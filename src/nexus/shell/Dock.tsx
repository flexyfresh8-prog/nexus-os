"use client";

// NEXUS OS — dock: launchers, running indicators, tray (clock/notifications/settings)

import React, { useEffect, useRef, useState } from "react";
import { Bell, Search, Settings as SettingsIcon, Lock } from "lucide-react";
import { useOS } from "../store/os";
import { useSettings } from "../store/settings";
import { useLock } from "../store/lock";
import { DOCK_ORDER, APP_META } from "../apps/meta";
import { AppIcon } from "../apps/AppIcon";

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function Dock() {
  const windows = useOS((s) => s.windows);
  const focusedId = useOS((s) => s.focusedId);
  const toggleMinimizeApp = useOS((s) => s.toggleMinimizeApp);
  const launch = useOS((s) => s.launch);
  const quitApp = useOS((s) => s.quitApp);
  const setSpotlight = useOS((s) => s.setSpotlight);
  const notifPanel = useOS((s) => s.notifPanel);
  const setNotifPanel = useOS((s) => s.setNotifPanel);
  const notifications = useOS((s) => s.notifications);
  const openCtx = useOS((s) => s.openCtx);
  const settings = useSettings();
  const now = useClock();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runningApps = new Set(windows.filter((w) => !w.closing).map((w) => w.appId));
  const focusedApp = windows.find((w) => w.id === focusedId && !w.minimized)?.appId;
  const unread = notifications.filter((n) => !n.read).length;

  // magnification based on index distance from the hovered icon (no ref reads)
  const scaleFor = (idx: number): number => {
    if (!settings.dockMagnify || hoverIdx === null) return 1;
    const d = Math.abs(idx - hoverIdx);
    if (d > 2) return 1;
    if (d === 0) return 1.32;
    return d === 1 ? 1.16 : 1.05;
  };

  const appContext = (appId: string, clientX: number, clientY: number) => {
    openCtx(clientX, clientY, [
      { label: APP_META[appId].name, disabled: true },
      { separator: true },
      { label: "New window", onClick: () => launch(appId) },
      ...(runningApps.has(appId)
        ? [{ label: "Quit app", danger: true, onClick: () => quitApp(appId) }]
        : []),
    ]);
  };

  const onPointerDown = (e: React.PointerEvent, appId: string) => {
    if (e.pointerType === "mouse") return;
    pressTimer.current = setTimeout(() => {
      appContext(appId, e.clientX, e.clientY);
      pressTimer.current = null;
    }, 550);
  };
  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[8000] flex justify-center pb-2.5">
      <div
        className="nx-glass-strong nx-pop-in pointer-events-auto flex max-w-[calc(100vw-16px)] items-end gap-1 overflow-x-auto rounded-2xl px-2.5 py-2 shadow-[0_18px_50px_rgba(0,0,0,0.5)]"
        onPointerLeave={() => {
          setHoverIdx(null);
        }}
        role="navigation"
        aria-label="Dock"
      >
        {DOCK_ORDER.map((appId, idx) => {
          const running = runningApps.has(appId);
          const active = focusedApp === appId;
          const scale = scaleFor(idx);
          return (
            <button
              key={appId}
              aria-label={APP_META[appId].name}
              className="nx-longpress group relative flex shrink-0 flex-col items-center outline-none"
              onClick={() => {
                clearPress();
                toggleMinimizeApp(appId);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                appContext(appId, e.clientX, e.clientY);
              }}
              onPointerDown={(e) => onPointerDown(e, appId)}
              onPointerUp={clearPress}
              onPointerCancel={clearPress}
              onMouseEnter={() => setHoverIdx(idx)}
            >
              <span
                className="transition-transform duration-150 ease-out"
                style={{ transform: `scale(${scale})`, transformOrigin: "bottom center" }}
              >
                <AppIcon appId={appId} size={settings.dockSize} />
              </span>
              {running && (
                <span
                  className={`absolute -bottom-1 h-1 w-1 rounded-full ${
                    active ? "bg-[var(--nx-accent)] nx-accent-glow" : "bg-white/50"
                  }`}
                />
              )}
              {hoverIdx === idx && (
                <span className="nx-fade-in pointer-events-none absolute -top-9 whitespace-nowrap rounded-md border border-[var(--nx-border)] bg-[var(--nx-glass-strong)] px-2 py-1 text-[11px] text-[var(--nx-text)] shadow-lg">
                  {APP_META[appId].name}
                </span>
              )}
            </button>
          );
        })}

        <span className="mx-1.5 h-9 w-px shrink-0 self-center bg-[var(--nx-border)]" />

        <button
          aria-label="Search (Ctrl+K)"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)]"
          onClick={() => setSpotlight(true)}
        >
          <Search size={19} />
        </button>
        <button
          aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
          className="relative grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)]"
          onClick={() => setNotifPanel(!notifPanel)}
        >
          <Bell size={19} />
          {unread > 0 && (
            <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[var(--nx-accent)] nx-accent-glow" />
          )}
        </button>
        <button
          aria-label="Open clock and date"
          className="flex h-11 shrink-0 flex-col items-end justify-center rounded-xl px-2.5 text-right transition hover:bg-white/10"
          onClick={() => setNotifPanel(!notifPanel)}
        >
          <span className="text-[12px] font-semibold leading-none text-[var(--nx-text)]">
            {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="mt-0.5 text-[10px] leading-none text-[var(--nx-text-dim)]">
            {now.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        </button>
        <button
          aria-label="Settings"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)]"
          onClick={() => launch("settings")}
        >
          <SettingsIcon size={18} />
        </button>
        <button
          aria-label="Lock screen (Ctrl+Alt+L)"
          title="Lock (Ctrl+Alt+L)"
          className="hidden h-11 w-11 shrink-0 place-items-center rounded-xl text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)] sm:grid"
          onClick={() => useLock.getState().lock("manual")}
        >
          <Lock size={17} />
        </button>
      </div>
    </div>
  );
}
