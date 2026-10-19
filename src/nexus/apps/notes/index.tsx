"use client";

// NEXUS OS — Notes. Markdown notes live in the REAL virtual filesystem at
// /home/Documents/Notes/*.md — visible in Files, searchable by Spotlight,
// editable in Studio, backed up with workspace backups. Autosave + preview.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilePlus, Search, Trash2, Eye, Pencil } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { AppInstanceProps, FSNode } from "../../types";
import { useFS } from "../../store/fs";
import { useOS } from "../../store/os";
import { HOME_ID, childrenOf, findChild } from "../../lib/vfs";
import { useNexusEvent } from "../../lib/bus";

const NOTES_DIR = "Documents/Notes";

function notesDirId(): string | null {
  const fs = useFS.getState();
  const r = (function find(nodes: Record<string, FSNode>, parent: string, segs: string[]): string | null {
    if (segs.length === 0) return parent;
    const child = findChild(nodes, parent, segs[0]);
    if (!child || child.type !== "dir") return null;
    return find(nodes, child.id, segs.slice(1));
  })(fs.nodes, HOME_ID, NOTES_DIR.split("/"));
  return r;
}

function ensureNotesDir(): string {
  const fs = useFS.getState();
  const existing = notesDirId();
  if (existing) return existing;
  const err = fs.mkdirAtPath(NOTES_DIR, HOME_ID);
  if (typeof err === "string" && !fs.nodes[err]) {
    // mkdirAtPath returns id or error string; verify
  }
  const created = notesDirId();
  if (!created) throw new Error("Could not create the Notes folder");
  return created;
}

export default function NotesApp(_props: AppInstanceProps) {
  const nodes = useFS((s) => s.nodes);
  const openApp = useOS((s) => s.launch);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [savedTick, setSavedTick] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notes = useMemo(() => {
    const dir = notesDirId();
    if (!dir) return [];
    return childrenOf(nodes, dir)
      .filter((n) => n.type === "file" && n.name.endsWith(".md"))
      .sort((a, b) => b.modified - a.modified);
  }, [nodes]);

  const selected = selectedId ? nodes[selectedId] : undefined;

  // load note content when switching selection
  useEffect(() => {
    if (selected && typeof selected.content === "string") {
      setDraft(selected.content);
    } else if (!selected) {
      setDraft("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const saveNow = useCallback(
    (id: string, content: string) => {
      const e = useFS.getState().writeFile(id, content);
      if (!e) setSavedTick(Date.now());
    },
    []
  );

  // debounced autosave
  useEffect(() => {
    if (!selectedId || !selected) return;
    if (draft === (selected.content ?? "")) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveNow(selectedId, draft), 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, selectedId]);

  const createNote = () => {
    const dirId = ensureNotesDir();
    const base = "Note";
    let name = `${base}.md`;
    let i = 2;
    while (childrenOf(useFS.getState().nodes, dirId).some((n) => n.name === name)) {
      name = `${base} ${i}.md`;
      i++;
    }
    const res = useFS.getState().createNode({
      parentId: dirId,
      name,
      type: "file",
      content: `# ${name.replace(/\.md$/, "")}\n\n`,
    });
    if ("id" in res) setSelectedId(res.id);
  };

  const deleteNote = (id: string) => {
    const node = nodes[id];
    if (!node) return;
    useOS.getState().openCtx(window.innerWidth / 2, 120, [
      {
        label: `Delete "${node.name}" permanently?`,
        danger: true,
        disabled: true,
      },
      { separator: true },
      {
        label: "Delete",
        danger: true,
        onClick: () => {
          useFS.getState().remove(id);
          if (selectedId === id) setSelectedId(null);
        },
      },
      { label: "Cancel" },
    ]);
  };

  const filtered = query.trim()
    ? notes.filter(
        (n) =>
          n.name.toLowerCase().includes(query.toLowerCase()) ||
          (n.content ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : notes;

  // other apps can ask Notes to open a specific file
  useNexusEvent("os:open-path", ({ fileId }) => {
    if (nodes[fileId]?.parentId === notesDirId()) setSelectedId(fileId);
  });

  return (
    <div className="flex h-full">
      {/* list */}
      <div className="flex w-[240px] min-w-[190px] flex-col border-r border-white/5 bg-black/15">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-white/5 p-2">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--nx-text-dim)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes…"
              aria-label="Search notes"
              className="w-full rounded-lg border border-white/10 bg-black/25 py-1.5 pl-7 pr-2 text-[12px] outline-none placeholder:text-[var(--nx-text-dim)] focus:border-[rgba(var(--nx-accent-rgb),0.5)]"
            />
          </div>
          <button
            onClick={createNote}
            title="New note"
            aria-label="New note"
            className="shrink-0 rounded-lg p-2 text-[var(--nx-text-dim)] transition hover:bg-white/5 hover:text-[var(--nx-text)]"
          >
            <FilePlus size={14} />
          </button>
        </div>
        <div className="nx-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-2 py-4 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
              No notes yet. Notes are real markdown files in <code>~/Documents/Notes</code>.
            </p>
          ) : (
            filtered.map((n) => (
              <button
                key={n.id}
                onClick={() => setSelectedId(n.id)}
                className={`group mb-0.5 flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                  selectedId === n.id ? "bg-[rgba(var(--nx-accent-rgb),0.12)]" : "hover:bg-white/5"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-[var(--nx-text)]">
                    {n.name.replace(/\.md$/, "")}
                  </div>
                  <div className="truncate text-[10px] text-[var(--nx-text-dim)]">
                    {(n.content ?? "").replace(/[#*`>\-\n]/g, " ").trim().slice(0, 46) || "empty"}
                  </div>
                </div>
                <span
                  role="button"
                  aria-label="Delete note"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteNote(n.id);
                  }}
                  className="rounded p-1 text-[var(--nx-text-dim)] opacity-0 transition hover:bg-red-400/10 hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 size={11} />
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* editor */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 py-1.5">
              <input
                value={selected.name}
                onChange={(e) => {
                  const name = e.target.value.endsWith(".md") ? e.target.value : e.target.value + ".md";
                  if (name !== selected.name) useFS.getState().rename(selected.id, name);
                }}
                aria-label="Note title"
                className="min-w-0 flex-1 border-none bg-transparent text-[13px] font-medium text-[var(--nx-text)] outline-none"
                spellCheck={false}
              />
              <span className="shrink-0 text-[10px] text-[var(--nx-text-dim)]" title="Autosaves">
                {savedTick && draft === (nodes[selected.id]?.content ?? "") ? "saved ✓" : "editing…"}
              </span>
              <button
                onClick={() => openApp("studio", { openFileId: selected.id })}
                title="Open in Studio"
                className="rounded-md px-2 py-1 text-[10px] text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]"
              >
                Studio ↗
              </button>
              <button
                onClick={() => setMode((m) => (m === "edit" ? "preview" : "edit"))}
                title={mode === "edit" ? "Preview markdown" : "Edit"}
                className="rounded-md p-1.5 text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]"
              >
                {mode === "edit" ? <Eye size={13} /> : <Pencil size={13} />}
              </button>
            </div>
            {mode === "edit" ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="# Markdown…"
                spellCheck={false}
                aria-label="Note content"
                className="nx-scroll min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed text-[var(--nx-text)] outline-none placeholder:text-[var(--nx-text-dim)]"
              />
            ) : (
              <div className="nx-scroll prose-invert min-h-0 flex-1 overflow-y-auto p-5 text-[13px] leading-relaxed text-[var(--nx-text)] [&_a]:text-[var(--nx-accent)] [&_code]:rounded [&_code]:bg-white/5 [&_code]:px-1 [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:mb-0.5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/40 [&_pre]:p-3 [&_pre]:text-[12px] [&_strong]:text-white [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5">
                <ReactMarkdown>{draft}</ReactMarkdown>
              </div>
            )}
          </>
        ) : (
          <div className="grid h-full place-items-center">
            <div className="max-w-[280px] text-center">
              <div className="mb-3 text-3xl">📝</div>
              <p className="text-[13px] text-[var(--nx-text)]">No note selected</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
                Pick a note on the left or create one. Everything autosaves to the virtual
                filesystem and persists across reloads.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
