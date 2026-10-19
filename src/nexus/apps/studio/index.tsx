"use client";

// NEXUS OS — Nexus Studio: the coding workspace.
// File explorer + Monaco editor tabs + live sandboxed preview + embedded
// nexus-shell terminal + project search + ZIP export. Projects live under
// /home/Projects in the virtual filesystem.

import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditorNs } from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  File as FileIcon,
  FileCode,
  FilePlus,
  FileSearch,
  Folder,
  FolderPlus,
  GitBranch,
  Package,
  PanelBottom,
  PanelLeft,
  Plus,
  Replace,
  RotateCw,
  Save,
  Search,
  Server,
  TerminalSquare,
  X,
} from "lucide-react";
import type { AppInstanceProps, ContextMenuItem, FSNode } from "../../types";
import {
  HOME_ID,
  childrenOf,
  descendantsOf,
  extOf,
  findChild,
  isTextFile,
  nodeSize,
  uniqueName,
} from "../../lib/vfs";
import { clamp, downloadBlob, formatBytes, uid } from "../../lib/utils";
import { useFS } from "../../store/fs";
import { useOS } from "../../store/os";
import { useSettings } from "../../store/settings";
import { PROJECT_TEMPLATES, templateById } from "./templates";
import FileTree, { fileIcon } from "./FileTree";
import PreviewPane, { buildPreviewDoc, isRuntimePayload, type PreviewFile } from "./PreviewPane";
import TerminalPanel from "./TerminalPanel";
import { GitPanel } from "./GitPanel";
import { ServersPanel } from "./ServersPanel";

// ------------------------------------------------------------------ helpers

const LANG_BY_EXT: Record<string, string> = {
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  xml: "xml",
  svg: "xml",
  yml: "yaml",
  yaml: "yaml",
};

function monacoLang(name: string): string {
  return LANG_BY_EXT[extOf(name)] ?? "plaintext";
}

const EDITOR_OPTIONS: MonacoEditorNs.IStandaloneEditorConstructionOptions = {
  fontSize: 13,
  fontFamily: "var(--font-geist-mono), monospace",
  minimap: { enabled: false },
  wordWrap: "on",
  automaticLayout: true,
  tabSize: 2,
  smoothScrolling: true,
  cursorBlinking: "smooth",
  padding: { top: 12 },
  scrollBeyondLastLine: false,
  overviewRulerLanes: 0,
  scrollbar: { verticalScrollbarSize: 9, horizontalScrollbarSize: 9 },
};

/** Walk up from a file to its project root (dir whose parent is /home/Projects or /home). */
function deriveProjectRoot(nodes: Record<string, FSNode>, fileId: string): string | null {
  const start = nodes[fileId];
  if (!start) return null;
  let cur = start.type === "dir" ? start : nodes[start.parentId ?? ""];
  if (!cur) return null;
  let guard = 0;
  while (cur.parentId && cur.parentId !== HOME_ID && guard++ < 256) {
    const parent = nodes[cur.parentId];
    if (!parent) break;
    if (parent.name === "Projects" && parent.parentId === HOME_ID) break;
    if (parent.parentId === null) break;
    cur = parent;
  }
  if (cur.type === "file") cur = nodes[cur.parentId ?? ""] ?? cur;
  return cur.type === "dir" ? cur.id : null;
}

function projectsDirId(nodes: Record<string, FSNode>): string | null {
  return findChild(nodes, HOME_ID, "Projects")?.id ?? null;
}

function listProjects(nodes: Record<string, FSNode>): FSNode[] {
  const pid = projectsDirId(nodes);
  if (!pid) return [];
  return childrenOf(nodes, pid).filter((n) => n.type === "dir");
}

function relPathOf(nodes: Record<string, FSNode>, rootId: string, id: string): string {
  const parts: string[] = [];
  let cur: FSNode | undefined = nodes[id];
  let guard = 0;
  while (cur && cur.id !== rootId && guard++ < 256) {
    parts.unshift(cur.name);
    cur = nodes[cur.parentId ?? ""];
  }
  return parts.join("/");
}

function collectPreviewFiles(nodes: Record<string, FSNode>, rootId: string): PreviewFile[] {
  const out: PreviewFile[] = [];
  for (const id of descendantsOf(nodes, rootId)) {
    if (id === rootId) continue;
    const n = nodes[id];
    if (!n || n.type !== "file" || typeof n.content !== "string") continue;
    out.push({ relPath: relPathOf(nodes, rootId, id), content: n.content });
  }
  return out;
}

function removeKey(rec: Record<string, boolean>, key: string): Record<string, boolean> {
  const next = { ...rec };
  delete next[key];
  return next;
}

interface ProblemItem {
  id: string;
  message: string;
  line?: number;
}

interface SearchHit {
  fileId: string;
  rel: string;
  line: number;
  snippet: string;
}

type Modal =
  | { kind: "newProject" }
  | {
      kind: "prompt";
      mode: "newFile" | "newFolder" | "rename";
      parentId: string;
      targetId?: string;
      initial: string;
      title: string;
    }
  | { kind: "delete"; targetId: string; name: string; isDir: boolean }
  | { kind: "closeTab"; tabId: string };

// ------------------------------------------------------------ style tokens

const INPUT_CLS =
  "h-7 w-full rounded-md border border-[var(--nx-border)] bg-black/30 px-2 text-[12px] text-[var(--nx-text)] outline-none placeholder:text-[var(--nx-text-dim)] focus:border-[rgba(var(--nx-accent-rgb),0.5)]";

const BTN_ACCENT =
  "flex h-7 items-center justify-center gap-1.5 rounded-md bg-[rgba(var(--nx-accent-rgb),0.16)] px-3 text-[12px] font-medium text-[var(--nx-accent)] transition-colors hover:bg-[rgba(var(--nx-accent-rgb),0.26)]";

const BTN_GHOST =
  "flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-[12px] text-[var(--nx-text-dim)] transition-colors hover:bg-white/10 hover:text-[var(--nx-text)]";

const BTN_DANGER =
  "flex h-7 items-center justify-center gap-1.5 rounded-md bg-red-500/20 px-3 text-[12px] font-medium text-red-300 transition-colors hover:bg-red-500/30";

// -------------------------------------------------------------- subviews

function ToolBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-md transition-colors ${
        active
          ? "bg-[rgba(var(--nx-accent-rgb),0.16)] text-[var(--nx-accent)]"
          : "text-[var(--nx-text-dim)] hover:bg-white/10 hover:text-[var(--nx-text)]"
      }`}
    >
      {children}
    </button>
  );
}

function MiniBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded-md text-[var(--nx-text-dim)] transition-colors hover:bg-white/10 hover:text-[var(--nx-text)]"
    >
      {children}
    </button>
  );
}

function PanelTabBtn({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Search;
  label: string;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-6 items-center gap-1.5 rounded-md px-2 text-[11.5px] transition-colors ${
        active
          ? "bg-white/10 text-[var(--nx-text)]"
          : "text-[var(--nx-text-dim)] hover:bg-white/[0.06] hover:text-[var(--nx-text)]"
      }`}
    >
      <Icon size={12} />
      <span>{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] leading-4 text-red-300">
          {badge}
        </span>
      )}
    </button>
  );
}

function TabItem({
  node,
  active,
  dirty,
  onSelect,
  onClose,
}: {
  node: FSNode;
  active: boolean;
  dirty: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const { Icon, cls } = fileIcon(node.name);
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={0}
      title={node.name}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      className={`group flex min-w-[110px] max-w-[180px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-[var(--nx-border)] px-2.5 text-[12px] transition-colors ${
        active
          ? "bg-[#0f1218] text-[var(--nx-text)]"
          : "text-[var(--nx-text-dim)] hover:bg-white/[0.04] hover:text-[var(--nx-text)]"
      }`}
      style={active ? { boxShadow: "inset 0 -2px 0 0 var(--nx-accent)" } : undefined}
    >
      <Icon size={12} className={`shrink-0 ${cls}`} />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {dirty && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nx-accent)]"
          title="Unsaved changes"
        />
      )}
      <button
        type="button"
        aria-label={`Close ${node.name}`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="grid h-4 w-4 shrink-0 place-items-center rounded text-[var(--nx-text-dim)] opacity-0 transition-opacity hover:bg-white/10 hover:text-[var(--nx-text)] group-hover:opacity-100"
      >
        <X size={11} />
      </button>
    </div>
  );
}

function ModalOverlay({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 z-50 grid place-items-center bg-black/55 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="nx-glass-strong nx-pop-in w-full max-w-[480px] rounded-xl p-4 shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function PromptModal({
  title,
  initial,
  confirmLabel,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (name: string) => string | null;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const err = onSubmit(value);
    if (err) setError(err);
    else onClose();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[13px] font-medium text-[var(--nx-text)]">{title}</div>
      <input
        ref={inputRef}
        value={value}
        spellCheck={false}
        aria-label={title}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onClose();
        }}
        className={INPUT_CLS}
      />
      {error && <div className="text-[11.5px] text-red-400">{error}</div>}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" className={BTN_GHOST} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={BTN_ACCENT} onClick={submit}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}

function NewProjectModal({
  nodes,
  onClose,
  onSubmit,
}: {
  nodes: Record<string, FSNode>;
  onClose: () => void;
  onSubmit: (name: string, templateId: string) => string | null;
}) {
  const [name, setName] = useState(() => {
    const pid = projectsDirId(nodes);
    return pid ? uniqueName(nodes, pid, "my-site") : "my-site";
  });
  const [templateId, setTemplateId] = useState(PROJECT_TEMPLATES[0]?.id ?? "blank");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const err = onSubmit(name, templateId);
    if (err) setError(err);
    else onClose();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[14px] font-medium text-[var(--nx-text)]">New Project</div>
      <div>
        <label
          htmlFor="nx-studio-newproj"
          className="mb-1 block text-[10.5px] uppercase tracking-[0.12em] text-[var(--nx-text-dim)]"
        >
          Project name
        </label>
        <input
          id="nx-studio-newproj"
          ref={inputRef}
          value={name}
          spellCheck={false}
          placeholder="my-site"
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
          className={INPUT_CLS}
        />
      </div>
      <div>
        <div className="mb-1.5 text-[10.5px] uppercase tracking-[0.12em] text-[var(--nx-text-dim)]">
          Template
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PROJECT_TEMPLATES.map((t) => {
            const selected = t.id === templateId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTemplateId(t.id)}
                className={`rounded-lg border p-2.5 text-left transition-colors ${
                  selected
                    ? "border-[rgba(var(--nx-accent-rgb),0.55)] bg-[rgba(var(--nx-accent-rgb),0.10)]"
                    : "border-[var(--nx-border)] hover:border-white/25"
                }`}
              >
                <div
                  className={`text-[12.5px] font-medium ${
                    selected ? "text-[var(--nx-accent)]" : "text-[var(--nx-text)]"
                  }`}
                >
                  {t.name}
                </div>
                <div className="mt-0.5 text-[11px] leading-snug text-[var(--nx-text-dim)]">
                  {t.description}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {t.files.map((f) => (
                    <span
                      key={f.name}
                      className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[10px] text-[var(--nx-text-dim)]"
                    >
                      {f.name}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {error && <div className="text-[11.5px] text-red-400">{error}</div>}
      <div className="mt-1 flex justify-end gap-2">
        <button type="button" className={BTN_GHOST} onClick={onClose}>
          Cancel
        </button>
        <button type="button" className={BTN_ACCENT} onClick={submit}>
          <Plus size={13} /> Create project
        </button>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- main app

export default function StudioApp({ windowId, launchProps, setTitle }: AppInstanceProps) {
  const fsReady = useFS((s) => s.ready);
  const nodes = useFS((s) => s.nodes);
  const launchOS = useOS((s) => s.launch);
  const notify = useOS((s) => s.notify);
  const openCtx = useOS((s) => s.openCtx);
  const addRecent = useSettings((s) => s.addRecent);

  const [booted, setBooted] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<"terminal" | "problems" | "search" | "git" | "servers" | null>("terminal");
  const [panelH, setPanelH] = useState(240);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [previewDoc, setPreviewDoc] = useState<string | null>(null);
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[] | null>(null);
  const [caret, setCaret] = useState({ line: 1, col: 1 });
  const [revealTick, setRevealTick] = useState(0);
  const [modal, setModal] = useState<Modal | null>(null);
  const [projMenuOpen, setProjMenuOpen] = useState(false);

  const editorRef = useRef<MonacoEditorNs.IStandaloneCodeEditor | null>(null);
  const pendingRef = useRef<Record<string, string>>({});
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealRef = useRef<{ id: string; line: number } | null>(null);
  const editorFocusedRef = useRef(false);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const lastTitleRef = useRef("");
  const actionsRef = useRef<{
    flushAll: () => void;
    refreshPreview: (rootOverride?: string) => void;
    previewOpen: boolean;
    autoRefresh: boolean;
  }>({ flushAll: () => {}, refreshPreview: () => {}, previewOpen: true, autoRefresh: true });

  // ----- derived
  const projects = useMemo(() => listProjects(nodes), [nodes]);
  const project = projectId ? nodes[projectId] ?? null : null;
  const activeNode = activeId ? nodes[activeId] ?? null : null;
  const activeIsText =
    !!activeNode &&
    activeNode.type === "file" &&
    !activeNode.binary &&
    isTextFile(activeNode.name, activeNode.mime) &&
    typeof activeNode.content === "string";
  const activeIsBinary = !!activeNode && activeNode.type === "file" && !activeIsText;
  const activeDirty = !!(activeId && dirty[activeId]);
  const editorOptions: MonacoEditorNs.IStandaloneEditorConstructionOptions = activeIsBinary
    ? { ...EDITOR_OPTIONS, readOnly: true }
    : EDITOR_OPTIONS;

  // ----- preview
  const refreshPreviewNow = (rootOverride?: string): void => {
    const rootId = rootOverride ?? projectId;
    const nodesNow = useFS.getState().nodes;
    if (!rootId || !nodesNow[rootId]) {
      setPreviewDoc(null);
      return;
    }
    setPreviewDoc(buildPreviewDoc(collectPreviewFiles(nodesNow, rootId), windowId));
    setProblems([]);
  };

  const schedulePreviewRefresh = (): void => {
    const flags = actionsRef.current;
    if (!flags.autoRefresh || !flags.previewOpen) return;
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      actionsRef.current.refreshPreview();
    }, 1000);
  };

  // ----- boot: process launchProps.openFileId once the filesystem is ready.
  // Render-phase state init (React-blessed alternative to a mount effect).
  if (fsReady && !booted) {
    setBooted(true);
    const nodesNow = useFS.getState().nodes;
    const openFileId = launchProps?.openFileId;
    const fileId = typeof openFileId === "string" ? openFileId : null;
    let rootId: string | null = null;
    if (fileId && nodesNow[fileId]) {
      rootId = deriveProjectRoot(nodesNow, fileId);
      if (rootId) {
        setProjectId(rootId);
        setTabs([fileId]);
        setActiveId(fileId);
      }
    }
    if (!rootId) {
      const first = listProjects(nodesNow)[0];
      if (first) setProjectId(first.id);
    }
    if (rootId) refreshPreviewNow(rootId);
  }

  // ----- saving
  const saveTabNow = (id: string): void => {
    const value = pendingRef.current[id];
    if (value === undefined) return;
    delete pendingRef.current[id];
    const fsStore = useFS.getState();
    const node = fsStore.nodes[id];
    if (!node || node.type !== "file") {
      setDirty((d) => (d[id] ? removeKey(d, id) : d));
      return;
    }
    if (value === node.content) {
      // identical — skip the write, just clear the dirty marker
      setDirty((d) => (d[id] ? removeKey(d, id) : d));
      return;
    }
    const err = fsStore.writeFile(id, value);
    if (err) {
      pendingRef.current[id] = value; // retry on the next flush
      notify({ title: "Nexus Studio", body: `Could not save "${node.name}": ${err}` });
      return;
    }
    setDirty((d) => (d[id] ? removeKey(d, id) : d));
    schedulePreviewRefresh();
  };

  const flushAllSaves = (): void => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    for (const id of Object.keys(pendingRef.current)) saveTabNow(id);
  };

  // keep Monaco-mounted + timer closures pointing at the freshest actions
  useEffect(() => {
    actionsRef.current = {
      flushAll: flushAllSaves,
      refreshPreview: refreshPreviewNow,
      previewOpen,
      autoRefresh,
    };
  });

  // ----- tabs
  const openTab = (id: string, reveal?: { line: number }): void => {
    const node = useFS.getState().nodes[id];
    if (!node || node.type !== "file") return;
    flushAllSaves();
    // if the file lives in another project, switch the explorer/preview context
    const derivedRoot = deriveProjectRoot(useFS.getState().nodes, id);
    if (derivedRoot && derivedRoot !== projectId) {
      setProjectId(derivedRoot);
      refreshPreviewNow(derivedRoot);
    }
    setTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setActiveId(id);
    addRecent(id);
    if (reveal) {
      revealRef.current = { id, line: reveal.line };
      setRevealTick((t) => t + 1);
    }
  };

  const closeTabNow = (id: string): void => {
    const idx = tabs.indexOf(id);
    const nextTabs = tabs.filter((t) => t !== id);
    delete pendingRef.current[id];
    setTabs(nextTabs);
    setDirty((d) => (d[id] ? removeKey(d, id) : d));
    if (activeId === id) setActiveId(nextTabs[Math.max(0, idx - 1)] ?? null);
  };

  const requestCloseTab = (id: string): void => {
    if (dirty[id]) {
      // let the user decide: save / discard / cancel
      setModal({ kind: "closeTab", tabId: id });
      return;
    }
    closeTabNow(id);
  };

  // ----- project ops
  const selectProject = (id: string | null): void => {
    if (id === projectId) return;
    flushAllSaves();
    pendingRef.current = {};
    setTabs([]);
    setActiveId(null);
    setDirty({});
    setExpanded({});
    setProblems([]);
    setSearchResults(null);
    setProjectId(id);
    setPreviewDoc(null);
    if (id) refreshPreviewNow(id);
  };

  const submitNewProject = (name: string, templateId: string): string | null => {
    const fsStore = useFS.getState();
    let pid = projectsDirId(fsStore.nodes);
    if (!pid) {
      const res = fsStore.createNode({
        parentId: HOME_ID,
        name: "Projects",
        type: "dir",
        autoRename: false,
      });
      if ("error" in res) return res.error;
      pid = res.id;
    }
    const finalName = uniqueName(useFS.getState().nodes, pid, name.trim() || "my-site");
    const res = useFS.getState().createNode({
      parentId: pid,
      name: finalName,
      type: "dir",
      autoRename: false,
    });
    if ("error" in res) return res.error;
    const rootId = res.id;
    const tpl = templateById(templateId) ?? PROJECT_TEMPLATES[0];
    if (tpl) {
      for (const f of tpl.files) {
        const r = useFS.getState().createNode({
          parentId: rootId,
          name: f.name,
          type: "file",
          content: f.content,
          autoRename: true,
        });
        if ("error" in r) notify({ title: "Nexus Studio", body: r.error });
      }
    }
    // switch to the fresh project and open its first file
    pendingRef.current = {};
    setTabs([]);
    setDirty({});
    setExpanded({});
    setProblems([]);
    setSearchResults(null);
    setProjectId(rootId);
    const first = tpl?.files[0];
    const firstId = first ? findChild(useFS.getState().nodes, rootId, first.name)?.id ?? null : null;
    if (firstId) {
      setTabs([firstId]);
      setActiveId(firstId);
      addRecent(firstId);
    }
    refreshPreviewNow(rootId);
    return null;
  };

  // ----- explorer ops
  const submitPrompt = (
    mode: "newFile" | "newFolder" | "rename",
    parentId: string,
    targetId: string | undefined,
    name: string
  ): string | null => {
    const trimmed = name.trim();
    if (mode === "rename") {
      if (!targetId) return "Nothing to rename";
      return useFS.getState().rename(targetId, trimmed);
    }
    if (mode === "newFolder") {
      const res = useFS.getState().createNode({
        parentId,
        name: trimmed,
        type: "dir",
        autoRename: false,
      });
      return "error" in res ? res.error : null;
    }
    const res = useFS.getState().createNode({
      parentId,
      name: trimmed,
      type: "file",
      content: "",
      autoRename: false,
    });
    if ("error" in res) return res.error;
    openTab(res.id);
    return null;
  };

  const performDelete = (targetId: string): void => {
    const nodesNow = useFS.getState().nodes;
    const doomed = new Set(descendantsOf(nodesNow, targetId));
    for (const id of Object.keys(pendingRef.current)) {
      if (doomed.has(id)) delete pendingRef.current[id];
    }
    const nextTabs = tabs.filter((t) => !doomed.has(t));
    setTabs(nextTabs);
    setDirty((d) => {
      const next = { ...d };
      for (const id of Object.keys(next)) if (doomed.has(id)) delete next[id];
      return next;
    });
    if (activeId && doomed.has(activeId)) {
      setActiveId(nextTabs[nextTabs.length - 1] ?? null);
    }
    if (projectId && doomed.has(projectId)) {
      setProjectId(null);
    }
    const err = useFS.getState().remove(targetId);
    if (err) notify({ title: "Nexus Studio", body: err });
    refreshPreviewNow();
  };

  const handleNodeContext = (e: ReactMouseEvent, node: FSNode): void => {
    e.preventDefault();
    e.stopPropagation();
    const dirId = node.type === "dir" ? node.id : node.parentId ?? "";
    const parentName =
      node.type === "dir" ? node.name : nodes[node.parentId ?? ""]?.name ?? "folder";
    const items: ContextMenuItem[] = [];
    if (node.type === "file") items.push({ label: "Open", onClick: () => openTab(node.id) });
    items.push(
      {
        label: "New File",
        onClick: () =>
          setModal({
            kind: "prompt",
            mode: "newFile",
            parentId: dirId,
            initial: uniqueName(useFS.getState().nodes, dirId, "untitled.html"),
            title: `New file in ${parentName}`,
          }),
      },
      {
        label: "New Folder",
        onClick: () =>
          setModal({
            kind: "prompt",
            mode: "newFolder",
            parentId: dirId,
            initial: uniqueName(useFS.getState().nodes, dirId, "new-folder"),
            title: `New folder in ${parentName}`,
          }),
      },
      {
        label: "Rename",
        onClick: () =>
          setModal({
            kind: "prompt",
            mode: "rename",
            parentId: dirId,
            targetId: node.id,
            initial: node.name,
            title: `Rename "${node.name}"`,
          }),
      },
      {
        label: "Duplicate",
        onClick: () => {
          const err = useFS.getState().copy(node.id, dirId);
          if (err) notify({ title: "Nexus Studio", body: err });
        },
      },
      { separator: true },
      {
        label: "Delete",
        danger: true,
        onClick: () =>
          setModal({
            kind: "delete",
            targetId: node.id,
            name: node.name,
            isDir: node.type === "dir",
          }),
      }
    );
    openCtx(e.clientX, e.clientY, items);
  };

  // ----- export
  const exportZip = async (): Promise<void> => {
    if (!projectId) return;
    flushAllSaves();
    const projectName = useFS.getState().nodes[projectId]?.name ?? "project";
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const nodesNow = useFS.getState().nodes;
      const addDir = (dirId: string, prefix: string): void => {
        for (const child of childrenOf(nodesNow, dirId)) {
          const rel = prefix ? `${prefix}/${child.name}` : child.name;
          if (child.type === "dir") {
            addDir(child.id, rel);
          } else if (typeof child.content === "string") {
            zip.file(rel, child.content);
          } else if (child.binary) {
            zip.file(rel, child.binary);
          }
        }
      };
      addDir(projectId, "");
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `${projectName}.zip`);
      notify({ title: "Nexus Studio", body: `Exported ${projectName}.zip` });
    } catch (e) {
      notify({
        title: "Nexus Studio",
        body: `Export failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  };

  // ----- search in project
  const runProjectSearch = (): void => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !projectId) {
      setSearchResults([]);
      return;
    }
    const nodesNow = useFS.getState().nodes;
    const hits: SearchHit[] = [];
    for (const id of descendantsOf(nodesNow, projectId)) {
      if (hits.length >= 100) break;
      const n = nodesNow[id];
      if (!n || n.type !== "file" || typeof n.content !== "string" || !isTextFile(n.name, n.mime)) {
        continue;
      }
      const rel = relPathOf(nodesNow, projectId, id);
      const fileLines = n.content.split("\n");
      for (let i = 0; i < fileLines.length; i++) {
        if (fileLines[i].toLowerCase().includes(q)) {
          hits.push({
            fileId: id,
            rel,
            line: i + 1,
            snippet: fileLines[i].trim().slice(0, 140),
          });
          if (hits.length >= 100) break;
        }
      }
    }
    setSearchResults(hits);
  };

  // ----- Monaco
  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monaco.editor.defineTheme("nexus", {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0f1218",
        "editor.foreground": "#e8eaf1",
        "editorCursor.foreground": "#22d3ee",
        "editor.selectionBackground": "#22d3ee33",
      },
    });
    monaco.editor.setTheme("nexus");
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      actionsRef.current.flushAll();
    });
    editor.onDidChangeCursorPosition((e) => {
      setCaret({ line: e.position.lineNumber, col: e.position.column });
    });
    editor.onDidFocusEditorText(() => {
      editorFocusedRef.current = true;
    });
    editor.onDidBlurEditorText(() => {
      editorFocusedRef.current = false;
    });
  };

  const handleEditorChange = (value: string | undefined): void => {
    if (!activeId || value === undefined) return;
    const node = useFS.getState().nodes[activeId];
    if (!node) return;
    if (value === node.content) {
      // programmatic sync (e.g. the terminal wrote this file) — not an edit
      if (pendingRef.current[activeId] !== undefined) delete pendingRef.current[activeId];
      setDirty((d) => (d[activeId] ? removeKey(d, activeId) : d));
      return;
    }
    pendingRef.current[activeId] = value;
    setDirty((d) => (d[activeId] ? d : { ...d, [activeId]: true }));
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTabNow(activeId);
    }, 800);
  };

  const findInEditor = (actionId: string): void => {
    editorRef.current?.trigger("nexus-studio", actionId, null);
  };

  const togglePreview = (): void => {
    if (previewOpen) {
      setPreviewOpen(false);
    } else {
      setPreviewOpen(true);
      refreshPreviewNow();
    }
  };

  // ----- bottom panel resize
  const onPanelDragStart = (e: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = { startY: e.clientY, startH: panelH };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPanelDragMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (!d) return;
    setPanelH(Math.round(clamp(d.startH + (d.startY - e.clientY), 110, 560)));
  };
  const onPanelDragEnd = (e: ReactPointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // ----- effects
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // reveal a specific line after a tab becomes active (search-in-project)
  useEffect(() => {
    const r = revealRef.current;
    if (!r || r.id !== activeIdRef.current) return;
    const ed = editorRef.current;
    if (!ed) return;
    ed.revealLineInCenter(r.line);
    ed.setPosition({ lineNumber: r.line, column: 1 });
    ed.focus();
    revealRef.current = null;
  }, [revealTick]);

  // Ctrl/Cmd+S while the editor has focus (Monaco addCommand covers it too)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "s" &&
        editorFocusedRef.current
      ) {
        e.preventDefault();
        actionsRef.current.flushAll();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // runtime errors reported by the sandboxed preview (this window's instance)
  useEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (!isRuntimePayload(e.data) || e.data.kind !== "error") return;
      if (e.data.id !== windowId) return;
      const message = e.data.message;
      if (!message) return;
      const line = typeof e.data.line === "number" ? e.data.line : undefined;
      setProblems((prev) => [...prev, { id: uid(), message, line }].slice(-100));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [windowId]);

  // window title follows the active file / project
  useEffect(() => {
    const pName = project?.name;
    const fName = activeNode?.name;
    const title = fName
      ? `${fName} — ${pName ?? "Nexus Studio"}`
      : pName
        ? `${pName} — Nexus Studio`
        : "Nexus Studio";
    if (title !== lastTitleRef.current) {
      lastTitleRef.current = title;
      setTitle(title);
    }
  }, [project?.name, activeNode?.name, setTitle]);

  // persist pending buffers + clear timers when the window closes
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
      const pending = { ...pendingRef.current };
      for (const id of Object.keys(pending)) {
        const node = useFS.getState().nodes[id];
        if (node && node.type === "file" && node.content !== pending[id]) {
          useFS.getState().writeFile(id, pending[id]);
        }
      }
    };
  }, []);

  // ----- loading skeleton
  if (!fsReady) {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        <div className="h-9 shrink-0 animate-pulse rounded-lg bg-white/[0.05]" />
        <div className="flex min-h-0 flex-1 gap-2">
          <div className="w-[220px] shrink-0 animate-pulse rounded-lg bg-white/[0.05]" />
          <div className="min-w-0 flex-1 animate-pulse rounded-lg bg-white/[0.05]" />
        </div>
        <div className="h-6 shrink-0 animate-pulse rounded bg-white/[0.05]" />
      </div>
    );
  }

  // ----- no projects yet
  if (!project) {
    return (
      <div className="relative flex h-full flex-col">
        <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-[var(--nx-border)] bg-black/20 px-2">
          <ToolBtn
            title="Toggle explorer"
            onClick={() => setExplorerOpen((v) => !v)}
            active={explorerOpen}
          >
            <PanelLeft size={14} />
          </ToolBtn>
          <div className="ml-auto">
            <button type="button" className={BTN_ACCENT} onClick={() => setModal({ kind: "newProject" })}>
              <Plus size={13} /> New Project
            </button>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-8">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-[var(--nx-border)] bg-black/30">
            <FileCode size={24} className="text-[var(--nx-accent)]" />
          </div>
          <div className="text-[15px] font-medium text-[var(--nx-text)]">No projects yet</div>
          <p className="max-w-[360px] text-center text-[12.5px] leading-relaxed text-[var(--nx-text-dim)]">
            Nexus Studio keeps your sites inside /home/Projects. Create one from a
            template and start coding — the live preview and terminal panel are
            ready when you are.
          </p>
          <button type="button" className={BTN_ACCENT} onClick={() => setModal({ kind: "newProject" })}>
            <Plus size={13} /> New Project
          </button>
        </div>
        {modal?.kind === "newProject" && (
          <ModalOverlay onClose={() => setModal(null)}>
            <NewProjectModal
              nodes={nodes}
              onClose={() => setModal(null)}
              onSubmit={submitNewProject}
            />
          </ModalOverlay>
        )}
      </div>
    );
  }

  // ----- main layout
  return (
    <div className="relative flex h-full flex-col">
      {/* toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[var(--nx-border)] bg-black/20 px-2">
        {/* project selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setProjMenuOpen((v) => !v)}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--nx-text)] transition-colors hover:bg-white/10"
          >
            <Folder size={13} className="text-[var(--nx-accent)]" />
            <span className="max-w-[150px] truncate">{project.name}</span>
            <ChevronDown size={12} className="text-[var(--nx-text-dim)]" />
          </button>
          {projMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setProjMenuOpen(false)} />
              <div className="nx-glass-strong nx-pop-in absolute left-0 top-8 z-50 w-56 rounded-lg p-1 shadow-xl">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--nx-text-dim)]">
                  Projects
                </div>
                {projects.length === 0 && (
                  <div className="px-2 py-1.5 text-[12px] text-[var(--nx-text-dim)]">
                    No projects yet
                  </div>
                )}
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProjMenuOpen(false);
                      selectProject(p.id);
                    }}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors ${
                      p.id === projectId
                        ? "bg-[rgba(var(--nx-accent-rgb),0.14)] text-[var(--nx-text)]"
                        : "text-[var(--nx-text-dim)] hover:bg-white/10 hover:text-[var(--nx-text)]"
                    }`}
                  >
                    <Folder size={12} className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    {p.id === projectId && <Check size={12} className="text-[var(--nx-accent)]" />}
                  </button>
                ))}
                <div className="my-1 border-t border-[var(--nx-border)]" />
                <button
                  type="button"
                  onClick={() => {
                    setProjMenuOpen(false);
                    setModal({ kind: "newProject" });
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-[var(--nx-accent)] transition-colors hover:bg-white/10"
                >
                  <Plus size={13} /> New Project
                </button>
              </div>
            </>
          )}
        </div>

        <div className="mx-1 h-5 w-px shrink-0 bg-[var(--nx-border)]" />
        <ToolBtn title="Save all (Ctrl+S)" onClick={flushAllSaves}>
          <Save size={14} />
        </ToolBtn>
        <ToolBtn title="Find" onClick={() => findInEditor("actions.find")}>
          <Search size={14} />
        </ToolBtn>
        <ToolBtn
          title="Find and replace"
          onClick={() => findInEditor("editor.action.startFindReplaceAction")}
        >
          <Replace size={14} />
        </ToolBtn>
        <ToolBtn
          title="Search in project"
          onClick={() => setPanelTab("search")}
          active={panelTab === "search"}
        >
          <FileSearch size={14} />
        </ToolBtn>

        <div className="mx-1 h-5 w-px shrink-0 bg-[var(--nx-border)]" />
        <ToolBtn title={previewOpen ? "Hide preview" : "Show preview"} onClick={togglePreview} active={previewOpen}>
          {previewOpen ? <Eye size={14} /> : <EyeOff size={14} />}
        </ToolBtn>
        <ToolBtn
          title={autoRefresh ? "Auto-refresh preview: on" : "Auto-refresh preview: off"}
          onClick={() => setAutoRefresh((v) => !v)}
          active={autoRefresh}
        >
          <RotateCw size={14} />
        </ToolBtn>
        <ToolBtn title="Export project as ZIP" onClick={() => void exportZip()}>
          <Package size={14} />
        </ToolBtn>

        <div className="ml-auto flex items-center gap-1">
          <ToolBtn
            title={panelTab ? "Hide bottom panel" : "Show bottom panel"}
            onClick={() => setPanelTab((t) => (t ? null : "terminal"))}
            active={!!panelTab}
          >
            <PanelBottom size={14} />
          </ToolBtn>
          <ToolBtn
            title={explorerOpen ? "Hide explorer" : "Show explorer"}
            onClick={() => setExplorerOpen((v) => !v)}
            active={explorerOpen}
          >
            <PanelLeft size={14} />
          </ToolBtn>
          <button
            type="button"
            className={BTN_ACCENT}
            onClick={() => setModal({ kind: "newProject" })}
          >
            <Plus size={13} /> New
          </button>
        </div>
      </div>

      {/* middle: explorer | editor | preview */}
      <div className="flex min-h-[140px] min-w-0 flex-1">
        {explorerOpen && (
          <div className="flex w-[220px] shrink-0 flex-col border-r border-[var(--nx-border)] bg-black/20">
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--nx-border)] px-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nx-text-dim)]">
                Explorer
              </span>
              <div className="ml-auto flex items-center">
                <MiniBtn
                  title="New file at project root"
                  onClick={() =>
                    setModal({
                      kind: "prompt",
                      mode: "newFile",
                      parentId: projectId ?? "",
                      initial: uniqueName(nodes, projectId ?? "", "untitled.html"),
                      title: `New file in ${project.name}`,
                    })
                  }
                >
                  <FilePlus size={12} />
                </MiniBtn>
                <MiniBtn
                  title="New folder at project root"
                  onClick={() =>
                    setModal({
                      kind: "prompt",
                      mode: "newFolder",
                      parentId: projectId ?? "",
                      initial: uniqueName(nodes, projectId ?? "", "new-folder"),
                      title: `New folder in ${project.name}`,
                    })
                  }
                >
                  <FolderPlus size={12} />
                </MiniBtn>
                <MiniBtn title="Hide explorer" onClick={() => setExplorerOpen(false)}>
                  <PanelLeft size={12} />
                </MiniBtn>
              </div>
            </div>
            <FileTree
              nodes={nodes}
              rootId={project.id}
              activeId={activeId}
              expanded={expanded}
              onToggleDir={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
              onOpenFile={(id) => openTab(id)}
              onRename={(node) =>
                setModal({
                  kind: "prompt",
                  mode: "rename",
                  parentId: node.parentId ?? "",
                  targetId: node.id,
                  initial: node.name,
                  title: `Rename "${node.name}"`,
                })
              }
              onContext={handleNodeContext}
            />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          {/* tabs */}
          <div className="flex h-9 shrink-0 items-stretch border-b border-[var(--nx-border)] bg-black/20">
            <div className="nx-scroll flex min-w-0 flex-1 items-stretch overflow-x-auto">
              {tabs.map((id) => {
                const n = nodes[id];
                if (!n) return null;
                return (
                  <TabItem
                    key={id}
                    node={n}
                    active={id === activeId}
                    dirty={!!dirty[id]}
                    onSelect={() => {
                      flushAllSaves();
                      setActiveId(id);
                    }}
                    onClose={() => requestCloseTab(id)}
                  />
                );
              })}
            </div>
          </div>

          {/* editor surface */}
          <div className="relative min-h-0 flex-1 bg-[#0f1218]">
            {activeNode && activeIsText ? (
              <Editor
                path={activeNode.id}
                value={activeNode.content ?? ""}
                language={monacoLang(activeNode.name)}
                theme="nexus"
                options={editorOptions}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                loading={
                  <span className="text-[12px] text-[var(--nx-text-dim)]">Loading editor…</span>
                }
              />
            ) : activeNode && activeIsBinary ? (
              <div className="grid h-full place-items-center p-6">
                <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-[var(--nx-border)] bg-black/30 px-6 py-8 text-center">
                  <FileIcon size={22} className="text-zinc-400" />
                  <div className="text-[13px] text-[var(--nx-text)]">{activeNode.name}</div>
                  <div className="text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
                    Binary file ({formatBytes(nodeSize(activeNode))}) — editing is disabled.
                  </div>
                  <button
                    type="button"
                    className={BTN_ACCENT}
                    onClick={() => {
                      const buf = activeNode.binary;
                      if (!buf) return;
                      downloadBlob(new Blob([buf]), activeNode.name);
                    }}
                  >
                    <Package size={13} /> Download
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid h-full place-items-center">
                <div className="flex flex-col items-center gap-3 text-center">
                  <FileCode size={26} className="text-[rgba(var(--nx-accent-rgb),0.55)]" />
                  <div className="text-[13px] text-[var(--nx-text)]">No file open</div>
                  <div className="max-w-[260px] text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
                    Pick a file from the explorer on the left, or create one with
                    the buttons in the explorer header.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {previewOpen && (
          <div className="w-[38%] min-w-[240px] shrink-0 border-l border-[var(--nx-border)] bg-[#0d1017]">
            <PreviewPane
              doc={previewDoc}
              onRefresh={() => refreshPreviewNow()}
              onClose={() => setPreviewOpen(false)}
            />
          </div>
        )}
      </div>

      {/* bottom panel */}
      {panelTab !== null && (
        <>
          <div
            className="nx-drag-none h-[3px] shrink-0 cursor-row-resize bg-white/[0.04] transition-colors hover:bg-[rgba(var(--nx-accent-rgb),0.45)]"
            onPointerDown={onPanelDragStart}
            onPointerMove={onPanelDragMove}
            onPointerUp={onPanelDragEnd}
            onPointerCancel={onPanelDragEnd}
          />
          <div
            className="flex shrink-0 flex-col border-t border-[var(--nx-border)]"
            style={{ height: `min(${panelH}px, 46%)` }}
          >
            <div className="flex h-8 shrink-0 items-center gap-1 border-b border-[var(--nx-border)] bg-black/20 px-2">
              <PanelTabBtn
                active={panelTab === "terminal"}
                onClick={() => setPanelTab("terminal")}
                icon={TerminalSquare}
                label="Terminal"
              />
              <PanelTabBtn
                active={panelTab === "problems"}
                onClick={() => setPanelTab("problems")}
                icon={AlertTriangle}
                label="Problems"
                badge={problems.length}
              />
              <PanelTabBtn
                active={panelTab === "search"}
                onClick={() => setPanelTab("search")}
                icon={Search}
                label="Search"
              />
              <PanelTabBtn
                active={panelTab === "git"}
                onClick={() => setPanelTab("git")}
                icon={GitBranch}
                label="Git"
              />
              <PanelTabBtn
                active={panelTab === "servers"}
                onClick={() => setPanelTab("servers")}
                icon={Server}
                label="Servers"
              />
              <div className="ml-auto">
                <MiniBtn title="Hide panel" onClick={() => setPanelTab(null)}>
                  <X size={13} />
                </MiniBtn>
              </div>
            </div>
            <div className="relative min-h-0 flex-1">
              <div className={`absolute inset-0 ${panelTab === "terminal" ? "" : "hidden"}`}>
                <TerminalPanel
                  projectRootId={projectId}
                  launch={launchOS}
                  openLocalFile={(id) => openTab(id)}
                  active={panelTab === "terminal"}
                />
              </div>
              <div
                className={`absolute inset-0 ${
                  panelTab === "problems" ? "flex flex-col" : "hidden"
                }`}
              >
                <div className="flex shrink-0 items-center justify-between border-b border-white/[0.04] px-3 py-1">
                  <span className="text-[11px] text-[var(--nx-text-dim)]">
                    {problems.length === 0
                      ? "No runtime errors captured."
                      : `${problems.length} runtime ${problems.length === 1 ? "error" : "errors"}`}
                  </span>
                  <button type="button" className={BTN_GHOST} onClick={() => setProblems([])}>
                    Clear
                  </button>
                </div>
                <div className="nx-scroll min-h-0 flex-1 overflow-auto">
                  {problems.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-start gap-2 border-b border-white/[0.04] px-3 py-1.5 text-[12px]"
                    >
                      <AlertTriangle size={12} className="mt-0.5 shrink-0 text-red-400" />
                      <span className="min-w-0 flex-1 break-words text-[var(--nx-text)]">
                        {p.message}
                      </span>
                      {p.line !== undefined && (
                        <span className="shrink-0 text-[var(--nx-text-dim)]">line {p.line}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div
                className={`absolute inset-0 ${
                  panelTab === "search" ? "flex flex-col" : "hidden"
                }`}
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.04] px-2.5 py-1.5">
                  <Search size={12} className="shrink-0 text-[var(--nx-text-dim)]" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") runProjectSearch();
                    }}
                    placeholder="Search text in project files…"
                    spellCheck={false}
                    className={INPUT_CLS}
                    aria-label="Search in project"
                  />
                  <button type="button" className={BTN_GHOST} onClick={runProjectSearch}>
                    Find
                  </button>
                </div>
                <div className="nx-scroll min-h-0 flex-1 overflow-auto">
                  {searchResults === null ? (
                    <div className="px-3 py-3 text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
                      Type a query and press Enter — all text files under the
                      project are scanned (up to 100 matches).
                    </div>
                  ) : searchResults.length === 0 ? (
                    <div className="px-3 py-3 text-[12px] text-[var(--nx-text-dim)]">
                      No matches.
                    </div>
                  ) : (
                    searchResults.map((h, i) => (
                      <button
                        key={`${h.fileId}:${h.line}:${i}`}
                        type="button"
                        onClick={() => openTab(h.fileId, { line: h.line })}
                        className="flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-white/[0.05]"
                      >
                        <span className="shrink-0 font-mono text-[11px] text-[var(--nx-text-dim)]">
                          {h.rel}:{h.line}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--nx-text)]">
                          {h.snippet}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              <div
                className={`absolute inset-0 ${
                  panelTab === "git" ? "" : "hidden"
                }`}
              >
                {projectId ? <GitPanel projectId={projectId} /> : null}
              </div>
              <div
                className={`absolute inset-0 ${
                  panelTab === "servers" ? "" : "hidden"
                }`}
              >
                {projectId ? <ServersPanel projectId={projectId} /> : null}
              </div>
            </div>
          </div>
        </>
      )}

      {/* status bar */}
      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-[var(--nx-border)] bg-black/30 px-3 text-[11px] text-[var(--nx-text-dim)]">
        <span className={activeDirty ? "text-[var(--nx-accent)]" : ""}>
          {activeDirty ? "Unsaved changes" : "Saved ✓"}
        </span>
        {activeNode && (
          <>
            <span>
              Ln {caret.line}, Col {caret.col}
            </span>
            <span>{formatBytes(nodeSize(activeNode))}</span>
          </>
        )}
        <span className="ml-auto">UTF-8</span>
        <span>{project.name}</span>
      </div>

      {/* modals */}
      {modal && (
        <ModalOverlay onClose={() => setModal(null)}>
          {modal.kind === "newProject" && (
            <NewProjectModal
              nodes={nodes}
              onClose={() => setModal(null)}
              onSubmit={submitNewProject}
            />
          )}
          {modal.kind === "prompt" && (
            <PromptModal
              key={`${modal.mode}-${modal.targetId ?? modal.parentId}`}
              title={modal.title}
              initial={modal.initial}
              confirmLabel={
                modal.mode === "rename"
                  ? "Rename"
                  : modal.mode === "newFile"
                    ? "Create file"
                    : "Create folder"
              }
              onClose={() => setModal(null)}
              onSubmit={(name) => submitPrompt(modal.mode, modal.parentId, modal.targetId, name)}
            />
          )}
          {modal.kind === "delete" && (
            <div className="flex flex-col gap-3">
              <div className="text-[13px] font-medium text-[var(--nx-text)]">
                Delete &ldquo;{modal.name}&rdquo;?
              </div>
              <p className="text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
                {modal.isDir
                  ? "The folder and everything inside it will be removed."
                  : "This file will be removed from the virtual filesystem."}{" "}
                This cannot be undone.
              </p>
              <div className="mt-1 flex justify-end gap-2">
                <button type="button" className={BTN_GHOST} onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_DANGER}
                  onClick={() => {
                    performDelete(modal.targetId);
                    setModal(null);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
          {modal.kind === "closeTab" && (
            <div className="flex flex-col gap-3">
              <div className="text-[13px] font-medium text-[var(--nx-text)]">Save changes?</div>
              <p className="text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
                &ldquo;{nodes[modal.tabId]?.name ?? "This file"}&rdquo; has unsaved changes.
              </p>
              <div className="mt-1 flex justify-end gap-2">
                <button type="button" className={BTN_GHOST} onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={BTN_GHOST}
                  onClick={() => {
                    closeTabNow(modal.tabId);
                    setModal(null);
                  }}
                >
                  Discard
                </button>
                <button
                  type="button"
                  className={BTN_ACCENT}
                  onClick={() => {
                    saveTabNow(modal.tabId);
                    closeTabNow(modal.tabId);
                    setModal(null);
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          )}
        </ModalOverlay>
      )}
    </div>
  );
}
