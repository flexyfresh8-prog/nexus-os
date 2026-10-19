"use client";

// NEXUS OS — Studio terminal panel: the shared nexus-shell engine embedded
// as a bottom panel. Same UX contract as the Terminal app (history, tab
// completion, cwd, error coloring) with a studio-flavored prompt.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useFS } from "../../store/fs";
import { displayPath } from "../../lib/vfs";
import { COMMAND_NAMES, completePath, runCommand } from "../terminal/engine";

interface TermLine {
  text: string;
  err?: boolean;
  dim?: boolean;
}

interface TerminalPanelProps {
  /** project root dir id — used as the default cwd; null disables the shell */
  projectRootId: string | null;
  /** launch other OS apps from commands like `open` */
  launch: (appId: string, props?: Record<string, unknown>) => void;
  /** open a file as a studio tab (engine's `open <file>` lands here) */
  openLocalFile: (fileId: string) => void;
  /** when true the panel is visible — focus the input */
  active: boolean;
}

function longestCommonPrefix(items: string[]): string {
  if (items.length === 0) return "";
  let prefix = items[0];
  for (const item of items.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < item.length && prefix[i] === item[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

export default function TerminalPanel({
  projectRootId,
  launch,
  openLocalFile,
  active,
}: TerminalPanelProps) {
  const nodes = useFS((s) => s.nodes);

  // reset cwd whenever the selected project changes (render-phase state sync)
  const [cwdId, setCwdId] = useState<string>(projectRootId ?? "");
  const [prevRoot, setPrevRoot] = useState<string | null>(projectRootId);
  if (prevRoot !== projectRootId) {
    setPrevRoot(projectRootId);
    setCwdId(projectRootId ?? "");
  }

  const [lines, setLines] = useState<TermLine[]>([
    { text: "NEXUS shell — studio panel. Type 'help' for commands.", dim: true },
  ]);
  const [input, setInput] = useState("");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  const histRef = useRef<{ list: string[]; idx: number }>({ list: [], idx: -1 });

  const cwdValid = !!nodes[cwdId] && nodes[cwdId].type === "dir";
  const effectiveCwd = cwdValid ? cwdId : projectRootId ?? cwdId;
  const prompt = `studio:${displayPath(nodes, effectiveCwd)} $`;

  // focus the input when the terminal tab becomes visible
  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  // keep the view pinned to the bottom as lines arrive
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!projectRootId) {
    return (
      <div className="grid h-full place-items-center px-6 text-center text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
        Open or create a project to use the terminal.
      </div>
    );
  }

  const push = (next: TermLine[]) => setLines((prev) => [...prev, ...next]);

  const runLine = async (): Promise<void> => {
    const raw = input;
    if (busyRef.current) return;
    setInput("");
    push([{ text: `${prompt} ${raw}`, dim: true }]);
    const trimmed = raw.trim();
    if (!trimmed) return;

    histRef.current.list = [...histRef.current.list, trimmed].slice(-100);
    histRef.current.idx = -1;

    busyRef.current = true;
    try {
      const res = await runCommand(trimmed, {
        cwdId: effectiveCwd,
        env: "shell",
        line: trimmed,
        setEnv: () => {
          push([{ text: "environment switching is available in the full Terminal app", dim: true }]);
        },
        setCwd: (id) => setCwdId(id),
        clearScreen: () => setLines([]),
        openApp: (appId, props) => {
          // keep studio file opens inside this window; everything else launches OS-wide
          if (appId === "studio" && props && typeof props.openFileId === "string") {
            openLocalFile(props.openFileId);
            return;
          }
          launch(appId, props);
        },
        history: histRef.current.list,
      });
      if (res.output.length > 0) {
        push(res.output.map((t) => ({ text: t, err: res.error })));
      }
    } finally {
      busyRef.current = false;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  };

  const complete = (): void => {
    const match = input.match(/(\S*)$/);
    const token = match ? match[1] : "";
    const before = input.slice(0, input.length - token.length);
    const firstWord = before.trim().length === 0;

    const candidates = firstWord
      ? COMMAND_NAMES.filter((c) => c.startsWith(token)).map((c) => `${c} `)
      : completePath(token, effectiveCwd);

    if (candidates.length === 0) return;
    if (candidates.length === 1) {
      setInput(before + candidates[0]);
      return;
    }
    const common = longestCommonPrefix(candidates);
    if (common.length > token.length) setInput(before + common);
    push([{ text: candidates.map((c) => c.trimEnd()).join("   "), dim: true }]);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runLine();
    } else if (e.key === "Tab") {
      e.preventDefault();
      complete();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = histRef.current.list;
      if (h.length === 0) return;
      histRef.current.idx =
        histRef.current.idx === -1
          ? h.length - 1
          : Math.max(0, histRef.current.idx - 1);
      setInput(h[histRef.current.idx]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = histRef.current.list;
      if (histRef.current.idx === -1) return;
      histRef.current.idx += 1;
      if (histRef.current.idx >= h.length) {
        histRef.current.idx = -1;
        setInput("");
      } else {
        setInput(h[histRef.current.idx]);
      }
    }
  };

  return (
    <div
      className="flex h-full flex-col bg-black/40 font-mono text-[12px]"
      onMouseDown={() => inputRef.current?.focus()}
    >
      <div ref={scrollRef} className="nx-scroll min-h-0 flex-1 overflow-auto px-3 py-2">
        {lines.map((l, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap break-words leading-[1.55] ${
              l.err
                ? "text-red-400"
                : l.dim
                  ? "text-[var(--nx-text-dim)]"
                  : "text-[var(--nx-text)]"
            }`}
          >
            {l.text}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 px-3 pb-2">
        <span className="shrink-0 whitespace-nowrap text-[rgba(var(--nx-accent-rgb),0.9)]">
          {prompt}
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
          className="min-w-0 flex-1 bg-transparent text-[var(--nx-text)] caret-[var(--nx-accent)] outline-none placeholder:text-[var(--nx-text-dim)]"
          placeholder="type a command…"
          aria-label="Terminal input"
        />
      </div>
    </div>
  );
}
