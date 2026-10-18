"use client";

// NEXUS OS — Browser home page. Rendered natively by the desktop (no iframe):
// wordmark, web search box, curated quick links, the user's bookmarks and an
// honest explanation of embedding limits.

import { useState } from "react";
import type { FormEvent } from "react";
import { BookOpen, Compass, Globe, Newspaper, Package, Search, ShieldAlert, Star } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Bookmark } from "../../types";
import { useSettings } from "../../store/settings";
import { safeHostname } from "./lib";

interface QuickLink {
  label: string;
  url: string;
  hint: string;
  Icon: LucideIcon;
}

const QUICK_LINKS: QuickLink[] = [
  { label: "Wikipedia", url: "https://www.wikipedia.org", hint: "wikipedia.org", Icon: Globe },
  { label: "DuckDuckGo", url: "https://duckduckgo.com", hint: "duckduckgo.com", Icon: Search },
  {
    label: "MDN Web Docs",
    url: "https://developer.mozilla.org",
    hint: "developer.mozilla.org",
    Icon: BookOpen,
  },
  {
    label: "Hacker News",
    url: "https://news.ycombinator.com",
    hint: "news.ycombinator.com",
    Icon: Newspaper,
  },
  { label: "Example.com", url: "https://example.com", hint: "example.com", Icon: Package },
  { label: "Bing", url: "https://www.bing.com", hint: "bing.com", Icon: Compass },
];

function QuickLinkCard({ link, onOpen }: { link: QuickLink; onOpen: (url: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(link.url)}
      title={link.url}
      className="flex items-center gap-2.5 rounded-xl border border-[var(--nx-border)] bg-[rgba(127,127,160,0.08)] p-3 text-left transition-colors hover:border-[rgba(var(--nx-accent-rgb),0.45)] hover:bg-[rgba(var(--nx-accent-rgb),0.1)]"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[rgba(var(--nx-accent-rgb),0.12)] text-[var(--nx-accent)]">
        <link.Icon size={15} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-[var(--nx-text)]">
          {link.label}
        </span>
        <span className="block truncate text-[11px] text-[var(--nx-text-dim)]">{link.hint}</span>
      </span>
    </button>
  );
}

function HomeBookmarkChip({
  bookmark,
  onOpen,
}: {
  bookmark: Bookmark;
  onOpen: (url: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(bookmark.url)}
      title={bookmark.url}
      className="flex h-8 items-center gap-1.5 rounded-full border border-[var(--nx-border)] bg-[rgba(127,127,160,0.08)] px-3 text-xs text-[var(--nx-text-dim)] transition-colors hover:border-[rgba(var(--nx-accent-rgb),0.45)] hover:bg-[rgba(var(--nx-accent-rgb),0.1)] hover:text-[var(--nx-text)]"
    >
      <Globe size={12} className="shrink-0" />
      <span className="max-w-[160px] truncate">{safeHostname(bookmark.url) || bookmark.title}</span>
    </button>
  );
}

export default function HomePage({ onNavigate }: { onNavigate: (url: string) => void }) {
  const bookmarks = useSettings((s) => s.bookmarks);
  const [query, setQuery] = useState("");

  const submitSearch = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    // Raw input on purpose — the browser resolves it (domain → https, text → search).
    onNavigate(q);
  };

  return (
    <div className="nx-scroll flex h-full flex-col items-center gap-8 overflow-y-auto px-6 py-9">
      {/* wordmark */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-2.5">
          <span className="text-[34px] font-bold leading-none tracking-[0.3em] text-[var(--nx-text)]">
            NEXUS
          </span>
          <span className="h-2 w-2 rounded-full bg-[var(--nx-accent)] nx-accent-glow" />
        </div>
        <p className="mt-2.5 text-[10px] uppercase tracking-[0.45em] text-[var(--nx-text-dim)]">
          Browser
        </p>
      </div>

      {/* search */}
      <form onSubmit={submitSearch} className="w-full max-w-xl">
        <div className="flex h-12 items-center gap-3 rounded-full border border-[var(--nx-border)] bg-[rgba(127,127,160,0.1)] px-5 transition-colors focus-within:border-[rgba(var(--nx-accent-rgb),0.55)] focus-within:bg-[rgba(var(--nx-accent-rgb),0.06)]">
          <Search size={17} className="shrink-0 text-[var(--nx-text-dim)]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the web or enter an address"
            spellCheck={false}
            autoComplete="off"
            autoFocus
            aria-label="Search the web or enter an address"
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-[var(--nx-text)] outline-none placeholder:text-[var(--nx-text-dim)]"
          />
        </div>
        <p className="mt-2 text-center text-[11px] text-[var(--nx-text-dim)]">
          Web search runs on DuckDuckGo
        </p>
      </form>

      {/* quick links */}
      <section className="w-full max-w-xl">
        <h2 className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--nx-text-dim)]">
          Quick Links
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {QUICK_LINKS.map((link) => (
            <QuickLinkCard key={link.url} link={link} onOpen={onNavigate} />
          ))}
        </div>
      </section>

      {/* bookmarks */}
      {bookmarks.length > 0 && (
        <section className="w-full max-w-xl">
          <h2 className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--nx-text-dim)]">
            <Star size={11} /> Bookmarks
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {bookmarks.map((b) => (
              <HomeBookmarkChip key={b.id} bookmark={b} onOpen={onNavigate} />
            ))}
          </div>
        </section>
      )}

      {/* honest limits panel */}
      <section className="w-full max-w-xl rounded-xl border border-[var(--nx-border)] bg-[rgba(127,127,160,0.07)] p-4">
        <div className="flex items-start gap-2.5">
          <ShieldAlert size={15} className="mt-0.5 shrink-0 text-[var(--nx-accent)]" />
          <p className="text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
            Some websites (Google, YouTube, GitHub, X…) send security headers (X-Frame-Options /
            CSP frame-ancestors) that prohibit embedding. When a page refuses to render, use{" "}
            <span className="font-medium text-[var(--nx-text)]">Open in New Tab</span>. NEXUS
            Browser never fakes content it cannot display.
          </p>
        </div>
      </section>
    </div>
  );
}
