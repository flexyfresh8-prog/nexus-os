# NEXUS OS 3.0

A premium, fully functional **virtual computer in the browser** — a desktop OS with a real window manager, three genuine execution environments, a persistent virtual filesystem, real Git, an AI agent that operates the system through approved tools, and a full application suite. Not a mockup: every visible control does something real.

**Live demo:** `https://flexyfresh8-prog.github.io/nexus-os/` (deployed via GitHub Actions on every push to `main`)

![NEXUS OS](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8)

---

## Three real execution environments

Every command in NEXUS runs somewhere real, and the UI always shows you where:

| Environment | What it is | Availability |
|---|---|---|
| **NEXUS sh** | A pure-TypeScript shell operating on the IndexedDB-backed virtual filesystem. Quote-aware tokenizer, `&&`/`;` chaining, tab completion — **no `eval`, no `Function`** | Always |
| **JS Worker** | User JavaScript compiled and executed inside a dedicated **Web Worker** — no DOM, no NEXUS state, timeout-protected | Always |
| **Node.js (WebContainer)** | A real Node.js + npm runtime via StackBlitz **WebContainers**. `npm install` hits the real registry; dev servers become reachable via `localhost` | Requires cross-origin isolation (this deployment ships COOP/COEP headers); open NEXUS in its own browser tab |

When the Node runtime isn't available, NEXUS says so honestly and everything else keeps working.

## What actually works

### Desktop shell
- **Window manager** — drag, 8-direction resize, minimize/maximize/restore/close, focus + z-order, edge snapping, cascade placement, session restore across reloads. Pointer Events throughout (mouse + touch); windows can never be stranded off-screen.
- **Workspaces** — four presets (**Coding**, **AI Research**, **Terminal**, **General**) that arrange *real* windows, plus named saved sessions (snapshot + restore layouts from Settings → Workspaces).
- **Dock & tray** — launchers, running indicators, magnification, notification center, clock/calendar, global search entry.
- **Spotlight** (`Ctrl/⌘+K`) — fuzzy search across apps, files, folders, settings, and workspace presets; routes files to the app that handles them best.
- **Keyboard** — `Ctrl+K` search, `` Ctrl+` `` terminal, `Alt+Tab` switching, `Alt+W/M`, `Alt+←/→/↑` snapping, `Ctrl+T` new terminal tab.

### Applications (all functional)
| App | Highlights |
|---|---|
| **Terminal** | Multi-tab sessions with per-tab cwd + execution environment, ANSI-colored output, exit codes, history. Commands: full VFS suite (`ls/cd/mkdir/touch/cat/write/rm/cp/mv/find/search/tree/df/…`), plus `env`, `js`, `node`, `npm`, `ps`, `kill`, `git`, `workspaces`, `notify`. Unknown commands fail honestly |
| **Files** | Nested navigation, create/rename/copy/move/duplicate/delete, grid + list, search/sort, breadcrumbs, media preview, import/export, drag-to-move, "Open in Terminal" / "Open as Project" cross-app actions |
| **Nexus Studio** | Monaco Editor, file tree, multi-tab editing, autosave, project-wide search, project templates (static site, **Node script**, **Node HTTP server**, **Express app**), sandboxed live preview, **Git panel** (status/stage/commit/diff/log/branches), **Servers panel** (real process state, URLs, logs, restart/stop), integrated terminal, ZIP export |
| **Nexus AI** | Agent with a validated tool allowlist: filesystem tools, `run_js` (worker sandbox), `run_node`/`npm_run` (WebContainer), `list_processes`/`kill_process`, app launching. Plan → execute loop with **approval gates** for write/danger tools, task history, cancellation. Three provider options: **built-in NEXUS backend** (zero-config on server deployments), OpenAI-compatible BYOK, Anthropic BYOK — keys never touch the client bundle for the backend route |
| **Browser** | URL bar, back/forward/reload/home, bookmarks, honest handling of framing-blocked sites, receives cross-app navigation (dev-server URLs from the Servers panel, `open example.com` from Terminal) |
| **System Monitor** | Only real metrics: JS heap (Chromium), storage quota/usage, process registry, window state, render rate, network requests initiated by the page — with an explicit "not available on this platform" section for the rest |
| **Git** | **Real Git** via isomorphic-git on a custom VFS adapter: `.git/` is a genuine object database inside the project folder (visible in Files). init/status/add/commit/log/branch/checkout/diff work locally; push honestly reports CORS-blocked hosts |
| **Notes** | Markdown notes stored as real `.md` files in `~/Documents/Notes`, autosave, preview, search |
| **Tasks** | Persistent task lists with priorities and due dates (IndexedDB) |
| **Calculator** | Real expression parser (recursive descent — no eval): arithmetic, `^`, `%`, `sqrt/sin/cos/tan/log/ln/abs`, constants, implicit multiplication, tape history |
| **Media Player / Image Viewer / Document Viewer** | Play audio/video and view images from the VFS (zoom/rotate/pan), render Markdown/PDF/CSV/text documents, export originals |
| **App Manager** | Inventory of installed apps, runtime capability matrix (honest states), project templates, and every dependency declared in project `package.json` files |

### Platform
- **Persistence** — IndexedDB with versioned schema + migration hook; settings/session/notifications survive reloads; corrupt imports rejected safely; full backup export/import.
- **Recovery** — per-window error boundaries (a crashed app never takes down the desktop), global boundary over the shell.
- **Design** — near-black workspace, translucent charcoal glass, restrained depth, reduced-motion support, consistent type/icon system.
- **Security** — strict Content-Security-Policy in both deployment modes (build-time script hashes on static hosting, per-request nonce + `strict-dynamic` on server hosting), a lock screen with PBKDF2/AES-GCM verification and idle auto-lock, AI provider keys encrypted at rest, sandboxed opaque-origin previews, tool-call allowlist validation, approval gates for destructive actions, prototype-pollution-proof backup imports, a security audit trail, and per-IP rate limiting on the AI backend. Full model + honest limits in **[SECURITY.md](./SECURITY.md)**.

## Honest capability boundaries

- The **virtual filesystem** lives in IndexedDB — it never touches real files unless you import/export explicitly.
- The **Node runtime** requires cross-origin isolation; in embedded previews it is unavailable and the UI explains why. WebContainer-incompatible packages fail with real errors, never fake success.
- **Git push** over the network depends on the host sending CORS headers — GitHub does not, and NEXUS reports the raw failure instead of pretending.
- On **static hosting** (GitHub Pages) there are no server routes: the AI backend reports itself unavailable and the app guides you to a BYOK provider.
- The **internal browser** cannot render sites that forbid framing; it says so and offers a real new tab.

## Run it

```bash
bun install
bun run dev          # http://localhost:3000
bun test src/nexus   # unit + integration tests (VFS, shell, calculator, git)
bun run lint
```

Production builds:

```bash
bun run build        # standalone server build (with API routes + COI headers)
bun run build:pages  # static export for GitHub Pages (emits ./out)
```
