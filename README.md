# NEXUS OS

A premium, fully functional **browser-based desktop environment** — not a mockup. NEXUS OS ships a real window manager, a persistent virtual filesystem, a working shell, a code studio with sandboxed live preview, an extensible AI agent with validated tool-calling, and an honest internal browser. Everything runs client-side.

**Live demo:** `https://<your-username>.github.io/nexus-os/` (deployed via GitHub Actions on every push to `main`)

![NEXUS OS](https://img.shields.io/badge/Next.js-16-black) ![React](https://img.shields.io/badge/React-19-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8)

---

## What actually works

### Desktop shell
- **Window manager** — drag, 8-direction resize, minimize / maximize / restore / close, focus + z-index ordering, edge **snapping** (halves, quarters, full), cascade placement, per-app remembered geometry, session restore across reloads. Pointer Events throughout, so mouse **and touch** behave identically; windows can never be stranded outside the viewport.
- **Dock** — launchers, running indicators, active highlight, minimize/restore behavior, hover magnification, long-press context menus on touch, system tray (search / notifications / clock / settings).
- **Desktop** — wallpaper themes, draggable icon grid with layout persistence, single-click select + double-click launch (double-tap on touch), right-click / long-press context menus, clock widget, notification toasts + center.
- **Global search** (`Ctrl/⌘+K`) — fuzzy search across apps, files, folders, and settings; launch anything from the results.
- **Keyboard** — `Ctrl+K` search, `Ctrl+`` terminal, `Alt+Tab` / `` Alt+` `` window cycling, `Alt+W` close, `Alt+M` minimize, `Alt+←/→/↑` snapping. Capture-phase handling so app internals (e.g. Monaco) can't swallow system shortcuts.

### Applications
| App | Highlights |
|---|---|
| **Terminal** | 24 working commands (`ls`, `cd`, `mkdir`, `touch`, `cat`, `write`, `rm`, `cp`, `mv`, `find`, `search`, `open`, `apps`, `theme`, `tree`, `df`, `neofetch`…), quote-aware tokenizer (no `eval`, ever), tab completion, history, operates on the real virtual filesystem |
| **Files** | Nested navigation, create/rename/copy/move/duplicate/delete, grid + list, search & sort, breadcrumbs, metadata properties, image/audio/video preview, text editing hand-off, **import** (drop or picker) and **export** (download), drag-to-move, clipboard, storage quota reporting |
| **Nexus Studio** | **Monaco Editor**, project explorer, multi-tab editing with per-file undo, autosave + `Ctrl/⌘+S`, find/replace, project-wide search, templates, embedded terminal panel, **sandboxed live preview** (CSS/JS inlined, errors forwarded via postMessage, iframe sealed without `allow-same-origin`), **ZIP export** |
| **Nexus AI** | Provider abstraction (**OpenAI-compatible** + **Anthropic**), plan → execute agent loop with a strict validated tool allowlist (`list_dir`, `read_file`, `create_file`, `write_file`, `delete_path`, `create_project`, `open_app`, `validate_project`), human **approval gates** for destructive actions, live step progress, task history. No key configured → honest setup screen; **never simulates responses** |
| **Browser** | URL bar, back/forward/reload/home (own history), bookmarks, search shortcuts, and honest handling of `X-Frame-Options`/CSP-blocked sites (known-blocked detection + always-available *Open in New Tab*) |
| **Settings** | Dark/light themes, 8 accent colors, 8 CSS wallpapers, animation preferences, dock tuning, shortcut reference, storage usage, **full backup export/import**, granular + factory reset with confirmations |

### Platform
- **Persistence** — IndexedDB (virtual filesystem, versioned schema + migration hook) and localStorage (settings, session, notifications). The OS survives refresh with windows, files, and layout intact. Corrupt imports are rejected safely.
- **Recovery** — per-window error boundaries: a crashed app shows *Restart app / Close window* without taking down the desktop; a global boundary covers the shell.
- **Design system** — near-black workspace, translucent charcoal glass, restrained borders, real depth, tuned blur, reduced-motion support (`prefers-reduced-motion` honored), consistent spacing/typography/icon language.
- **Security posture** — paths can't escape the VFS root, no `eval`/`Function` anywhere, no `dangerouslySetInnerHTML` on dynamic content, sandboxed preview iframes, tool-call allowlist validation, confirmations before destructive actions, secrets never hardcoded (see below).

## Honest capability boundaries

NEXUS OS never pretends the browser is a native OS:

- The **virtual filesystem** lives in IndexedDB. It does not touch your real files unless you explicitly import/export through Files.
- **Terminal commands execute locally in the browser** against the VFS. There is no real shell, bash, or package manager behind it.
- **Studio previews** run in a sandboxed iframe that cannot access NEXUS internals or your storage.
- **Nexus AI** is strictly bring-your-own-key. The key is stored locally on your device and sent only to the provider endpoint you configure. This app is statically hosted, so there is no server-side proxy — choose providers that allow browser CORS calls (the UI explains this, and reports real errors).
- The **internal browser** cannot render sites that forbid framing; it tells you and offers a real new tab instead of faking content.

## Run it

```bash
bun install
bun run dev        # http://localhost:3000
bun test src/nexus # unit tests (VFS path engine)
bun run lint       # eslint
```

Production static build (what Pages deploys):

```bash
DEPLOY_TARGET=gh-pages GH_REPO_NAME=nexus-os bunx next build   # emits ./out
```

## Deploy to your own GitHub Pages

1. Push this repository to GitHub (Actions workflow included at `.github/workflows/deploy.yml`).
2. Settings → Pages → Build and deployment → **Source: GitHub Actions**.
3. Every push to `main` runs tests, builds the static export, and deploys.

The build bakes `basePath = /<repo-name>` automatically (`GH_REPO_NAME` env), so it works from project URLs like `https://user.github.io/nexus-os/`.

## Tech stack

Next.js 16 (App Router, static export) · React 19 · TypeScript 5 · Tailwind CSS 4 · Zustand 5 · IndexedDB · Monaco Editor (@monaco-editor/react) · JSZip · lucide-react · Bun (runtime, tests, CI)

## Architecture

```
src/
├── app/                  # Next.js entry (single route → the OS)
└── nexus/
    ├── types.ts          # shared contracts (FSNode, WindowState, AppInstanceProps…)
    ├── lib/              # idb (versioned IndexedDB), vfs (pure path engine), backup, wallpapers
    ├── store/            # zustand: os (windows/shell), fs (VFS+IDB sync), settings (persisted)
    ├── shell/            # boot, desktop, window manager, dock, spotlight, notifications, menus
    └── apps/
        ├── registry.tsx  # lazy app installation point
        └── <app>/        # terminal · files · studio · ai · browser · settings
```

Adding an application: create `src/nexus/apps/<id>/index.tsx` exporting a component that accepts `AppInstanceProps`, register metadata in `apps/meta.ts`, and add a lazy entry in `apps/registry.tsx`. The window manager, dock, search, and persistence pick it up automatically.
