"use client";

// NEXUS OS — global search (Ctrl/Cmd+K): apps, files, settings, actions

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Folder, FileText, AppWindow, Settings2, CornerDownLeft } from "lucide-react";
import { useOS } from "../store/os";
import { useFS } from "../store/fs";
import { APP_META } from "../apps/meta";
import { AppIcon } from "../apps/AppIcon";
import { fuzzyScore } from "../lib/utils";
import { displayPath, isTextFile } from "../lib/vfs";

interface Result {
  id: string;
  group: "Apps" | "Files & Folders" | "Settings" | "Actions";
  title: string;
  subtitle?: string;
  score: number;
  icon: React.ReactNode;
  run: () => void;
}

const SETTINGS_SECTIONS: { id: string; name: string; hint: string }[] = [
  { id: "appearance", name: "Appearance", hint: "theme, accent, wallpaper" },
  { id: "desktop", name: "Desktop & Dock", hint: "icons, dock size" },
  { id: "motion", name: "Motion", hint: "animations" },
  { id: "shortcuts", name: "Keyboard Shortcuts", hint: "hotkeys" },
  { id: "storage", name: "Storage & Backup", hint: "usage, export, import" },
  { id: "about", name: "About", hint: "version, capabilities" },
];

export function Spotlight() {
  const open = useOS((s) => s.spotlight);
  const setOpen = useOS((s) => s.setSpotlight);
  const launch = useOS((s) => s.launch);
  const fs = useFS();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const out: Result[] = [];
    // apps
    for (const meta of Object.values(APP_META)) {
      const s = Math.max(
        fuzzyScore(q, meta.name),
        fuzzyScore(q, meta.tagline),
        ...meta.keywords.map((k) => fuzzyScore(q, k) - 1)
      );
      if (s >= 0)
        out.push({
          id: `app-${meta.id}`,
          group: "Apps",
          title: meta.name,
          subtitle: meta.tagline,
          score: s + 4,
          icon: <AppIcon appId={meta.id} size={30} />,
          run: () => launch(meta.id),
        });
    }
    // settings
    for (const sec of SETTINGS_SECTIONS) {
      const s = fuzzyScore(q, `${sec.name} ${sec.hint}`);
      if (s >= 0)
        out.push({
          id: `set-${sec.id}`,
          group: "Settings",
          title: sec.name,
          subtitle: sec.hint,
          score: s + 2,
          icon: <Settings2 size={26} className="text-[var(--nx-text-dim)]" />,
          run: () => launch("settings", { section: sec.id }),
        });
    }
    // files (names, capped for perf)
    const query = q.toLowerCase().trim();
    if (query.length >= 1) {
      let n = 0;
      for (const node of Object.values(fs.nodes)) {
        if (n > 300) break;
        if (node.id === "root") continue;
        const s = fuzzyScore(q, node.name);
        if (s >= 0 && node.parentId !== null) {
          n++;
          out.push({
            id: `file-${node.id}`,
            group: "Files & Folders",
            title: node.name,
            subtitle: displayPath(fs.nodes, node.parentId),
            score: s,
            icon:
              node.type === "dir" ? (
                <Folder size={26} className="text-amber-300" />
              ) : (
                <FileText size={26} className="text-sky-300" />
              ),
            run: () => {
              if (node.type === "file" && isTextFile(node.name, node.mime)) {
                launch("studio", { openFileId: node.id });
              } else {
                launch("files", { openId: node.id });
              }
            },
          });
        }
      }
    }
    // actions
    if ("terminal files studio ai browser settings".includes(query) || q.length === 0) {
      out.push({
        id: "act-terminal",
        group: "Actions",
        title: "Open Terminal here",
        subtitle: "Ctrl+`",
        score: q === "terminal" ? 99 : 1,
        icon: <AppWindow size={26} className="text-[var(--nx-text-dim)]" />,
        run: () => launch("terminal"),
      });
    }
    return out
      .filter((r) => q.trim() === "" ? r.group === "Apps" || r.group === "Actions" : true)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);
  }, [q, fs.nodes, launch]);

  useEffect(() => setActive(0), [q]);

  if (!open) return null;

  const groups: Result["group"][] = ["Apps", "Actions", "Files & Folders", "Settings"];
  let flatIdx = -1;

  const runResult = (r?: Result) => {
    if (!r) return;
    setOpen(false);
    r.run();
  };

  return (
    <div
      className="fixed inset-0 z-[9000] flex items-start justify-center bg-black/40 pt-[14vh] nx-fade-in"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-label="Search"
    >
      <div
        className="nx-glass-strong nx-pop-in w-[min(640px,92vw)] overflow-hidden rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[var(--nx-border)] px-4">
          <Search size={18} className="shrink-0 text-[var(--nx-text-dim)]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                runResult(results[active]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Search apps, files, settings…"
            className="h-14 w-full bg-transparent text-[15px] text-[var(--nx-text)] outline-none placeholder:text-[var(--nx-text-dim)]"
            aria-label="Search query"
          />
          <kbd className="shrink-0 rounded-md border border-[var(--nx-border)] px-1.5 py-0.5 text-[10px] text-[var(--nx-text-dim)]">
            ESC
          </kbd>
        </div>
        <div ref={listRef} className="nx-scroll max-h-[46vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-[var(--nx-text-dim)]">
              No results for “{q}”
            </div>
          )}
          {groups.map((g) => {
            const items = results.map((r, i) => ({ r, i })).filter(({ r }) => r.group === g);
            if (items.length === 0) return null;
            return (
              <div key={g} className="mb-1">
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--nx-text-dim)]">
                  {g}
                </div>
                {items.map(({ r, i }) => {
                  flatIdx++;
                  const isActive = flatIdx === active;
                  return (
                    <button
                      key={r.id}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition ${
                        isActive ? "bg-[rgba(var(--nx-accent-rgb),0.14)]" : "hover:bg-white/[0.05]"
                      }`}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => runResult(r)}
                    >
                      {r.icon}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-[var(--nx-text)]">
                          {r.title}
                        </span>
                        {r.subtitle && (
                          <span className="block truncate text-[11px] text-[var(--nx-text-dim)]">
                            {r.subtitle}
                          </span>
                        )}
                      </span>
                      {isActive && <CornerDownLeft size={14} className="shrink-0 text-[var(--nx-text-dim)]" />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
