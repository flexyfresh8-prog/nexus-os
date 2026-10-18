"use client";

// NEXUS OS — boot screen + task switcher + window layer

import React from "react";
import { useOS } from "../store/os";
import { WindowFrame } from "./Window";
import { APP_META } from "../apps/meta";
import { AppIcon } from "../apps/AppIcon";
import { OS_VERSION } from "../apps/meta";

export function BootScreen() {
  return (
    <div className="fixed inset-0 z-[10000] grid place-items-center bg-[#050507]">
      <div className="flex flex-col items-center gap-6">
        <div className="nx-boot-pulse relative grid h-20 w-20 place-items-center">
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden>
            <defs>
              <linearGradient id="nxg" x1="0" y1="0" x2="72" y2="72">
                <stop offset="0" stopColor="#22d3ee" />
                <stop offset="1" stopColor="#a78bfa" />
              </linearGradient>
            </defs>
            <path
              d="M36 4 L62 19 V53 L36 68 L10 53 V19 Z"
              stroke="url(#nxg)"
              strokeWidth="2.5"
              fill="rgba(34,211,238,0.06)"
            />
            <path d="M26 48 V24 L46 48 V24" stroke="url(#nxg)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>
        <div className="text-center">
          <div className="text-lg font-semibold tracking-[0.3em] text-[#e8eaf1]">NEXUS OS</div>
          <div className="mt-1 text-[11px] tracking-widest text-[#5b6270]">v{OS_VERSION}</div>
        </div>
        <div className="h-0.5 w-40 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full w-1/2 rounded-full bg-gradient-to-r from-[#22d3ee] to-[#a78bfa]"
            style={{ animation: "nx-shimmer 1.1s linear infinite", width: "100%", backgroundSize: "200px 100%" }}
          />
        </div>
      </div>
    </div>
  );
}

export function WindowLayer() {
  const windows = useOS((s) => s.windows);
  const snapHint = useOS((s) => s.snapHint);

  let hintStyle: React.CSSProperties | null = null;
  if (snapHint) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pad = 6;
    const halfW = Math.floor(vw / 2) - pad;
    const fullH = vh - 108 - pad * 2;
    const halfH = Math.floor((vh - 108) / 2) - pad;
    const map: Record<string, React.CSSProperties> = {
      left: { left: pad, top: pad, width: halfW, height: fullH },
      right: { left: vw - halfW - pad, top: pad, width: halfW, height: fullH },
      top: { left: pad, top: pad, width: vw - pad * 2, height: fullH },
      tl: { left: pad, top: pad, width: halfW, height: halfH },
      tr: { left: vw - halfW - pad, top: pad, width: halfW, height: halfH },
      bl: { left: pad, top: vh - 108 - halfH - pad, width: halfW, height: halfH },
      br: { left: vw - halfW - pad, top: vh - 108 - halfH - pad, width: halfW, height: halfH },
    };
    hintStyle = map[snapHint];
  }

  return (
    <>
      {hintStyle && (
        <div
          className="pointer-events-none fixed z-[7000] rounded-2xl border-2 border-[rgba(var(--nx-accent-rgb),0.6)] bg-[rgba(var(--nx-accent-rgb),0.10)] transition-all duration-100"
          style={hintStyle}
          aria-hidden
        />
      )}
      {windows.map((w) => (
        <WindowFrame key={w.id} win={w} />
      ))}
    </>
  );
}

export function TaskSwitcher() {
  const visible = useOS((s) => s.switcherVisible);
  // select raw state (stable references) and derive — a filter() here would
  // create a new array per snapshot and loop zustand's re-render check
  const windows = useOS((s) => s.windows);
  const focusedId = useOS((s) => s.focusedId);
  const open = visible && windows.filter((w) => !w.closing).length >= 2;
  if (!open) return null;
  const ordered = [...windows].filter((w) => !w.closing).sort((a, b) => b.zIndex - a.zIndex);
  return (
    <div className="nx-fade-in pointer-events-none fixed inset-0 z-[9300] grid place-items-center">
      <div className="nx-glass-strong flex max-w-[92vw] gap-2 overflow-x-auto rounded-2xl p-3 shadow-2xl">
        {ordered.map((w) => (
          <div
            key={w.id}
            className={`flex w-28 shrink-0 flex-col items-center gap-2 rounded-xl p-3 ${
              w.id === focusedId ? "bg-[rgba(var(--nx-accent-rgb),0.15)] ring-1 ring-[rgba(var(--nx-accent-rgb),0.5)]" : ""
            }`}
          >
            <AppIcon appId={w.appId} size={40} />
            <span className="w-full truncate text-center text-[11px] text-[var(--nx-text)]">
              {APP_META[w.appId]?.name ?? w.appId}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
