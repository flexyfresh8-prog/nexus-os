# NEXUS OS — Security Model

This document describes, honestly, what NEXUS OS protects, what it cannot
protect, and how each layer works. No security theater: every control listed
here is implemented and verified by tests (unit + end-to-end in real browsers).

## Architecture overview

NEXUS OS is a browser application. Everything it "is" — the desktop, the
filesystem, the terminal, the IDE, the AI agent — lives inside a single web
origin. Security is therefore organized as concentric boundaries:

```
┌──────────────────────────────────────────────────────────────┐
│  Browser profile (OS-level trust boundary)                   │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  NEXUS OS origin (CSP-locked, lock-screen gated)       │  │
│  │  ┌──────────────────┐  ┌────────────────────────────┐  │  │
│  │  │ Preview frames    │  │ JS worker sandbox          │  │  │
│  │  │ opaque origin,    │  │ no DOM, no storage,        │  │  │
│  │  │ no storage/DOM    │  │ timeout + terminate        │  │  │
│  │  └──────────────────┘  └────────────────────────────┘  │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ WebContainer Node runtime (vendor-isolated VM)   │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## What is protected, and how

### 1. Content-Security-Policy (anti-XSS backbone)

The app shell ships a strict CSP in both deployment modes:

- **Static hosting (GitHub Pages)** — `scripts/gen-csp.mjs` runs after the
  export, hashes every inline `<script>` body in each emitted HTML file, and
  injects a per-page `<meta http-equiv="Content-Security-Policy">` listing
  exactly those hashes. Nothing else executes.
- **Server hosting (standalone)** — `src/middleware.ts` issues a per-request
  nonce CSP (`script-src 'nonce-…' 'strict-dynamic'`) plus
  `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and a
  restrictive `Permissions-Policy` (camera/microphone/geolocation denied).

Policy details that matter:

- `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
- `script-src` allows only `'self'`, the Monaco CDN host, blob workers and
  WASM (both required by the WebContainer Node runtime).
- There is **no** `upgrade-insecure-requests` — it would rewrite local
  dev-server preview frames to https and break them.
- CSP violations raise `securitypolicyviolation` events, which are recorded
  in the audit trail (visible in Settings → Security and System Monitor).

**Verified:** previewed user code, Monaco, the terminal engine, the lock
screen and the worker runtime all function with zero violations; injected
inline scripts are blocked (unit-verified in a controlled harness).

### 2. Why the live preview is a real file (not srcDoc)

A parent's CSP is **inherited** by `srcdoc` documents — a strict policy would
block every inline `<script>` in user preview code. Measured behavior:

| iframe source                        | parent CSP applied? |
| ------------------------------------ | ------------------- |
| `srcdoc`                             | yes (inherited)     |
| Blob URL                             | yes (inherited)     |
| SW-synthesized response              | yes (inherited)     |
| **real network response, no CSP**    | **no — own policy** |

So `public/preview-shell.html` is served as a plain static file and the
preview document is delivered to it with `postMessage`. The frame is
sandboxed **without `allow-same-origin`** — the rendered document runs with
an opaque origin and cannot touch the app's DOM, IndexedDB, localStorage or
cookies. Every inbound message is validated against
`e.source === iframe.contentWindow` and its payload shape; the shell ignores
oversized (>5 MB) or malformed payloads.

On server deployments the shell additionally carries a
`Cross-Origin-Embedder-Policy: credentialless` header (and nothing else):
under a COEP parent, an embedded document without its own COEP header fails
the embedding check and renders empty. No CSP on the shell — that is the
mechanism that keeps user preview code executable while the app stays locked.

### 3. Execution sandboxes

- **JS worker runtime** — user JavaScript executes inside a Blob-constructed
  Web Worker: no DOM, no parent state, no storage access, hard timeout with
  `terminate()`. Output is forwarded as plain strings (never HTML).
- **NEXUS shell** — pure TypeScript command engine over the virtual
  filesystem. No `eval`, no `new Function`; arguments are tokenizer-parsed.
- **WebContainer (Node.js)** — vendor-isolated runtime (StackBlitz); its
  processes are killable from the process registry and never receive NEXUS
  state. Files are copied in through an explicit whitelist that skips
  `node_modules`, `.git` and oversized binaries.
- **AI tool calls** — validated against explicit schemas; filesystem tools
  are sandboxed to `/home/Projects` and `/home/Documents`; `.`/`..` segments
  are rejected; dangerous operations require user approval (risk levels
  `read` / `write` / `danger`).

### 4. Secrets at rest (AES-GCM)

- BYOK AI provider keys are sealed with AES-GCM-256 using a per-installation
  random device key before touching IndexedDB (`secret:` KV prefix).
- Legacy plaintext configs are migrated to encrypted storage and deleted.
- Backups and exports **exclude** all `secret:` entries by design.
- The lock-screen verifier is a random token sealed under the user's
  passcode (PBKDF2-HMAC-SHA256, 600 000 iterations, per-seal salt). The
  passcode itself is never stored anywhere; a wrong passcode fails AES-GCM
  authentication.
- Unlock attempts back off exponentially (15 s → 1 min → 5 min).
- The audit trail, settings and AI history contain no secrets; log lines pass
  through a redactor that masks `ghp_…`, `github_pat_…`, `sk-…`, `Bearer …`,
  `x-api-key: …` patterns.

### 5. Lock screen

- Boot with an enabled lock always starts locked (reload cannot bypass it).
- Idle auto-lock (off/1/5/15/60 min), dock button, and `Ctrl/⌘+Alt+L`.
- While locked, a full-viewport overlay covers the desktop; the desktop is
  blurred beneath it. State is preserved — it is a gate, not a logout.

### 6. Import / export hardening

Backup imports pass `sanitizeImportedFS()` before touching storage:

- `__proto__` / `constructor` / `prototype` keys stripped (no prototype
  pollution via crafted backup files),
- name validation (no separators, control characters, oversized names),
- phantom files dropped (neither text nor binary content),
- caps: 20 000 nodes, 64 MB per binary blob, 256 MB total payload,
- root-node requirement, version cap on the backup format,
- `secret:` KV entries never imported.

Exports are audited (`backup:export`) and contain no secrets.

### 7. Browser app (embedded web)

- `javascript:` / `data:` / custom-scheme input is converted into a search
  query — never executed or loaded.
- URLs pointing at the app's **own origin** are refused: combined with
  `allow-same-origin` in the sandbox they would constitute a full sandbox
  escape; there is nothing useful to browse there anyway.
- Frames carry `referrerPolicy="no-referrer"`; external opens use
  `window.open(…, "noopener,noreferrer")`.

### 8. AI backend route (server deployments)

`/api/ai/chat` never exposes provider credentials (the model key stays
server-side). Hardening: per-IP token-bucket rate limiting (burst 12,
refill 6/min), 400 KB body cap, zod schema validation of every message and
tool-call shape, bounded message counts. Statically hosted builds return an
honest 501 and the client falls back to BYOK.

### 9. Audit trail

Ring-buffered (200 entries), persisted, surfaced in Settings → Security and
System Monitor: boots, lock/unlock, failed unlock attempts, passcode
changes, panic wipes, backup export/import, secret events, CSP violations,
and blocked same-origin embeds.

### 10. Supply chain

- Unused dependencies with advisories were removed outright (`next-auth`,
  `uuid`, `prisma`, `@prisma/client` were installed but never imported).
- Direct dependencies pinned to patched releases (`next`, `sharp`).
- Same-major `overrides` for transitive advisories (`lodash`, `postcss`,
  `js-yaml`, `source-map-js`).
- `bun.lock` is committed; CI installs with `--frozen-lockfile`.
- Known residual advisories (transitive, fix requires breaking major bumps
  in unrelated packages — e.g. `picomatch`, `nanoid` consumers) are accepted
  and tracked; none are reachable from untrusted input paths in this app.

## What this CANNOT protect against (honest limits)

1. **An attacker who can run JavaScript on the page while it is unlocked.**
   No browser app can defend against active script execution inside its own
   origin. That is why the layers above concentrate on making that impossible:
   strict CSP, no unsafe sinks, React escaping, sandboxed frames/workers.
2. **The device owner.** A person with access to the unlocked browser profile
   can read anything the app can read. The lock screen gates the UI, not the
   operating system underneath it.
3. **Browser storage persistence.** All data lives in IndexedDB/localStorage.
   Clearing browser data, evicted quotas or profile deletion erase it. Backups
   exist because of this — not because storage is durable.
4. **WebContainer workloads.** Code you run in the Node runtime can do
   anything WebContainers allow in their VM; it is isolated from NEXUS state
   by the vendor's boundary, not by this codebase.
5. **Clickjacking on static hosting.** `frame-ancestors` requires response
   headers; GitHub Pages cannot set them. A best-effort JS framebuster runs
   at boot instead. Server deployments send real headers.
6. **Side channels** (timing, cache probing across origins from embedded
   sites) — outside the reach of an application-level model.

## Reporting

Please open a GitHub issue for anything you believe is exploitable. Include
reproduction steps; reports with working PoCs get priority.
