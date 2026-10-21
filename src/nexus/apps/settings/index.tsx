"use client";

// NEXUS OS — Settings: appearance, desktop, motion, shortcuts,
// storage/backup, about. Backs everything with honest confirmations.

import React, { useEffect, useRef, useState } from "react";
import {
  Palette, Monitor, Gauge, Keyboard, HardDrive, Info, Upload, Download,
  RotateCcw, Trash2, Check, X, ShieldAlert, ShieldCheck, LayoutGrid, Play, Save, Lock,
} from "lucide-react";
import type { AppInstanceProps } from "../../types";
import { useSettings } from "../../store/settings";
import { useFS } from "../../store/fs";
import { useOS } from "../../store/os";
import { WALLPAPERS, ACCENTS } from "../../lib/wallpapers";
import { formatBytes } from "../../lib/utils";
import { downloadBackup, importBackup } from "../../lib/backup";
import { idbCount, STORE_FS } from "../../lib/idb";
import { useLock } from "../../store/lock";
import { audit, auditLog, clearAudit, agoOf, cryptoAvailable, type AuditEntry } from "../../lib/secure";
import { WORKSPACE_PRESETS, applyPreset, saveSession, loadSessions, restoreSession, deleteSession, type SavedSession } from "../../lib/workspaces";
import { OS_VERSION } from "../meta";

type SectionId = "appearance" | "desktop" | "workspaces" | "motion" | "shortcuts" | "security" | "storage" | "about";

const SECTIONS: { id: SectionId; name: string; icon: React.ReactNode; hint: string }[] = [
  { id: "appearance", name: "Appearance", icon: <Palette size={15} />, hint: "Theme, accent, wallpaper" },
  { id: "desktop", name: "Desktop & Dock", icon: <Monitor size={15} />, hint: "Icons, clock, dock" },
  { id: "workspaces", name: "Workspaces", icon: <LayoutGrid size={15} />, hint: "Presets, saved sessions" },
  { id: "motion", name: "Motion", icon: <Gauge size={15} />, hint: "Animations" },
  { id: "shortcuts", name: "Shortcuts", icon: <Keyboard size={15} />, hint: "Keyboard reference" },
  { id: "security", name: "Security", icon: <ShieldCheck size={15} />, hint: "Lock, secrets, audit log" },
  { id: "storage", name: "Storage & Backup", icon: <HardDrive size={15} />, hint: "Usage, backup, reset" },
  { id: "about", name: "About", icon: <Info size={15} />, hint: "Version, capabilities" },
];

const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Ctrl / ⌘ + K", action: "Open global search" },
  { keys: "Ctrl / ⌘ + `", action: "Open Terminal" },
  { keys: "Alt + Tab or Alt + `", action: "Cycle windows" },
  { keys: "Alt + W", action: "Close focused window" },
  { keys: "Alt + M", action: "Minimize focused window" },
  { keys: "Alt + ←/→", action: "Snap window left / right" },
  { keys: "Alt + ↑", action: "Snap window (maximize)" },
  { keys: "Double-click title bar", action: "Maximize / restore window" },
  { keys: "Drag to screen edges", action: "Snap zones (halves, quarters, full)" },
  { keys: "Ctrl / ⌘ + S (Studio)", action: "Save file" },
  { keys: "F2 / Delete (Files)", action: "Rename / delete selection" },
  { keys: "Ctrl / ⌘ + Alt + L", action: "Lock the screen" },
  { keys: "Right-click / long-press", action: "Context menus everywhere" },
];

/* ---------- small primitives ---------- */

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
        on
          ? "border-[rgba(var(--nx-accent-rgb),0.5)] bg-[rgba(var(--nx-accent-rgb),0.35)]"
          : "border-[var(--nx-border)] bg-white/10"
      }`}
    >
      <span
        className={`absolute top-1/2 h-4.5 w-4.5 -translate-y-1/2 rounded-full bg-white shadow transition-all ${
          on ? "left-[calc(100%-22px)]" : "left-[3px]"
        }`}
        style={{ height: 18, width: 18 }}
      />
    </button>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-[var(--nx-border)] py-3.5 last:border-0">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-[var(--nx-text)]">{title}</div>
        {desc && <div className="mt-0.5 text-[11.5px] leading-snug text-[var(--nx-text-dim)]">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ConfirmModal({
  title, body, confirmLabel, danger, onConfirm, onCancel,
}: {
  title: string; body: string; confirmLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/60 p-6 nx-fade-in" onClick={onCancel}>
      <div
        className="nx-glass-strong w-full max-w-sm rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-label={title}
      >
        <div className="flex items-start gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${danger ? "bg-red-500/15 text-red-400" : "bg-[rgba(var(--nx-accent-rgb),0.15)] text-[var(--nx-accent)]"}`}>
            <ShieldAlert size={17} />
          </span>
          <div>
            <div className="text-sm font-semibold text-[var(--nx-text)]">{title}</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--nx-text-dim)]">{body}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-lg border border-[var(--nx-border)] px-3.5 py-1.5 text-xs text-[var(--nx-text)] hover:bg-white/5 transition">
            Cancel
          </button>
          <button
            onClick={() => { onConfirm(); onCancel(); }}
            className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white transition ${
              danger ? "bg-red-500 hover:bg-red-400" : "bg-[var(--nx-accent)] text-black hover:brightness-110"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- main app ---------- */

export default function SettingsApp({ launchProps, setTitle }: AppInstanceProps) {
  const s = useSettings();
  const notify = useOS((st) => st.notify);
  const fs = useFS();
  const initial = (launchProps?.section as SectionId) || "appearance";
  const [section, setSection] = useState<SectionId>(
    SECTIONS.some((x) => x.id === initial) ? initial : "appearance"
  );
  const [confirm, setConfirm] = useState<null | "settings" | "fs" | "full">(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [fsCounts, setFsCounts] = useState<{ files: number; dirs: number; rows: number } | null>(null);
  const [importMode, setImportMode] = useState<"replace" | "merge">("replace");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitle("Settings");
  }, [setTitle]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        const rows = await idbCount(STORE_FS);
        if (!alive) return;
        setUsage({ usage: est?.usage ?? 0, quota: est?.quota ?? 0 });
        const nodes = Object.values(useFS.getState().nodes);
        setFsCounts({ files: nodes.filter((n) => n.type === "file").length, dirs: nodes.filter((n) => n.type === "dir").length, rows });
      } catch { /* estimates unavailable */ }
    };
    const t = setTimeout(load, 50);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [section]);

  const onImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const res = await importBackup(text, importMode);
      notify({ title: "Backup import", body: res.message, appId: "settings" });
      if (res.ok) {
        // reload filesystem store from IDB
        const rows = await idbCount(STORE_FS);
        if (importMode === "replace" && rows > 0) {
          // simplest reliable path: rehydrate via reload prompt
          notify({ title: "Backup import", body: "Import complete. Refresh the page to load the restored system.", appId: "settings" });
        }
      }
    } catch (e) {
      notify({ title: "Backup import", body: `Could not read file: ${e instanceof Error ? e.message : String(e)}`, appId: "settings" });
    }
  };

  return (
    <div className="relative flex h-full">
      {/* nav */}
      <nav className="flex w-[190px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--nx-border)] p-2.5 nx-scroll" aria-label="Settings sections">
        <div className="px-2.5 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-widest text-[var(--nx-text-dim)]">
          Settings
        </div>
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            onClick={() => setSection(sec.id)}
            className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
              section === sec.id
                ? "bg-[rgba(var(--nx-accent-rgb),0.14)] text-[var(--nx-text)] ring-1 ring-[rgba(var(--nx-accent-rgb),0.35)]"
                : "text-[var(--nx-text-dim)] hover:bg-white/[0.05] hover:text-[var(--nx-text)]"
            }`}
          >
            <span className={section === sec.id ? "text-[var(--nx-accent)]" : ""}>{sec.icon}</span>
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-medium">{sec.name}</span>
              <span className="block truncate text-[10.5px] opacity-70">{sec.hint}</span>
            </span>
          </button>
        ))}
      </nav>

      {/* content */}
      <div className="nx-scroll min-w-0 flex-1 overflow-y-auto p-5" key={section}>
        {section === "appearance" && (
          <section className="nx-fade-in">
            <h2 className="text-[15px] font-semibold text-[var(--nx-text)]">Appearance</h2>
            <p className="mt-0.5 text-[12px] text-[var(--nx-text-dim)]">Make NEXUS yours.</p>

            <div className="mt-4">
              <Row title="Theme" desc="Dark is the native NEXUS experience; light adjusts glass surfaces.">
                <div className="flex rounded-xl border border-[var(--nx-border)] p-0.5">
                  {(["dark", "light"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => s.set({ theme: t })}
                      className={`rounded-lg px-3.5 py-1.5 text-xs font-medium capitalize transition ${
                        s.theme === t ? "bg-[rgba(var(--nx-accent-rgb),0.25)] text-[var(--nx-text)]" : "text-[var(--nx-text-dim)] hover:text-[var(--nx-text)]"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </Row>

              <Row title="Accent color" desc="Used for highlights, focus rings, and the dock glow.">
                <div className="flex flex-wrap justify-end gap-2">
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      aria-label={`Accent ${a.name}`}
                      onClick={() => s.set({ accent: a.hex })}
                      className={`grid h-7 w-7 place-items-center rounded-full transition hover:scale-110 ${s.accent === a.hex ? "ring-2 ring-white/70 ring-offset-2 ring-offset-transparent" : ""}`}
                      style={{ background: a.hex }}
                    >
                      {s.accent === a.hex && <Check size={13} className="text-black/70" />}
                    </button>
                  ))}
                </div>
              </Row>

              <Row title="Wallpaper" desc="Pure-CSS system wallpapers — zero downloads.">
                <span className="text-[11px] text-[var(--nx-text-dim)]">{WALLPAPERS.length} styles</span>
              </Row>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {WALLPAPERS.map((w) => (
                <button
                  key={w.id}
                  onClick={() => s.set({ wallpaper: w.id })}
                  className={`group overflow-hidden rounded-xl border text-left transition ${
                    s.wallpaper === w.id
                      ? "border-[rgba(var(--nx-accent-rgb),0.6)] ring-2 ring-[rgba(var(--nx-accent-rgb),0.35)]"
                      : "border-[var(--nx-border)] hover:border-[var(--nx-border-strong)]"
                  }`}
                >
                  <span className="block h-16 w-full transition group-hover:brightness-110" style={{ background: w.css }} />
                  <span className="flex items-center justify-between px-2.5 py-1.5">
                    <span className="text-[11.5px] font-medium text-[var(--nx-text)]">{w.name}</span>
                    <span className="text-[9.5px] uppercase tracking-wider text-[var(--nx-text-dim)]">{w.theme}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {section === "desktop" && (
          <section className="nx-fade-in">
            <h2 className="text-[15px] font-semibold text-[var(--nx-text)]">Desktop & Dock</h2>
            <p className="mt-0.5 text-[12px] text-[var(--nx-text-dim)]">Tune the workspace.</p>
            <div className="mt-4">
              <Row title="Show desktop icons" desc="Disable for a minimal, widget-only desktop.">
                <Toggle on={s.showDesktopIcons} onChange={(v) => s.set({ showDesktopIcons: v })} label="Show desktop icons" />
              </Row>
              <Row title="Clock widget" desc="Large clock in the corner; hides while windows are open.">
                <Toggle on={s.showClockWidget} onChange={(v) => s.set({ showClockWidget: v })} label="Show clock widget" />
              </Row>
              <Row title="Dock magnification" desc="Icons grow near the cursor (mouse only).">
                <Toggle on={s.dockMagnify} onChange={(v) => s.set({ dockMagnify: v })} label="Dock magnification" />
              </Row>
              <Row title="Dock icon size" desc={`${s.dockSize}px`}>
                <input
                  type="range"
                  min={40}
                  max={68}
                  value={s.dockSize}
                  onChange={(e) => s.set({ dockSize: Number(e.target.value) })}
                  className="w-40 accent-[var(--nx-accent)]"
                  aria-label="Dock icon size"
                />
              </Row>
            </div>
          </section>
        )}

        {section === "workspaces" && <WorkspacesSection />}

        {section === "motion" && (
          <section className="nx-fade-in">
            <h2 className="text-[15px] font-semibold text-[var(--nx-text)]">Motion</h2>
            <p className="mt-0.5 text-[12px] text-[var(--nx-text-dim)]">Window and UI animation behavior.</p>
            <div className="mt-4">
              <Row title="Animations" desc="Window open/close, dock hover, panels. Your system-level reduced-motion preference is always respected.">
                <Toggle on={s.animations} onChange={(v) => s.set({ animations: v })} label="Animations" />
              </Row>
            </div>
          </section>
        )}

        {section === "shortcuts" && (
          <section className="nx-fade-in">
            <h2 className="text-[15px] font-semibold text-[var(--nx-text)]">Keyboard Shortcuts</h2>
            <p className="mt-0.5 text-[12px] text-[var(--nx-text-dim)]">Everything important is reachable without a mouse.</p>
            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--nx-border)]">
              {SHORTCUTS.map((sc, i) => (
                <div key={sc.keys} className={`flex items-center justify-between px-4 py-2.5 ${i % 2 ? "bg-white/[0.02]" : ""}`}>
                  <span className="text-[12.5px] text-[var(--nx-text)]">{sc.action}</span>
                  <kbd className="rounded-md border border-[var(--nx-border)] bg-white/5 px-2 py-0.5 font-mono text-[10.5px] text-[var(--nx-text-dim)]">
                    {sc.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </section>
        )}

        {section === "security" && <SecuritySection />}

        {section === "storage" && (
          <section className="nx-fade-in">
            <h2 className="text-[15px] font-semibold text-[var(--nx-text)]">Storage & Backup</h2>
            <p className="mt-0.5 text-[12px] text-[var(--nx-text-dim)]">
              The virtual filesystem and settings live in your browser (IndexedDB + localStorage). Nothing syncs anywhere.
            </p>

            <div className="mt-4 grid grid-cols-3 gap-3">
              {[
                { label: "Files", value: fsCounts ? String(fsCounts.files) : "—" },
                { label: "Folders", value: fsCounts ? String(fsCounts.dirs) : "—" },
                { label: "Browser storage used", value: usage ? formatBytes(usage.usage) : "—" },
              ].map((c) => (
                <div key={c.label} className="rounded-xl border border-[var(--nx-border)] bg-white/[0.03] p-3">
                  <div className="text-[18px] font-semibold text-[var(--nx-text)]">{c.value}</div>
                  <div className="mt-0.5 text-[10.5px] uppercase tracking-wider text-[var(--nx-text-dim)]">{c.label}</div>
                </div>
              ))}
            </div>
            {usage && usage.quota > 0 && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--nx-accent)]"
                  style={{ width: `${Math.min(100, (usage.usage / usage.quota) * 100).toFixed(2)}%` }}
                />
              </div>
            )}

            <div className="mt-5">
              <Row title="Export full backup" desc="Downloads a JSON snapshot of the filesystem and system data.">
                <button
                  onClick={() => downloadBackup().then(() => notify({ title: "Backup", body: "Backup file downloaded.", appId: "settings" }))}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] px-3 py-1.5 text-xs text-[var(--nx-text)] hover:bg-white/5 transition"
                >
                  <Download size={13} /> Export
                </button>
              </Row>
              <Row title="Import backup" desc={`Mode: ${importMode}. Replace wipes current data; merge keeps both. Corrupt or foreign files are rejected safely.`}>
                <div className="flex items-center gap-2">
                  <select
                    value={importMode}
                    onChange={(e) => setImportMode(e.target.value as "replace" | "merge")}
                    className="rounded-lg border border-[var(--nx-border)] bg-transparent px-2 py-1.5 text-xs text-[var(--nx-text)] outline-none"
                    aria-label="Import mode"
                  >
                    <option value="replace">Replace</option>
                    <option value="merge">Merge</option>
                  </select>
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--nx-border)] px-3 py-1.5 text-xs text-[var(--nx-text)] hover:bg-white/5 transition"
                  >
                    <Upload size={13} /> Import
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) onImportFile(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </Row>
              <Row title="Reset settings" desc="Theme, wallpaper, dock, desktop icons — files are kept.">
                <button
                  onClick={() => setConfirm("settings")}
                  className="flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20 transition"
                >
                  <RotateCcw size={13} /> Reset
                </button>
              </Row>
              <Row title="Erase filesystem" desc="Deletes every file and folder, then reseeds the home directory. Cannot be undone.">
                <button
                  onClick={() => setConfirm("fs")}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 transition"
                >
                  <Trash2 size={13} /> Erase
                </button>
              </Row>
              <Row title="Factory reset" desc="Everything: files, settings, windows, notifications, backups of state. The page reloads.">
                <button
                  onClick={() => setConfirm("full")}
                  className="flex items-center gap-1.5 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20 transition"
                >
                  <X size={13} /> Factory reset
                </button>
              </Row>
            </div>
          </section>
        )}

        {section === "about" && (
          <section className="nx-fade-in">
            <h2 className="text-[15px] font-semibold text-[var(--nx-text)]">About NEXUS OS</h2>
            <div className="mt-4 rounded-xl border border-[var(--nx-border)] bg-white/[0.03] p-4">
              <div className="flex items-center gap-3">
                <svg width="40" height="40" viewBox="0 0 72 72" fill="none" aria-hidden>
                  <path d="M36 4 L62 19 V53 L36 68 L10 53 V19 Z" stroke="var(--nx-accent)" strokeWidth="3" fill="rgba(34,211,238,0.06)" />
                  <path d="M26 48 V24 L46 48 V24" stroke="var(--nx-accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
                <div>
                  <div className="text-sm font-semibold text-[var(--nx-text)]">NEXUS OS</div>
                  <div className="text-[11.5px] text-[var(--nx-text-dim)]">Version {OS_VERSION} · browser desktop environment</div>
                </div>
              </div>
              <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--nx-text-dim)]">
                A complete desktop environment running client-side: window manager, virtual filesystem, terminal,
                code studio with live preview, AI agent with validated tools, and an internal browser.
              </p>
            </div>

            <div className="mt-4 space-y-2.5 text-[12.5px] leading-relaxed text-[var(--nx-text-dim)]">
              <div className="rounded-xl border border-[var(--nx-border)] p-3.5">
                <span className="font-semibold text-[var(--nx-text)]">Honest capability notes.</span> The
                filesystem is virtual (IndexedDB): it never touches your real files unless you import or export
                through Files. Terminal commands execute locally in the browser — there is no real shell. Studio
                previews run in a sandboxed iframe that cannot access NEXUS internals. Nexus AI talks directly to
                the provider you configure; on static hosting there is no proxy, so keys stay on-device and the
                provider must permit browser requests. The internal browser cannot render sites that send
                X-Frame-Options/CSP frame restrictions — it tells you and offers a real new tab instead.
              </div>
            </div>
          </section>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          danger={confirm !== "settings"}
          title={
            confirm === "settings" ? "Reset settings?" : confirm === "fs" ? "Erase the filesystem?" : "Factory reset?"
          }
          body={
            confirm === "settings"
              ? "Appearance, desktop, and dock preferences return to defaults. Your files are untouched."
              : confirm === "fs"
                ? "All files and folders will be permanently deleted and the home directory reseeded. This cannot be undone."
                : "All data — files, settings, sessions, notifications — will be wiped and the page will reload."
          }
          confirmLabel={confirm === "settings" ? "Reset" : confirm === "fs" ? "Erase everything" : "Wipe & reload"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            if (confirm === "settings") {
              s.resetAll();
              notify({ title: "Settings", body: "Settings restored to defaults.", appId: "settings" });
            } else if (confirm === "fs") {
              useFS.getState().wipe();
              notify({ title: "Storage", body: "Filesystem erased and reseeded.", appId: "settings" });
            } else {
              try {
                localStorage.clear();
              } catch { /* noop */ }
              import("../../lib/idb").then(({ idbClear, STORE_FS, STORE_KV }) => {
                Promise.allSettled([idbClear(STORE_FS), idbClear(STORE_KV)]).then(() => window.location.reload());
              });
            }
          }}
        />
      )}
    </div>
  );
}

// ---------------- workspaces section ----------------

function WorkspacesSection() {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    void loadSessions().then(setSessions);
  };
  useEffect(refresh, []);

  return (
    <section className="nx-fade-in">
      <h2 className="text-[15px] font-semibold text-[var(--nx-text)]">Workspaces</h2>
      <p className="mt-0.5 text-[12px] text-[var(--nx-text-dim)]">
        Presets arrange real application windows. Saved sessions snapshot your current layout
        (positions, sizes, minimized state) and restore it later.
      </p>

      <h3 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wide text-[var(--nx-text-dim)]">
        Presets
      </h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {WORKSPACE_PRESETS.map((p) => (
          <div key={p.id} className="nx-glass flex items-center gap-3 rounded-xl p-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-[var(--nx-text)]">{p.name}</div>
              <p className="truncate text-[11px] text-[var(--nx-text-dim)]">{p.description}</p>
            </div>
            <button
              onClick={() => {
                setBusy(p.id);
                void applyPreset(p).finally(() => setBusy(null));
              }}
              disabled={busy !== null}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[rgba(var(--nx-accent-rgb),0.15)] px-3 py-1.5 text-[11px] text-[var(--nx-accent)] transition hover:bg-[rgba(var(--nx-accent-rgb),0.25)] disabled:opacity-50"
            >
              <Play size={11} /> {busy === p.id ? "Arranging…" : "Apply"}
            </button>
          </div>
        ))}
      </div>

      <h3 className="mb-2 mt-5 text-[12px] font-semibold uppercase tracking-wide text-[var(--nx-text-dim)]">
        Saved sessions
      </h3>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              void saveSession(name).then(() => {
                setName("");
                refresh();
              });
            }
          }}
          placeholder="Session name (e.g. Deep work)"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[12px] outline-none placeholder:text-[var(--nx-text-dim)] focus:border-[rgba(var(--nx-accent-rgb),0.5)]"
        />
        <button
          onClick={() => {
            void saveSession(name).then(() => {
              setName("");
              refresh();
            });
          }}
          disabled={!name.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/5 px-3 py-2 text-[12px] transition hover:bg-white/10 disabled:opacity-40"
        >
          <Save size={12} /> Save current
        </button>
      </div>
      <div className="mt-2 space-y-1.5">
        {sessions.length === 0 ? (
          <p className="text-[11px] text-[var(--nx-text-dim)]">
            No saved sessions yet. Arrange some windows and save the layout.
          </p>
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-[var(--nx-text)]">{s.name}</div>
                <div className="text-[10px] text-[var(--nx-text-dim)]">
                  {s.windows.length} window{s.windows.length === 1 ? "" : "s"} · saved{" "}
                  {new Date(s.ts).toLocaleString()}
                </div>
              </div>
              <button
                onClick={() => void restoreSession(s)}
                className="shrink-0 rounded-lg bg-[rgba(var(--nx-accent-rgb),0.15)] px-2.5 py-1 text-[11px] text-[var(--nx-accent)] hover:bg-[rgba(var(--nx-accent-rgb),0.25)]"
              >
                Restore
              </button>
              <button
                onClick={() => {
                  void deleteSession(s.id).then(refresh);
                }}
                aria-label="Delete session"
                className="shrink-0 rounded-lg p-1.5 text-[var(--nx-text-dim)] hover:bg-red-400/10 hover:text-red-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/* ---------------- security section ---------------- */

const AUTOLOCK_CHOICES = [
  { v: 0, label: "Off" },
  { v: 1, label: "1 min" },
  { v: 5, label: "5 min" },
  { v: 15, label: "15 min" },
  { v: 60, label: "1 hour" },
];

function SecuritySection() {
  const lock = useLock();
  const autoLockMin = useSettings((s) => s.autoLockMin);
  const setSettings = useSettings((st) => st.set);
  const notify = useOS((st) => st.notify);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<AuditEntry[]>([]);
  const [wipePhrase, setWipePhrase] = useState("");
  const [wiping, setWiping] = useState(false);

  const refreshLog = () => void auditLog().then((l) => setLog([...l].reverse().slice(0, 40)));
  useEffect(refreshLog, []);

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 5000);
  };

  const enable = async () => {
    setBusy(true);
    const err = await lock.enable(next);
    setBusy(false);
    if (err) flash(false, err);
    else {
      flash(true, "Lock screen enabled. It engages on reload and via the dock button or Ctrl+Alt+L.");
      setCurrent("");
      setNext("");
      refreshLog();
    }
  };

  const change = async () => {
    setBusy(true);
    const err = await lock.change(current, next);
    setBusy(false);
    if (err) flash(false, err);
    else {
      flash(true, "Passcode changed. The new passcode takes effect immediately.");
      setCurrent("");
      setNext("");
      refreshLog();
    }
  };

  const disable = async () => {
    setBusy(true);
    const err = await lock.disable(current);
    setBusy(false);
    if (err) flash(false, err);
    else {
      flash(true, "Lock screen disabled.");
      setCurrent("");
      setNext("");
      refreshLog();
    }
  };

  const panicWipe = async () => {
    if (wipePhrase !== "ERASE ALL") return;
    setWiping(true);
    audit("panic-wipe", "user-initiated secure wipe from Settings");
    try {
      localStorage.clear();
      sessionStorage.clear();
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister().catch(() => {})));
      }
      // IndexedDB last — then reload into a factory state
      const dbs = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
      for (const db of dbs) {
        if (db.name) await new Promise<void>((res) => {
          const req = indexedDB.deleteDatabase(db.name!);
          req.onsuccess = req.onerror = req.onblocked = () => res();
        });
      }
    } catch {
      /* wipe as much as possible regardless */
    }
    location.reload();
  };

  const cryptoOk = cryptoAvailable();

  return (
    <section className="nx-fade-in">
      <h2 className="text-[15px] font-semibold text-[var(--nx-text)]">Security</h2>
      <p className="mt-0.5 text-[12px] text-[var(--nx-text-dim)]">
        Lock screen, secret storage and the security audit trail. Everything runs locally —
        see SECURITY.md in the repository for the full threat model.
      </p>

      {/* posture */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {[
          { ok: cryptoOk, label: "WebCrypto available", desc: "AES-GCM + PBKDF2 for secrets and the lock verifier" },
          { ok: true, label: "AI provider keys encrypted at rest", desc: "sealed with a per-installation device key, excluded from backups" },
          { ok: true, label: "Sandboxed execution", desc: "previews run in an opaque-origin iframe; user JS in a Web Worker" },
          { ok: true, label: "Strict Content-Security-Policy", desc: "inline script injection is blocked; violations are audited" },
        ].map((r) => (
          <div key={r.label} className="flex items-start gap-2.5 rounded-xl border border-[var(--nx-border)] bg-white/[0.03] p-3">
            <ShieldCheck size={15} className={`mt-0.5 shrink-0 ${r.ok ? "text-emerald-400" : "text-amber-400"}`} />
            <div>
              <div className="text-[12.5px] font-medium text-[var(--nx-text)]">{r.label}</div>
              <div className="text-[11px] leading-snug text-[var(--nx-text-dim)]">{r.desc}</div>
            </div>
          </div>
        ))}
      </div>

      {/* lock screen */}
      <h3 className="mb-1 mt-6 text-[12px] font-semibold uppercase tracking-wide text-[var(--nx-text-dim)]">Lock screen</h3>
      <Row
        title={lock.hasLock ? "Passcode is enabled" : "No passcode is set"}
        desc="A passcode gates the whole desktop with a lock screen. Verification uses PBKDF2 (600k rounds) + AES-GCM; the passcode itself is never stored."
      >
        <div className="flex items-center gap-2 text-[11px] text-[var(--nx-text-dim)]">
          <Lock size={13} className={lock.hasLock ? "text-emerald-400" : ""} />
          {lock.hasLock ? "On" : "Off"}
        </div>
      </Row>
      <Row title="Auto-lock" desc="Engage the lock screen after this much idle time (pointer / keyboard / wheel).">
        <select
          value={autoLockMin}
          onChange={(e) => setSettings({ autoLockMin: Number(e.target.value) })}
          className="rounded-lg border border-[var(--nx-border)] bg-transparent px-2 py-1.5 text-xs text-[var(--nx-text)] outline-none"
          aria-label="Auto-lock timeout"
        >
          {AUTOLOCK_CHOICES.map((c) => (
            <option key={c.v} value={c.v}>{c.label}</option>
          ))}
        </select>
      </Row>

      <div className="mt-3 rounded-xl border border-[var(--nx-border)] bg-white/[0.03] p-3.5">
        <div className="text-[12px] font-medium text-[var(--nx-text)]">
          {lock.hasLock ? "Change or remove the passcode" : "Set a passcode"}
        </div>
        <div className="mt-2.5 grid gap-2">
          {lock.hasLock && (
            <input
              type="password"
              autoComplete="off"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Current passcode"
              aria-label="Current passcode"
              className="rounded-lg border border-[var(--nx-border)] bg-black/25 px-3 py-2 text-xs text-[var(--nx-text)] outline-none focus:border-[rgba(var(--nx-accent-rgb),0.5)]"
            />
          )}
          <input
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder={lock.hasLock ? "New passcode (min 4 chars)" : "New passcode (min 4 chars)"}
            aria-label="New passcode"
            className="rounded-lg border border-[var(--nx-border)] bg-black/25 px-3 py-2 text-xs text-[var(--nx-text)] outline-none focus:border-[rgba(var(--nx-accent-rgb),0.5)]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy || !next}
              onClick={() => void (lock.hasLock ? change() : enable())}
              className="rounded-lg bg-[var(--nx-accent)] px-3.5 py-1.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:opacity-40"
            >
              {lock.hasLock ? "Change passcode" : "Enable lock screen"}
            </button>
            {lock.hasLock && (
              <button
                disabled={busy || !current}
                onClick={() => void disable()}
                className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-1.5 text-xs text-red-300 transition hover:bg-red-500/20 disabled:opacity-40"
              >
                Remove lock
              </button>
            )}
          </div>
          {msg && (
            <p className={`text-[11.5px] ${msg.ok ? "text-emerald-400" : "text-rose-400"}`} role="status">
              {msg.text}
            </p>
          )}
        </div>
      </div>

      {/* audit log */}
      <h3 className="mb-2 mt-6 flex items-center justify-between text-[12px] font-semibold uppercase tracking-wide text-[var(--nx-text-dim)]">
        <span>Security audit trail</span>
        <button
          onClick={() => { void clearAudit().then(refreshLog); }}
          className="rounded-md px-2 py-1 text-[10px] normal-case text-[var(--nx-text-dim)] hover:bg-white/10 hover:text-[var(--nx-text)]"
        >
          Clear
        </button>
      </h3>
      <div className="max-h-64 overflow-y-auto rounded-xl border border-[var(--nx-border)] bg-black/20 p-2.5 nx-scroll" aria-live="polite">
        {log.length === 0 ? (
          <div className="px-1 py-3 text-center text-[11.5px] text-[var(--nx-text-dim)]">No events recorded yet.</div>
        ) : (
          log.map((e, i) => (
            <div key={`${e.ts}-${i}`} className="flex items-baseline gap-2 border-b border-white/5 py-1.5 text-[11.5px] last:border-0">
              <span className="shrink-0 tabular-nums text-[var(--nx-text-dim)]">{agoOf(e.ts)}</span>
              <span className={`shrink-0 font-mono ${e.event.includes("fail") || e.event.includes("violation") || e.event.includes("wipe") ? "text-amber-400" : "text-[var(--nx-accent)]"}`}>
                {e.event}
              </span>
              {e.detail && <span className="min-w-0 truncate text-[var(--nx-text-dim)]">{e.detail}</span>}
            </div>
          ))
        )}
      </div>

      {/* panic wipe */}
      <h3 className="mb-1 mt-6 text-[12px] font-semibold uppercase tracking-wide text-[var(--nx-text-dim)]">Panic wipe</h3>
      <div className="rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3.5">
        <p className="text-[11.5px] leading-relaxed text-[var(--nx-text-dim)]">
          Immediately erases <b className="text-red-300">everything</b> this app stores — files, settings,
          encrypted secrets, audit trail, caches — and reloads. There is no confirmation dialog beyond
          typing the phrase; there is no undo. Browsers may still keep residual copies in their storage
          engine internals until the profile itself is cleared.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <input
            value={wipePhrase}
            onChange={(e) => setWipePhrase(e.target.value)}
            placeholder='Type "ERASE ALL"'
            aria-label="Panic wipe confirmation phrase"
            className="w-44 rounded-lg border border-red-500/40 bg-black/30 px-3 py-2 font-mono text-xs text-red-200 outline-none focus:border-red-400"
          />
          <button
            disabled={wiping || wipePhrase !== "ERASE ALL"}
            onClick={() => void panicWipe()}
            className="rounded-lg bg-red-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-red-400 disabled:opacity-40"
          >
            {wiping ? "Erasing…" : "Erase everything"}
          </button>
        </div>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
        Honest limits: a browser app cannot protect data from the person using the device while the
        desktop is unlocked, and it cannot make storage survive a browser profile wipe. What this
        layer does: gate the UI, encrypt secrets at rest, sandbox all executed/previewed code,
        enforce a strict CSP and record who did what in the audit trail.
      </p>
    </section>
  );
}
