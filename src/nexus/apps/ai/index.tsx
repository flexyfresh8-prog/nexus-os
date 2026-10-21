"use client";

// NEXUS OS — Nexus AI: BYOK agent workspace. Provider config lives in
// IndexedDB; requests go straight from the browser to the configured
// endpoint (no proxy exists — the OS is statically hosted). Agent mode
// runs a plan → tool-step loop with user approval for write/danger tools.
// Everything the model "knows" comes from real tool results — nothing is
// simulated or fabricated here.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { z } from "zod";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  History,
  ListOrdered,
  Loader2,
  Lock,
  Plus,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { AppInstanceProps } from "../../types";
import { kvGet, kvSet, idbDelete, STORE_KV } from "../../lib/idb";
import { sealKV, openKV, deleteKV, audit } from "../../lib/secure";
import { uid } from "../../lib/utils";
import {
  DEFAULT_BASE_URLS,
  RequestAbortedError,
  chat,
  testConnection,
  type ChatResult,
  type LLMMessage,
  type ProviderConfig,
  type ProviderType,
} from "./providers";
import { TOOL_SPECS, executeToolWithApproval } from "./tools";
import type {
  ChatMessage,
  HistoryStep,
  TaskRecord,
  TaskStatus,
  ToolStep,
  ToolStepStatus,
} from "./types";
import { clearTasks, loadTasks, saveTask } from "./history";

const PROVIDER_KEY = "ai:provider";
// encrypted-at-rest location (sealed with the per-installation device key);
// the legacy plaintext key above is only read once for migration, then removed.
const PROVIDER_SECRET_KEY = "secret:ai:provider";
const MAX_STEPS = 12;
const MAX_TRANSCRIPT = 40;

// ---------------- prompts ----------------

const SYSTEM_AGENT = [
  "You are NEXUS AI, the built-in agent of NEXUS OS — a desktop environment that runs entirely in the user's browser.",
  "You operate a virtual filesystem (rooted at /home with folders Documents, Downloads, Projects, Pictures, Music, Desktop) and can launch installed apps.",
  "Path conventions: absolute virtual paths like /home/Projects/my-site/index.html. The sandbox only allows paths under /home/Projects or /home/Documents — everything else is blocked. Files are text-based (html, css, js, json, md, txt...); binary files cannot be read.",
  "Tool rules: make ONE tool call per reply and wait for its result before continuing. Write and danger tools require explicit user approval — if the user denies, do not retry the same action; adapt or ask. Never fabricate tool results or file contents; always verify with tools. When the task is complete, reply with a short final summary and no tool call.",
  "Valid app ids for open_app: files, terminal, studio, ai, browser, settings.",
].join("\n");

const SYSTEM_PLAN =
  SYSTEM_AGENT +
  "\n\nFIRST REPLY: respond with ONLY a short numbered plan (2-5 steps) for the user's task. Do not call any tools in this first reply.";

const EXECUTE_INSTRUCTION =
  "Plan noted. Execute it now with the available tools. Make ONE tool call per reply and wait for its result. When everything is done, reply with a short final summary and no tool call.";

const WRAP_UP_INSTRUCTION =
  "The tool step budget (12) is exhausted. Reply with a final summary of what was completed and what remains, with no tool call.";

const SYSTEM_PLAIN =
  "You are NEXUS AI, the built-in assistant of NEXUS OS — a desktop environment that runs entirely in the user's browser. Answer helpfully and concisely in plain text. Tools are disabled in this mode.";

const NXAI_CSS = `
@keyframes nxai-blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
.nxai-dot { display: inline-block; width: 6px; height: 6px; border-radius: 9999px; background: var(--nx-accent); animation: nxai-blink 1.2s infinite; }
.nxai-dot:nth-child(2) { animation-delay: 0.15s; }
.nxai-dot:nth-child(3) { animation-delay: 0.3s; }
`;

// ---------------- helpers ----------------

class StopError extends Error {}

const providerSchema = z.union([
  z.object({
    type: z.literal("nexus-backend"),
    baseUrl: z.string().max(0).optional().default(""),
    apiKey: z.string().max(0).optional().default(""),
    model: z.string().optional().default(""),
  }),
  z.object({
    type: z.enum(["openai-compatible", "anthropic"]),
    baseUrl: z.string().min(1),
    apiKey: z.string().min(1),
    model: z.string().min(1),
  }),
]);

function parseConfig(v: unknown): ProviderConfig | null {
  const r = providerSchema.safeParse(v);
  return r.success ? r.data : null;
}

function parsePlan(text: string): string[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const steps = lines
    .filter((l) => /^\d+[.)]/.test(l) || /^[-*]/.test(l))
    .map((l) => l.replace(/^\d+[.)]\s*/, "").replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 8);
  if (steps.length === 0 && text) return [text.slice(0, 200)];
  return steps;
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function formatArgs(args: Record<string, unknown>): string {
  const parts = Object.entries(args).map(([k, v]) => {
    const s = typeof v === "string" ? v : safeStringify(v);
    return `${k}: ${s.length > 400 ? s.slice(0, 400) + ` ...(+${s.length - 400} chars)` : s}`;
  });
  return parts.length > 0 ? parts.join("\n") : "(no arguments)";
}

// ---------------- shared class names ----------------

const inputCls =
  "w-full rounded-lg border border-[var(--nx-border)] bg-[rgba(127,127,127,0.1)] px-3 py-2 text-sm text-[var(--nx-text)] outline-none transition-colors focus:border-[rgba(var(--nx-accent-rgb),0.6)]";

const labelCls =
  "mb-1 block text-[11px] font-medium uppercase tracking-wider text-[var(--nx-text-dim)]";

const taCls =
  "nx-scroll min-h-[42px] flex-1 resize-none rounded-xl border border-[var(--nx-border)] bg-[rgba(127,127,127,0.1)] px-3 py-2.5 text-sm text-[var(--nx-text)] outline-none transition-colors focus:border-[rgba(var(--nx-accent-rgb),0.6)] disabled:opacity-60";

// ---------------- small components ----------------

function IconButton({
  title,
  onClick,
  children,
  disabled,
  active,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-8 w-8 place-items-center rounded-lg border transition-colors disabled:opacity-40 ${
        active
          ? "border-[rgba(var(--nx-accent-rgb),0.5)] bg-[rgba(var(--nx-accent-rgb),0.12)] text-[var(--nx-accent)]"
          : "border-transparent text-[var(--nx-text-dim)] hover:border-[var(--nx-border)] hover:text-[var(--nx-text)]"
      }`}
    >
      {children}
    </button>
  );
}

function StatusIcon({ status }: { status: ToolStepStatus }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--nx-accent)]" />;
  }
  if (status === "awaiting-approval") return <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
  if (status === "done") return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  if (status === "denied") return <X className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
  return <X className="h-3.5 w-3.5 shrink-0 text-red-400" />;
}

function PlanCard({ steps }: { steps: string[] }) {
  return (
    <div className="mb-2 rounded-xl border border-[rgba(var(--nx-accent-rgb),0.35)] bg-[rgba(var(--nx-accent-rgb),0.08)] p-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--nx-accent)]">
        <ListOrdered className="h-3.5 w-3.5" />
        Plan
      </div>
      <ol className="ml-4 list-decimal space-y-1 text-[13px] leading-snug text-[var(--nx-text)]">
        {steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

function ToolCard({
  step,
  onResolve,
}: {
  step: ToolStep;
  onResolve: (id: string, ok: boolean) => void;
}) {
  const [open, setOpen] = useState(step.status === "awaiting-approval");
  const risk = TOOL_SPECS.find((t) => t.name === step.name)?.risk ?? "read";
  const riskCls =
    risk === "danger"
      ? "border-red-400/40 text-red-400"
      : risk === "write"
        ? "border-amber-400/40 text-amber-400"
        : "border-[var(--nx-border)] text-[var(--nx-text-dim)]";
  const argText = formatArgs(step.args);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--nx-border)] bg-[rgba(127,127,127,0.06)] text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        <StatusIcon status={step.status} />
        <span className="font-mono text-xs text-[var(--nx-text)]">{step.name}</span>
        <span className={`rounded border px-1 text-[9px] uppercase tracking-wide ${riskCls}`}>
          {risk}
        </span>
        <span className="ml-auto text-[var(--nx-text-dim)]">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
      </button>
      {open && (
        <div className="border-t border-[var(--nx-border)] px-2.5 py-2">
          <div className="text-[10px] uppercase tracking-wide text-[var(--nx-text-dim)]">
            Arguments
          </div>
          <pre className="nx-scroll mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
            {argText}
          </pre>
          {step.summary && (
            <>
              <div className="mt-2 text-[10px] uppercase tracking-wide text-[var(--nx-text-dim)]">
                Result
              </div>
              <pre className="nx-scroll mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[var(--nx-text)]">
                {step.summary}
              </pre>
            </>
          )}
          {step.error && (
            <div className="mt-2 break-words text-[11px] leading-relaxed text-red-400">
              Error: {step.error}
            </div>
          )}
          {step.status === "awaiting-approval" && (
            <div className="mt-2.5 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5">
              <div className="flex items-start gap-1.5 text-xs leading-relaxed text-amber-400">
                <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  This {risk === "danger" ? "destructive" : "file-modifying"} action needs your
                  approval before it runs.
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => onResolve(step.id, true)}
                  className="rounded-lg bg-[var(--nx-accent)] px-3 py-1 text-xs font-semibold text-black transition hover:brightness-110"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => onResolve(step.id, false)}
                  className="rounded-lg border border-[var(--nx-border)] px-3 py-1 text-xs text-[var(--nx-text-dim)] transition hover:text-[var(--nx-text)]"
                >
                  Deny
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageView({
  msg,
  onRetry,
  onResolveApproval,
}: {
  msg: ChatMessage;
  onRetry: () => void;
  onResolveApproval: (id: string, ok: boolean) => void;
}) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-[rgba(var(--nx-accent-rgb),0.4)] bg-[rgba(var(--nx-accent-rgb),0.14)] px-3.5 py-2 text-sm leading-relaxed text-[var(--nx-text)]">
          {msg.text}
        </div>
      </div>
    );
  }
  if (msg.role === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-red-400/40 bg-red-500/10 px-3.5 py-2.5 text-sm">
          <div className="whitespace-pre-wrap break-words leading-relaxed text-red-400">
            {msg.text}
          </div>
          {msg.retryable && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 rounded-lg border border-red-400/40 px-2.5 py-1 text-xs text-red-400 transition hover:bg-red-500/10"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="nx-glass max-w-[85%] rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm text-[var(--nx-text)]">
        {msg.plan && msg.plan.length > 0 && <PlanCard steps={msg.plan} />}
        {msg.text && (
          <div className="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</div>
        )}
        {msg.toolSteps && msg.toolSteps.length > 0 && (
          <div className={msg.text || msg.plan ? "mt-2 space-y-1.5" : "space-y-1.5"}>
            {msg.toolSteps.map((s) => (
              <ToolCard key={s.id} step={s} onResolve={onResolveApproval} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="nx-glass flex items-center gap-1.5 rounded-2xl rounded-bl-md px-3.5 py-3.5">
        <span className="nxai-dot" />
        <span className="nxai-dot" />
        <span className="nxai-dot" />
      </div>
    </div>
  );
}

function EmptyState({
  agentMode,
  onPick,
}: {
  agentMode: boolean;
  onPick: (t: string) => void;
}) {
  const chips = [
    "Create a project called portfolio with an index.html",
    "Summarize welcome.md",
    "What can you do?",
  ];
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="nx-accent-glow grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-teal-600 text-white">
        <Sparkles className="h-6 w-6" />
      </div>
      <div>
        <div className="text-base font-medium text-[var(--nx-text)]">Nexus AI</div>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-[var(--nx-text-dim)]">
          {agentMode
            ? "Agent mode is on: I plan the task, use OS tools (files, apps) step by step, and ask for your approval before changing anything."
            : "Plain chat mode: ask anything — tools are disabled."}
        </p>
      </div>
      <div className="flex max-w-md flex-wrap justify-center gap-2">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            className="rounded-full border border-[var(--nx-border)] bg-[rgba(127,127,127,0.08)] px-3 py-1.5 text-xs text-[var(--nx-text-dim)] transition-colors hover:border-[rgba(var(--nx-accent-rgb),0.5)] hover:text-[var(--nx-text)]"
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: TaskStatus }) {
  const cls =
    status === "completed"
      ? "bg-emerald-400"
      : status === "failed"
        ? "bg-red-400"
        : status === "stopped"
          ? "bg-amber-400"
          : "bg-[var(--nx-accent)]";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} />;
}

function HistoryPanel({
  tasks,
  onOpen,
  onClose,
  onClear,
}: {
  tasks: TaskRecord[];
  onOpen: (t: TaskRecord) => void;
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <aside className="nx-glass-strong nx-slide-right absolute inset-y-0 right-0 z-20 flex w-80 max-w-full flex-col border-l border-[var(--nx-border)]">
      <div className="flex items-center gap-2 border-b border-[var(--nx-border)] px-3 py-2.5">
        <History className="h-4 w-4 text-[var(--nx-text-dim)]" />
        <span className="text-sm font-medium text-[var(--nx-text)]">Task history</span>
        {tasks.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto flex items-center gap-1 text-[11px] text-[var(--nx-text-dim)] transition-colors hover:text-red-400"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        )}
        <IconButton title="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>
      <div className="nx-scroll flex-1 space-y-1.5 overflow-y-auto p-2">
        {tasks.length === 0 && (
          <div className="p-4 text-center text-xs text-[var(--nx-text-dim)]">
            No tasks yet. Completed agent tasks appear here.
          </div>
        )}
        {tasks.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onOpen(t)}
            className="w-full rounded-xl border border-[var(--nx-border)] bg-[rgba(127,127,127,0.05)] p-2.5 text-left transition-colors hover:border-[rgba(var(--nx-accent-rgb),0.4)]"
          >
            <div className="flex items-center gap-2">
              <StatusDot status={t.status} />
              <span className="text-[11px] text-[var(--nx-text-dim)]">
                {new Date(t.ts).toLocaleString()}
              </span>
              <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--nx-text-dim)]">
                {t.status}
              </span>
            </div>
            <div className="mt-1 line-clamp-2 text-xs leading-snug text-[var(--nx-text)]">
              {t.task}
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}

function TranscriptBubble({ msg }: { msg: { role: string; text: string } }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md border border-[rgba(var(--nx-accent-rgb),0.4)] bg-[rgba(var(--nx-accent-rgb),0.14)] px-3.5 py-2 text-sm leading-relaxed text-[var(--nx-text)]">
          {msg.text}
        </div>
      </div>
    );
  }
  if (msg.role === "error") {
    return (
      <div className="flex justify-start">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md border border-red-400/40 bg-red-500/10 px-3.5 py-2 text-sm leading-relaxed text-red-400">
          {msg.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="nx-glass max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed text-[var(--nx-text)]">
        {msg.text}
      </div>
    </div>
  );
}

function TranscriptView({ task, onBack }: { task: TaskRecord; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--nx-border)] px-4 py-2.5">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 flex items-center gap-1 text-xs text-[var(--nx-text-dim)] transition-colors hover:text-[var(--nx-text)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to chat
        </button>
        <div className="flex items-center gap-2">
          <StatusDot status={task.status} />
          <span className="text-[11px] text-[var(--nx-text-dim)]">
            {new Date(task.ts).toLocaleString()} · {task.status} ·{" "}
            {task.steps.length} tool step{task.steps.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--nx-text)]">
          {task.task}
        </div>
      </div>
      <div className="nx-scroll flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {task.transcript.map((m, i) => (
          <TranscriptBubble key={i} msg={m} />
        ))}
        {task.steps.length > 0 && (
          <div className="nx-glass rounded-2xl p-3 text-xs">
            <div className="mb-1.5 text-[11px] uppercase tracking-wider text-[var(--nx-text-dim)]">
              Tool steps
            </div>
            <ul className="space-y-1">
              {task.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="shrink-0 font-mono text-[var(--nx-text)]">{s.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[var(--nx-text-dim)]">
                    {s.error ? `Error: ${s.error}` : s.summary ? s.summary.slice(0, 120) : s.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- config screen ----------------

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; ms: number }
  | { kind: "fail"; error: string };

function ConfigScreen({
  form,
  onPatch,
  test,
  onTest,
  onSave,
  onCancel,
  hasExisting,
}: {
  form: ProviderConfig;
  onPatch: (p: Partial<ProviderConfig>) => void;
  test: TestState;
  onTest: () => void;
  onSave: () => void;
  onCancel: () => void;
  hasExisting: boolean;
}) {
  const [showKey, setShowKey] = useState(false);
  const placeholder = form.type === "anthropic" ? "claude-sonnet-4-5" : "gpt-4o-mini";
  const isBackend = form.type === "nexus-backend";
  return (
    <div className="nx-scroll h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-lg">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-400 to-teal-600 text-white">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-medium text-[var(--nx-text)]">
              Connect an AI provider
            </div>
            <div className="text-[11px] text-[var(--nx-text-dim)]">
              Use the built-in NEXUS backend, or bring your own key.
            </div>
          </div>
        </div>
        <div className="nx-glass space-y-4 rounded-2xl p-4">
          {isBackend ? (
            <p className="text-xs leading-relaxed text-[var(--nx-text-dim)]">
              The <b>NEXUS backend</b> routes requests through this deployment&apos;s own server
              route — the model and its credentials stay server-side and never touch the browser.
              Nothing to configure. If this copy of NEXUS is statically hosted (no server
              routes), pick a BYOK provider below instead.
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-[var(--nx-text-dim)]">
              Bring your own key. It is stored <b>encrypted (AES-GCM) at rest</b> in this
              browser&apos;s IndexedDB — never in backups or exports — and is sent ONLY to the
              provider endpoint you configure. BYOK calls go straight from the browser, so
              choose providers that allow browser CORS calls.
            </p>
          )}
          {form.type === "anthropic" && (
            <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-400">
              Anthropic requires the header{" "}
              <span className="font-mono">
                anthropic-dangerous-direct-browser-access: true
              </span>{" "}
              for direct browser calls — it is sent automatically.
            </p>
          )}
          <div>
            <label htmlFor="nxai-provider" className={labelCls}>
              Provider type
            </label>
            <select
              id="nxai-provider"
              value={form.type}
              onChange={(e) => {
                const t = e.target.value as ProviderType;
                onPatch({ type: t, baseUrl: DEFAULT_BASE_URLS[t] });
              }}
              className={inputCls}
            >
              <option value="nexus-backend">NEXUS backend (built-in)</option>
              <option value="openai-compatible">OpenAI-compatible (BYOK)</option>
              <option value="anthropic">Anthropic (BYOK)</option>
            </select>
          </div>
          {!isBackend && (
            <>
              <div>
                <label htmlFor="nxai-baseurl" className={labelCls}>
                  Base URL
                </label>
                <input
                  id="nxai-baseurl"
                  value={form.baseUrl}
                  onChange={(e) => onPatch({ baseUrl: e.target.value })}
                  placeholder={DEFAULT_BASE_URLS[form.type]}
                  className={inputCls}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="nxai-key" className={labelCls}>
                  API key
                </label>
                <div className="relative">
                  <input
                    id="nxai-key"
                    type={showKey ? "text" : "password"}
                    value={form.apiKey}
                    onChange={(e) => onPatch({ apiKey: e.target.value })}
                    placeholder="Paste your key"
                    className={`${inputCls} pr-10`}
                    spellCheck={false}
                    autoComplete="off"
                  />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? "Hide key" : "Show key"}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--nx-text-dim)] transition-colors hover:text-[var(--nx-text)]"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label htmlFor="nxai-model" className={labelCls}>
              Model
            </label>
            <input
              id="nxai-model"
              value={form.model}
              onChange={(e) => onPatch({ model: e.target.value })}
              placeholder={placeholder}
              className={inputCls}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
            </>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onTest}
              disabled={test.kind === "testing"}
              className="rounded-lg border border-[var(--nx-border)] px-3 py-1.5 text-xs text-[var(--nx-text)] transition-colors hover:border-[rgba(var(--nx-accent-rgb),0.5)] disabled:opacity-50"
            >
              {test.kind === "testing" ? "Testing..." : "Test connection"}
            </button>
            <button
              type="button"
              onClick={onSave}
              className="rounded-lg bg-[var(--nx-accent)] px-4 py-1.5 text-xs font-semibold text-black transition hover:brightness-110"
            >
              Save
            </button>
            {hasExisting && (
              <button
                type="button"
                onClick={onCancel}
                className="ml-auto text-xs text-[var(--nx-text-dim)] transition-colors hover:text-[var(--nx-text)]"
              >
                Cancel
              </button>
            )}
          </div>
          {test.kind === "ok" && (
            <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-400">
              Connected — the provider answered a real request in {test.ms} ms.
            </div>
          )}
          {test.kind === "fail" && (
            <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-400">
              {test.error}
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
            You can change this anytime with the gear button in the chat header.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------- main app ----------------

type View = "loading" | "config" | "chat";

export default function AIApp(_props: AppInstanceProps) {
  const [view, setView] = useState<View>("loading");
  const [cfg, setCfg] = useState<ProviderConfig | null>(null);
  const [form, setForm] = useState<ProviderConfig>({
    type: "nexus-backend",
    baseUrl: "",
    apiKey: "",
    model: "",
  });
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [agentMode, setAgentMode] = useState(true);
  const [running, setRunning] = useState(false);
  const [stepCount, setStepCount] = useState(0);
  const [statusLine, setStatusLine] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [viewing, setViewing] = useState<TaskRecord | null>(null);

  const cfgRef = useRef<ProviderConfig | null>(null);
  const runningRef = useRef(false);
  const stopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const lastTaskRef = useRef("");
  const approvalsRef = useRef<Map<string, (ok: boolean) => void>>(new Map());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // load provider config + task history
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        // encrypted-at-rest first; migrate legacy plaintext if present
        let raw: unknown = await openKV<unknown>(PROVIDER_SECRET_KEY);
        if (raw === null) {
          const legacy = await kvGet<unknown>(PROVIDER_KEY);
          if (legacy && typeof legacy === "object") {
            raw = legacy;
            void sealKV(PROVIDER_SECRET_KEY, "ai-provider", legacy)
              .then(() => idbDelete(STORE_KV, PROVIDER_KEY))
              .catch(() => {});
            audit("ai:provider-saved", "migrated legacy plaintext config to encrypted storage");
          }
        }
        const parsed = parseConfig(raw);
        if (!alive) return;
        if (parsed) {
          cfgRef.current = parsed;
          setCfg(parsed);
          setView("chat");
        } else {
          // no saved config: probe the NEXUS backend first — when this
          // deployment has server routes, AI works with zero configuration
          try {
            const res = await fetch("/api/ai/chat", { method: "GET" });
            const probe = (await res.json().catch(() => null)) as { ok?: boolean } | null;
            if (res.ok && probe?.ok === true) {
              const backendCfg: ProviderConfig = { type: "nexus-backend", baseUrl: "", apiKey: "", model: "" };
              cfgRef.current = backendCfg;
              setCfg(backendCfg);
              setForm(backendCfg);
              setView("chat");
              return;
            }
          } catch { /* static hosting — fall through to BYOK config */ }
          setView("config");
        }
        setTasks(await loadTasks());
      } catch {
        if (alive) setView("config");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // keep the message list scrolled to the newest entry
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, viewing, running]);

  const runTask = async (task: string, useAgent: boolean) => {
    const config = cfgRef.current;
    if (!config) {
      setView("config");
      return;
    }
    runningRef.current = true;
    stopRef.current = false;
    setRunning(true);
    setStepCount(0);
    setStatusLine(useAgent ? "Drafting a plan..." : "Thinking...");
    setMessages((m) => [...m, { id: uid(), role: "user", text: task, ts: Date.now() }]);

    const abort = new AbortController();
    abortRef.current = abort;
    const callLLM = (msgs: LLMMessage[], withTools: boolean): Promise<ChatResult> =>
      chat(config, msgs, withTools ? TOOL_SPECS : [], abort.signal);

    const steps: HistoryStep[] = [];
    const transcript: Array<{ role: "user" | "assistant" | "error"; text: string }> = [
      { role: "user", text: task },
    ];
    let status: TaskStatus = "completed";
    let finalText = "";

    const pushAssistant = (text: string, plan?: string[]) =>
      setMessages((m) => [...m, { id: uid(), role: "assistant", text, ts: Date.now(), plan }]);
    const pushError = (text: string) =>
      setMessages((m) => [
        ...m,
        { id: uid(), role: "error", text, ts: Date.now(), retryable: true },
      ]);
    const askApproval = (stepId: string, toolName: string): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        approvalsRef.current.set(stepId, resolve);
        setStatusLine(`Waiting for approval: ${toolName}`);
      });

    try {
      if (!useAgent) {
        const llm: LLMMessage[] = [
          { role: "system", content: SYSTEM_PLAIN },
          { role: "user", content: task },
        ];
        const res = await callLLM(llm, false);
        finalText = res.text.trim() || "(the model returned an empty response)";
        pushAssistant(finalText);
        transcript.push({ role: "assistant", text: finalText });
      } else {
        const llm: LLMMessage[] = [
          { role: "system", content: SYSTEM_PLAN },
          { role: "user", content: task },
        ];
        const planRes = await callLLM(llm, false);
        if (stopRef.current) throw new StopError();
        const planText = planRes.text.trim();
        const planSteps = parsePlan(planText);
        const shownPlan =
          planSteps.length > 0 ? planSteps : planText ? [planText] : ["(the model returned an empty plan)"];
        llm.push({ role: "assistant", content: planText || "(empty plan)" });
        llm.push({ role: "user", content: EXECUTE_INSTRUCTION });
        pushAssistant("", shownPlan);
        transcript.push({ role: "assistant", text: planText || "(empty plan)" });

        let used = 0;
        while (true) {
          if (stopRef.current) throw new StopError();
          if (used >= MAX_STEPS) {
            llm.push({ role: "user", content: WRAP_UP_INSTRUCTION });
            setStatusLine("Wrapping up...");
            const r = await callLLM(llm, false);
            finalText =
              r.text.trim() ||
              "Stopped: the 12-step tool budget was exhausted before a final summary.";
            pushAssistant(finalText);
            transcript.push({ role: "assistant", text: finalText });
            break;
          }
          setStatusLine(`Step ${used + 1}/${MAX_STEPS}...`);
          const res = await callLLM(llm, true);
          if (stopRef.current) throw new StopError();
          if (res.toolCalls.length === 0) {
            finalText = res.text.trim() || "(the model returned an empty response)";
            pushAssistant(finalText);
            transcript.push({ role: "assistant", text: finalText });
            break;
          }
          llm.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls });
          const turnMsgId = uid();
          const stepObjs: ToolStep[] = res.toolCalls.map((tc) => ({
            id: uid(),
            name: tc.name,
            args: tc.args,
            status: "running",
          }));
          setMessages((m) => [
            ...m,
            {
              id: turnMsgId,
              role: "assistant",
              text: res.text.trim(),
              ts: Date.now(),
              toolSteps: stepObjs,
            },
          ]);
          const updateStep = (sid: string, patch: Partial<ToolStep>) =>
            setMessages((m) =>
              m.map((msg) =>
                msg.id === turnMsgId
                  ? {
                      ...msg,
                      toolSteps: (msg.toolSteps ?? []).map((s) =>
                        s.id === sid ? { ...s, ...patch } : s
                      ),
                    }
                  : msg
              )
            );

          for (let i = 0; i < res.toolCalls.length; i++) {
            const tc = res.toolCalls[i];
            const st = stepObjs[i];
            if (stopRef.current) {
              const skipped = "Skipped: the user stopped the task.";
              updateStep(st.id, { status: "denied", summary: skipped });
              steps.push({ name: tc.name, status: "stopped", summary: skipped });
              llm.push({
                role: "tool",
                toolCallId: tc.id,
                toolName: tc.name,
                content: skipped,
              });
              continue;
            }
            if (used >= MAX_STEPS) {
              const skipped = "Skipped: the 12-step tool budget was exhausted.";
              updateStep(st.id, { status: "error", summary: skipped });
              steps.push({ name: tc.name, status: "skipped", summary: skipped });
              llm.push({
                role: "tool",
                toolCallId: tc.id,
                toolName: tc.name,
                content: skipped,
              });
              continue;
            }
            used += 1;
            setStepCount(used);
            setStatusLine(`Step ${used}/${MAX_STEPS}: ${tc.name}`);
            let denied = false;
            try {
              const result = await executeToolWithApproval(tc.name, tc.args, async (info) => {
                updateStep(st.id, { status: "awaiting-approval" });
                const ok = await askApproval(st.id, info.name);
                if (!ok) denied = true;
                return ok;
              });
              if (denied) {
                updateStep(st.id, { status: "denied", summary: result.summary });
                steps.push({ name: tc.name, status: "denied", summary: result.summary });
              } else {
                updateStep(st.id, { status: "done", summary: result.summary });
                steps.push({ name: tc.name, status: "done", summary: result.summary });
              }
              llm.push({
                role: "tool",
                toolCallId: tc.id,
                toolName: tc.name,
                content: result.summary.slice(0, 8000),
              });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              updateStep(st.id, { status: "error", error: msg });
              steps.push({ name: tc.name, status: "error", error: msg });
              llm.push({
                role: "tool",
                toolCallId: tc.id,
                toolName: tc.name,
                content: `Error: ${msg}`.slice(0, 8000),
              });
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof StopError || e instanceof RequestAbortedError) {
        status = "stopped";
        const note =
          e instanceof StopError
            ? "Stopped by user. Completed steps keep their results above."
            : "Request aborted.";
        finalText = finalText || "Stopped by user.";
        pushAssistant(note);
        transcript.push({ role: "assistant", text: note });
      } else {
        status = "failed";
        const msg = e instanceof Error ? e.message : String(e);
        pushError(`Request failed: ${msg}`);
        transcript.push({ role: "error", text: msg });
      }
    } finally {
      abortRef.current = null;
      runningRef.current = false;
      stopRef.current = false;
      setRunning(false);
      setStatusLine("");
    }

    try {
      await saveTask({
        id: uid(),
        task,
        ts: Date.now(),
        status,
        summary: finalText.slice(0, 200),
        steps: steps.map((s) => ({
          name: s.name,
          status: s.status,
          summary: s.summary?.slice(0, 300),
          error: s.error?.slice(0, 300),
        })),
        transcript: transcript.slice(-MAX_TRANSCRIPT),
      });
      setTasks(await loadTasks());
    } catch {
      // history persistence is best-effort
    }
  };

  const submitText = (raw: string) => {
    const text = raw.trim();
    if (!text || runningRef.current) return;
    if (!cfgRef.current) {
      setView("config");
      return;
    }
    lastTaskRef.current = text;
    setInput("");
    void runTask(text, agentMode);
  };

  const stopRun = () => {
    stopRef.current = true;
    abortRef.current?.abort();
    for (const resolve of approvalsRef.current.values()) resolve(false);
    approvalsRef.current.clear();
  };

  const resolveApproval = (stepId: string, ok: boolean) => {
    const resolve = approvalsRef.current.get(stepId);
    if (resolve) {
      approvalsRef.current.delete(stepId);
      resolve(ok);
    }
  };

  const openConfig = () => {
    if (runningRef.current) return;
    setTest({ kind: "idle" });
    setForm(
      cfg ?? {
        type: "nexus-backend",
        baseUrl: "",
        apiKey: "",
        model: "",
      }
    );
    setView("config");
  };

  const saveConfig = () => {
    const clean: ProviderConfig =
      form.type === "nexus-backend"
        ? { type: "nexus-backend", baseUrl: "", apiKey: "", model: "" }
        : {
            type: form.type,
            baseUrl: form.baseUrl.trim() || DEFAULT_BASE_URLS[form.type],
            apiKey: form.apiKey.trim(),
            model: form.model.trim(),
          };
    if (form.type !== "nexus-backend" && !clean.apiKey) {
      setTest({ kind: "fail", error: "An API key is required." });
      return;
    }
    if (form.type !== "nexus-backend" && !clean.model) {
      setTest({ kind: "fail", error: "A model name is required." });
      return;
    }
    void (async () => {
      try {
        await sealKV(PROVIDER_SECRET_KEY, "ai-provider", clean);
        audit("ai:provider-saved", `provider=${clean.type}, key stored encrypted at rest`);
        cfgRef.current = clean;
        setCfg(clean);
        setView("chat");
        setTest({ kind: "idle" });
      } catch (e) {
        setTest({
          kind: "fail",
          error: `Could not save locally: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
    })();
  };

  const runTest = () => {
    if (test.kind === "testing") return;
    const candidate: ProviderConfig =
      form.type === "nexus-backend"
        ? { type: "nexus-backend", baseUrl: "", apiKey: "", model: "" }
        : {
            type: form.type,
            baseUrl: form.baseUrl.trim() || DEFAULT_BASE_URLS[form.type],
            apiKey: form.apiKey.trim(),
            model: form.model.trim(),
          };
    if (form.type !== "nexus-backend" && (!candidate.apiKey || !candidate.model)) {
      setTest({ kind: "fail", error: "Enter an API key and a model name first." });
      return;
    }
    setTest({ kind: "testing" });
    void testConnection(candidate).then((r) =>
      setTest(r.ok ? { kind: "ok", ms: r.ms } : { kind: "fail", error: r.error })
    );
  };

  const newChat = () => {
    if (runningRef.current) return;
    setMessages([]);
    setViewing(null);
  };

  const wipeHistory = () => {
    void clearTasks()
      .then(() => {
        setTasks([]);
        setViewing(null);
      })
      .catch(() => undefined);
  };

  const handleKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submitText(input);
    }
  };

  if (view === "loading") {
    return (
      <div className="grid h-full place-items-center">
        <div className="h-6 w-6 rounded-full border-2 border-[rgba(var(--nx-accent-rgb),0.25)] border-t-[var(--nx-accent)] nx-spin" />
      </div>
    );
  }

  if (view === "config" || !cfg) {
    return (
      <ConfigScreen
        form={form}
        onPatch={(p) => setForm((f) => ({ ...f, ...p }))}
        test={test}
        onTest={runTest}
        onSave={saveConfig}
        onCancel={() => setView("chat")}
        hasExisting={cfg !== null}
      />
    );
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <style>{NXAI_CSS}</style>
      <header className="flex items-center gap-2 border-b border-[var(--nx-border)] px-3 py-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-cyan-400 to-teal-600 text-[10px] font-bold text-white">
          AI
        </div>
        <div className="mr-auto min-w-0 leading-tight">
          <div className="truncate text-sm font-medium text-[var(--nx-text)]">Nexus AI</div>
          <div className="truncate text-[11px] text-[var(--nx-text-dim)]">
            {cfg.model} · {cfg.type === "anthropic" ? "Anthropic" : "OpenAI-compatible"}
          </div>
        </div>
        {running && stepCount > 0 && (
          <span className="rounded-md border border-[rgba(var(--nx-accent-rgb),0.4)] bg-[rgba(var(--nx-accent-rgb),0.12)] px-2 py-0.5 font-mono text-[11px] text-[var(--nx-accent)]">
            {stepCount}/{MAX_STEPS}
          </span>
        )}
        <IconButton title="New chat" onClick={newChat} disabled={running}>
          <Plus className="h-4 w-4" />
        </IconButton>
        <IconButton
          title="Task history"
          onClick={() => setHistoryOpen((v) => !v)}
          active={historyOpen}
        >
          <History className="h-4 w-4" />
        </IconButton>
        <IconButton title="Provider settings" onClick={openConfig} disabled={running}>
          <Settings className="h-4 w-4" />
        </IconButton>
      </header>

      {viewing ? (
        <TranscriptView task={viewing} onBack={() => setViewing(null)} />
      ) : (
        <>
          <div
            ref={scrollRef}
            className="nx-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 && !running ? (
              <EmptyState agentMode={agentMode} onPick={submitText} />
            ) : (
              messages.map((m) => (
                <MessageView
                  key={m.id}
                  msg={m}
                  onRetry={() => submitText(lastTaskRef.current)}
                  onResolveApproval={resolveApproval}
                />
              ))
            )}
            {running && <TypingIndicator />}
          </div>
          {running && (
            <div className="flex items-center gap-2 px-4 pb-1 text-[11px] text-[var(--nx-text-dim)]">
              <span className="h-3 w-3 shrink-0 rounded-full border-2 border-[rgba(var(--nx-accent-rgb),0.3)] border-t-[var(--nx-accent)] nx-spin" />
              <span className="truncate">{statusLine}</span>
              {stepCount > 0 && (
                <span className="ml-auto shrink-0 font-mono">
                  {stepCount}/{MAX_STEPS}
                </span>
              )}
            </div>
          )}
          <div className="border-t border-[var(--nx-border)] p-3">
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => setAgentMode((v) => !v)}
                disabled={running}
                title={
                  agentMode
                    ? "Agent mode is on: tools are available and write actions need approval. Click to switch to plain chat."
                    : "Plain chat mode. Click to enable agent mode (tools + approvals)."
                }
                className={`flex h-[42px] shrink-0 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                  agentMode
                    ? "border-[rgba(var(--nx-accent-rgb),0.5)] bg-[rgba(var(--nx-accent-rgb),0.14)] text-[var(--nx-accent)]"
                    : "border-[var(--nx-border)] text-[var(--nx-text-dim)] hover:text-[var(--nx-text)]"
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Agent</span>
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                rows={2}
                disabled={running}
                placeholder={
                  agentMode
                    ? "Describe a task — NEXUS AI will plan and use tools..."
                    : "Ask anything..."
                }
                className={taCls}
              />
              {running ? (
                <button
                  type="button"
                  onClick={stopRun}
                  title="Stop"
                  className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border border-red-400/50 text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => submitText(input)}
                  disabled={!input.trim()}
                  title="Send"
                  className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl bg-[var(--nx-accent)] text-black transition hover:brightness-110 disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {historyOpen && (
        <HistoryPanel
          tasks={tasks}
          onOpen={(t) => {
            setViewing(t);
            setHistoryOpen(false);
          }}
          onClose={() => setHistoryOpen(false)}
          onClear={wipeHistory}
        />
      )}
    </div>
  );
}
