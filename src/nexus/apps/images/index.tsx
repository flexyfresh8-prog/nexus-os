"use client";

// NEXUS OS — Image Viewer. Browses real images from the virtual filesystem
// with zoom, rotation, pan and keyboard navigation.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import type { AppInstanceProps, FSNode } from "../../types";
import { useFS } from "../../store/fs";
import { IMAGE_EXTS, displayPath, extOf, nodeSize } from "../../lib/vfs";
import { formatBytes } from "../../lib/utils";

interface ImageItem {
  id: string;
  name: string;
  url: string;
  path: string;
  size: number;
}

function scanImages(nodes: Record<string, FSNode>): ImageItem[] {
  const out: ImageItem[] = [];
  for (const node of Object.values(nodes)) {
    if (node.type !== "file" || !IMAGE_EXTS.has(extOf(node.name))) continue;
    if (node.binary) {
      out.push({
        id: node.id,
        name: node.name,
        url: URL.createObjectURL(new Blob([node.binary], { type: node.mime ?? "image/png" })),
        path: displayPath(nodes, node.id),
        size: nodeSize(node),
      });
    } else if (extOf(node.name) === "svg" && typeof node.content === "string") {
      out.push({
        id: node.id,
        name: node.name,
        url: URL.createObjectURL(new Blob([node.content], { type: "image/svg+xml" })),
        path: displayPath(nodes, node.id),
        size: nodeSize(node),
      });
    }
  }
  return out;
}

export default function ImageViewerApp(_props: AppInstanceProps) {
  const nodes = useFS((s) => s.nodes);
  const [images, setImages] = useState<ImageItem[]>([]);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const next = scanImages(nodes);
    setImages((prev) => {
      for (const p of prev) if (!next.find((n) => n.id === p.id)) URL.revokeObjectURL(p.url);
      return next;
    });
  }, [nodes]);

  useEffect(() => {
    return () => {
      for (const it of images) URL.revokeObjectURL(it.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = images[index];

  const go = useCallback(
    (dir: 1 | -1) => {
      if (images.length === 0) return;
      setIndex((i) => (i + dir + images.length) % images.length);
      setZoom(1);
      setRotation(0);
      setOffset({ x: 0, y: 0 });
    },
    [images.length]
  );

  // keyboard navigation when the window is focused
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(6, z * 1.2));
      if (e.key === "-") setZoom((z) => Math.max(0.2, z / 1.2));
      if (e.key === "r") setRotation((r) => (r + 90) % 360);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const thumbs = useMemo(() => images, [images]);

  return (
    <div className="flex h-full flex-col">
      {/* toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 py-1.5">
        <button onClick={() => go(-1)} disabled={images.length < 2} aria-label="Previous image" className="rounded-md p-1.5 text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)] disabled:opacity-30">
          <ChevronLeft size={15} />
        </button>
        <button onClick={() => go(1)} disabled={images.length < 2} aria-label="Next image" className="rounded-md p-1.5 text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)] disabled:opacity-30">
          <ChevronRight size={15} />
        </button>
        <span className="ml-1 min-w-0 flex-1 truncate text-[12px] text-[var(--nx-text)]">
          {current ? current.name : "No image"}
          {current ? <span className="ml-2 text-[10px] text-[var(--nx-text-dim)]">{index + 1}/{images.length} · {formatBytes(current.size)}</span> : null}
        </span>
        <button onClick={() => setZoom((z) => Math.max(0.2, z / 1.25))} aria-label="Zoom out" className="rounded-md p-1.5 text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]">
          <ZoomOut size={14} />
        </button>
        <span className="w-10 text-center font-mono text-[10px] text-[var(--nx-text-dim)]">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(6, z * 1.25))} aria-label="Zoom in" className="rounded-md p-1.5 text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]">
          <ZoomIn size={14} />
        </button>
        <button onClick={() => setRotation((r) => (r + 90) % 360)} aria-label="Rotate" className="rounded-md p-1.5 text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]">
          <RotateCw size={14} />
        </button>
      </div>

      {/* stage */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[repeating-conic-gradient(#0a0b0e_0%_25%,#0e1015_0%_50%)] bg-[length:20px_20px]"
        onPointerDown={(e) => {
          dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragRef.current) return;
          setOffset({
            x: dragRef.current.ox + (e.clientX - dragRef.current.x),
            y: dragRef.current.oy + (e.clientY - dragRef.current.y),
          });
        }}
        onPointerUp={() => (dragRef.current = null)}
        onWheel={(e) => {
          if (!current) return;
          e.preventDefault();
          setZoom((z) => Math.min(6, Math.max(0.2, z * (e.deltaY < 0 ? 1.1 : 0.9))));
        }}
        style={{ cursor: current ? (dragRef.current ? "grabbing" : "grab") : "default" }}
      >
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={current.url}
            alt={current.name}
            draggable={false}
            className="max-h-full max-w-full select-none transition-transform duration-100"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)` }}
          />
        ) : (
          <div className="max-w-[300px] text-center">
            <div className="mb-3 text-3xl">🖼️</div>
            <p className="text-[13px] text-[var(--nx-text)]">No images in the filesystem</p>
            <p className="mt-1 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
              Import pictures via the Files app (~/Pictures). PNG, JPG, GIF, WebP and SVG are
              supported — scroll to zoom, drag to pan, R to rotate.
            </p>
          </div>
        )}
      </div>

      {/* filmstrip */}
      {thumbs.length > 1 ? (
        <div className="nx-scroll flex shrink-0 gap-2 overflow-x-auto border-t border-white/5 bg-black/20 p-2">
          {thumbs.map((it, i) => (
            <button
              key={it.id}
              onClick={() => {
                setIndex(i);
                setZoom(1);
                setRotation(0);
                setOffset({ x: 0, y: 0 });
              }}
              className={`h-12 w-16 shrink-0 overflow-hidden rounded-md border transition ${
                i === index ? "border-[var(--nx-accent)]" : "border-white/10 opacity-60 hover:opacity-100"
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt="" className="h-full w-full object-cover" draggable={false} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
