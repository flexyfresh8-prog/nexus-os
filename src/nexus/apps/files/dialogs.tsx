"use client";

// NEXUS OS — Files app: small modal dialogs (naming, confirm, properties)

import { useState } from "react";
import type { ReactNode } from "react";
import { AlertCircle, Download as DownloadIcon } from "lucide-react";
import type { FSNode } from "../../types";
import { displayPath, nodeSize } from "../../lib/vfs";
import { formatBytes, formatDate, formatTime } from "../../lib/utils";
import { TypeIcon, downloadNode, kindOf } from "./itemIcon";

export function ModalShell({
  children,
  onClose,
  className = "",
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div
      className="nx-fade-in absolute inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onPointerDown={onClose}
    >
      <div
        className={`nx-glass-strong nx-pop-in nx-scroll max-h-full w-full overflow-y-auto rounded-2xl border border-[var(--nx-border-strong)] p-4 shadow-2xl ${className}`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/** Input dialog used for create / rename flows. onConfirm performs the
 *  filesystem mutation and returns an error message, or null on success. */
export function NameDialog({
  title,
  initial,
  confirmLabel = "OK",
  onClose,
  onConfirm,
}: {
  title: string;
  initial: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (name: string) => string | null;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const err = onConfirm(name.trim());
    if (err) setError(err);
    else onClose();
  };
  return (
    <ModalShell onClose={onClose} className="max-w-xs">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="text-[13px] font-medium text-[var(--nx-text)]">{title}</div>
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onFocus={(e) => e.target.select()}
          spellCheck={false}
          className="mt-3 w-full rounded-lg border border-[var(--nx-border-strong)] bg-black/20 px-3 py-2 text-[13px] text-[var(--nx-text)] outline-none transition focus:border-[rgba(var(--nx-accent-rgb),0.6)]"
        />
        {error && (
          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-400">
            <AlertCircle size={12} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--nx-border)] px-3 py-1.5 text-[12px] text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg bg-[var(--nx-accent)] px-3 py-1.5 text-[12px] font-medium text-black transition hover:brightness-110"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Delete",
  onClose,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <ModalShell onClose={onClose} className="max-w-xs">
      <div className="text-[13px] font-medium text-[var(--nx-text)]">{title}</div>
      <div className="mt-1.5 text-[12px] text-[var(--nx-text-dim)]">{body}</div>
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-red-400">
          <AlertCircle size={12} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--nx-border)] px-3 py-1.5 text-[12px] text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            const err = onConfirm();
            if (err) setError(err);
            else onClose();
          }}
          className="rounded-lg bg-red-500/90 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-red-500"
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

export function PropertiesDialog({
  node,
  nodes,
  onClose,
}: {
  node: FSNode;
  nodes: Record<string, FSNode>;
  onClose: () => void;
}) {
  const childCount = Object.values(nodes).filter((n) => n.parentId === node.id).length;
  const rows: Array<[string, string]> = [
    ["Kind", kindOf(node)],
    [
      "Size",
      node.type === "dir"
        ? `${childCount} item${childCount === 1 ? "" : "s"}`
        : formatBytes(nodeSize(node)),
    ],
    ["Location", node.parentId ? displayPath(nodes, node.parentId) : "/"],
    ["MIME", node.mime ?? "—"],
    ["Created", `${formatDate(node.created)} ${formatTime(node.created)}`],
    ["Modified", `${formatDate(node.modified)} ${formatTime(node.modified)}`],
  ];
  return (
    <ModalShell onClose={onClose} className="max-w-sm">
      <div className="flex items-center gap-3">
        <TypeIcon node={node} size={36} />
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-[var(--nx-text)]">{node.name}</div>
          <div className="text-[11px] text-[var(--nx-text-dim)]">{kindOf(node)}</div>
        </div>
      </div>
      <div className="mt-3 divide-y divide-[var(--nx-border)] rounded-xl border border-[var(--nx-border)]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start gap-3 px-3 py-2 text-[12px]">
            <span className="w-20 shrink-0 text-[var(--nx-text-dim)]">{label}</span>
            <span className="min-w-0 flex-1 break-words text-[var(--nx-text)]">{value}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {node.type === "file" && (
          <button
            type="button"
            onClick={() => downloadNode(node)}
            className="flex items-center gap-1.5 rounded-lg border border-[rgba(var(--nx-accent-rgb),0.4)] bg-[rgba(var(--nx-accent-rgb),0.12)] px-3 py-1.5 text-[12px] text-[var(--nx-accent)] transition hover:bg-[rgba(var(--nx-accent-rgb),0.2)]"
          >
            <DownloadIcon size={12} />
            Download
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--nx-border)] px-3 py-1.5 text-[12px] text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)]"
        >
          Close
        </button>
      </div>
    </ModalShell>
  );
}
