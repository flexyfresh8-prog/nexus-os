// NEXUS OS — workspace presets & saved sessions.
//
// A preset arranges REAL application windows (launch + snap), it never just
// swaps a wallpaper. A session is a snapshot of the current window layout
// that can be saved, restored later and deleted — persisted in IndexedDB.

import { useOS } from "../store/os";
import { useRuntime } from "../store/runtime";
import { kvGet, kvSet } from "./idb";
import type { SnapZone } from "../types";

export interface WorkspacePreset {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name hint for the launcher
  steps: Array<{
    appId: string;
    props?: Record<string, unknown>;
    zone: Exclude<SnapZone, null>;
  }>;
}

export const WORKSPACE_PRESETS: WorkspacePreset[] = [
  {
    id: "coding",
    name: "Coding",
    description: "Studio beside the Terminal, Files in reserve",
    icon: "Code2",
    steps: [
      { appId: "studio", zone: "left" },
      { appId: "terminal", zone: "right" },
      { appId: "files", props: { openId: "projects" }, zone: "br" },
    ],
  },
  {
    id: "ai-research",
    name: "AI Research",
    description: "Agent workspace, Browser and Notes side by side",
    icon: "Sparkles",
    steps: [
      { appId: "ai", zone: "left" },
      { appId: "browser", zone: "tr" },
      { appId: "notes", zone: "br" },
    ],
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Full-width shell with Files underneath",
    icon: "SquareTerminal",
    steps: [
      { appId: "terminal", zone: "top" },
      { appId: "files", props: { openId: "projects" }, zone: "bl" },
      { appId: "monitor", zone: "br" },
    ],
  },
  {
    id: "general",
    name: "General",
    description: "Everyday desktop: Files, Browser, Tasks",
    icon: "LayoutGrid",
    steps: [
      { appId: "files", zone: "left" },
      { appId: "browser", zone: "tr" },
      { appId: "tasks", zone: "br" },
    ],
  },
];

export interface SavedSession {
  id: string;
  name: string;
  ts: number;
  windows: Array<{
    appId: string;
    title: string;
    x: number;
    y: number;
    w: number;
    h: number;
    minimized: boolean;
    maximized: boolean;
    props?: Record<string, unknown>;
  }>;
}

const SESSIONS_KEY = "workspaces:sessions";

export async function loadSessions(): Promise<SavedSession[]> {
  try {
    return (await kvGet<SavedSession[]>(SESSIONS_KEY)) ?? [];
  } catch {
    return [];
  }
}

export async function saveSession(name: string): Promise<SavedSession> {
  const os = useOS.getState();
  const windows = os.windows
    .filter((w) => !w.closing)
    .map((w) => ({
      appId: w.appId,
      title: w.title,
      x: w.x,
      y: w.y,
      w: w.w,
      h: w.h,
      minimized: w.minimized,
      maximized: w.maximized,
      props: w.props,
    }));
  const session: SavedSession = {
    id: `ws-${Date.now()}`,
    name: name.trim() || `Session ${new Date().toLocaleString()}`,
    ts: Date.now(),
    windows,
  };
  const all = await loadSessions();
  const next = [session, ...all.filter((s) => s.name !== session.name)].slice(0, 12);
  await kvSet(SESSIONS_KEY, next);
  return session;
}

export async function deleteSession(id: string): Promise<void> {
  const all = await loadSessions();
  await kvSet(SESSIONS_KEY, all.filter((s) => s.id !== id));
}

/** Close everything and open a preset's windows, snapped into place. */
export async function applyPreset(preset: WorkspacePreset): Promise<void> {
  const os = useOS.getState();
  // close current windows (skip closing animation waits — quitApp handles it)
  for (const w of [...os.windows]) {
    if (!w.closing) os.closeWindow(w.id);
  }
  await new Promise((r) => setTimeout(r, 220));
  const fresh = useOS.getState();
  for (const step of preset.steps) {
    fresh.launch(step.appId, step.props);
    await new Promise((r) => setTimeout(r, 60));
    const win = useOS
      .getState()
      .windows.filter((w) => w.appId === step.appId && !w.closing)
      .sort((a, b) => b.zIndex - a.zIndex)[0];
    if (win) fresh.snap(win.id, step.zone);
  }
  emitWorkspaceChanged(preset.id, preset.name);
}

export async function restoreSession(session: SavedSession): Promise<void> {
  const os = useOS.getState();
  for (const w of [...os.windows]) {
    if (!w.closing) os.closeWindow(w.id);
  }
  await new Promise((r) => setTimeout(r, 220));
  for (const w of session.windows) {
    useOS.getState().launch(w.appId, w.props);
  }
  await new Promise((r) => setTimeout(r, 80));
  // apply exact rects from the snapshot
  const current = useOS.getState().windows;
  const byApp = new Map<string, typeof current>();
  for (const w of current) {
    if (!byApp.has(w.appId)) byApp.set(w.appId, []);
    byApp.get(w.appId)!.push(w);
  }
  const used = new Set<string>();
  for (const snap of session.windows) {
    const candidates = byApp.get(snap.appId) ?? [];
    const target = candidates.find((w) => !used.has(w.id));
    if (!target) continue;
    used.add(target.id);
    useOS.getState().setRect(target.id, { x: snap.x, y: snap.y, w: snap.w, h: snap.h });
    if (snap.minimized) useOS.getState().minimize(target.id);
    else if (snap.maximized) useOS.getState().toggleMaximize(target.id);
    if (snap.title) useOS.getState().setTitle(target.id, snap.title);
  }
  emitWorkspaceChanged(session.id, session.name);
}

function emitWorkspaceChanged(id: string, name: string) {
  void (async () => {
    const { emit } = await import("./bus");
    emit("workspace:changed", { id, name });
    // let the System Monitor know work happens
    useRuntime.getState().checkCaps();
  })();
}
