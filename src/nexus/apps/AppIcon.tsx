"use client";

// NEXUS OS — cohesive app icon tiles (gradient + glyph)

import {
  FolderOpen, Terminal, Code2, Sparkles, Globe, Settings,
} from "lucide-react";
import type { CSSProperties } from "react";

const ICONS: Record<string, React.ReactNode> = {
  files: <FolderOpen size={20} strokeWidth={1.9} />,
  terminal: <Terminal size={20} strokeWidth={1.9} />,
  studio: <Code2 size={20} strokeWidth={1.9} />,
  ai: <Sparkles size={20} strokeWidth={1.9} />,
  browser: <Globe size={20} strokeWidth={1.9} />,
  settings: <Settings size={20} strokeWidth={1.9} />,
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
  // avoid circular import: read gradient from meta via require-free copy
  const gradients: Record<string, string> = {
    files: "from-amber-300 to-orange-500",
    terminal: "from-slate-600 to-slate-900",
    studio: "from-violet-400 to-fuchsia-600",
    ai: "from-cyan-400 to-teal-600",
    browser: "from-sky-400 to-blue-600",
    settings: "from-zinc-400 to-zinc-600",
  };
  return (
    <div
      className={`grid place-items-center bg-gradient-to-br ${gradients[appId] ?? "from-zinc-500 to-zinc-700"} ${className}`}
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
