"use client";

// NEXUS OS — generic context menu (mouse right-click + touch long-press)

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useOS } from "../store/os";
import type { ContextMenuItem } from "../types";

export function ContextMenuHost() {
  const ctx = useOS((s) => s.ctxMenu);
  const closeCtx = useOS((s) => s.closeCtx);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!ctx) return;
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    // direct DOM adjustment avoids a cascading state update
    el.style.left = `${Math.max(4, Math.min(ctx.x, window.innerWidth - w - 8))}px`;
    el.style.top = `${Math.max(4, Math.min(ctx.y, window.innerHeight - h - 8))}px`;
    el.style.visibility = "visible";
  }, [ctx]);

  useEffect(() => {
    if (!ctx) return;
    const close = () => closeCtx();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCtx();
    };
    window.addEventListener("pointerdown", close, { capture: true });
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close, { capture: true } as never);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [ctx, closeCtx]);

  if (!ctx) return null;

  return (
    <div
      ref={ref}
      className="nx-glass-strong nx-pop-in fixed z-[9500] min-w-48 overflow-hidden rounded-xl py-1 shadow-[0_16px_48px_rgba(0,0,0,0.5)]"
      style={{ left: ctx.x, top: ctx.y, visibility: "hidden" }}
      onPointerDown={(e) => e.stopPropagation()}
      role="menu"
    >
      {ctx.items.map((item: ContextMenuItem, i) =>
        item.separator ? (
          <div key={i} className="mx-2 my-1 h-px bg-[var(--nx-border)]" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            role="menuitem"
            className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[13px] transition disabled:opacity-40 ${
              item.danger
                ? "text-red-400 hover:bg-red-500/15"
                : "text-[var(--nx-text)] hover:bg-[rgba(var(--nx-accent-rgb),0.12)]"
            }`}
            onClick={() => {
              closeCtx();
              item.onClick?.();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="text-[10px] text-[var(--nx-text-dim)]">{item.shortcut}</span>
            )}
          </button>
        )
      )}
    </div>
  );
}

/** Long-press helper for touch devices → opens a context menu. */
export function useLongPress(onLong: (x: number, y: number) => void, ms = 550) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moved = useRef(false);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse") return;
      moved.current = false;
      const { clientX, clientY } = e;
      timer.current = setTimeout(() => {
        if (!moved.current) {
          timer.current = null;
          onLong(clientX, clientY);
        }
      }, ms);
    },
    onPointerMove: () => {
      moved.current = true;
    },
    onPointerUp: () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    },
    onPointerCancel: () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    },
  };
}
