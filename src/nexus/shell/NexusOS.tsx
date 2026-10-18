"use client";

// NEXUS OS — root shell: boots the system, mounts the desktop,
// installs global keyboard shortcuts and applies theme settings.

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DesktopErrorBoundary } from "./ErrorBoundary";
import { BootScreen, TaskSwitcher, WindowLayer } from "./BootScreen";
import { Wallpaper, DesktopIcons, ClockWidget } from "./DesktopIcons";
import { Dock } from "./Dock";
import { Spotlight } from "./Spotlight";
import { Toasts, NotificationCenter } from "./Notifications";
import { ContextMenuHost } from "./ContextMenu";
import { useOS } from "../store/os";
import { useFS } from "../store/fs";
import { useSettings } from "../store/settings";
import { hexToRgb } from "../lib/wallpapers";
import { wallpaperById } from "../lib/wallpapers";

function applyThemeSettings() {
  const s = useSettings.getState();
  const root = document.documentElement;
  root.classList.toggle("dark", s.theme === "dark");
  root.style.setProperty("--nx-accent", s.accent);
  root.style.setProperty("--nx-accent-rgb", hexToRgb(s.accent));
  root.classList.toggle("nx-no-anim", !s.animations);
  // light wallpapers should not be paired with the dark glass theme invisibly —
  // switching to a light wallpaper nudges the theme, but only on explicit change.
}

const emptySubscribe = () => () => {};

export default function NexusOS() {
  // hydration gate: false during SSR/first render, true on client
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const phase = useOS((s) => s.phase);
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    applyThemeSettings();

    const boot = async () => {
      await useFS.getState().init();
      useOS.getState().restoreSession();
      await useOS.getState().hydrateNotifications();
      // graceful entrance
      setTimeout(() => useOS.getState().setPhase("ready"), 250);
    };
    boot();
  }, []);

  // re-apply theme when settings change
  const theme = useSettings((s) => s.theme);
  const accent = useSettings((s) => s.accent);
  const animations = useSettings((s) => s.animations);
  const wallpaper = useSettings((s) => s.wallpaper);
  useEffect(() => {
    if (!mounted) return;
    applyThemeSettings();
    const wp = wallpaperById(wallpaper);
    const root = document.documentElement;
    if (wp.theme === "light" && theme === "dark") root.classList.add("dark"); // keep glass consistent
  }, [theme, accent, animations, wallpaper, mounted]);

  // global keyboard shortcuts
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      const os = useOS.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        os.setSpotlight(!os.spotlight);
        return;
      }
      if (mod && e.key === "`") {
        e.preventDefault();
        os.launch("terminal");
        return;
      }
      if (e.altKey && e.key === "Tab") {
        e.preventDefault();
        os.cycleFocus(1);
        return;
      }
      if (e.altKey && e.key === "`") {
        e.preventDefault();
        os.cycleFocus(1);
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "w") {
        // close focused window (browser-safe alternative to Ctrl+W)
        e.preventDefault();
        if (os.focusedId) os.closeWindow(os.focusedId);
        return;
      }
      if (e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (os.focusedId) os.minimize(os.focusedId);
        return;
      }
      if (e.altKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        if (!os.focusedId) return;
        e.preventDefault();
        const zone =
          e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "top" : null;
        if (zone) {
          os.snap(os.focusedId, zone as "left" | "right" | "top");
        }
        return;
      }
      if (e.key === "Escape") {
        if (os.spotlight) os.setSpotlight(false);
        if (os.notifPanel) os.setNotifPanel(false);
        if (os.ctxMenu) os.closeCtx();
      }
    };
    // capture phase so app-internal handlers (e.g. Monaco chords) can't swallow system shortcuts
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [mounted]);

  // viewport safety: windows must never be stranded off-screen after resizes
  useEffect(() => {
    if (!mounted) return;
    const onResize = () => {
      const os = useOS.getState();
      for (const w of os.windows) {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        if (w.x > vw - 120 || w.y > vh - 60 || w.maximized) {
          os.setRect(w.id, { x: Math.min(w.x, Math.max(0, vw - 160)), y: Math.min(w.y, Math.max(0, vh - 80)) });
        }
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mounted]);

  if (!mounted || phase === "boot") return <BootScreen />;

  return (
    <DesktopErrorBoundary>
      <div className="nx-root fixed inset-0 select-none overflow-hidden">
        <Wallpaper />
        <DesktopIcons />
        <ClockWidget />
        <WindowLayer />
        <Dock />
        <Spotlight />
        <NotificationCenter />
        <Toasts />
        <TaskSwitcher />
        <ContextMenuHost />
      </div>
    </DesktopErrorBoundary>
  );
}
