"use client";

// NEXUS OS — Terminal app (v2)
// Multi-tab shell front-end over the shared command engine (./engine.ts).
// Each tab owns its cwd, execution environment (shell / worker / webcontainer),
// history and scrollback. Output lines may carry raw ANSI codes which are
// parsed into styled spans below.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Loader2, Plus, X } from "lucide-react";
import type { AppInstanceProps } from "../../types";
import { useFS } from "../../store/fs";
import { useOS } from "../../store/os";
import { useRuntime, ENV_LABEL, type RuntimeEnv } from "../../store/runtime";
import { HOME_ID, displayPath } from "../../lib/vfs";
import { uid } from "../../lib/utils";
import { emit } from "../../lib/bus";
import { OS_VERSION } from "../meta";
import { COMMAND_NAMES, completePath, runCommand } from "./engine";
import type { ExecResult, ShellCtx } from "./engine";

type LineKind = "in" | "out" | "err" | "sys";

interface Line {
  id: string;
  text: string;
  kind: LineKind;
  cwd?: string;
  /** text contains ANSI escapes → render colored spans */
  ansi?: boolean;
  /** exit code marker */
  code?: number;
}

interface Session {
  id: string;
  cwdId: string;
  env: RuntimeEnv;
  lines: Line[];
  history: string[];
  draft: string;
}

const MAX_LINES = 900;
const MAX_HISTORY = 200;

// ---------------------------------------------------------------- ANSI utils

const ANSI_COLOR: Record<string, string> = {
  "30": "text-zinc-500",
  "31": "text-red-400",
  "32": "text-emerald-400",
  "33": "text-amber-300",
  "34": "text-sky-400",
  "35": "text-fuchsia-400",
  "36": "text-cyan-300",
  "37": "text-zinc-200",
  "90": "text-zinc-500",
  "91": "text-red-300",
  "92": "text-emerald-300",
  "93": "text-amber-200",
  "94": "text-sky-300",
  "95": "text-fuchsia-300",
  "96": "text-cyan-200",
  "97": "text-zinc-100",
};

interface AnsiSpan {
  text: string;
  cls: string;
}

function parseAnsi(text: string): AnsiSpan[] {
  if (!text.includes("\u001b[")) return [{ text, cls: "" }];
  const spans: AnsiSpan[] = [];
  let cur = "";
  let cls = "";
  let i = 0;
  const push = () => {
    if (cur) spans.push({ text: cur, cls });
    cur = "";
  };
  while (i < text.length) {
    if (text[i] === "\u001b" && text[i + 1] === "[") {
      const end = text.indexOf("m", i + 2);
      if (end > 0) {
        const codes = text.slice(i + 2, end).split(";");
        for (const c of codes) {
          if (c === "0" || c === "" || c === "39") cls = "";
          else if (ANSI_COLOR[c]) cls = ANSI_COLOR[c];
        }
        i = end + 1;
        push();
        continue;
      }
    }
    cur += text[i];
    i++;
  }
  push();
  return spans.filter((s) => s.text.length > 0);
}

// ---------------------------------------------------------------- component

type PendingLine = { text: string; kind: LineKind; cwd?: string; ansi?: boolean; code?: number };

function newSession(cwdId = HOME_ID): Session {
  return {
    id: uid(),
    cwdId,
    env: "shell",
    draft: "",
    history: [],
    lines: [
      { id: uid(), text: `NEXUS OS v${OS_VERSION} · nexus-sh`, kind: "sys" },
      { id: uid(), text: "Virtual filesystem — nothing touches your real files.", kind: "out" },
      { id: uid(), text: "help = commands · env = switch runtime · Tab completes paths.", kind: "out" },
      { id: uid(), text: "", kind: "out" },
    ],
  };
}

export default function TerminalApp({ launchProps, setTitle }: AppInstanceProps) {
  const nodes = useFS((s) => s.nodes);
  const launch = useOS((s) => s.launch);
  const wcError = useRuntime((s) => s.wcError);
  const caps = useRuntime((s) => s.caps);

  const initialCwdId = (() => {
    const raw = launchProps?.cwdId;
    return typeof raw === "string" && useFS.getState().nodes[raw]?.type === "dir" ? raw : HOME_ID;
  })();

  const [sessions, setSessions] = useState<Session[]>(() => [newSession(initialCwdId)]);
  const [activeId, setActiveId] = useState<string>(() => "");
  const [input, setInput] = useState("");
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const draftRef = useRef("");
  const sessionRef = useRef<Session | null>(null);

  const active = useMemo(() => {
    const s = sessions.find((x) => x.id === activeId) ?? sessions[0];
    return s;
  }, [sessions, activeId]);

  useEffect(() => {
    if (!activeId && sessions[0]) setActiveId(sessions[0].id);
  }, [activeId, sessions]);

  sessionRef.current = active;

  // If the cwd node disappears (deleted / fs reseeded), fall back to home.
  const effectiveCwdId = nodes[active?.cwdId ?? ""]?.type === "dir" ? active!.cwdId : HOME_ID;
  const cwdDisplay = displayPath(nodes, effectiveCwdId);

  const patchSession = (id: string, patch: Partial<Session> | ((s: Session) => Partial<Session>)) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...(typeof patch === "function" ? patch(s) : patch) } : s))
    );
  };

  const pushLines = (sid: string, items: PendingLine[]) => {
    const withIds: Line[] = items.map((it) => ({ ...it, id: uid() }));
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== sid) return s;
        const next = s.lines.concat(withIds);
        return { ...s, lines: next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next };
      })
    );
  };

  const runLine = async (raw: string) => {
    const session = sessionRef.current;
    if (!session || running) return;
    const sid = session.id;
    pushLines(sid, [{ text: raw, kind: "in", cwd: displayPath(nodes, effectiveCwdId) }]);
    setInput("");
    setHistIdx(null);
    draftRef.current = "";
    const trimmed = raw.trim();
    if (!trimmed) return;

    const ctx: ShellCtx & { history: string[] } = {
      cwdId: effectiveCwdId,
      env: session.env,
      line: trimmed,
      setEnv: (env: RuntimeEnv) => patchSession(sid, { env }),
      setCwd: (id: string) => {
        patchSession(sid, { cwdId: id });
        setTitle(`Terminal — ${displayPath(useFS.getState().nodes, id)}`);
      },
      clearScreen: () => patchSession(sid, { lines: [] }),
      openApp: (appId: string, props?: Record<string, unknown>) => launch(appId, props),
      history: session.history,
    };

    setRunning(true);
    try {
      const res: ExecResult = await runCommand(trimmed, ctx);
      const kind: LineKind = res.error ? "err" : "out";
      const items: PendingLine[] = res.output.map((text) => ({ text, kind, ansi: res.ansi }));
      if (res.code !== 0) items.push({ text: `[exit ${res.code}]`, kind: "sys" });
      pushLines(sid, items);
      if (res.error && res.code !== 0) {
        emit("terminal:error", { command: trimmed, output: res.output.slice(0, 12), env: session.env });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushLines(sid, [{ text: `nexus: ${msg}`, kind: "err" }]);
    } finally {
      setRunning(false);
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== sid) return s;
          if (s.history[s.history.length - 1] === trimmed) return s;
          const history = [...s.history, trimmed];
          return { ...s, history: history.length > MAX_HISTORY ? history.slice(-MAX_HISTORY) : history };
        })
      );
    }
  };

  const runCompletion = () => {
    const el = inputRef.current;
    const value = input;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const start = before.lastIndexOf(" ") + 1;
    const token = before.slice(start);
    const isFirst = before.slice(0, start).trim().length === 0;
    const matches = isFirst
      ? COMMAND_NAMES.filter((c) => c.startsWith(token))
      : completePath(token, effectiveCwdId);
    if (matches.length === 0) return;

    if (matches.length === 1) {
      const m = matches[0];
      const nextBefore = before.slice(0, start) + m + (m.endsWith("/") ? "" : " ");
      const next = nextBefore + value.slice(caret);
      setInput(next);
      const caretPos = nextBefore.length;
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(caretPos, caretPos);
      });
    } else {
      pushLines(active!.id, [{ text: matches.join("   "), kind: "out" }]);
    }
  };

  const switchSession = (id: string) => {
    // stash the current draft
    if (sessionRef.current) {
      const cur = sessionRef.current.id;
      const draft = input;
      setSessions((prev) => prev.map((s) => (s.id === cur ? { ...s, draft } : s)));
    }
    setActiveId(id);
    const next = sessions.find((s) => s.id === id);
    setInput(next?.draft ?? "");
    setHistIdx(null);
  };

  const addSession = () => {
    const s = newSession(HOME_ID);
    setSessions((prev) => [...prev, s]);
    setActiveId(s.id);
    setInput("");
  };

  const closeSession = (id: string) => {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) return [newSession(HOME_ID)];
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      patchSession(active!.id, { lines: [] });
      return;
    }
    if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      pushLines(active!.id, [{ text: `${input}^C`, kind: "in", cwd: cwdDisplay }]);
      setInput("");
      setHistIdx(null);
      draftRef.current = "";
      return;
    }
    if (e.ctrlKey && (e.key === "t" || e.key === "T")) {
      e.preventDefault();
      addSession();
      return;
    }
    if (e.altKey && (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4" || e.key === "5")) {
      const idx = parseInt(e.key, 10) - 1;
      if (sessions[idx]) {
        e.preventDefault();
        switchSession(sessions[idx].id);
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void runLine(input);
      return;
    }
    if (e.key === "ArrowUp") {
      const history = active?.history ?? [];
      if (history.length === 0) return;
      e.preventDefault();
      if (histIdx === null) {
        draftRef.current = input;
        setHistIdx(history.length - 1);
        setInput(history[history.length - 1]);
      } else {
        const i = Math.max(0, histIdx - 1);
        setHistIdx(i);
        setInput(history[i]);
      }
      return;
    }
    if (e.key === "ArrowDown") {
      if (histIdx === null) return;
      e.preventDefault();
      const history = active?.history ?? [];
      const i = histIdx + 1;
      if (i >= history.length) {
        setHistIdx(null);
        setInput(draftRef.current);
      } else {
        setHistIdx(i);
        setInput(history[i]);
      }
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      runCompletion();
    }
  };

  // Keep the view pinned to the newest output unless the user scrolled up.
  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.lines, running]);

  // Initial window title + focus the prompt on mount.
  useEffect(() => {
    setTitle(`Terminal — ${displayPath(useFS.getState().nodes, effectiveCwdId)}`);
    inputRef.current?.focus();
    useRuntime.getState().checkCaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusInput = () => {
    const sel = document.getSelection();
    if (sel && sel.toString().length > 0) return; // don't steal an active text selection
    inputRef.current?.focus();
  };

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  const envBadgeCls =
    active?.env === "webcontainer"
      ? "bg-emerald-400/15 text-emerald-300 border-emerald-400/30"
      : active?.env === "worker"
        ? "bg-violet-400/15 text-violet-300 border-violet-400/30"
        : "bg-[rgba(var(--nx-accent-rgb),0.12)] text-[var(--nx-accent)] border-[rgba(var(--nx-accent-rgb),0.3)]";

  const promptPrefix = active?.env === "webcontainer" ? "node" : "nexus";

  return (
    <div className="flex h-full flex-col bg-black/40 font-mono text-[13px] text-[var(--nx-text)]">
      {/* tab strip */}
      <div className="flex items-center gap-1 border-b border-white/5 px-2 pt-2">
        <div className="nx-scroll flex flex-1 items-center gap-1 overflow-x-auto">
          {sessions.map((s, i) => {
            const isActive = s.id === active?.id;
            const sCwd = displayPath(nodes, nodes[s.cwdId]?.type === "dir" ? s.cwdId : HOME_ID);
            return (
              <button
                key={s.id}
                onClick={() => switchSession(s.id)}
                className={`group flex max-w-[190px] shrink-0 items-center gap-1.5 rounded-t-lg border-b-0 px-3 py-1.5 text-[12px] transition-colors ${
                  isActive
                    ? "bg-black/40 text-[var(--nx-text)]"
                    : "bg-white/[0.03] text-[var(--nx-text-dim)] hover:bg-white/[0.06]"
                }`}
                title={`${ENV_LABEL[s.env]} · ${sCwd}`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    s.env === "webcontainer"
                      ? "bg-emerald-400"
                      : s.env === "worker"
                        ? "bg-violet-400"
                        : "bg-[var(--nx-accent)]"
                  }`}
                />
                <span className="truncate">{`sh ${i + 1}`}</span>
                <span
                  role="button"
                  aria-label="Close tab"
                  tabIndex={-1}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    closeSession(s.id);
                  }}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
                >
                  <X size={10} />
                </span>
              </button>
            );
          })}
          <button
            onClick={addSession}
            aria-label="New tab"
            title="New tab (Ctrl+T)"
            className="shrink-0 rounded-md p-1.5 text-[var(--nx-text-dim)] transition-colors hover:bg-white/5 hover:text-[var(--nx-text)]"
          >
            <Plus size={13} />
          </button>
        </div>
        <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${envBadgeCls}`}>
          {ENV_LABEL[active?.env ?? "shell"]}
        </span>
      </div>

      {active?.env === "webcontainer" && !caps.webcontainer ? (
        <div className="border-b border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-[11px] text-amber-200">
          Node runtime unavailable in this surface — {wcError ?? "cross-origin isolation is off"}. Commands will fail until
          NEXUS runs in its own tab with COOP/COEP headers.
        </div>
      ) : null}

      {/* scrollback */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={focusInput}
        className="nx-scroll min-h-0 flex-1 cursor-text overflow-y-auto p-3 leading-[1.5]"
      >
        {(active?.lines ?? []).map((l) => (
          <div key={l.id} className={`whitespace-pre-wrap break-words ${l.kind === "err" ? "text-red-400" : l.kind === "sys" ? "text-[var(--nx-accent)]" : ""}`}>
            {l.kind === "in" ? (
              <>
                <span className="select-none font-semibold text-[var(--nx-accent)]">{promptPrefix}</span>
                <span className="select-none text-[var(--nx-text-dim)]">:{l.cwd ?? "~"} $ </span>
                <span>{l.text.length > 0 ? l.text : "\u00A0"}</span>
              </>
            ) : l.ansi ? (
              parseAnsi(l.text).map((span, i) => (
                <span key={i} className={span.cls}>
                  {span.text}
                </span>
              ))
            ) : l.text.length > 0 ? (
              l.text
            ) : (
              "\u00A0"
            )}
          </div>
        ))}

        {/* live input line */}
        <div className="flex items-baseline">
          <span className="select-none whitespace-pre">
            <span className="font-semibold text-[var(--nx-accent)]">{promptPrefix}</span>
            <span className="text-[var(--nx-text-dim)]">:{cwdDisplay} $ </span>
          </span>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            aria-label="Terminal command input"
            className="min-w-0 flex-1 border-none bg-transparent p-0 font-mono text-[13px] text-[var(--nx-text)] outline-none"
          />
          {running ? (
            <Loader2 size={12} className="nx-spin ml-1 self-center text-[var(--nx-accent)]" aria-label="Running" />
          ) : null}
        </div>
      </div>
    </div>
  );
}
