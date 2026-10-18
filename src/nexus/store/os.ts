"use client";

// NEXUS OS — window manager + shell state

import { create } from "zustand";
import type {
  ContextMenuItem,
  NotificationItem,
  Rect,
  SnapZone,
  WindowState,
} from "../types";
import { APP_META } from "../apps/meta";
import { uid, clamp } from "../lib/utils";
import { kvGet, kvSet } from "../lib/idb";

const VIEWPAD = 8;

function viewport(): { w: number; h: number } {
  if (typeof window === "undefined") return { w: 1440, h: 900 };
  return { w: window.innerWidth, h: window.innerHeight };
}

function isMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < 768;
}

function dockHitboxH(): number {
  return 108;
}

function defaultRect(appId: string, openCount: number): Rect {
  const meta = APP_META[appId];
  const vp = viewport();
  const w = Math.min(meta?.defaultSize.w ?? 800, vp.w - 40);
  const h = Math.min(meta?.defaultSize.h ?? 560, vp.h - dockHitboxH() - 40);
  const cascade = (openCount % 6) * 26;
  const x = clamp(Math.round((vp.w - w) / 2) + cascade - 60, VIEWPAD, Math.max(VIEWPAD, vp.w - w - VIEWPAD));
  const y = clamp(Math.round((vp.h - dockHitboxH() - h) / 2) + cascade - 50, VIEWPAD, Math.max(VIEWPAD, vp.h - dockHitboxH() - h));
  return { x, y, w, h };
}

function clampRect(r: Rect): Rect {
  const vp = viewport();
  const x = clamp(r.x, -r.w + 120, vp.w - 120);
  const y = clamp(r.y, 0, vp.h - 44);
  const w = clamp(r.w, 260, vp.w);
  const h = clamp(r.h, 180, vp.h);
  return { x, y, w, h };
}

export function snapRect(zone: Exclude<SnapZone, null>, vpPad = 6): Rect {
  const vp = viewport();
  const halfW = Math.floor(vp.w / 2) - vpPad;
  const halfH = Math.floor((vp.h - dockHitboxH()) / 2) - vpPad;
  const fullH = vp.h - dockHitboxH() - vpPad * 2;
  switch (zone) {
    case "left":
      return { x: vpPad, y: vpPad, w: halfW, h: fullH };
    case "right":
      return { x: vp.w - halfW - vpPad, y: vpPad, w: halfW, h: fullH };
    case "top":
      return { x: vpPad, y: vpPad, w: vp.w - vpPad * 2, h: fullH };
    case "tl":
      return { x: vpPad, y: vpPad, w: halfW, h: halfH };
    case "tr":
      return { x: vp.w - halfW - vpPad, y: vpPad, w: halfW, h: halfH };
    case "bl":
      return { x: vpPad, y: vp.h - dockHitboxH() - halfH - vpPad, w: halfW, h: halfH };
    case "br":
      return { x: vp.w - halfW - vpPad, y: vp.h - dockHitboxH() - halfH - vpPad, w: halfW, h: halfH };
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persistWindows(windows: WindowState[]) {
  if (typeof window === "undefined") return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const slim = windows
      .filter((w) => !w.closing)
      .map((w) => ({
        appId: w.appId,
        title: w.title,
        x: w.x, y: w.y, w: w.w, h: w.h,
        minimized: w.minimized,
        maximized: w.maximized,
        prevRect: w.prevRect,
        props: w.props,
      }));
    try {
      localStorage.setItem("nexus-windows", JSON.stringify(slim));
    } catch { /* quota — non-fatal */ }
  }, 350);
}

export interface OSState {
  phase: "boot" | "ready";
  windows: WindowState[];
  focusedId: string | null;
  topZ: number;
  spotlight: boolean;
  notifPanel: boolean;
  switcherVisible: boolean;
  snapHint: SnapZone;
  notifications: NotificationItem[];
  toasts: NotificationItem[];
  ctxMenu: { x: number; y: number; items: ContextMenuItem[] } | null;
  wallpaperFx: number;

  setPhase: (p: "boot" | "ready") => void;
  launch: (appId: string, props?: Record<string, unknown>) => void;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  minimize: (id: string) => void;
  toggleMinimizeApp: (appId: string) => void;
  toggleMaximize: (id: string) => void;
  setRect: (id: string, r: Partial<Rect>) => void;
  setTitle: (id: string, title: string) => void;
  snap: (id: string, zone: Exclude<SnapZone, null>) => void;
  setSnapHint: (z: SnapZone) => void;
  restoreSession: () => void;
  cycleFocus: (dir: 1 | -1) => void;
  quitApp: (appId: string) => void;

  setSpotlight: (v: boolean) => void;
  setNotifPanel: (v: boolean) => void;
  setSwitcherVisible: (v: boolean) => void;

  notify: (n: { title: string; body: string; appId?: string }) => void;
  dismissToast: (id: string) => void;
  dismissNotification: (id: string) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
  hydrateNotifications: () => Promise<void>;

  openCtx: (x: number, y: number, items: ContextMenuItem[]) => void;
  closeCtx: () => void;
}

export const useOS = create<OSState>((set, get) => ({
  phase: "boot",
  windows: [],
  focusedId: null,
  topZ: 10,
  spotlight: false,
  notifPanel: false,
  switcherVisible: false,
  snapHint: null,
  notifications: [],
  toasts: [],
  ctxMenu: null,
  wallpaperFx: 0,

  setPhase: (p) => set({ phase: p }),

  launch: (appId, props) => {
    const meta = APP_META[appId];
    if (!meta) return;
    const state = get();
    if (meta.singleton) {
      const existing = state.windows.find((w) => w.appId === appId && !w.closing);
      if (existing) {
        set((s) => ({
          windows: s.windows.map((w) =>
            w.id === existing.id
              ? {
                  ...w,
                  minimized: false,
                  zIndex: s.topZ + 1,
                  props: props ?? w.props,
                }
              : w
          ),
          focusedId: existing.id,
          topZ: s.topZ + 1,
        }));
        persistWindows(get().windows);
        return;
      }
    }
    const rect = defaultRect(appId, state.windows.length);
    const mobile = isMobile();
    const vp = viewport();
    const win: WindowState = {
      id: uid(),
      appId,
      title: meta.name,
      x: rect.x,
      y: rect.y,
      w: mobile ? vp.w : rect.w,
      h: mobile ? vp.h - dockHitboxH() : rect.h,
      minimized: false,
      maximized: mobile,
      zIndex: state.topZ + 1,
      props,
      launchedAt: Date.now(),
    };
    set((s) => ({
      windows: [...s.windows, win],
      focusedId: win.id,
      topZ: s.topZ + 1,
      spotlight: false,
      notifPanel: false,
    }));
    persistWindows(get().windows);
  },

  closeWindow: (id) => {
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, closing: true } : w)),
      focusedId: s.focusedId === id ? null : s.focusedId,
    }));
    setTimeout(() => {
      set((s) => {
        const windows = s.windows.filter((w) => w.id !== id);
        const visible = windows.filter((w) => !w.minimized && !w.closing);
        const nextFocus =
          s.focusedId === id || !windows.find((w) => w.id === s.focusedId)
            ? (visible.sort((a, b) => b.zIndex - a.zIndex)[0]?.id ?? null)
            : s.focusedId;
        return { windows, focusedId: nextFocus };
      });
      persistWindows(get().windows);
    }, 160);
  },

  focusWindow: (id) => {
    set((s) => {
      const w = s.windows.find((x) => x.id === id);
      if (!w) return {};
      return {
        windows: s.windows.map((x) =>
          x.id === id ? { ...x, zIndex: s.topZ + 1, minimized: false } : x
        ),
        focusedId: id,
        topZ: s.topZ + 1,
      };
    });
  },

  minimize: (id) => {
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, minimized: true } : w)),
      focusedId: s.focusedId === id ? null : s.focusedId,
    }));
    persistWindows(get().windows);
  },

  toggleMinimizeApp: (appId) => {
    const s = get();
    const wins = s.windows.filter((w) => w.appId === appId && !w.closing);
    if (wins.length === 0) {
      s.launch(appId);
      return;
    }
    const top = wins.sort((a, b) => b.zIndex - a.zIndex)[0];
    const isFocused = s.focusedId === top.id && !top.minimized;
    if (isFocused) {
      s.minimize(top.id);
    } else {
      s.focusWindow(top.id);
    }
  },

  toggleMaximize: (id) => {
    set((s) => ({
      windows: s.windows.map((w) => {
        if (w.id !== id) return w;
        if (w.maximized) {
          const p = w.prevRect ?? defaultRect(w.appId, 0);
          return { ...w, maximized: false, ...p, prevRect: undefined };
        }
        return { ...w, maximized: true, prevRect: { x: w.x, y: w.y, w: w.w, h: w.h } };
      }),
    }));
    persistWindows(get().windows);
  },

  setRect: (id, r) => {
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id ? { ...w, ...clampRect({ ...w, ...r }) } : w
      ),
    }));
    persistWindows(get().windows);
  },

  setTitle: (id, title) => {
    // no-op when unchanged: prevents render loops from apps that sync
    // their title inside effects keyed on the setTitle callback
    const current = get().windows.find((w) => w.id === id);
    if (!current || current.title === title) return;
    set((s) => ({
      windows: s.windows.map((w) => (w.id === id ? { ...w, title } : w)),
    }));
    persistWindows(get().windows);
  },

  snap: (id, zone) => {
    const r = snapRect(zone);
    set((s) => ({
      windows: s.windows.map((w) =>
        w.id === id
          ? {
              ...w,
              ...r,
              maximized: zone === "top",
              prevRect: zone === "top" ? { x: w.x, y: w.y, w: w.w, h: w.h } : w.prevRect,
            }
          : w
      ),
    }));
    persistWindows(get().windows);
  },

  setSnapHint: (z) => set({ snapHint: z }),

  restoreSession: () => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("nexus-windows");
      if (!raw) return;
      const slim = JSON.parse(raw) as Array<Partial<WindowState> & { appId: string }>;
      const vp = viewport();
      let z = 10;
      const restored: WindowState[] = [];
      for (const w of slim) {
        if (!APP_META[w.appId]) continue;
        z += 1;
        const rect = clampRect({
          x: Math.min(w.x ?? 80, vp.w - 100),
          y: Math.min(w.y ?? 60, vp.h - 100),
          w: w.w ?? APP_META[w.appId].defaultSize.w,
          h: w.h ?? APP_META[w.appId].defaultSize.h,
        });
        restored.push({
          id: uid(),
          appId: w.appId,
          title: w.title ?? APP_META[w.appId].name,
          ...rect,
          minimized: w.minimized ?? false,
          maximized: w.maximized ?? false,
          prevRect: w.prevRect,
          zIndex: z,
          props: w.props,
          launchedAt: Date.now(),
        });
      }
      const top = restored.filter((w) => !w.minimized).sort((a, b) => b.zIndex - a.zIndex)[0];
      set({ windows: restored, topZ: z, focusedId: top?.id ?? null });
    } catch {
      // corrupted session — start clean
      try { localStorage.removeItem("nexus-windows"); } catch { /* noop */ }
    }
  },

  cycleFocus: (dir) => {
    const s = get();
    const wins = s.windows.filter((w) => !w.closing);
    if (wins.length < 2) return;
    const sorted = [...wins].sort((a, b) => b.zIndex - a.zIndex);
    const idx = sorted.findIndex((w) => w.id === s.focusedId);
    const next = sorted[(idx + dir + sorted.length) % sorted.length];
    s.focusWindow(next.id);
    set({ switcherVisible: true });
    setTimeout(() => {
      if (get().switcherVisible) set({ switcherVisible: false });
    }, 1200);
  },

  quitApp: (appId) => {
    const s = get();
    for (const w of s.windows.filter((w) => w.appId === appId)) {
      s.closeWindow(w.id);
    }
  },

  setSpotlight: (v) => set({ spotlight: v, notifPanel: v ? false : get().notifPanel }),
  setNotifPanel: (v) => set({ notifPanel: v, spotlight: v ? false : get().spotlight }),
  setSwitcherVisible: (v) => set({ switcherVisible: v }),

  notify: (n) => {
    const item: NotificationItem = {
      id: uid(),
      ts: Date.now(),
      read: false,
      ...n,
    };
    set((s) => ({
      notifications: [item, ...s.notifications].slice(0, 50),
      toasts: [...s.toasts, item].slice(-4),
    }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== item.id) }));
    }, 4600);
    try {
      localStorage.setItem("nexus-notifs", JSON.stringify(get().notifications.slice(0, 50)));
    } catch { /* noop */ }
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  dismissNotification: (id) =>
    set((s) => {
      const notifications = s.notifications.filter((n) => n.id !== id);
      try { localStorage.setItem("nexus-notifs", JSON.stringify(notifications)); } catch { /* noop */ }
      return { notifications };
    }),

  markAllRead: () =>
    set((s) => {
      const notifications = s.notifications.map((n) => ({ ...n, read: true }));
      try { localStorage.setItem("nexus-notifs", JSON.stringify(notifications)); } catch { /* noop */ }
      return { notifications };
    }),

  clearNotifications: () => {
    set({ notifications: [] });
    try { localStorage.setItem("nexus-notifs", "[]"); } catch { /* noop */ }
  },

  hydrateNotifications: async () => {
    try {
      const raw = localStorage.getItem("nexus-notifs");
      if (raw) set({ notifications: JSON.parse(raw) });
      const quota = await kvGet<string>("storage:warned");
      if (!quota) {
        await kvSet("storage:warned", "1");
      }
    } catch { /* noop */ }
  },

  openCtx: (x, y, items) => set({ ctxMenu: { x, y, items } }),
  closeCtx: () => set({ ctxMenu: null }),
}));

export function useFocusedWindow(): WindowState | undefined {
  return useOS((s) => s.windows.find((w) => w.id === s.focusedId));
}
