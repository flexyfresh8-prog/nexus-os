"use client";

// NEXUS OS — settings store (persisted to localStorage, no secrets here)

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Bookmark, DesktopIcon } from "../types";
import { uid } from "../lib/utils";

export interface SettingsState {
  theme: "dark" | "light";
  accent: string; // hex
  wallpaper: string;
  animations: boolean;
  dockMagnify: boolean;
  dockSize: number; // px icon size
  showDesktopIcons: boolean;
  showClockWidget: boolean;
  desktopIcons: DesktopIcon[];
  recentFiles: string[];
  bookmarks: Bookmark[];
  set: (patch: Partial<Omit<SettingsState, "set" | "rehydrateDefaults">>) => void;
  addRecent: (fileId: string) => void;
  addBookmark: (title: string, url: string) => void;
  removeBookmark: (id: string) => void;
  setIconPos: (id: string, gx: number, gy: number) => void;
  addDesktopIcon: (icon: Omit<DesktopIcon, "id">) => string;
  removeDesktopIcon: (id: string) => void;
  reseedIcons: (defaults: DesktopIcon[]) => void;
  resetAll: () => void;
}

const DEFAULT_ICONS: DesktopIcon[] = [
  { id: "d-files", kind: "app", ref: "files", gx: 0, gy: 0 },
  { id: "d-terminal", kind: "app", ref: "terminal", gx: 0, gy: 1 },
  { id: "d-studio", kind: "app", ref: "studio", gx: 0, gy: 2 },
];

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      accent: "#22d3ee",
      wallpaper: "void",
      animations: true,
      dockMagnify: true,
      dockSize: 52,
      showDesktopIcons: true,
      showClockWidget: true,
      desktopIcons: DEFAULT_ICONS,
      recentFiles: [],
      bookmarks: [],

      set: (patch) => set(patch),

      addRecent: (fileId) =>
        set((s) => ({
          recentFiles: [fileId, ...s.recentFiles.filter((f) => f !== fileId)].slice(0, 12),
        })),

      addBookmark: (title, url) =>
        set((s) => {
          if (s.bookmarks.some((b) => b.url === url)) return {};
          return { bookmarks: [...s.bookmarks, { id: uid(), title, url }] };
        }),

      removeBookmark: (id) =>
        set((s) => ({ bookmarks: s.bookmarks.filter((b) => b.id !== id) })),

      setIconPos: (id, gx, gy) =>
        set((s) => ({
          desktopIcons: s.desktopIcons.map((i) => (i.id === id ? { ...i, gx, gy } : i)),
        })),

      addDesktopIcon: (icon) => {
        const id = `di-${uid()}`;
        set((s) => ({ desktopIcons: [...s.desktopIcons, { ...icon, id }] }));
        return id;
      },

      removeDesktopIcon: (id) =>
        set((s) => ({ desktopIcons: s.desktopIcons.filter((i) => i.id !== id) })),

      reseedIcons: (defaults) => set({ desktopIcons: defaults }),

      resetAll: () => {
        set({
          theme: "dark",
          accent: "#22d3ee",
          wallpaper: "void",
          animations: true,
          dockMagnify: true,
          dockSize: 52,
          showDesktopIcons: true,
          showClockWidget: true,
          desktopIcons: DEFAULT_ICONS,
          recentFiles: [],
          bookmarks: [],
        });
      },
    }),
    {
      name: "nexus-settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        theme: s.theme,
        accent: s.accent,
        wallpaper: s.wallpaper,
        animations: s.animations,
        dockMagnify: s.dockMagnify,
        dockSize: s.dockSize,
        showDesktopIcons: s.showDesktopIcons,
        showClockWidget: s.showClockWidget,
        desktopIcons: s.desktopIcons,
        recentFiles: s.recentFiles,
        bookmarks: s.bookmarks,
      }),
    }
  )
);

export function defaultDesktopIcons(): DesktopIcon[] {
  return DEFAULT_ICONS.map((i) => ({ ...i }));
}
