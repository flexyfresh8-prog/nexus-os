"use client";

// NEXUS OS — Files app: virtual file explorer (sidebar, navigation, DnD,
// clipboard, context menus, media preview, dialogs, keyboard shortcuts)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download as DownloadIcon,
  FilePlus,
  FileText,
  FolderCode,
  FolderOpen,
  FolderPlus,
  HardDrive,
  House,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Monitor,
  Music,
  RotateCw,
  Search,
  Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppInstanceProps, ContextMenuItem, FSNode } from "../../types";
import {
  HOME_ID,
  childrenOf,
  descendantsOf,
  displayPath,
  findChild,
  isTextFile,
  nodeSize,
  uniqueName,
} from "../../lib/vfs";
import { formatBytes, isTouchDevice } from "../../lib/utils";
import { useFS } from "../../store/fs";
import { useOS } from "../../store/os";
import { useSettings } from "../../store/settings";
import { TypeIcon, downloadNode } from "./itemIcon";
import { GridTile, IconBtn, ListRow } from "./items";
import type { ItemHandlers } from "./items";
import { ConfirmDialog, NameDialog, PropertiesDialog } from "./dialogs";
import { PreviewModal, isPreviewable } from "./preview";

/* ---------------- clipboard (module-level, shared across windows) -------- */

interface ClipboardData {
  ids: string[];
  mode: "copy" | "cut";
}

let clipboard: ClipboardData | null = null;
const clipboardSubs = new Set<() => void>();

function setClipboardData(next: ClipboardData | null) {
  clipboard = next;
  for (const fn of clipboardSubs) fn();
}

function useClipboard(): ClipboardData | null {
  const [value, setValue] = useState<ClipboardData | null>(clipboard);
  useEffect(() => {
    const fn = () => setValue(clipboard);
    clipboardSubs.add(fn);
    return () => {
      clipboardSubs.delete(fn);
    };
  }, []);
  return value;
}

/* ---------------- local types ------------------------------------------- */

type SortKey = "name" | "modified" | "size";
type ViewMode = "grid" | "list";

const SORT_LABELS: Record<SortKey, string> = { name: "Name", modified: "Modified", size: "Size" };

const QUICK_LINKS: Array<{ name: string; icon: LucideIcon }> = [
  { name: "Home", icon: House },
  { name: "Documents", icon: FileText },
  { name: "Downloads", icon: DownloadIcon },
  { name: "Projects", icon: FolderCode },
  { name: "Pictures", icon: ImageIcon },
  { name: "Music", icon: Music },
  { name: "Desktop", icon: Monitor },
];

type ModalState =
  | { kind: "preview"; id: string }
  | { kind: "rename"; id: string }
  | { kind: "newFolder" }
  | { kind: "newFile" }
  | { kind: "delete"; id: string }
  | { kind: "properties"; id: string };

const NODE_MIME = "text/nexus-node";

/* ---------------- component --------------------------------------------- */

export default function FilesApp({ windowId, launchProps }: AppInstanceProps) {
  const nodes = useFS((s) => s.nodes);
  const ready = useFS((s) => s.ready);
  const recentIds = useSettings((s) => s.recentFiles);
  const addRecent = useSettings((s) => s.addRecent);
  const isFocused = useOS((s) => s.focusedId === windowId);

  const [nav, setNav] = useState<{ stack: string[]; index: number }>({
    stack: [HOME_ID],
    index: 0,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("grid");
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: "name", asc: true });
  const [modal, setModal] = useState<ModalState | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const clipboardData = useClipboard();

  const dirId = nav.stack[nav.index];
  const dirNode = ready ? nodes[dirId] : undefined;

  const lastTapRef = useRef(0);
  const suppressDblRef = useRef(0);
  const draggingIdRef = useRef<string | null>(null);
  const bootstrappedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ---------- navigation ---------- */

  const navigate = useCallback((id: string) => {
    setNav((n) => {
      if (n.stack[n.index] === id) return n;
      const stack = [...n.stack.slice(0, n.index + 1), id].slice(-50);
      return { stack, index: stack.length - 1 };
    });
    setSelectedId(null);
  }, []);

  const goBack = useCallback(() => {
    setNav((n) => (n.index > 0 ? { ...n, index: n.index - 1 } : n));
    setSelectedId(null);
  }, []);

  const goForward = useCallback(() => {
    setNav((n) => (n.index < n.stack.length - 1 ? { ...n, index: n.index + 1 } : n));
    setSelectedId(null);
  }, []);

  const goUp = useCallback(() => {
    const cur = useFS.getState().nodes[dirId];
    if (cur?.parentId) navigate(cur.parentId);
  }, [dirId, navigate]);

  /* ---------- storage estimate ---------- */

  const refreshStorage = useCallback(async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      setStorage(est ? { usage: est.usage ?? 0, quota: est.quota ?? 0 } : null);
    } catch {
      setStorage(null);
    }
  }, []);

  useEffect(() => {
    navigator.storage
      ?.estimate?.()
      .then((est) => setStorage(est ? { usage: est.usage ?? 0, quota: est.quota ?? 0 } : null))
      .catch(() => setStorage(null));
  }, []);

  /* ---------- window title ---------- */

  useEffect(() => {
    if (!ready) return;
    const title = `Files — ${displayPath(useFS.getState().nodes, dirId)}`;
    const st = useOS.getState();
    const win = st.windows.find((w) => w.id === windowId);
    if (win && win.title !== title) st.setTitle(windowId, title);
  }, [ready, dirId, windowId]);

  /* ---------- launch props bootstrap (reveal / open a node) ---------- */

  useEffect(() => {
    if (!ready || bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    setTimeout(() => {
      const ns = useFS.getState().nodes;
      const candidates = [launchProps?.openId, launchProps?.openFileId, launchProps?.dirId];
      const target = candidates.find((v): v is string => typeof v === "string" && Boolean(ns[v]));
      if (!target) return;
      const node = ns[target];
      if (node.type === "dir") {
        navigate(node.id);
      } else if (node.parentId) {
        navigate(node.parentId);
        setSelectedId(target);
        if (isPreviewable(node)) setModal({ kind: "preview", id: target });
      }
    }, 0);
  }, [ready, launchProps, navigate]);

  /* ---------- derived data ---------- */

  const visibleItems = useMemo<FSNode[]>(() => {
    if (!ready) return [];
    const q = query.trim().toLowerCase();
    let list: FSNode[];
    if (q) {
      list = descendantsOf(nodes, dirId)
        .filter((id) => id !== dirId)
        .map((id) => nodes[id])
        .filter((n): n is FSNode => Boolean(n) && n.name.toLowerCase().includes(q));
    } else {
      list = childrenOf(nodes, dirId);
    }
    const dir = sort.asc ? 1 : -1;
    return [...list].sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      let c = 0;
      if (sort.key === "name") c = a.name.localeCompare(b.name, undefined, { numeric: true });
      else if (sort.key === "modified") c = a.modified - b.modified;
      else c = nodeSize(a) - nodeSize(b);
      return c * dir;
    });
  }, [nodes, dirId, query, sort, ready]);

  const crumbs = useMemo(() => {
    const chain: FSNode[] = [];
    let cur: FSNode | undefined = nodes[dirId];
    let guard = 0;
    while (cur && guard++ < 64) {
      chain.unshift(cur);
      cur = cur.parentId !== null ? nodes[cur.parentId] : undefined;
    }
    return chain;
  }, [nodes, dirId]);

  const recentNodes = useMemo(
    () =>
      recentIds
        .map((id) => nodes[id])
        .filter((n): n is FSNode => Boolean(n))
        .slice(0, 8),
    [recentIds, nodes]
  );

  const modalNode = modal && "id" in modal ? nodes[modal.id] : undefined;

  /* ---------- actions ---------- */

  const openNode = useCallback(
    (node: FSNode) => {
      if (node.type === "dir") {
        navigate(node.id);
        return;
      }
      if (isPreviewable(node)) {
        setModal({ kind: "preview", id: node.id });
        return;
      }
      if (isTextFile(node.name, node.mime)) {
        addRecent(node.id);
        useOS.getState().launch("studio", { openFileId: node.id });
        return;
      }
      setModal({ kind: "properties", id: node.id });
    },
    [navigate, addRecent]
  );

  const pasteIntoDir = useCallback(() => {
    if (!clipboard) return;
    const fs = useFS.getState();
    const os = useOS.getState();
    for (const id of clipboard.ids) {
      const err = clipboard.mode === "copy" ? fs.copy(id, dirId) : fs.move(id, dirId);
      if (err) os.notify({ title: "Files", body: err });
    }
    if (clipboard.mode === "cut") setClipboardData(null);
  }, [dirId]);

  const importFiles = useCallback(async (files: File[], parentId: string) => {
    const fs = useFS.getState();
    const os = useOS.getState();
    for (const file of files) {
      try {
        if (isTextFile(file.name, file.type)) {
          const content = await file.text();
          const res = fs.createNode({ parentId, name: file.name, type: "file", content, autoRename: true });
          if ("error" in res) os.notify({ title: "Files", body: res.error });
        } else {
          const binary = await file.arrayBuffer();
          const res = fs.createNode({
            parentId,
            name: file.name,
            type: "file",
            binary,
            mime: file.type || undefined,
            autoRename: true,
          });
          if ("error" in res) os.notify({ title: "Files", body: res.error });
        }
      } catch (err) {
        os.notify({
          title: "Files",
          body: `Could not import "${file.name}" — ${err instanceof Error ? err.message : "unknown error"}`,
        });
      }
    }
  }, []);

  const sortMenuItems = useCallback((): ContextMenuItem[] => {
    const mark = (active: boolean) => (active ? "✓  " : "");
    return [
      { label: mark(sort.key === "name") + "Name", onClick: () => setSort((s) => ({ ...s, key: "name" })) },
      {
        label: mark(sort.key === "modified") + "Modified",
        onClick: () => setSort((s) => ({ ...s, key: "modified" })),
      },
      { label: mark(sort.key === "size") + "Size", onClick: () => setSort((s) => ({ ...s, key: "size" })) },
      { separator: true },
      { label: mark(sort.asc) + "Ascending", onClick: () => setSort((s) => ({ ...s, asc: true })) },
      { label: mark(!sort.asc) + "Descending", onClick: () => setSort((s) => ({ ...s, asc: false })) },
    ];
  }, [sort]);

  const openSortMenu = useCallback(
    (x: number, y: number) => {
      useOS.getState().openCtx(x, y, sortMenuItems());
    },
    [sortMenuItems]
  );

  const openItemMenu = useCallback(
    (node: FSNode, x: number, y: number) => {
      setSelectedId(node.id);
      const os = useOS.getState();
      const items: ContextMenuItem[] = [{ label: "Open", onClick: () => openNode(node) }];
      if (isPreviewable(node)) {
        items.push({ label: "Preview", onClick: () => setModal({ kind: "preview", id: node.id }) });
      }
      if (node.type === "file" && isTextFile(node.name, node.mime)) {
        items.push({
          label: "Open in Studio",
          onClick: () => {
            addRecent(node.id);
            os.launch("studio", { openFileId: node.id });
          },
        });
      }
      if (node.type === "file") {
        items.push({ label: "Download", onClick: () => downloadNode(node) });
      }
      items.push(
        { separator: true },
        {
          label: "Duplicate",
          onClick: () => {
            const err = useFS.getState().copy(node.id, node.parentId ?? dirId);
            if (err) os.notify({ title: "Files", body: err });
          },
        },
        { label: "Rename", shortcut: "F2", onClick: () => setModal({ kind: "rename", id: node.id }) },
        { separator: true },
        {
          label: "Copy",
          shortcut: "Ctrl+C",
          onClick: () => setClipboardData({ ids: [node.id], mode: "copy" }),
        },
        {
          label: "Cut",
          shortcut: "Ctrl+X",
          onClick: () => setClipboardData({ ids: [node.id], mode: "cut" }),
        },
        { separator: true },
        {
          label: "Delete",
          shortcut: "Del",
          danger: true,
          onClick: () => setModal({ kind: "delete", id: node.id }),
        },
        { label: "Properties", onClick: () => setModal({ kind: "properties", id: node.id }) }
      );
      os.openCtx(x, y, items);
    },
    [dirId, openNode, addRecent]
  );

  const openBackgroundMenu = useCallback(
    (x: number, y: number) => {
      const items: ContextMenuItem[] = [
        { label: "New Folder", onClick: () => setModal({ kind: "newFolder" }) },
        { label: "New Text File", onClick: () => setModal({ kind: "newFile" }) },
        { label: "Paste", disabled: !clipboard, onClick: pasteIntoDir },
        { separator: true },
        { label: "Sort by…", onClick: () => openSortMenu(x + 8, y + 8) },
        {
          label: "Refresh",
          onClick: () => {
            setQuery("");
            void refreshStorage();
          },
        },
        { separator: true },
        { label: "Folder Properties", onClick: () => setModal({ kind: "properties", id: dirId }) },
      ];
      useOS.getState().openCtx(x, y, items);
    },
    [pasteIntoDir, openSortMenu, refreshStorage, dirId]
  );

  /* ---------- item interaction (click / touch / dnd) ---------- */

  const handleItemTap = useCallback(
    (node: FSNode, e: ReactMouseEvent) => {
      e.stopPropagation();
      const ptr = e.nativeEvent as PointerEvent;
      const isTouch = ptr.pointerType === "touch" || isTouchDevice();
      if (!isTouch) {
        setSelectedId(node.id);
        return;
      }
      const now = Date.now();
      if (selectedId === node.id && now - lastTapRef.current < 500) {
        lastTapRef.current = 0;
        suppressDblRef.current = now + 600;
        openNode(node);
      } else {
        lastTapRef.current = now;
        setSelectedId(node.id);
      }
    },
    [selectedId, openNode]
  );

  const handleItemOpen = useCallback(
    (node: FSNode, e: ReactMouseEvent) => {
      e.stopPropagation();
      if (Date.now() < suppressDblRef.current) return;
      openNode(node);
    },
    [openNode]
  );

  const itemHandlers: ItemHandlers = {
    onTap: handleItemTap,
    onOpen: handleItemOpen,
    onMenu: openItemMenu,
    onDragStart: (node, e) => {
      draggingIdRef.current = node.id;
      e.dataTransfer.setData(NODE_MIME, node.id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (node, e) => {
      if (draggingIdRef.current === node.id) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      setDragOverId((cur) => (cur === node.id ? cur : node.id));
    },
    onDragLeave: (node) => {
      setDragOverId((cur) => (cur === node.id ? null : cur));
    },
    onDrop: (node, e) => {
      e.preventDefault();
      e.stopPropagation();
      draggingIdRef.current = null;
      setDragOverId(null);
      if (e.dataTransfer.files.length > 0) {
        void importFiles(Array.from(e.dataTransfer.files), node.id);
        return;
      }
      const dragged = e.dataTransfer.getData(NODE_MIME);
      if (dragged && dragged !== node.id) {
        const err = useFS.getState().move(dragged, node.id);
        if (err) useOS.getState().notify({ title: "Files", body: err });
      }
    },
    onDragEnd: () => {
      draggingIdRef.current = null;
      setDragOverId(null);
    },
  };

  const handleContentDrop = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      draggingIdRef.current = null;
      setDragOverId(null);
      if (e.dataTransfer.files.length > 0) {
        void importFiles(Array.from(e.dataTransfer.files), dirId);
        return;
      }
      const dragged = e.dataTransfer.getData(NODE_MIME);
      if (dragged && dragged !== dirId) {
        const err = useFS.getState().move(dragged, dirId);
        if (err) useOS.getState().notify({ title: "Files", body: err });
      }
    },
    [dirId, importFiles]
  );

  /* ---------- keyboard ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName ?? "";
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el?.isContentEditable ?? false);
      if (e.key === "Escape") {
        if (modal) {
          setModal(null);
          return;
        }
        if (!typing) setSelectedId(null);
        return;
      }
      if (modal || typing || tag === "BUTTON" || !isFocused || e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const node = selectedId ? nodes[selectedId] : undefined;
      if (!node) return;
      if (e.key === "Delete") {
        e.preventDefault();
        setModal({ kind: "delete", id: node.id });
      } else if (e.key === "F2") {
        e.preventDefault();
        setModal({ kind: "rename", id: node.id });
      } else if (e.key === "Enter") {
        e.preventDefault();
        openNode(node);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal, isFocused, selectedId, nodes, openNode]);

  /* ---------- render ---------- */

  const searchQ = query.trim();
  const storagePct =
    storage && storage.quota > 0 ? Math.min(100, Math.round((storage.usage / storage.quota) * 100)) : 0;

  return (
    <div className="@container flex h-full min-h-0 w-full text-[13px] text-[var(--nx-text)]">
      {/* sidebar */}
      <aside className="nx-scroll @min-[640px]:flex hidden w-[200px] shrink-0 flex-col gap-3 overflow-y-auto border-r border-[var(--nx-border)] p-2">
        <div>
          <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-dim)]">
            Quick access
          </div>
          {QUICK_LINKS.map((q) => {
            const id = q.name === "Home" ? HOME_ID : findChild(nodes, HOME_ID, q.name)?.id;
            if (!id) return null;
            const active = id === dirId;
            return (
              <button
                key={q.name}
                type="button"
                onClick={() => navigate(id)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] transition ${
                  active
                    ? "bg-[rgba(var(--nx-accent-rgb),0.15)] text-[var(--nx-text)]"
                    : "text-[var(--nx-text-dim)] hover:bg-white/[0.06] hover:text-[var(--nx-text)]"
                }`}
              >
                <q.icon size={14} className={active ? "text-[var(--nx-accent)]" : ""} />
                {q.name}
              </button>
            );
          })}
        </div>

        <div>
          <div className="flex items-center gap-1.5 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--nx-text-dim)]">
            <Clock size={11} />
            Recent
          </div>
          {recentNodes.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-[var(--nx-text-dim)] opacity-70">
              No recent files
            </div>
          ) : (
            recentNodes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => openNode(n)}
                title={displayPath(nodes, n.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-[var(--nx-text-dim)] transition hover:bg-white/[0.06] hover:text-[var(--nx-text)]"
              >
                <TypeIcon node={n} size={14} />
                <span className="min-w-0 flex-1 truncate text-left">{n.name}</span>
              </button>
            ))
          )}
        </div>

        <div className="mt-auto rounded-xl border border-[var(--nx-border)] bg-white/[0.03] p-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--nx-text-dim)]">
            <HardDrive size={12} />
            Storage
            <button
              type="button"
              title="Refresh storage info"
              aria-label="Refresh storage info"
              onClick={() => void refreshStorage()}
              className="ml-auto grid h-5 w-5 place-items-center rounded transition hover:bg-white/10 hover:text-[var(--nx-text)]"
            >
              <RotateCw size={10} />
            </button>
          </div>
          {storage ? (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--nx-accent)] transition-[width]"
                  style={{ width: `${storagePct}%` }}
                />
              </div>
              <div className="mt-1.5 text-[10px] text-[var(--nx-text-dim)]">
                {formatBytes(storage.usage)} of {formatBytes(storage.quota)} used
              </div>
            </>
          ) : (
            <div className="mt-2 text-[10px] text-[var(--nx-text-dim)]">Storage info unavailable</div>
          )}
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* toolbar */}
        <div className="flex h-11 shrink-0 items-center gap-0.5 border-b border-[var(--nx-border)] px-2">
          <IconBtn title="Back" disabled={nav.index <= 0} onClick={goBack}>
            <ChevronLeft size={15} />
          </IconBtn>
          <IconBtn title="Forward" disabled={nav.index >= nav.stack.length - 1} onClick={goForward}>
            <ChevronRight size={15} />
          </IconBtn>
          <IconBtn title="Up one level" disabled={!dirNode?.parentId} onClick={goUp}>
            <ArrowUp size={15} />
          </IconBtn>

          <nav
            aria-label="Breadcrumb"
            className="nx-scroll mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap py-1"
          >
            {crumbs.map((c, i) => {
              const last = i === crumbs.length - 1;
              return (
                <div key={c.id} className="flex shrink-0 items-center gap-0.5">
                  {i > 0 && (
                    <ChevronRight size={11} className="shrink-0 text-[var(--nx-text-dim)] opacity-60" />
                  )}
                  <button
                    type="button"
                    onClick={() => !last && navigate(c.id)}
                    className={`max-w-[160px] truncate rounded px-1.5 py-0.5 text-[12px] transition ${
                      last
                        ? "font-medium text-[var(--nx-text)]"
                        : "text-[var(--nx-text-dim)] hover:bg-white/10 hover:text-[var(--nx-text)]"
                    }`}
                  >
                    {c.id === HOME_ID ? "~" : c.name || "/"}
                  </button>
                </div>
              );
            })}
          </nav>

          <div className="mx-1 h-4 w-px shrink-0 bg-[var(--nx-border)]" />

          <div className="relative shrink-0">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--nx-text-dim)]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search current folder"
              spellCheck={false}
              className="h-7 w-28 rounded-lg border border-[var(--nx-border)] bg-white/[0.04] pl-7 pr-2 text-[12px] text-[var(--nx-text)] outline-none transition-[width] placeholder:text-[var(--nx-text-dim)] focus:w-36 focus:border-[rgba(var(--nx-accent-rgb),0.5)]"
            />
          </div>

          <div className="mx-1 h-4 w-px shrink-0 bg-[var(--nx-border)]" />

          <button
            type="button"
            title="Sort"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              openSortMenu(r.left, r.bottom + 4);
            }}
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-[11px] text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)]"
          >
            {SORT_LABELS[sort.key]}
            <ChevronDown size={12} />
          </button>
          <IconBtn
            title={sort.asc ? "Ascending order" : "Descending order"}
            onClick={() => setSort((s) => ({ ...s, asc: !s.asc }))}
          >
            {sort.asc ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </IconBtn>

          <div className="mx-1 h-4 w-px shrink-0 bg-[var(--nx-border)]" />

          <IconBtn title="Grid view" active={view === "grid"} onClick={() => setView("grid")}>
            <LayoutGrid size={14} />
          </IconBtn>
          <IconBtn title="List view" active={view === "list"} onClick={() => setView("list")}>
            <ListIcon size={14} />
          </IconBtn>

          <div className="mx-1 h-4 w-px shrink-0 bg-[var(--nx-border)]" />

          <IconBtn title="New folder" onClick={() => setModal({ kind: "newFolder" })}>
            <FolderPlus size={14} />
          </IconBtn>
          <IconBtn title="New text file" onClick={() => setModal({ kind: "newFile" })}>
            <FilePlus size={14} />
          </IconBtn>
          <IconBtn title="Upload files" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} />
          </IconBtn>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (files.length > 0) void importFiles(files, dirId);
            }}
          />
        </div>

        {/* content */}
        <div
          className="nx-scroll relative min-h-0 flex-1 overflow-y-auto"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleContentDrop}
          onClick={() => setSelectedId(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            openBackgroundMenu(e.clientX, e.clientY);
          }}
        >
          {!ready ? (
            <div className="grid grid-cols-[repeat(auto-fill,92px)] content-start gap-1.5 p-3">
              {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="flex h-[96px] w-[92px] flex-col items-center gap-2 rounded-xl p-2">
                  <div className="h-10 w-10 animate-pulse rounded-lg bg-white/[0.06]" />
                  <div className="h-2 w-14 animate-pulse rounded bg-white/[0.06]" />
                </div>
              ))}
            </div>
          ) : !nodes[dirId] ? (
            <div className="grid min-h-full place-items-center p-6">
              <div className="flex flex-col items-center gap-3 text-center">
                <FolderOpen size={44} strokeWidth={1.4} className="text-[var(--nx-text-dim)] opacity-70" />
                <div className="text-[13px]">Location not found</div>
                <button
                  type="button"
                  onClick={() => navigate(HOME_ID)}
                  className="rounded-lg border border-[rgba(var(--nx-accent-rgb),0.4)] bg-[rgba(var(--nx-accent-rgb),0.12)] px-3 py-1.5 text-[12px] text-[var(--nx-accent)] transition hover:bg-[rgba(var(--nx-accent-rgb),0.2)]"
                >
                  Go to Home
                </button>
              </div>
            </div>
          ) : (
            <>
              {searchQ && (
                <div className="flex items-center gap-2 border-b border-[var(--nx-border)] px-3 py-1.5 text-[11px] text-[var(--nx-text-dim)]">
                  <Search size={11} />
                  <span>
                    {visibleItems.length} result{visibleItems.length === 1 ? "" : "s"} for &quot;
                    {searchQ}&quot;
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="ml-auto rounded px-1.5 py-0.5 transition hover:bg-white/10 hover:text-[var(--nx-text)]"
                  >
                    Clear
                  </button>
                </div>
              )}

              {visibleItems.length === 0 ? (
                searchQ ? (
                  <div className="grid min-h-full place-items-center p-6">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <Search size={36} strokeWidth={1.4} className="text-[var(--nx-text-dim)] opacity-70" />
                      <div className="text-[13px]">No matches for &quot;{searchQ}&quot;</div>
                      <div className="text-[12px] text-[var(--nx-text-dim)]">
                        Try a different search term
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid min-h-full place-items-center p-6">
                    <div className="flex flex-col items-center gap-2 text-center">
                      <FolderOpen
                        size={44}
                        strokeWidth={1.4}
                        className="text-[var(--nx-text-dim)] opacity-70"
                      />
                      <div className="text-[13px]">This folder is empty</div>
                      <div className="text-[12px] text-[var(--nx-text-dim)]">
                        Create something with the buttons above
                      </div>
                    </div>
                  </div>
                )
              ) : view === "grid" ? (
                <div className="grid grid-cols-[repeat(auto-fill,92px)] content-start gap-1.5 p-3">
                  {visibleItems.map((node) => (
                    <GridTile
                      key={node.id}
                      node={node}
                      selected={selectedId === node.id}
                      dropTarget={dragOverId === node.id}
                      handlers={itemHandlers}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-2">
                  <div className="flex items-center gap-2 border-b border-[var(--nx-border)] px-2 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--nx-text-dim)]">
                    <span className="min-w-0 flex-1">Name</span>
                    <span className="w-16 shrink-0 text-right">Size</span>
                    <span className="hidden w-32 shrink-0 @min-[560px]:block">Modified</span>
                    <span className="hidden w-24 shrink-0 @min-[640px]:block">Kind</span>
                  </div>
                  <div className="pt-1">
                    {visibleItems.map((node) => (
                      <ListRow
                        key={node.id}
                        node={node}
                        selected={selectedId === node.id}
                        dropTarget={dragOverId === node.id}
                        handlers={itemHandlers}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* modals */}
      {modal?.kind === "preview" && modalNode && (
        <PreviewModal node={modalNode} onClose={() => setModal(null)} />
      )}
      {modal?.kind === "rename" && modalNode && (
        <NameDialog
          title="Rename"
          initial={modalNode.name}
          confirmLabel="Rename"
          onClose={() => setModal(null)}
          onConfirm={(name) => useFS.getState().rename(modal.id, name)}
        />
      )}
      {modal?.kind === "newFolder" && (
        <NameDialog
          title="New Folder"
          initial={uniqueName(nodes, dirId, "New Folder")}
          confirmLabel="Create"
          onClose={() => setModal(null)}
          onConfirm={(name) => {
            const res = useFS.getState().createNode({ parentId: dirId, name, type: "dir" });
            if ("id" in res) setSelectedId(res.id);
            return "error" in res ? res.error : null;
          }}
        />
      )}
      {modal?.kind === "newFile" && (
        <NameDialog
          title="New Text File"
          initial={uniqueName(nodes, dirId, "New Text File.txt")}
          confirmLabel="Create"
          onClose={() => setModal(null)}
          onConfirm={(name) => {
            const res = useFS.getState().createNode({ parentId: dirId, name, type: "file", content: "" });
            if ("id" in res) setSelectedId(res.id);
            return "error" in res ? res.error : null;
          }}
        />
      )}
      {modal?.kind === "delete" && modalNode && (
        <ConfirmDialog
          title={`Delete "${modalNode.name}"?`}
          body="This cannot be undone."
          confirmLabel="Delete"
          onClose={() => setModal(null)}
          onConfirm={() => {
            const err = useFS.getState().remove(modal.id);
            if (!err) {
              if (selectedId === modal.id) setSelectedId(null);
              if (!useFS.getState().nodes[dirId]) navigate(HOME_ID);
            }
            return err;
          }}
        />
      )}
      {modal?.kind === "properties" && modalNode && (
        <PropertiesDialog node={modalNode} nodes={nodes} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
