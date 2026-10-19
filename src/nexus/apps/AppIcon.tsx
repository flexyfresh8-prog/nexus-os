"use client";

// NEXUS OS — cohesive app icon tiles (gradient + glyph)

import {
  FolderOpen, Terminal, Code2, Sparkles, Globe, Settings,
  Activity, StickyNote, Calculator, ListTodo, Play, Image as ImageIcon,
  FileText, Package,
} from "lucide-react";
import type { CSSProperties } from "react";

const ICONS: Record<string, React.ReactNode> = {
  files: <FolderOpen size={20} strokeWidth={1.9} />,
  terminal: <Terminal size={20} strokeWidth={1.9} />,
  studio: <Code2 size={20} strokeWidth={1.9} />,
  ai: <Sparkles size={20} strokeWidth={1.9} />,
  browser: <Globe size={20} strokeWidth={1.9} />,
  monitor: <Activity size={20} strokeWidth={1.9} />,
  notes: <StickyNote size={20} strokeWidth={1.9} />,
  calc: <Calculator size={20} strokeWidth={1.9} />,
  tasks: <ListTodo size={20} strokeWidth={1.9} />,
  media: <Play size={20} strokeWidth={1.9} />,
  images: <ImageIcon size={20} strokeWidth={1.9} />,
  docsview: <FileText size={20} strokeWidth={1.9} />,
  pkgmgr: <Package size={20} strokeWidth={1.9} />,
  settings: <Settings size={20} strokeWidth={1.9} />,
};

const GRADIENTS: Record<string, string> = {
  files: "from-amber-300 to-orange-500",
  terminal: "from-slate-600 to-slate-900",
  studio: "from-violet-400 to-fuchsia-600",
  ai: "from-cyan-400 to-teal-600",
  browser: "from-sky-400 to-blue-600",
  monitor: "from-emerald-400 to-green-600",
  notes: "from-yellow-300 to-amber-500",
  calc: "from-zinc-500 to-zinc-800",
  tasks: "from-rose-400 to-pink-600",
  media: "from-purple-400 to-indigo-600",
  images: "from-teal-400 to-cyan-600",
  docsview: "from-orange-300 to-red-500",
  pkgmgr: "from-blue-400 to-indigo-700",
  settings: "from-zinc-400 to-zinc-600",
};

export function AppIcon({
  appId,
  size = 40,
  className = "",
}: {
  appId: string;
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`grid place-items-center bg-gradient-to-br ${GRADIENTS[appId] ?? "from-zinc-500 to-zinc-700"} ${className}`}
      style={
        {
          width: size,
          height: size,
          borderRadius: Math.max(6, size * 0.28),
          color: "#fff",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 4px 12px rgba(0,0,0,0.35)",
        } as CSSProperties
      }
    >
      <span style={{ transform: "scale(0.92)", display: "grid", placeItems: "center" }}>
        {ICONS[appId] ?? <span style={{ fontSize: size * 0.4 }}>?</span>}
      </span>
    </div>
  );
}
