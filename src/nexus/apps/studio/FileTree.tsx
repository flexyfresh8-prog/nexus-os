"use client";

// NEXUS OS — Studio file explorer tree (recursive, no hooks inside the walk)

import type { MouseEvent, ReactNode } from "react";
import type { FSNode } from "../../types";
import type { LucideIcon } from "lucide-react";
import {
  ChevronDown,
  ChevronRight,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { childrenOf, extOf } from "../../lib/vfs";

/** Icon + tailwind color class for a file, following the OS color language. */
export function fileIcon(name: string): { Icon: LucideIcon; cls: string } {
  switch (extOf(name)) {
    case "html":
    case "htm":
      return { Icon: FileCode, cls: "text-orange-400" };
    case "css":
    case "scss":
      return { Icon: FileCode, cls: "text-sky-400" };
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return { Icon: FileCode, cls: "text-amber-300" };
    case "ts":
    case "tsx":
      return { Icon: FileCode, cls: "text-sky-300" };
    case "json":
      return { Icon: FileJson, cls: "text-lime-300" };
    case "md":
    case "markdown":
      return { Icon: FileText, cls: "text-zinc-300" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
    case "ico":
    case "avif":
      return { Icon: FileImage, cls: "text-fuchsia-300" };
    default:
      return { Icon: File, cls: "text-zinc-500" };
  }
}

export interface FileTreeProps {
  nodes: Record<string, FSNode>;
  rootId: string;
  activeId: string | null;
  /** expanded dirs, keyed by node id */
  expanded: Record<string, boolean>;
  onToggleDir: (id: string) => void;
  onOpenFile: (id: string) => void;
  onRename: (node: FSNode) => void;
  onContext: (e: MouseEvent, node: FSNode) => void;
}

export default function FileTree({
  nodes,
  rootId,
  activeId,
  expanded,
  onToggleDir,
  onOpenFile,
  onRename,
  onContext,
}: FileTreeProps) {
  const renderNode = (node: FSNode, depth: number): ReactNode => {
    const isDir = node.type === "dir";
    const open = isDir && !!expanded[node.id];
    const active = node.id === activeId;
    const icon = isDir
      ? { Icon: open ? FolderOpen : Folder, cls: open ? "text-[var(--nx-accent)]" : "text-zinc-400" }
      : fileIcon(node.name);

    const row = (
      <button
        key={node.id}
        type="button"
        title={node.name}
        aria-expanded={isDir ? open : undefined}
        onClick={() => (isDir ? onToggleDir(node.id) : onOpenFile(node.id))}
        onDoubleClick={() => onRename(node)}
        onContextMenu={(e) => onContext(e, node)}
        className={`flex w-full items-center gap-1.5 rounded-md py-[3px] pr-2 text-left text-[12.5px] leading-none transition-colors ${
          active
            ? "bg-[rgba(var(--nx-accent-rgb),0.16)] text-[var(--nx-text)]"
            : "text-[var(--nx-text-dim)] hover:bg-white/[0.06] hover:text-[var(--nx-text)]"
        }`}
      >
        {/* indent guides */}
        {Array.from({ length: depth }, (_, i) => (
          <span
            key={i}
            className="h-[14px] w-[13px] shrink-0 self-center border-l border-white/[0.07]"
          />
        ))}
        <span className="grid h-3.5 w-3.5 shrink-0 place-items-center">
          {isDir ? (
            open ? (
              <ChevronDown size={12} className="text-[var(--nx-text-dim)]" />
            ) : (
              <ChevronRight size={12} className="text-[var(--nx-text-dim)]" />
            )
          ) : null}
        </span>
        <icon.Icon size={13} className={`shrink-0 ${icon.cls}`} />
        <span className="truncate">{node.name}</span>
      </button>
    );

    if (!isDir || !open) return row;
    const kids = childrenOf(nodes, node.id);
    return (
      <div key={node.id}>
        {row}
        {kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  const rootKids = childrenOf(nodes, rootId);
  if (rootKids.length === 0) {
    return (
      <div className="px-3 py-4 text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
        This project is empty. Right-click above to create a file, or use the
        buttons in the header.
      </div>
    );
  }
  return (
    <div className="nx-scroll min-h-0 flex-1 overflow-auto px-1.5 py-1.5">
      {rootKids.map((k) => renderNode(k, 0))}
    </div>
  );
}
