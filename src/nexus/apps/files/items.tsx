"use client";

// NEXUS OS — Files app: shared item views (grid tile / list row) + toolbar button

import type { DragEvent, MouseEvent, ReactNode } from "react";
import type { FSNode } from "../../types";
import { nodeSize } from "../../lib/vfs";
import { formatBytes, formatDate } from "../../lib/utils";
import { useLongPress } from "../../shell/ContextMenu";
import { TypeIcon, kindOf } from "./itemIcon";

export interface ItemHandlers {
  onTap: (node: FSNode, e: MouseEvent) => void;
  onOpen: (node: FSNode, e: MouseEvent) => void;
  onMenu: (node: FSNode, x: number, y: number) => void;
  onDragStart: (node: FSNode, e: DragEvent) => void;
  onDragOver: (node: FSNode, e: DragEvent) => void;
  onDragLeave: (node: FSNode) => void;
  onDrop: (node: FSNode, e: DragEvent) => void;
  onDragEnd: () => void;
}

export function IconBtn({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition disabled:cursor-default disabled:opacity-30 ${
        active
          ? "bg-[rgba(var(--nx-accent-rgb),0.18)] text-[var(--nx-accent)]"
          : "text-[var(--nx-text-dim)] hover:bg-white/10 hover:text-[var(--nx-text)]"
      }`}
    >
      {children}
    </button>
  );
}

export function GridTile({
  node,
  selected,
  dropTarget,
  handlers,
}: {
  node: FSNode;
  selected: boolean;
  dropTarget: boolean;
  handlers: ItemHandlers;
}) {
  const longPress = useLongPress((x, y) => handlers.onMenu(node, x, y));
  const isDir = node.type === "dir";
  return (
    <div
      {...longPress}
      draggable
      title={node.name}
      onClick={(e) => handlers.onTap(node, e)}
      onDoubleClick={(e) => handlers.onOpen(node, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handlers.onMenu(node, e.clientX, e.clientY);
      }}
      onDragStart={(e) => handlers.onDragStart(node, e)}
      onDragEnd={handlers.onDragEnd}
      onDragOver={isDir ? (e) => handlers.onDragOver(node, e) : undefined}
      onDragLeave={isDir ? () => handlers.onDragLeave(node) : undefined}
      onDrop={isDir ? (e) => handlers.onDrop(node, e) : undefined}
      className={`flex w-[92px] cursor-default flex-col items-center gap-1.5 rounded-xl border border-transparent p-2 transition ${
        selected
          ? "border-[rgba(var(--nx-accent-rgb),0.45)] bg-[rgba(var(--nx-accent-rgb),0.14)]"
          : "hover:border-[var(--nx-border)] hover:bg-white/[0.06]"
      } ${dropTarget ? "border-[var(--nx-accent)] bg-[rgba(var(--nx-accent-rgb),0.22)] ring-1 ring-[rgba(var(--nx-accent-rgb),0.6)]" : ""}`}
    >
      <TypeIcon node={node} size={40} />
      <div className="line-clamp-2 w-full text-center text-[11px] leading-tight">{node.name}</div>
    </div>
  );
}

export function ListRow({
  node,
  selected,
  dropTarget,
  handlers,
}: {
  node: FSNode;
  selected: boolean;
  dropTarget: boolean;
  handlers: ItemHandlers;
}) {
  const longPress = useLongPress((x, y) => handlers.onMenu(node, x, y));
  const isDir = node.type === "dir";
  return (
    <div
      {...longPress}
      draggable
      title={node.name}
      onClick={(e) => handlers.onTap(node, e)}
      onDoubleClick={(e) => handlers.onOpen(node, e)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handlers.onMenu(node, e.clientX, e.clientY);
      }}
      onDragStart={(e) => handlers.onDragStart(node, e)}
      onDragEnd={handlers.onDragEnd}
      onDragOver={isDir ? (e) => handlers.onDragOver(node, e) : undefined}
      onDragLeave={isDir ? () => handlers.onDragLeave(node) : undefined}
      onDrop={isDir ? (e) => handlers.onDrop(node, e) : undefined}
      className={`flex h-9 cursor-default items-center gap-2 rounded-lg px-2 text-[12px] transition ${
        selected
          ? "bg-[rgba(var(--nx-accent-rgb),0.16)] text-[var(--nx-text)]"
          : "text-[var(--nx-text)] hover:bg-white/[0.05]"
      } ${dropTarget ? "bg-[rgba(var(--nx-accent-rgb),0.22)] ring-1 ring-[rgba(var(--nx-accent-rgb),0.6)]" : ""}`}
    >
      <TypeIcon node={node} size={16} />
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      <span className="w-16 shrink-0 text-right text-[11px] text-[var(--nx-text-dim)]">
        {node.type === "dir" ? "—" : formatBytes(nodeSize(node))}
      </span>
      <span className="hidden w-32 shrink-0 text-[11px] text-[var(--nx-text-dim)] @min-[560px]:block">
        {formatDate(node.modified)}
      </span>
      <span className="hidden w-24 shrink-0 truncate text-[11px] text-[var(--nx-text-dim)] @min-[640px]:block">
        {kindOf(node)}
      </span>
    </div>
  );
}
