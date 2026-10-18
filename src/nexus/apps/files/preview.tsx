"use client";

// NEXUS OS — Files app: in-window media preview overlay

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import type { FSNode } from "../../types";
import { AUDIO_EXTS, IMAGE_EXTS, VIDEO_EXTS, extOf, nodeSize } from "../../lib/vfs";
import { formatBytes } from "../../lib/utils";
import { ModalShell } from "./dialogs";

export function isPreviewable(node: FSNode): boolean {
  if (node.type !== "file") return false;
  const ext = extOf(node.name);
  return IMAGE_EXTS.has(ext) || AUDIO_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

type MediaKind = "image" | "audio" | "video" | "other";

export function PreviewModal({ node, onClose }: { node: FSNode; onClose: () => void }) {
  const ext = extOf(node.name);
  const kind: MediaKind = IMAGE_EXTS.has(ext)
    ? "image"
    : AUDIO_EXTS.has(ext)
      ? "audio"
      : VIDEO_EXTS.has(ext)
        ? "video"
        : "other";

  // Created once per mounted preview; blob URLs are revoked on unmount.
  const [url] = useState<string | null>(() => {
    if (node.binary) {
      return URL.createObjectURL(
        new Blob([node.binary], { type: node.mime ?? "application/octet-stream" })
      );
    }
    if (kind === "image" && typeof node.content === "string") {
      return `data:${node.mime ?? "image/svg+xml"};utf8,${encodeURIComponent(node.content)}`;
    }
    return null;
  });

  useEffect(() => {
    return () => {
      if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
    };
  }, [url]);

  let body: ReactNode;
  if (kind === "image" && url) {
    body = (
      <img
        src={url}
        alt={node.name}
        draggable={false}
        className="max-h-full max-w-full object-contain"
      />
    );
  } else if (kind === "audio" && url) {
    body = <audio controls autoPlay src={url} className="w-full max-w-sm" />;
  } else if (kind === "video" && url) {
    body = <video controls src={url} className="max-h-full max-w-full" />;
  } else if (typeof node.content === "string") {
    body = (
      <pre className="nx-scroll max-h-full max-w-full overflow-auto whitespace-pre-wrap p-3 text-left text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
        {node.content}
      </pre>
    );
  } else {
    body = <span className="text-[12px] text-[var(--nx-text-dim)]">No preview available</span>;
  }

  return (
    <ModalShell onClose={onClose} className="max-w-2xl">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-[var(--nx-text)]">{node.name}</div>
          <div className="text-[11px] text-[var(--nx-text-dim)]">
            {formatBytes(nodeSize(node))} · {node.mime ?? "unknown type"}
          </div>
        </div>
        <button
          type="button"
          aria-label="Close preview"
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)]"
        >
          <X size={15} />
        </button>
      </div>
      <div className="mt-3 grid h-[300px] place-items-center overflow-hidden rounded-xl border border-[var(--nx-border)] bg-black/40 p-2">
        {body}
      </div>
    </ModalShell>
  );
}
