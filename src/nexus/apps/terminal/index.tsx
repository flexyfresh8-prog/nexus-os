"use client";

// NEXUS OS — Terminal app
// Premium shell front-end over the shared command engine (./engine.ts).
// The engine owns all command logic; this component owns rendering,
// prompt state, session history, tab completion and keyboard handling.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Loader2 } from "lucide-react";
import type { AppInstanceProps } from "../../types";
import { useFS } from "../../store/fs";
import { useOS } from "../../store/os";
import { HOME_ID, displayPath } from "../../lib/vfs";
import { uid } from "../../lib/utils";
import { OS_VERSION } from "../meta";
import { COMMAND_NAMES, completePath, runCommand } from "./engine";
import type { ExecResult, ShellCtx } from "./engine";

type LineKind = "in" | "out" | "err" | "sys";

interface Line {
  id: string;
  text: string;
  kind: LineKind;
  /** display path captured when the line was echoed (for prompt rendering) */
  cwd?: string;
}

const MAX_LINES = 800;
const MAX_HISTORY = 200;

const LINE_CLASS: Record<LineKind, string> = {
  in: "",
  out: "text-[var(--nx-text)]",
  err: "text-red-400",
  sys: "text-[var(--nx-accent)]",
};

const BANNER_RAW: Array<{ text: string; kind: LineKind }> = [
  { text: "  ███╗   ██╗███████╗ ██╗  ██╗██╗   ██╗███████╗", kind: "sys" },
  { text: "  ████╗  ██║██╔════╝ ╚██╗██╔╝██║   ██║██╔════╝", kind: "sys" },
  { text: "  ██╔██╗ ██║█████╗    ╚███╔╝ ██║   ██║███████╗", kind: "sys" },
  { text: "  ██║╚██╗██║██╔════╝  ██╔██╗ ██║   ██║╚════██║", kind: "sys" },
  { text: "  ██║ ╚████║███████╗ ██╔╝ ██╗╚██████╔╝███████║", kind: "sys" },
  { text: "  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝", kind: "sys" },
  { text: "", kind: "out" },
  { text: `NEXUS OS v${OS_VERSION} · nexus-sh`, kind: "sys" },
  { text: "All data lives in your browser — nothing touches your real files.", kind: "out" },
  { text: "Type 'help' for available commands. Tab completes paths.", kind: "out" },
  { text: "", kind: "out" },
];

type PendingLine = { text: string; kind: LineKind; cwd?: string };

export default function TerminalApp({ launchProps, setTitle }: AppInstanceProps) {
  const nodes = useFS((s) => s.nodes);
  const launch = useOS((s) => s.launch);

  const [cwdId, setCwdId] = useState<string>(() => {
    const raw = launchProps?.cwdId;
    return typeof raw === "string" && useFS.getState().nodes[raw]?.type === "dir"
      ? raw
      : HOME_ID;
  });
  const [lines, setLines] = useState<Line[]>(() =>
    BANNER_RAW.map((b) => ({ ...b, id: uid() }))
  );
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const draftRef = useRef("");

  // If the cwd node disappears (deleted / fs reseeded), gracefully fall back to home.
  const effectiveCwdId = nodes[cwdId]?.type === "dir" ? cwdId : HOME_ID;
  const cwdDisplay = displayPath(nodes, effectiveCwdId);

  const pushLines = (items: PendingLine[]) => {
    const withIds: Line[] = items.map((it) => ({
      id: uid(),
      text: it.text,
      kind: it.kind,
      cwd: it.cwd,
    }));
    setLines((prev) => {
      const next = prev.concat(withIds);
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  };

  const runLine = async (raw: string) => {
    if (running) return;
    pushLines([{ text: raw, kind: "in", cwd: cwdDisplay }]);
    setInput("");
    setHistIdx(null);
    draftRef.current = "";
    const trimmed = raw.trim();
    if (!trimmed) return;

    const ctx: ShellCtx & { history: string[] } = {
      cwdId: effectiveCwdId,
      setCwd: (id: string) => {
        setCwdId(id);
        setTitle(`Terminal — ${displayPath(useFS.getState().nodes, id)}`);
      },
      clearScreen: () => setLines([]),
      openApp: (appId: string, props?: Record<string, unknown>) => launch(appId, props),
      history,
    };

    setRunning(true);
    try {
      const res: ExecResult = await runCommand(trimmed, ctx);
      pushLines(
        res.output.map((text) => ({ text, kind: res.error ? ("err" as const) : ("out" as const) }))
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushLines([{ text: `nexus: ${msg}`, kind: "err" }]);
    } finally {
      setRunning(false);
      setHistory((prev) => {
        if (prev[prev.length - 1] === trimmed) return prev;
        const next = [...prev, trimmed];
        return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next;
      });
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
      pushLines([{ text: matches.join("   "), kind: "out" }]);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      setLines([]);
      return;
    }
    if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      pushLines([{ text: `${input}^C`, kind: "in", cwd: cwdDisplay }]);
      setInput("");
      setHistIdx(null);
      draftRef.current = "";
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void runLine(input);
      return;
    }
    if (e.key === "ArrowUp") {
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
  }, [lines, running]);

  // Initial window title + focus the prompt on mount.
  useEffect(() => {
    setTitle(`Terminal — ${displayPath(useFS.getState().nodes, effectiveCwdId)}`);
    inputRef.current?.focus();
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

  return (
    <div
      aria-label="Terminal"
      className="flex h-full flex-col bg-black/30 p-3 font-mono text-[13px] text-[var(--nx-text)]"
      onClick={focusInput}
    >
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="nx-scroll min-h-0 flex-1 cursor-text overflow-y-auto leading-[1.5]"
      >
        {lines.map((l) => (
          <div key={l.id} className={`whitespace-pre-wrap break-words ${LINE_CLASS[l.kind]}`}>
            {l.kind === "in" ? (
              <>
                <span className="select-none font-semibold text-[var(--nx-accent)]">nexus</span>
                <span className="select-none text-[var(--nx-text-dim)]">:{l.cwd ?? "~"} $ </span>
                <span className="text-[var(--nx-text)]">{l.text.length > 0 ? l.text : "\u00A0"}</span>
              </>
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
            <span className="font-semibold text-[var(--nx-accent)]">nexus</span>
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
            <Loader2
              size={12}
              className="nx-spin ml-1 self-center text-[var(--nx-accent)]"
              aria-label="Running"
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
