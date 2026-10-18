"use client";

// NEXUS OS — wallpaper + clock widget + desktop icon grid

import React, { useEffect, useState } from "react";
import { Folder, FileText } from "lucide-react";
import { wallpaperById } from "../lib/wallpapers";
import { useSettings, defaultDesktopIcons } from "../store/settings";
import { useOS } from "../store/os";
import { useFS } from "../store/fs";
import { APP_META } from "../apps/meta";
import { AppIcon } from "../apps/AppIcon";
import { isTextFile, HOME_ID } from "../lib/vfs";
import { useLongPress } from "./ContextMenu";

const COL_W = 92;
const ROW_H = 100;

export function Wallpaper() {
  const wallpaper = useSettings((s) => s.wallpaper);
  const wp = wallpaperById(wallpaper);
  return (
    <div
      className="nx-noise fixed inset-0 -z-10 transition-[background] duration-500"
      style={{ background: wp.css }}
      aria-hidden
    />
  );
}

export function ClockWidget() {
  const show = useSettings((s) => s.showClockWidget);
  const windows = useOS((s) => s.windows);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1_000);
    return () => clearInterval(t);
  }, []);
  if (!show || windows.length > 0) return null; // steps aside while working
  return (
    <div className="nx-fade-in pointer-events-none fixed right-8 top-7 z-[10] select-none text-right">
      <div className="text-[64px] font-extralight leading-none tracking-tight text-[var(--nx-text)] opacity-85 drop-shadow-lg">
        {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
      </div>
      <div className="mt-1 text-sm font-light text-[var(--nx-text-dim)]">
        {now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
      </div>
    </div>
  );
}

function FileGlyph({ refId }: { refId: string }) {
  const node = useFS((s) => s.nodes[refId]);
  if (!node) return <FileText size={42} className="text-[var(--nx-text-dim)]" strokeWidth={1.4} />;
  if (node.type === "dir") return <Folder size={44} className="text-amber-300" strokeWidth={1.4} />;
  return <FileText size={42} className="text-sky-300" strokeWidth={1.4} />;
}

function DesktopIconEl({
  iconId,
  kind,
  ref,
  gx,
  gy,
  selected,
  onSelect,
  onOpen,
}: {
  iconId: string;
  kind: "app" | "file";
  ref: string;
  gx: number;
  gy: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const openCtx = useOS((s) => s.openCtx);
  const setIconPos = useSettings((s) => s.setIconPos);
  const removeDesktopIcon = useSettings((s) => s.removeDesktopIcon);
  const [lastTap, setLastTap] = useState(0);
  const lp = useLongPress((x, y) => {
    openCtx(x, y, [
      { label: "Open", onClick: onOpen },
      { separator: true },
      { label: "Remove from Desktop", danger: true, onClick: () => removeDesktopIcon(iconId) },
    ]);
  });

  const label =
    kind === "app" ? APP_META[ref]?.name ?? ref : useFS.getState().nodes[ref]?.name ?? "missing";

  const startDrag = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 8) return;
      moved = true;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.style.zIndex = "60";
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.style.transform = "";
      el.style.zIndex = "";
      if (!moved) return;
      const newGx = Math.max(0, gx + Math.round((ev.clientX - startX) / COL_W));
      const newGy = Math.max(0, gy + Math.round((ev.clientY - startY) / ROW_H));
      if (newGx !== gx || newGy !== gy) setIconPos(iconId, newGx, newGy);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <button
      className={`nx-longpress absolute flex w-[84px] flex-col items-center gap-1.5 rounded-xl p-2 outline-none transition-colors ${
        selected
          ? "bg-[rgba(var(--nx-accent-rgb),0.16)] ring-1 ring-[rgba(var(--nx-accent-rgb),0.4)]"
          : "hover:bg-white/[0.06]"
      }`}
      style={{ left: 14 + gx * COL_W, top: 14 + gy * ROW_H }}
      draggable={false}
      onPointerDown={(e) => {
        onSelect();
        lp.onPointerDown(e);
        startDrag(e);
      }}
      onPointerMove={lp.onPointerMove}
      onPointerUp={(e) => {
        lp.onPointerUp();
        if (e.pointerType !== "mouse") {
          const now = Date.now();
          if (now - lastTap < 500) onOpen();
          setLastTap(now);
        }
      }}
      onPointerCancel={lp.onPointerCancel}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect();
        openCtx(e.clientX, e.clientY, [
          { label: "Open", onClick: onOpen },
          { separator: true },
          { label: "Remove from Desktop", danger: true, onClick: () => removeDesktopIcon(iconId) },
        ]);
      }}
      aria-label={label}
    >
      <span className="pointer-events-none drop-shadow-[0_4px_10px_rgba(0,0,0,0.45)]">
        {kind === "app" ? <AppIcon appId={ref} size={46} /> : <FileGlyph refId={ref} />}
      </span>
      <span
        className={`pointer-events-none max-w-full truncate rounded px-1 text-[11px] leading-tight ${
          selected
            ? "bg-[rgba(var(--nx-accent-rgb),0.35)] text-white"
            : "text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
        }`}
      >
        {label}
      </span>
    </button>
  );
}

export function DesktopIcons() {
  const show = useSettings((s) => s.showDesktopIcons);
  const icons = useSettings((s) => s.desktopIcons);
  const reseedIcons = useSettings((s) => s.reseedIcons);
  const launch = useOS((s) => s.launch);
  const openCtx = useOS((s) => s.openCtx);
  const nodes = useFS((s) => s.nodes);
  const [selected, setSelected] = useState<string | null>(null);

  const openIcon = (kind: "app" | "file", ref: string) => {
    if (kind === "app") {
      launch(ref);
      return;
    }
    const node = nodes[ref];
    if (!node) return;
    if (node.type === "file" && isTextFile(node.name, node.mime)) {
      launch("studio", { openFileId: ref });
    } else {
      launch("files", { openId: ref });
    }
  };

  const desktopCtx = (e: React.MouseEvent) => {
    e.preventDefault();
    const homeDesktop = Object.values(nodes).find(
      (n) => n.parentId === HOME_ID && n.name === "Desktop"
    );
    openCtx(e.clientX, e.clientY, [
      {
        label: "New Folder",
        onClick: () => {
          if (homeDesktop) {
            useFS
              .getState()
              .createNode({ parentId: homeDesktop.id, name: "New Folder", type: "dir", autoRename: true });
          }
        },
      },
      {
        label: "New Text File",
        onClick: () => {
          if (homeDesktop) {
            useFS
              .getState()
              .createNode({ parentId: homeDesktop.id, name: "untitled.txt", type: "file", content: "", autoRename: true });
          }
        },
      },
      { separator: true },
      {
        label: "Open Terminal Here",
        onClick: () => launch("terminal", homeDesktop ? { cwdId: homeDesktop.id } : undefined),
      },
      { label: "Change Wallpaper", onClick: () => launch("settings", { section: "appearance" }) },
      {
        label: "Reset Icon Layout",
        onClick: () => reseedIcons(defaultDesktopIcons()),
      },
      { label: "About This System", onClick: () => launch("settings", { section: "about" }) },
    ]);
  };

  return (
    <div
      className="fixed inset-0 z-0"
      onContextMenu={desktopCtx}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) setSelected(null);
      }}
    >
      {show &&
        icons.map((icon) => (
          <DesktopIconEl
            key={icon.id}
            iconId={icon.id}
            kind={icon.kind}
            ref={icon.ref}
            gx={icon.gx}
            gy={icon.gy}
            selected={selected === icon.id}
            onSelect={() => setSelected(icon.id)}
            onOpen={() => openIcon(icon.kind, icon.ref)}
          />
        ))}
    </div>
  );
}
