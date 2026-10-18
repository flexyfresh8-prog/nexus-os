"use client";

// NEXUS OS — Studio live preview pane.
//
// The preview document is assembled from the project's own files: index.html
// with local <link>/<script> references inlined. It is delivered to the iframe
// via the srcDoc prop — user content by design, which is exactly why the iframe
// is sandboxed WITHOUT allow-same-origin: previewed code must not be able to
// touch the parent app's DOM, localStorage, IndexedDB or cookies. It also never
// touches the app DOM itself (no innerHTML) — the browser sandbox renders it.

import { useState } from "react";
import { RotateCw, X } from "lucide-react";

export interface PreviewFile {
  /** path relative to the project root, e.g. "styles.css" or "css/main.css" */
  relPath: string;
  content: string;
}

interface RuntimePayload {
  source: "nexus-preview";
  kind: "error" | "log";
  message: string;
  /** studio window id — lets each window filter its own preview traffic */
  id?: string;
  line?: number;
  col?: number;
}

/** Runtime injected into the preview: forwards errors to the parent window. */
function runtimeScript(previewId: string): string {
  return [
    "(function () {",
    `  var PREVIEW_ID = ${JSON.stringify(previewId)};`,
    "  var sent = 0;",
    "  var MAX = 40;",
    "  function post(kind, message, line, col) {",
    "    if (sent >= MAX) return;",
    "    sent++;",
    "    try {",
    "      parent.postMessage({",
    "        source: 'nexus-preview',",
    "        kind: kind,",
    "        id: PREVIEW_ID,",
    "        message: String(message),",
    "        line: typeof line === 'number' ? line : undefined,",
    "        col: typeof col === 'number' ? col : undefined",
    "      }, '*');",
    "    } catch (e) { /* parent frame gone */ }",
    "  }",
    "  window.onerror = function (msg, src, line, col) {",
    "    post('error', msg, line, col);",
    "  };",
    "  window.addEventListener('unhandledrejection', function (e) {",
    "    var reason = e && e.reason ? String(e.reason) : 'unknown rejection';",
    "    post('error', 'Unhandled promise rejection: ' + reason);",
    "  });",
    "  var origError = console.error;",
    "  console.error = function () {",
    "    var parts = [];",
    "    for (var i = 0; i < arguments.length; i++) {",
    "      var a = arguments[i];",
    "      try { parts.push(typeof a === 'string' ? a : JSON.stringify(a)); }",
    "      catch (e) { parts.push(String(a)); }",
    "    }",
    "    post('error', parts.join(' '));",
    "    origError.apply(console, arguments);",
    "  };",
    "})();",
  ].join("\n");
}

function normalizeRel(p: string): string {
  let out = p.trim();
  while (out.startsWith("./")) out = out.slice(2);
  return out;
}

function isExternal(href: string): boolean {
  return (
    /^(https?:)?\/\//i.test(href) ||
    /^data:/i.test(href) ||
    href.startsWith("#") ||
    href.startsWith("/")
  );
}

/**
 * Build the preview document from project files.
 * - starts from index.html at the project root (returns null when absent)
 * - inlines local stylesheets and scripts, leaving external URLs untouched
 * - missing local assets are replaced by a warning comment
 * - previewId tags runtime error reports so multiple studio windows can filter
 */
export function buildPreviewDoc(files: PreviewFile[], previewId = ""): string | null {
  const byPath = new Map<string, string>();
  for (const f of files) byPath.set(normalizeRel(f.relPath), f.content);

  const html = byPath.get("index.html");
  if (html === undefined) return null;

  const lookup = (rawHref: string): string | undefined => {
    const href = rawHref.trim();
    if (!href || isExternal(href)) return undefined;
    // strip query/hash so "styles.css?v=2" still resolves
    const key = normalizeRel(href.split("?")[0].split("#")[0]);
    return byPath.get(key);
  };

  let doc = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const m = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m) return tag;
    const content = lookup(m[1]);
    if (content === undefined) {
      return `<!-- [nexus-preview] console warning: local stylesheet not found: ${m[1]} -->`;
    }
    // function form so "$&"-style sequences in user content stay literal
    return `<style>\n${content}\n</style>`;
  });

  doc = doc.replace(/<script\b([^>]*)>\s*<\/script>/gi, (tag, attrs: string) => {
    const m = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
    if (!m) return tag;
    const content = lookup(m[1]);
    if (content === undefined) {
      return `<!-- [nexus-preview] console warning: local script not found: ${m[1]} -->`;
    }
    return `<script>\n${content}\n</script>`;
  });

  // inject the error forwarder right after <head> (or prepend when absent)
  const runtimeTag = `<script>${runtimeScript(previewId)}</script>`;
  const head = doc.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    doc = doc.slice(0, at) + runtimeTag + doc.slice(at);
  } else {
    doc = runtimeTag + doc;
  }

  return doc;
}

export function isRuntimePayload(data: unknown): data is RuntimePayload {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Partial<RuntimePayload>;
  return d.source === "nexus-preview" && (d.kind === "error" || d.kind === "log");
}

// ---------------------------------------------------------------- component

interface PreviewPaneProps {
  /** stable srcDoc — only changes when a refresh actually happened */
  doc: string | null;
  onRefresh: () => void;
  onClose: () => void;
}

export default function PreviewPane({ doc, onRefresh, onClose }: PreviewPaneProps) {
  const [loadedDoc, setLoadedDoc] = useState<string | null>(null);
  const loaded = doc !== null && loadedDoc === doc;

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--nx-border)] bg-black/20 px-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nx-text-dim)]">
          Preview
        </span>
        {!loaded && doc !== null && (
          <span className="text-[10px] text-[var(--nx-text-dim)]">loading…</span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            title="Refresh preview"
            aria-label="Refresh preview"
            onClick={onRefresh}
            className="grid h-6 w-6 place-items-center rounded-md text-[var(--nx-text-dim)] transition-colors hover:bg-white/10 hover:text-[var(--nx-text)]"
          >
            <RotateCw size={12} />
          </button>
          <button
            title="Close preview"
            aria-label="Close preview"
            onClick={onClose}
            className="grid h-6 w-6 place-items-center rounded-md text-[var(--nx-text-dim)] transition-colors hover:bg-white/10 hover:text-[var(--nx-text)]"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {doc === null ? (
          <div className="grid h-full place-items-center bg-[#0d1017] p-6 text-center text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
            Add an{" "}
            <span className="mx-1 font-mono text-[var(--nx-text)]">index.html</span>{" "}
            at the project root to enable the live preview.
          </div>
        ) : (
          <>
            {/* sandbox intentionally omits allow-same-origin: user preview code
                must stay sealed off from the parent app's storage and DOM */}
            <iframe
              title="Live preview"
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              srcDoc={doc}
              className="h-full w-full border-0 bg-white"
              onLoad={() => setLoadedDoc(doc)}
            />
            {!loaded && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#0d1017]/70">
                <div className="h-5 w-5 rounded-full border-2 border-[rgba(var(--nx-accent-rgb),0.25)] border-t-[var(--nx-accent)] nx-spin" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
