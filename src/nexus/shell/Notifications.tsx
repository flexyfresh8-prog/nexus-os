"use client";

// NEXUS OS — toast stack + notification center panel

import React from "react";
import { Bell, X, CheckCheck, Trash2 } from "lucide-react";
import { useOS } from "../store/os";
import { formatTime } from "../lib/utils";
import { APP_META } from "../apps/meta";

export function Toasts() {
  const toasts = useOS((s) => s.toasts);
  const dismiss = useOS((s) => s.dismissToast);
  return (
    <div className="fixed right-4 top-4 z-[9200] flex w-[320px] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="nx-glass-strong nx-slide-right pointer-events-auto rounded-xl p-3 shadow-[0_16px_44px_rgba(0,0,0,0.5)]"
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-[rgba(var(--nx-accent-rgb),0.15)]">
              <Bell size={13} className="text-[var(--nx-accent)]" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12.5px] font-semibold text-[var(--nx-text)]">{t.title}</div>
              <div className="mt-0.5 text-[12px] leading-snug text-[var(--nx-text-dim)]">{t.body}</div>
            </div>
            <button
              aria-label="Dismiss"
              className="shrink-0 rounded-md p-1 text-[var(--nx-text-dim)] hover:bg-white/10"
              onClick={() => dismiss(t.id)}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function NotificationCenter() {
  const open = useOS((s) => s.notifPanel);
  const setOpen = useOS((s) => s.setNotifPanel);
  const notifications = useOS((s) => s.notifications);
  const dismissNotification = useOS((s) => s.dismissNotification);
  const markAllRead = useOS((s) => s.markAllRead);
  const clearNotifications = useOS((s) => s.clearNotifications);
  const launch = useOS((s) => s.launch);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9100]" onClick={() => setOpen(false)}>
      <aside
        className="nx-glass-strong nx-slide-right absolute right-3 top-3 flex max-h-[80vh] w-[360px] max-w-[94vw] flex-col rounded-2xl shadow-[0_24px_70px_rgba(0,0,0,0.6)]"
        onClick={(e) => e.stopPropagation()}
        aria-label="Notification center"
      >
        <header className="flex items-center justify-between border-b border-[var(--nx-border)] px-4 py-3">
          <span className="text-[13px] font-semibold text-[var(--nx-text)]">Notifications</span>
          <div className="flex gap-1">
            <button
              aria-label="Mark all read"
              className="rounded-lg p-1.5 text-[var(--nx-text-dim)] hover:bg-white/10"
              onClick={markAllRead}
            >
              <CheckCheck size={15} />
            </button>
            <button
              aria-label="Clear all"
              className="rounded-lg p-1.5 text-[var(--nx-text-dim)] hover:bg-white/10"
              onClick={clearNotifications}
            >
              <Trash2 size={15} />
            </button>
          </div>
        </header>
        <div className="nx-scroll flex-1 overflow-y-auto p-2">
          {notifications.length === 0 && (
            <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <Bell size={26} className="text-[var(--nx-text-dim)] opacity-50" />
              <div className="text-[13px] font-medium text-[var(--nx-text)]">All caught up</div>
              <p className="text-[11.5px] leading-relaxed text-[var(--nx-text-dim)]">
                System and application notifications will appear here.
              </p>
            </div>
          )}
          {notifications.map((n) => (
            <button
              key={n.id}
              className="group mb-1 flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/[0.05]"
              onClick={() => {
                if (n.appId) launch(n.appId);
                setOpen(false);
              }}
            >
              <span
                className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                  n.read ? "bg-white/20" : "bg-[var(--nx-accent)] nx-accent-glow"
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12.5px] font-semibold text-[var(--nx-text)]">{n.title}</span>
                  <span className="shrink-0 text-[10px] text-[var(--nx-text-dim)]">{formatTime(n.ts)}</span>
                </span>
                <span className="mt-0.5 block text-[12px] leading-snug text-[var(--nx-text-dim)]">{n.body}</span>
                {n.appId && APP_META[n.appId] && (
                  <span className="mt-1 inline-block rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-[var(--nx-text-dim)]">
                    {APP_META[n.appId].name}
                  </span>
                )}
              </span>
              <span
                role="button"
                aria-label="Delete notification"
                className="shrink-0 rounded-md p-1 text-[var(--nx-text-dim)] opacity-0 transition hover:bg-white/10 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  dismissNotification(n.id);
                }}
              >
                <X size={13} />
              </span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
