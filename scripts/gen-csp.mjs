#!/usr/bin/env node
// NEXUS OS — build-time CSP generator for the static (GitHub Pages) export.
//
// A meta-tag CSP is the only CSP a static host can deliver. This script:
//   1. scans out/**/*.html (skipping the CSP-free preview shell)
//   2. hashes every inline <script> body it finds (theme bootstrap,
//      Next's flight-data chunks — anything without a src attribute)
//   3. injects/updates <meta http-equiv="Content-Security-Policy"> with
//      the page-specific hash list
//
// Result: a strict policy that allows exactly the scripts present at build
// time — and nothing else. Run after `next build` (static export → out/).

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";

const OUT_DIR = process.argv[2] || "out";
const BASE_PATH = process.env.NX_BASE_PATH || ""; // e.g. "/nexus-os"

// ------------------------------------------------------------------ policy

function policyFor(hashes) {
  const scriptSrc = [
    "'self'",
    // Monaco is loaded from the jsDelivr CDN by @monaco-editor/react
    "https://cdn.jsdelivr.net",
    // Blob-constructed Web Worker (NEXUS worker runtime) + WASM (WebContainers)
    "blob:",
    "'wasm-unsafe-eval'",
    ...hashes,
  ].join(" ");

  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Next inlines critical CSS + sets style attributes (framer-motion);
    // Monaco injects its editor stylesheet from the CDN at runtime
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // BYOK AI endpoints, WebContainer supervisor, local dev servers
    "connect-src 'self' https: wss: ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
    // NEXUS Browser (external sites) + live preview shell + dev servers
    "frame-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // NOTE: no upgrade-insecure-requests — it would rewrite http://localhost
    // dev-server preview frames to https and break them.
    // NOTE: frame-ancestors is ignored inside <meta> — a best-effort JS
    // framebuster runs at boot instead (see NexusOS.tsx).
  ];
  return directives.join("; ");
}

// ------------------------------------------------------------------ helpers

function listHtmlFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".html")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const INLINE_SCRIPT_RE = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
const META_CSP_RE = /<meta\s+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi;
const HEAD_OPEN_RE = /<head[^>]*>/i;

function sha256(body) {
  return "'sha256-" + createHash("sha256").update(body, "utf8").digest("base64") + "'";
}

// -------------------------------------------------------------------- main

const files = listHtmlFiles(OUT_DIR);
let injected = 0;
let skipped = 0;
const problems = [];

for (const file of files) {
  const rel = relative(OUT_DIR, file).split(sep).join("/");
  // The preview shell must stay CSP-free so sandboxed user code can run.
  if (rel.endsWith("preview-shell.html")) {
    skipped++;
    continue;
  }

  let html = readFileSync(file, "utf8");

  // hash every inline script body (exact bytes — the hash must match
  // what the browser sees as the element's text content)
  const hashes = [];
  for (const m of html.matchAll(INLINE_SCRIPT_RE)) {
    const body = m[1];
    if (body.trim().length === 0) continue;
    hashes.push(sha256(body));
  }

  if (hashes.length === 0) {
    problems.push(`${rel}: no inline scripts found — CSP not injected`);
    continue;
  }

  const meta = `<meta http-equiv="Content-Security-Policy" content="${policyFor(hashes).replace(/"/g, "&quot;")}">`;

  // replace an existing meta CSP (idempotent re-runs) or insert after <head>
  if (META_CSP_RE.test(html)) {
    html = html.replace(META_CSP_RE, meta);
  } else {
    const head = html.match(HEAD_OPEN_RE);
    if (!head) {
      problems.push(`${rel}: no <head> found`);
      continue;
    }
    const at = head.index + head[0].length;
    html = html.slice(0, at) + "\n  " + meta + html.slice(at);
  }

  writeFileSync(file, html);
  injected++;
  console.log(`[gen-csp] ${rel}: ${hashes.length} inline script hash(es)`);
}

console.log(`[gen-csp] done — ${injected} file(s) protected, ${skipped} skipped (preview shell)`);
if (problems.length) {
  for (const p of problems) console.warn(`[gen-csp] WARN: ${p}`);
}
