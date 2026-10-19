// NEXUS OS — AI backend route.
//
// OpenAI-compatible proxy in front of the server-side model (z-ai-web-dev-sdk,
// GLM). The provider's key NEVER reaches the browser: the client talks to
// /api/ai/chat with OpenAI-style messages, and this route translates.
//
// Tool calling: the upstream SDK exposes plain chat completions, so we run a
// strict, documented protocol — available tools are serialized into the system
// prompt and the model is instructed to answer with a single JSON object when
// it wants to call tools. The route parses that object into OpenAI-style
// tool_calls. Nothing is fabricated: if the model outputs prose, we return
// prose; if its JSON is malformed, the raw text is returned verbatim.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 120;

// Static-export builds (GitHub Pages) cannot run server routes: the Pages
// build pipeline swaps `force-dynamic` → `force-static` via `bun run build:pages`
// (Next requires a literal here), and IS_STATIC_EXPORT below bakes an honest
// "unavailable" GET so the client falls back to BYOK providers.
const IS_STATIC_EXPORT = process.env.DEPLOY_TARGET === "gh-pages";
export const dynamic = "force-dynamic";

interface WireToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

interface WireMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface WireTool {
  type?: string;
  function?: { name?: string; description?: string; parameters?: unknown };
}

interface ChatBody {
  messages?: WireMessage[];
  tools?: WireTool[];
  temperature?: number;
}

const MAX_MESSAGES = 80;
const MAX_CHARS_PER_MESSAGE = 60_000;

function truncate(s: string): string {
  return s.length > MAX_CHARS_PER_MESSAGE ? s.slice(0, MAX_CHARS_PER_MESSAGE) + "\n…(truncated)" : s;
}

function toolProtocolPrompt(tools: WireTool[]): string {
  const specs = tools
    .map((t) => {
      const f = t.function ?? (t as unknown as { name?: string; description?: string; parameters?: unknown });
      if (!f?.name) return null;
      return `### ${f.name}\n${f.description ?? ""}\nparameters JSON schema: ${JSON.stringify(f.parameters ?? {})}`;
    })
    .filter(Boolean)
    .join("\n\n");

  return [
    "You are NEXUS OS's agent. You can invoke tools by responding with a single JSON object and NOTHING else:",
    '{"content": "<short user-facing text, may be empty>", "tool_calls": [{"name": "<tool name>", "arguments": {<json args>}}]}',
    "",
    "Rules:",
    "- Use EXACTLY this JSON shape. No markdown fences, no prose outside the JSON.",
    "- You may invoke multiple tools in one response by listing them in tool_calls.",
    "- If no tool is needed, answer in plain text (normal markdown is fine).",
    "- NEVER describe or narrate tool calls in prose — the literal string '[invoked tools' and similar annotations are FORBIDDEN in your output. To actually call a tool, emit the JSON object.",
    "- Never invent tool results. After tool results arrive (role=tool messages), continue the task or call more tools.",
    "",
    "Available tools:",
    specs,
  ].join("\n");
}

interface ParsedReply {
  content: string | null;
  toolCalls: WireToolCall[];
}

function stripFences(s: string): string {
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fence ? fence[1].trim() : s.trim();
}

function parseModelReply(text: string): ParsedReply {
  const trimmed = text.trim();
  // direct JSON object?
  const candidate = stripFences(trimmed);
  if (candidate.startsWith("{")) {
    try {
      const obj = JSON.parse(candidate) as {
        content?: string;
        tool_calls?: Array<{ name?: string; arguments?: unknown }>;
      };
      if (obj && (Array.isArray(obj.tool_calls) || typeof obj.content === "string")) {
        const calls: WireToolCall[] = (obj.tool_calls ?? [])
          .filter((c) => typeof c?.name === "string" && c.name)
          .map((c, i) => ({
            id: `call_${Date.now()}_${i}`,
            type: "function",
            function: {
              name: c.name!,
              arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? {}),
            },
          }));
        return { content: typeof obj.content === "string" ? obj.content : null, toolCalls: calls };
      }
    } catch {
      // fall through — treat as plain text
    }
  }
  // model may have embedded a JSON blob inside prose — extract the last {...} block
  const match = trimmed.match(/\{[\s\S]*"tool_calls"[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(stripFences(match[0])) as {
        content?: string;
        tool_calls?: Array<{ name?: string; arguments?: unknown }>;
      };
      if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
        const calls: WireToolCall[] = obj.tool_calls
          .filter((c) => typeof c?.name === "string" && c.name)
          .map((c, i) => ({
            id: `call_${Date.now()}_${i}`,
            type: "function",
            function: {
              name: c.name!,
              arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? {}),
            },
          }));
        return { content: typeof obj.content === "string" ? obj.content : null, toolCalls: calls };
      }
    } catch {
      // fall through
    }
  }
  return { content: text, toolCalls: [] };
}

function convertMessages(body: ChatBody): Array<{ role: "assistant" | "user"; content: string }> {
  const out: Array<{ role: "assistant" | "user"; content: string }> = [];
  for (const m of (body.messages ?? []).slice(-MAX_MESSAGES)) {
    const content = typeof m.content === "string" ? truncate(m.content) : "";
    if (m.role === "system" || m.role === "user") {
      out.push({ role: "user", content: content || "(empty)" });
    } else if (m.role === "assistant") {
      let text = content;
      if (m.toolCalls?.length) {
        const calls = m.toolCalls
          .map((c) => `${c.function?.name ?? "?"}(${c.function?.arguments ?? "{}"})`)
          .join("; ");
        text = `${content}\n(system note: in that turn you called: ${calls}. The results follow as TOOL RESULT messages.)`.trim();
      }
      if (text) out.push({ role: "assistant", content: text });
    } else if (m.role === "tool") {
      out.push({
        role: "user",
        content: `TOOL RESULT (${m.name ?? m.tool_call_id ?? "tool"}):\n${content || "(no output)"}`,
      });
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (IS_STATIC_EXPORT) {
    return NextResponse.json(
      { error: { message: "This NEXUS deployment is statically hosted — the AI backend route is unavailable. Configure a BYOK provider in settings." } },
      { status: 501 }
    );
  }
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: { message: "invalid JSON body" } }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: { message: "messages array required" } }, { status: 400 });
  }

  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();

    const messages = convertMessages(body);
    const tools = (body.tools ?? []).filter((t) => (t.function?.name ?? (t as { name?: string }).name));
    if (tools.length > 0) {
      messages.unshift({
        role: "assistant",
        content: toolProtocolPrompt(tools),
      });
    }

    const completion = await zai.chat.completions.create({
      messages,
      thinking: { type: "disabled" },
    });

    const raw = completion.choices?.[0]?.message?.content ?? "";
    const parsed = parseModelReply(raw);

    return NextResponse.json({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion",
      model: "nexus-backend",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: parsed.content,
            ...(parsed.toolCalls.length ? { tool_calls: parsed.toolCalls } : {}),
          },
          finish_reason: parsed.toolCalls.length ? "tool_calls" : "stop",
        },
      ],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: { message: `AI backend error: ${msg}` } }, { status: 502 });
  }
}

export async function GET() {
  // availability probe used by Settings + the AI app
  if (IS_STATIC_EXPORT) {
    return NextResponse.json({ ok: false, provider: "none", reason: "static-hosting" });
  }
  return NextResponse.json({ ok: true, provider: "nexus-backend", model: "glm" });
}
