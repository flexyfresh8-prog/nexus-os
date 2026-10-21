"use client";

// NEXUS OS — Studio live preview pane.
//
// Security architecture (verified empirically — see SECURITY.md):
//
//   1. The preview document is assembled from the project's own files
//      (index.html with local <link>/<script> references inlined). It is
//      USER code by design.
//
//   2. It is delivered to `preview-shell.html` — a static, CSP-free shell
//      page — inside an iframe sandboxed WITHOUT allow-same-origin. The
//      rendered document therefore has an opaque origin: it cannot touch
//      the parent app's DOM, localStorage, IndexedDB, cookies, or windows.
//
//   3. Why not srcDoc? A parent CSP is inherited by srcdoc documents and
//      would block every inline <script> in user preview code. A real
//      network response carries its own (empty) policy instead — strict CSP
//      on the app, free execution inside the sealed sandbox.
//
//   4. Every postMessage from the frame is validated against
//      `e.source === iframe.contentWindow` AND its payload shape — nothing
//      else in the page can spoof preview errors.

import { useCallback, useEffect, useRef, useState } from "react";
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
  /** stable doc — only changes when a refresh actually happened */
  doc: string | null;
  /** forwarded validated preview errors (already bound to this window id) */
  onError?: (message: string, line?: number, col?: number) => void;
  onRefresh: () => void;
  onClose: () => void;
}

/** URL of the static shell page, correct under any basePath. */
function shellUrl(): string {
  try {
    return new URL("preview-shell.html", document.baseURI).toString();
  } catch {
    return "/preview-shell.html";
  }
}

export default function PreviewPane({ doc, onError, onRefresh, onClose }: PreviewPaneProps) {
  const [ready, setReady] = useState(false); // shell signalled ready
  const [rendered, setRendered] = useState(false); // current doc written
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const docRef = useRef<string | null>(null);
  const sentRef = useRef<string | null>(null);
  const shell = useRef<string>(shellUrl());

  const send = useCallback((html: string) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    sentRef.current = html;
    win.postMessage({ __nexusPreview: true, id: "", html }, "*");
  }, []);

  // handshake: only THIS pane's frame can talk to us. Every message is
  // double-checked against e.source and the payload shape.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data as { source?: string; kind?: string } | null;
      if (!d || typeof d !== "object") return;

      if (d.source === "nexus-preview-shell") {
        if (d.kind === "ready") {
          setReady(true);
          // re-announced ready → resend only if this exact doc never arrived
          if (docRef.current && docRef.current !== sentRef.current) {
            send(docRef.current);
          }
        } else if (d.kind === "wrote") {
          setRendered(true);
        } else if (d.kind === "error") {
          onError?.(String((d as { message?: unknown }).message ?? "preview shell error"));
        }
        return;
      }

      if (isRuntimePayload(d) && d.kind === "error") {
        if (d.message) onError?.(d.message, d.line, d.col);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onError, send]);

  // doc changed → remember it; send immediately when the shell is already ready
  // (sentRef guard prevents double-write when both this effect and the
  // handshake listener react to the same state change)
  useEffect(() => {
    docRef.current = doc;
    if (doc !== sentRef.current) setRendered(false);
    if (ready && doc && doc !== sentRef.current) send(doc);
  }, [doc, ready, send]);

  // NOTE: no setRendered(false) on iframe load — the shell's load event can
  // legitimately fire after the doc was already written and would clobber
  // the "rendered" state, wedging the loading indicator on. Doc changes
  // already reset it in the effect above.

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--nx-border)] bg-black/20 px-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--nx-text-dim)]">
          Preview
        </span>
        {!rendered && doc !== null && (
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
            {/* sandbox intentionally omits allow-same-origin: previewed code
                must stay sealed off from the parent app's storage and DOM */}
            <iframe
              ref={iframeRef}
              title="Live preview"
              sandbox="allow-scripts allow-forms allow-modals allow-popups"
              src={shell.current}
              referrerPolicy="no-referrer"
              className="h-full w-full border-0 bg-white"
              onLoad={() => { /* shell handshake handled via postMessage */ }}
            />
            {!rendered && (
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
