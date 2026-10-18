// NEXUS OS — app metadata (React-free so stores can import it safely)

import type { AppMeta } from "../types";

export const APP_META: Record<string, AppMeta> = {
  files: {
    id: "files",
    name: "Files",
    tagline: "Virtual file explorer",
    keywords: ["explorer", "folder", "storage", "file manager"],
    gradient: "from-amber-300 to-orange-500",
    defaultSize: { w: 940, h: 600 },
    minSize: { w: 520, h: 380 },
    inDock: true,
    desktopShortcut: true,
  },
  terminal: {
    id: "terminal",
    name: "Terminal",
    tagline: "NEXUS shell",
    keywords: ["console", "shell", "command", "cli"],
    gradient: "from-slate-600 to-slate-900",
    defaultSize: { w: 760, h: 480 },
    minSize: { w: 420, h: 280 },
    inDock: true,
    desktopShortcut: true,
  },
  studio: {
    id: "studio",
    name: "Nexus Studio",
    tagline: "Code workspace",
    keywords: ["code", "editor", "monaco", "ide", "dev", "html", "css", "js"],
    gradient: "from-violet-400 to-fuchsia-600",
    defaultSize: { w: 1120, h: 700 },
    minSize: { w: 640, h: 420 },
    inDock: true,
    desktopShortcut: true,
  },
  ai: {
    id: "ai",
    name: "Nexus AI",
    tagline: "Agent workspace",
    keywords: ["assistant", "agent", "chat", "llm", "ai"],
    gradient: "from-cyan-400 to-teal-600",
    defaultSize: { w: 860, h: 620 },
    minSize: { w: 480, h: 400 },
    inDock: true,
    desktopShortcut: true,
  },
  browser: {
    id: "browser",
    name: "Browser",
    tagline: "Internal web viewer",
    keywords: ["web", "internet", "surf", "browse"],
    gradient: "from-sky-400 to-blue-600",
    defaultSize: { w: 1020, h: 680 },
    minSize: { w: 520, h: 400 },
    inDock: true,
  },
  settings: {
    id: "settings",
    name: "Settings",
    tagline: "System preferences",
    keywords: ["preferences", "theme", "wallpaper", "storage", "backup", "config"],
    gradient: "from-zinc-400 to-zinc-600",
    defaultSize: { w: 880, h: 600 },
    minSize: { w: 560, h: 420 },
    singleton: true,
    inDock: true,
  },
};

export const DOCK_ORDER = ["files", "terminal", "studio", "ai", "browser", "settings"];

export const OS_VERSION = "1.0.0";
