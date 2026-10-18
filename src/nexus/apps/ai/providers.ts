"use client";

// NEXUS OS — AI provider abstraction (BYOK, browser-direct, no proxy).
// Two provider dialects: OpenAI-compatible /chat/completions and Anthropic
// /v1/messages (with the direct-browser-access header). All requests carry
// the user's own API key straight to the endpoint they configured.

export type ProviderType = "openai-compatible" | "anthropic";

export interface ProviderConfig {
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ToolCallOut {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCallOut[];
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON schema for the tool's arguments */
  parameters: object;
  risk: "read" | "write" | "danger";
}

export interface ChatResult {
  text: string;
  toolCalls: ToolCallOut[];
}

export class RequestAbortedError extends Error {
  constructor() {
    super("Request aborted");
    this.name = "RequestAbortedError";
  }
}

export const DEFAULT_BASE_URLS: Record<ProviderType, string> = {
  "openai-compatible": "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
};

const ANTHROPIC_VERSION = "2023-06-01";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function detailFrom(body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: unknown } };
    if (j && typeof j.error?.message === "string") return j.error.message;
  } catch {
    // plain-text body — use as-is
  }
  return body.slice(0, 400);
}

function httpError(status: number, body: string): Error {
  const d = detailFrom(body);
  if (status === 401 || status === 403) {
    return new Error(
      `HTTP ${status} — the API key was rejected (invalid or unauthorized). Provider said: ${d}`
    );
  }
  if (status === 404) {
    return new Error(
      `HTTP 404 — endpoint not found. Check the Base URL (OpenAI-compatible endpoints usually end in /v1). Provider said: ${d}`
    );
  }
  if (status === 429) {
    return new Error(`HTTP 429 — rate limited or quota exceeded. Provider said: ${d}`);
  }
  return new Error(`HTTP ${status} from provider: ${d}`);
}

function networkError(err: unknown, signal?: AbortSignal): Error {
  if (signal?.aborted) return new RequestAbortedError();
  if (err instanceof Error && err.name === "AbortError") return new RequestAbortedError();
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(
    `Network request failed before the provider answered. Causes: offline, wrong Base URL, or the provider blocking direct browser calls (CORS). Details: ${msg}`
  );
}

// ---------------- OpenAI-compatible ----------------

interface OpenAIWireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIResponseShape {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAIWireToolCall[];
    };
  }>;
}

async function chatOpenAI(
  cfg: ProviderConfig,
  messages: LLMMessage[],
  tools: ToolSpec[],
  signal?: AbortSignal
): Promise<ChatResult> {
  const url = stripTrailingSlash(cfg.baseUrl) + "/chat/completions";
  const wire: unknown[] = messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId ?? m.toolName ?? "", content: m.content };
    }
    if (m.role === "assistant") {
      const o: Record<string, unknown> = { role: "assistant", content: m.content || null };
      if (m.toolCalls && m.toolCalls.length > 0) {
        o.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        }));
      }
      return o;
    }
    return { role: m.role, content: m.content };
  });

  const body: Record<string, unknown> = { model: cfg.model, messages: wire };
  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = "auto";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw networkError(e, signal);
  }

  const raw = await res.text().catch(() => "");
  if (!res.ok) throw httpError(res.status, raw);
  let data: OpenAIResponseShape;
  try {
    data = JSON.parse(raw) as OpenAIResponseShape;
  } catch {
    throw new Error("Provider returned a non-JSON response — check the Base URL.");
  }

  const msg = data.choices?.[0]?.message;
  const text = typeof msg?.content === "string" ? msg.content : "";
  const toolCalls: ToolCallOut[] = [];
  for (const tc of msg?.tool_calls ?? []) {
    const id = tc.id;
    const name = tc.function?.name;
    if (!id || !name) continue;
    let args: Record<string, unknown> = {};
    const argStr = tc.function?.arguments;
    if (typeof argStr === "string" && argStr.trim()) {
      try {
        const parsed: unknown = JSON.parse(argStr);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        }
      } catch {
        // malformed model JSON — keep a capped raw copy so validation can reject honestly
        args = { _raw: argStr.slice(0, 500) };
      }
    }
    toolCalls.push({ id, name, args });
  }
  return { text, toolCalls };
}

// ---------------- Anthropic ----------------

type AnthropicBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicResponseShape {
  content?: Array<{
    type?: string;
    text?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
}

function buildAnthropicMessages(messages: LLMMessage[]): {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: AnthropicBlock[] }>;
} {
  const systemParts: string[] = [];
  const out: Array<{ role: "user" | "assistant"; content: AnthropicBlock[] }> = [];
  const push = (role: "user" | "assistant", block: AnthropicBlock) => {
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(block);
    else out.push({ role, content: [block] });
  };
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
      continue;
    }
    if (m.role === "user") {
      push("user", { type: "text", text: m.content });
      continue;
    }
    if (m.role === "tool") {
      push("user", { type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content });
      continue;
    }
    if (m.content) push("assistant", { type: "text", text: m.content });
    for (const tc of m.toolCalls ?? []) {
      push("assistant", { type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
    }
  }
  return { system: systemParts.join("\n\n"), messages: out.filter((m) => m.content.length > 0) };
}

async function chatAnthropic(
  cfg: ProviderConfig,
  messages: LLMMessage[],
  tools: ToolSpec[],
  signal?: AbortSignal
): Promise<ChatResult> {
  const base = stripTrailingSlash(cfg.baseUrl);
  const url = base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;
  const { system, messages: anthropicMessages } = buildAnthropicMessages(messages);

  const body: Record<string, unknown> = {
    model: cfg.model,
    max_tokens: 4096,
    messages: anthropicMessages,
  };
  if (system) body.system = system;
  if (tools.length > 0) {
    body.tools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    throw networkError(e, signal);
  }

  const raw = await res.text().catch(() => "");
  if (!res.ok) throw httpError(res.status, raw);
  let data: AnthropicResponseShape;
  try {
    data = JSON.parse(raw) as AnthropicResponseShape;
  } catch {
    throw new Error("Provider returned a non-JSON response — check the Base URL.");
  }

  const textParts: string[] = [];
  const toolCalls: ToolCallOut[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    } else if (
      block.type === "tool_use" &&
      typeof block.id === "string" &&
      typeof block.name === "string"
    ) {
      const input: unknown = block.input;
      const args =
        input && typeof input === "object" && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};
      toolCalls.push({ id: block.id, name: block.name, args });
    }
  }
  return { text: textParts.join("\n"), toolCalls };
}

// ---------------- public entry point ----------------

export async function chat(
  cfg: ProviderConfig,
  messages: LLMMessage[],
  tools: ToolSpec[],
  signal?: AbortSignal
): Promise<ChatResult> {
  if (!cfg.apiKey) {
    throw new Error("No API key configured. Open the provider settings (gear icon) and add one.");
  }
  if (!cfg.model) {
    throw new Error("No model configured. Open the provider settings (gear icon).");
  }
  if (!cfg.baseUrl) {
    throw new Error("No Base URL configured. Open the provider settings (gear icon).");
  }
  return cfg.type === "anthropic"
    ? chatAnthropic(cfg, messages, tools, signal)
    : chatOpenAI(cfg, messages, tools, signal);
}

/** Minimal real request used by the config screen's "Test connection". */
export async function testConnection(
  cfg: ProviderConfig
): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const t0 = Date.now();
  try {
    await chat(cfg, [{ role: "user", content: "Reply with the single word: pong" }], []);
    return { ok: true, ms: Math.max(1, Date.now() - t0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
