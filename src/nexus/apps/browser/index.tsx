"use client";

// NEXUS OS — Browser app: an honest internal web viewer.
//
// Honesty rules baked into this file:
// - The history stack records only navigations NEXUS Browser initiates itself
//   (address bar, links we render, back/forward/reload/home). Clicks inside a
//   cross-origin iframe cannot be observed from the parent document, so they
//   never appear in history (see help popover).
// - Hosts known to send X-Frame-Options / CSP frame-ancestors are not loaded
//   at all; the user gets an explicit "this site blocks embedding" screen.
// - No fake page content is ever rendered. If the web refuses to load in a
//   frame, we say so and offer window.open in a real tab.

import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  HelpCircle,
  House,
  Lock,
  LockOpen,
  RotateCw,
  ShieldAlert,
  Star,
} from "lucide-react";
import type { AppInstanceProps, Bookmark, ContextMenuItem } from "../../types";
import { useOS } from "../../store/os";
import { useSettings } from "../../store/settings";
import HomePage from "./HomePage";
import { HOME_ENTRY, isKnownBlocked, resolveInput, resolveLaunchUrl, safeHostname } from "./lib";

interface HistoryState {
  /** Visited targets in order; HOME_ENTRY marks the internal home page. */
  entries: string[];
  /** Current position in entries. */
  idx: number;
}

interface ToolButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}

interface BookmarkChipProps {
  bookmark: Bookmark;
  onOpen: (url: string) => void;
  onContext: (e: ReactMouseEvent<HTMLButtonElement>, bookmark: Bookmark) => void;
}

interface BlockedScreenProps {
  url: string;
  onOpenExternal: () => void;
  onGoHome: () => void;
}

function ToolButton({ label, onClick, disabled = false, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--nx-text)] transition-colors ${
        disabled
          ? "cursor-not-allowed text-[var(--nx-text-dim)] opacity-30"
          : "hover:bg-[rgba(var(--nx-accent-rgb),0.12)] active:scale-95"
      }`}
    >
      {children}
    </button>
  );
}

function BookmarkChip({ bookmark, onOpen, onContext }: BookmarkChipProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(bookmark.url)}
      onContextMenu={(e) => onContext(e, bookmark)}
      title={bookmark.url}
      className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-transparent px-2.5 text-xs text-[var(--nx-text-dim)] transition-colors hover:border-[var(--nx-border)] hover:bg-[rgba(var(--nx-accent-rgb),0.1)] hover:text-[var(--nx-text)]"
    >
      <Globe size={12} className="shrink-0" />
      <span className="max-w-[140px] truncate">{safeHostname(bookmark.url) || bookmark.title}</span>
    </button>
  );
}

/** Indeterminate progress bar — reuses the global nx-shimmer keyframes. */
function LoadingBar() {
  return (
    <div className="h-0.5 w-full shrink-0 overflow-hidden">
      <div
        className="h-full w-full"
        style={{
          backgroundImage:
            "linear-gradient(90deg, transparent, rgba(var(--nx-accent-rgb),0.9), transparent)",
          backgroundSize: "400px 100%",
          backgroundRepeat: "no-repeat",
          animation: "nx-shimmer 1.1s linear infinite",
        }}
      />
    </div>
  );
}

function BlockedScreen({ url, onOpenExternal, onGoHome }: BlockedScreenProps) {
  return (
    <div className="nx-scroll grid h-full place-items-center overflow-y-auto p-6">
      <div className="nx-glass-strong nx-pop-in w-full max-w-md rounded-2xl p-7 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[rgba(var(--nx-accent-rgb),0.12)] text-[var(--nx-accent)]">
          <ShieldAlert size={26} />
        </div>
        <h2 className="mt-4 text-[15px] font-semibold text-[var(--nx-text)]">
          This site blocks embedding
        </h2>
        <p className="mt-1.5 truncate font-mono text-[12px] text-[var(--nx-accent)]" title={url}>
          {safeHostname(url)}
        </p>
        <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--nx-text-dim)]">
          {safeHostname(url)} sends security headers (X-Frame-Options or CSP frame-ancestors) that
          forbid being displayed inside another page. NEXUS Browser will not pretend to render it —
          open it in a real tab instead.
        </p>
        <div className="mt-5 flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onOpenExternal}
            className="nx-accent-glow flex h-10 items-center gap-2 rounded-full bg-[var(--nx-accent)] px-6 text-[13px] font-semibold text-[#0b0f14] transition-transform hover:scale-[1.03] active:scale-95"
          >
            <ExternalLink size={15} />
            Open in New Tab
          </button>
          <button
            type="button"
            onClick={onGoHome}
            className="h-9 rounded-full px-4 text-[12.5px] text-[var(--nx-text-dim)] transition-colors hover:bg-[rgba(127,127,160,0.15)] hover:text-[var(--nx-text)]"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BrowserApp({ launchProps, setTitle }: AppInstanceProps) {
  const openCtx = useOS((s) => s.openCtx);
  const notify = useOS((s) => s.notify);
  const bookmarks = useSettings((s) => s.bookmarks);
  const addBookmark = useSettings((s) => s.addBookmark);
  const removeBookmark = useSettings((s) => s.removeBookmark);

  // launchProps: { url?: string } — open directly on a target page.
  const initialUrl = resolveLaunchUrl(launchProps?.url);
  const [history, setHistory] = useState<HistoryState>(() =>
    initialUrl ? { entries: [initialUrl], idx: 0 } : { entries: [HOME_ENTRY], idx: 0 }
  );
  const [input, setInput] = useState(initialUrl ?? "");
  const [loading, setLoading] = useState(initialUrl !== null && !isKnownBlocked(initialUrl));
  const [reloadKey, setReloadKey] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);

  const current = history.entries[history.idx] ?? HOME_ENTRY;
  const atHome = current === HOME_ENTRY;
  const blocked = !atHome && isKnownBlocked(current);
  const canBack = history.idx > 0;
  const canForward = history.idx < history.entries.length - 1;
  const currentBookmark = atHome ? undefined : bookmarks.find((b) => b.url === current);

  // Reflect the current target in the window chrome (hostname is the most
  // honest title we have — cross-origin document.title is unreadable).
  useEffect(() => {
    setTitle(atHome ? "Home" : safeHostname(current));
  }, [setTitle, atHome, current]);

  const pushEntry = useCallback((entry: string) => {
    setHistory((h) => {
      if (h.entries[h.idx] === entry) return h;
      const entries = h.entries.slice(0, h.idx + 1);
      entries.push(entry);
      return { entries, idx: entries.length - 1 };
    });
  }, []);

  const goHome = useCallback(() => {
    setInput("");
    setLoading(false);
    pushEntry(HOME_ENTRY);
  }, [pushEntry]);

  const navigate = useCallback(
    (raw: string) => {
      const resolved = resolveInput(raw);
      if (!resolved) return;
      if (resolved === HOME_ENTRY) {
        goHome();
        return;
      }
      setInput(resolved);
      setLoading(true);
      if (history.entries[history.idx] === resolved) {
        setReloadKey((k) => k + 1); // same target → refresh in place
        return;
      }
      pushEntry(resolved);
    },
    [goHome, history, pushEntry]
  );

  const goToIndex = useCallback(
    (idx: number) => {
      const target = history.entries[idx];
      if (target === undefined) return;
      setHistory({ entries: history.entries, idx });
      setInput(target === HOME_ENTRY ? "" : target);
      setLoading(target !== HOME_ENTRY);
    },
    [history]
  );

  const goBack = useCallback(() => {
    if (history.idx > 0) goToIndex(history.idx - 1);
  }, [goToIndex, history]);

  const goForward = useCallback(() => {
    if (history.idx < history.entries.length - 1) goToIndex(history.idx + 1);
  }, [goToIndex, history]);

  const reload = useCallback(() => {
    if (atHome) return;
    setLoading(true);
    setReloadKey((k) => k + 1); // remounts the iframe → it re-navigates
  }, [atHome]);

  const openExternal = useCallback(() => {
    if (atHome) {
      notify({
        title: "Browser",
        body: "No page is open yet — enter an address or pick a link first.",
        appId: "browser",
      });
      return;
    }
    window.open(current, "_blank", "noopener,noreferrer");
  }, [atHome, current, notify]);

  const toggleBookmark = useCallback(() => {
    if (atHome) return;
    if (currentBookmark) {
      removeBookmark(currentBookmark.id);
    } else {
      addBookmark(safeHostname(current), current);
    }
  }, [addBookmark, atHome, current, currentBookmark, removeBookmark]);

  const openChipMenu = useCallback(
    (e: ReactMouseEvent<HTMLButtonElement>, b: Bookmark) => {
      e.preventDefault();
      const items: ContextMenuItem[] = [
        { label: "Remove bookmark", danger: true, onClick: () => removeBookmark(b.id) },
      ];
      openCtx(e.clientX, e.clientY, items);
    },
    [openCtx, removeBookmark]
  );

  const onUrlChange = (e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value);
  const onUrlSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    navigate(input);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── toolbar ─────────────────────────────────────────────── */}
      <div className="relative flex h-12 shrink-0 items-center gap-1 border-b border-[var(--nx-border)] bg-[rgba(127,127,160,0.05)] px-2">
        <ToolButton label="Back" onClick={goBack} disabled={!canBack}>
          <ArrowLeft size={16} />
        </ToolButton>
        <ToolButton label="Forward" onClick={goForward} disabled={!canForward}>
          <ArrowRight size={16} />
        </ToolButton>
        <ToolButton label="Reload" onClick={reload} disabled={atHome}>
          <RotateCw size={14} />
        </ToolButton>
        <ToolButton label="Home" onClick={goHome} disabled={atHome}>
          <House size={16} />
        </ToolButton>

        {/* address bar */}
        <form
          onSubmit={onUrlSubmit}
          className="mx-1.5 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full border border-[var(--nx-border)] bg-[rgba(127,127,160,0.1)] px-3.5 transition-colors focus-within:border-[rgba(var(--nx-accent-rgb),0.55)] focus-within:bg-[rgba(var(--nx-accent-rgb),0.06)]"
        >
          {atHome ? (
            <House size={13} className="shrink-0 text-[var(--nx-text-dim)]" />
          ) : current.startsWith("https://") ? (
            <Lock size={13} className="shrink-0 text-[rgba(var(--nx-accent-rgb),0.8)]" />
          ) : (
            <LockOpen size={13} className="shrink-0 text-amber-400/90" />
          )}
          <input
            value={input}
            onChange={onUrlChange}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Search the web or enter an address"
            spellCheck={false}
            autoComplete="off"
            aria-label="Address and search bar"
            className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-[var(--nx-text)] outline-none placeholder:font-sans placeholder:text-[var(--nx-text-dim)]"
          />
          <button
            type="button"
            onClick={toggleBookmark}
            disabled={atHome}
            title={currentBookmark ? "Remove bookmark" : "Bookmark this page"}
            aria-label={currentBookmark ? "Remove bookmark" : "Bookmark this page"}
            className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${
              atHome
                ? "cursor-not-allowed text-[var(--nx-text-dim)] opacity-30"
                : currentBookmark
                  ? "text-[var(--nx-accent)] hover:bg-[rgba(var(--nx-accent-rgb),0.15)]"
                  : "text-[var(--nx-text-dim)] hover:bg-[rgba(127,127,160,0.18)] hover:text-[var(--nx-text)]"
            }`}
          >
            <Star size={15} className={currentBookmark ? "fill-current" : undefined} />
          </button>
        </form>

        <ToolButton label="About NEXUS Browser" onClick={() => setHelpOpen((v) => !v)}>
          <HelpCircle size={16} />
        </ToolButton>
        <ToolButton label="Open in New Tab" onClick={openExternal}>
          <ExternalLink size={15} />
        </ToolButton>

        {helpOpen && (
          <>
            <div
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setHelpOpen(false)}
              aria-hidden="true"
            />
            <div className="nx-glass-strong nx-pop-in absolute right-2 top-[calc(100%+6px)] z-50 w-80 rounded-xl p-4 shadow-2xl">
              <p className="text-[12px] font-medium text-[var(--nx-text)]">
                NEXUS Browser tracks its own navigation history only
              </p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--nx-text-dim)]">
                Clicks inside embedded pages are cross-origin and cannot be observed from the
                desktop, so they never appear in Back/Forward. Sites that send X-Frame-Options or
                CSP frame-ancestors are refused up front — use Open in New Tab for those.
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── bookmarks bar (only when bookmarks exist) ───────────── */}
      {bookmarks.length > 0 && (
        <div className="nx-scroll flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-[var(--nx-border)] px-2">
          {bookmarks.map((b) => (
            <BookmarkChip key={b.id} bookmark={b} onOpen={navigate} onContext={openChipMenu} />
          ))}
        </div>
      )}

      {/* ── content ─────────────────────────────────────────────── */}
      {atHome ? (
        <HomePage onNavigate={navigate} />
      ) : blocked ? (
        <BlockedScreen url={current} onOpenExternal={openExternal} onGoHome={goHome} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* persistent honest banner */}
          <div className="flex h-7 shrink-0 items-center justify-center gap-1.5 border-b border-[var(--nx-border)] bg-[rgba(127,127,160,0.07)] px-3 text-[11px] text-[var(--nx-text-dim)]">
            <span className="truncate">
              Page blank or refusing to load? Many sites disallow embedding —
            </span>
            <button
              type="button"
              onClick={openExternal}
              className="shrink-0 font-medium text-[var(--nx-accent)] hover:underline"
            >
              Open in New Tab
            </button>
          </div>
          {loading && <LoadingBar />}
          <div className="relative min-h-0 flex-1">
            {/*
              Security note: allow-same-origin + allow-scripts together let the
              framed document keep ITS OWN origin (most sites need that to
              function at all). Because every URL loaded here is cross-origin
              relative to NEXUS OS, the frame still cannot read or mutate the
              parent desktop — the same-origin policy that matters applies to
              the framed site, not to us. We never load same-origin documents
              in this frame, and src is always a resolved http(s) URL rendered
              via React (never user HTML injected into the document).
            */}
            <iframe
              key={`page-${reloadKey}-${current}`}
              src={current}
              title={safeHostname(current)}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              className="h-full w-full bg-white"
              onLoad={() => setLoading(false)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
