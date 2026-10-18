"use client";

// NEXUS OS — draggable, resizable, snappable window frame.
// Pointer Events power mouse + touch alike; every handle has a
// generous hit area so iPad users can resize comfortably.

import React, { useCallback, useEffect, useRef, useState, createElement } from "react";
import { Minus, Square, X, Copy } from "lucide-react";
import type { Rect, SnapZone, WindowState } from "../types";
import { useOS } from "../store/os";
import { APP_META } from "../apps/meta";
import { clamp } from "../lib/utils";
import { AppErrorBoundary } from "./ErrorBoundary";
import { AppIcon } from "../apps/AppIcon";

const EDGE = 8; // resize handle hit area
const TOUCH_EDGE = 16;

type Dir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function detectSnapZone(x: number, y: number): SnapZone {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 14; // snap activation margin
  const corner = 64;
  if (y <= m) {
    if (x <= corner) return "tl";
    if (x >= vw - corner) return "tr";
    return "top";
  }
  if (x <= m) return y > vh - corner - 90 ? "bl" : "left";
  if (x >= vw - m) return y > vh - corner - 90 ? "br" : "right";
  return null;
}

export function WindowFrame({ win }: { win: WindowState }) {
  const os = useOS();
  const meta = APP_META[win.appId];
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState<Dir | null>(null);
  const dragState = useRef<{ px: number; py: number; rect: Rect; moved: boolean } | null>(null);
  const resizeState = useRef<{ px: number; py: number; rect: Rect; dir: Dir } | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRect = useRef<Rect | null>(null);
  const edge = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches ? TOUCH_EDGE : EDGE;

  const focused = useOS((s) => s.focusedId === win.id);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (pendingRect.current) {
        os.setRect(win.id, pendingRect.current);
        pendingRect.current = null;
      }
    });
  }, [os, win.id]);

  const onTitlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    os.focusWindow(win.id);
    let rect: Rect = { x: win.x, y: win.y, w: win.w, h: win.h };
    // dragging a maximized window restores it under the cursor
    if (win.maximized && win.prevRect) {
      const rel = (e.clientX - win.x) / win.w;
      const p = win.prevRect;
      rect = { ...p };
      os.setRect(win.id, { ...p, x: Math.round(e.clientX - p.w * rel), y: Math.max(0, e.clientY - 22) });
      os.toggleMaximize(win.id);
      const after = useOS.getState().windows.find((w) => w.id === win.id);
      if (after) rect = { x: after.x, y: after.y, w: after.w, h: after.h };
    }
    dragState.current = { px: e.clientX, py: e.clientY, rect, moved: false };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onTitlePointerMove = (e: React.PointerEvent) => {
    const st = dragState.current;
    if (!st) return;
    const dx = e.clientX - st.px;
    const dy = e.clientY - st.py;
    if (Math.abs(dx) + Math.abs(dy) > 3) st.moved = true;
    pendingRect.current = { ...st.rect, x: st.rect.x + dx, y: st.rect.y + dy };
    scheduleFlush();
    if (st.moved) {
      os.setSnapHint(detectSnapZone(e.clientX, e.clientY));
    }
  };

  const onTitlePointerUp = (e: React.PointerEvent) => {
    const st = dragState.current;
    dragState.current = null;
    setDragging(false);
    const zone = detectSnapZone(e.clientX, e.clientY);
    os.setSnapHint(null);
    if (st && zone && st.moved) {
      os.snap(win.id, zone);
    }
  };

  // resize
  const onHandleDown = (dir: Dir) => (e: React.PointerEvent) => {
    if (e.button !== 0 || win.maximized) return;
    e.stopPropagation();
    os.focusWindow(win.id);
    resizeState.current = { px: e.clientX, py: e.clientY, rect: { x: win.x, y: win.y, w: win.w, h: win.h }, dir };
    setResizing(dir);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onHandleMove = (e: React.PointerEvent) => {
    const st = resizeState.current;
    if (!st) return;
    const minW = meta?.minSize.w ?? 320;
    const minH = meta?.minSize.h ?? 200;
    let { x, y, w, h } = st.rect;
    const dx = e.clientX - st.px;
    const dy = e.clientY - st.py;
    if (st.dir.includes("e")) w = Math.max(minW, st.rect.w + dx);
    if (st.dir.includes("s")) h = Math.max(minH, st.rect.h + dy);
    if (st.dir.includes("w")) {
      w = Math.max(minW, st.rect.w - dx);
      x = st.rect.x + (st.rect.w - w);
    }
    if (st.dir.includes("n")) {
      h = Math.max(minH, st.rect.h - dy);
      y = st.rect.y + (st.rect.h - h);
    }
    pendingRect.current = { x, y, w, h };
    scheduleFlush();
  };

  const onHandleUp = () => {
    resizeState.current = null;
    setResizing(null);
  };

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const busy = dragging || resizing !== null;
  const style: React.CSSProperties = win.maximized
    ? { left: 6, top: 6, width: "calc(100% - 12px)", height: "calc(100% - 114px)", zIndex: win.zIndex }
    : { left: win.x, top: win.y, width: win.w, height: win.h, zIndex: win.zIndex };

  if (win.minimized) return null;

  const handles: { dir: Dir; className: string }[] = [
    { dir: "n", className: "top-0 left-3 right-3 h-[var(--edge)] cursor-ns-resize" },
    { dir: "s", className: "bottom-0 left-3 right-3 h-[var(--edge)] cursor-ns-resize" },
    { dir: "e", className: "right-0 top-3 bottom-3 w-[var(--edge)] cursor-ew-resize" },
    { dir: "w", className: "left-0 top-3 bottom-3 w-[var(--edge)] cursor-ew-resize" },
    { dir: "ne", className: "top-0 right-0 w-5 h-5 cursor-nesw-resize" },
    { dir: "nw", className: "top-0 left-0 w-5 h-5 cursor-nwse-resize" },
    { dir: "se", className: "bottom-0 right-0 w-5 h-5 cursor-nwse-resize" },
    { dir: "sw", className: "bottom-0 left-0 w-5 h-5 cursor-nesw-resize" },
  ];

  return (
    <div
      ref={ref}
      className={`nx-window nx-glass-strong absolute flex flex-col ${
        win.closing ? "opacity-0 scale-[0.97] transition-all duration-150" : "nx-win-open"
      } ${focused ? "nx-window-shadow" : "nx-window-shadow-inactive"} ${busy ? "" : "transition-[width,height,left,top] duration-100"}`}
      style={{ ...style, ["--edge" as string]: `${edge}px` }}
      onPointerDown={() => !focused && os.focusWindow(win.id)}
      role="dialog"
      aria-label={win.title}
    >
      {/* title bar */}
      <div
        className={`nx-drag-none flex h-10 shrink-0 items-center gap-2 px-3 select-none border-b ${
          focused ? "border-[var(--nx-border)]" : "border-transparent opacity-80"
        }`}
        onPointerDown={onTitlePointerDown}
        onPointerMove={onTitlePointerMove}
        onPointerUp={onTitlePointerUp}
        onPointerCancel={onTitlePointerUp}
        onDoubleClick={() => os.toggleMaximize(win.id)}
      >
        <AppIcon appId={win.appId} size={18} className="pointer-events-none" />
        <div className={`truncate text-[13px] font-medium ${focused ? "text-[var(--nx-text)]" : "text-[var(--nx-text-dim)]"}`}>
          {win.title}
        </div>
        <div className="ml-auto flex items-center gap-1" data-no-drag>
          <button
            aria-label="Minimize window"
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--nx-text-dim)] hover:bg-white/10 hover:text-[var(--nx-text)] active:scale-90 transition"
            onClick={() => os.minimize(win.id)}
          >
            <Minus size={14} />
          </button>
          <button
            aria-label="Maximize window"
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--nx-text-dim)] hover:bg-white/10 hover:text-[var(--nx-text)] active:scale-90 transition"
            onClick={() => os.toggleMaximize(win.id)}
          >
            {win.maximized ? <Copy size={12} /> : <Square size={11} />}
          </button>
          <button
            aria-label="Close window"
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--nx-text-dim)] hover:bg-red-500/80 hover:text-white active:scale-90 transition"
            onClick={() => os.closeWindow(win.id)}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {/* app surface */}
      <div className="relative min-h-0 flex-1">
        <AppErrorBoundary appName={meta?.name ?? win.appId} onClose={() => os.closeWindow(win.id)}>
          <AppSurface appId={win.appId} win={win} />
        </AppErrorBoundary>
      </div>

      {/* resize handles */}
      {!win.maximized &&
        handles.map((h) => (
          <div
            key={h.dir}
            className={`nx-drag-none absolute z-50 ${h.className}`}
            onPointerDown={onHandleDown(h.dir)}
            onPointerMove={onHandleMove}
            onPointerUp={onHandleUp}
            onPointerCancel={onHandleUp}
          />
        ))}
    </div>
  );
}

/**
 * Loads the app component lazily. Registry keeps dynamic imports;
 * we re-request on each mount so React.lazy-style caching applies.
 */
import { getApp } from "../apps/registry";

function AppSurface({ appId, win }: { appId: string; win: WindowState }) {
  const os = useOS();
  const Comp = getApp(appId);
  if (!Comp) {
    return (
      <div className="grid h-full place-items-center text-sm text-[var(--nx-text-dim)]">
        Application not installed
      </div>
    );
  }
  return createElement(Comp, {
    windowId: win.id,
    launchProps: win.props,
    setTitle: (t: string) => os.setTitle(win.id, t),
    close: () => os.closeWindow(win.id),
  });
}
