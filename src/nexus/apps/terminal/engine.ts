"use client";

// NEXUS OS — terminal command engine (shared with Nexus Studio's terminal panel)
// Pure TypeScript, no React rendering — returns output lines as strings.
// Commands operate ONLY on the NEXUS virtual filesystem (browser-local).
// Never uses eval/Function: arguments are parsed with a tokenizer.

import { useFS } from "../../store/fs";
import { useSettings } from "../../store/settings";
import { useOS } from "../../store/os";
import { useRuntime, vfsToContainerTree, ENV_LABEL, type RuntimeEnv } from "../../store/runtime";
import { formatBytes } from "../../lib/utils";
import {
  ROOT_ID,
  HOME_ID,
  resolvePath,
  pathOf,
  displayPath,
  childrenOf,
  nodeSize,
  descendantsOf,
  isTextFile,
  extOf,
  validateFileName,
} from "../../lib/vfs";
import * as gitops from "../../lib/gitops";
import { WORKSPACE_PRESETS, applyPreset, saveSession, loadSessions, restoreSession, deleteSession } from "../../lib/workspaces";
import { emit } from "../../lib/bus";
import type { FSNode } from "../../types";

export interface ShellCtx {
  /** current working directory node id */
  cwdId: string;
  setCwd: (id: string) => void;
  clearScreen: () => void;
  openApp: (appId: string, props?: Record<string, unknown>) => void;
  /** session command history (for the history command) */
  history?: string[];
  /** active execution environment of this terminal session */
  env: RuntimeEnv;
  setEnv: (env: RuntimeEnv) => void;
  /** the raw command line (pre-tokenization) — used by code-taking commands */
  line?: string;
}

export interface ExecResult {
  /** lines to append to terminal output */
  output: string[];
  /** render output in error color */
  error?: boolean;
  /** exit code style convention: 0 ok, 1 error */
  code: number;
  /** lines contain raw ANSI escape codes — the terminal colorizes them */
  ansi?: boolean;
}

/** Files that must never be shipped into the Node runtime */
const WC_SKIP_DIRS = new Set(["node_modules", ".git"]);
const WC_MAX_FILE_BYTES = 800_000;

/** Collect the VFS subtree of a directory as container-ready text files. */
export function collectProjectFiles(rootId: string): Array<{ relPath: string; content: string }> {
  const nodes = useFS.getState().nodes;
  const rootPath = pathOf(nodes, rootId);
  const out: Array<{ relPath: string; content: string }> = [];
  const walk = (id: string) => {
    for (const child of childrenOf(nodes, id)) {
      const rel = pathOf(nodes, child.id).slice(rootPath.length + 1);
      if (child.type === "dir") {
        if (!WC_SKIP_DIRS.has(child.name)) walk(child.id);
        continue;
      }
      if (!isTextFile(child.name, child.mime) || typeof child.content !== "string") continue;
      if (new Blob([child.content]).size > WC_MAX_FILE_BYTES) continue;
      out.push({ relPath: rel.replace(/\\/g, "/"), content: child.content });
    }
  };
  walk(rootId);
  return out;
}

/** Mount the current VFS directory into the Node runtime (one-way sync). */
async function syncCwdToRuntime(cwdId: string): Promise<number> {
  const runtime = useRuntime.getState();
  const wc = await runtime.ensureWebContainer();
  const files = collectProjectFiles(cwdId);
  const tree = vfsToContainerTree(files);
  await wc.mount(tree);
  return files.length;
}

async function requireWebContainerEnv(): Promise<void> {
  const runtime = useRuntime.getState();
  runtime.checkCaps();
  if (!runtime.caps.webcontainer) {
    throw new ShellError(
      runtime.wcError ??
        "Node runtime unavailable: this page is not cross-origin isolated. Open NEXUS in its own browser tab, or use `js` (Web Worker sandbox) for plain JavaScript."
    );
  }
}

export class ShellError extends Error {}

// ---------------- tokenizer (quotes-aware, no eval) ----------------

export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let hasToken = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      } else if (c === "\\" && quote === '"' && i + 1 < line.length) {
        cur += line[++i];
      } else {
        cur += c;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
      hasToken = true;
    } else if (c === " " || c === "\t") {
      if (cur || hasToken) {
        out.push(cur);
        cur = "";
        hasToken = false;
      }
    } else if (c === "\\" && i + 1 < line.length) {
      cur += line[++i];
      hasToken = true;
    } else {
      cur += c;
      hasToken = true;
    }
  }
  if (cur || hasToken) out.push(cur);
  return out;
}

// ---------------- path completion ----------------

export function completePath(prefix: string, cwdId: string): string[] {
  const fs = useFS.getState();
  const nodes = fs.nodes;
  const slash = prefix.lastIndexOf("/");
  const dirPart = slash >= 0 ? prefix.slice(0, slash + 1) : "";
  const namePart = slash >= 0 ? prefix.slice(slash + 1) : prefix;
  const base =
    dirPart === ""
      ? cwdId
      : resolvePath(nodes, cwdId, dirPart.endsWith("/") && dirPart !== "/" ? dirPart : dirPart)?.id ?? "";
  if (!base || !nodes[base] || nodes[base].type !== "dir") return [];
  const matches = childrenOf(nodes, base).filter((n) => n.name.startsWith(namePart));
  return matches.map((n) => {
    const name = (dirPart + n.name) || "/";
    return n.type === "dir" ? name + "/" : name;
  });
}

export const COMMAND_NAMES = [
  "help", "clear", "pwd", "ls", "cd", "mkdir", "touch", "cat", "write", "rm",
  "cp", "mv", "find", "search", "open", "apps", "theme", "date", "history",
  "echo", "tree", "df", "whoami", "neofetch",
  "env", "js", "node", "npm", "ps", "kill", "git", "workspaces", "notify",
];

function needNodes() {
  const fs = useFS.getState();
  if (!fs.ready) throw new ShellError("filesystem is still booting, try again in a moment");
  return fs;
}

function resolveDir(arg: string | undefined, cwdId: string): string {
  const fs = needNodes();
  if (!arg) return cwdId;
  const r = resolvePath(fs.nodes, cwdId, arg);
  if (!r || !r.id) throw new ShellError(`no such directory: ${arg}`);
  const node = fs.nodes[r.id];
  if (!node) throw new ShellError(`no such file or directory: ${arg}`);
  if (node.type !== "dir") throw new ShellError(`not a directory: ${arg}`);
  return r.id;
}

/**
 * Creation helpers (mkdirAtPath / createFileAtPath) walk plain relative
 * segments, so expand ~ and / prefixes here before handing the path over.
 */
function toCreateTarget(p: string, cwdId: string): { startId: string; rel: string } {
  const trimmed = p.trim();
  if (trimmed === "~" || trimmed.startsWith("~/")) {
    return { startId: HOME_ID, rel: trimmed.slice(1).replace(/^\//, "") };
  }
  if (trimmed.startsWith("/")) {
    const nodes = useFS.getState().nodes;
    // only "" (root) and /home/... are creatable from the absolute root
    return { startId: ROOT_ID, rel: trimmed.replace(/^\//, "") };
  }
  return { startId: cwdId, rel: trimmed };
}

function resolveExisting(arg: string, cwdId: string) {
  const fs = needNodes();
  const r = resolvePath(fs.nodes, cwdId, arg);
  if (!r || !r.id || !fs.nodes[r.id]) throw new ShellError(`no such file or directory: ${arg}`);
  return fs.nodes[r.id];
}

function parentAndName(arg: string, cwdId: string): { parentId: string; name: string } {
  const fs = needNodes();
  const trimmed = arg.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  const name = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  const dirPart = slash >= 0 ? trimmed.slice(0, slash) || "/" : ".";
  const parent = resolveDir(dirPart, cwdId);
  const err = validateFileName(name);
  if (err) throw new ShellError(err);
  return { parentId: parent, name };
}

// ---------------- command implementations ----------------

type Flags = Record<string, boolean | string>;

function parseFlags(args: string[], boolFlags: string[], valFlags: string[] = []): { flags: Flags; rest: string[] } {
  const flags: Flags = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const name = a.slice(2);
      if (valFlags.includes(name)) flags[name] = args[++i] ?? "";
      else flags[name] = true;
    } else if (a.startsWith("-") && a.length > 1 && !/^-\d/.test(a)) {
      for (const ch of a.slice(1)) {
        if (boolFlags.includes(ch)) flags[ch] = true;
        else throw new ShellError(`unknown flag: -${ch}`);
      }
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

const HELP_LINES = [
  "NEXUS shell — two execution environments, honestly labeled:",
  "  env shell        NEXUS sh → virtual filesystem (browser-local)",
  "  env webcontainer Node.js + npm via WebContainers (needs cross-origin isolation)",
  "",
  "Filesystem (env shell):",
  "  help                 show this help",
  "  clear                clear the screen",
  "  pwd                  print working directory",
  "  ls [-a] [-l] [path]  list directory contents",
  "  cd <path>            change directory (supports ~ .. . /)",
  "  mkdir [-p] <path>    create directory",
  "  touch <path>         create empty file (or update timestamp)",
  "  cat <file>           print file contents",
  "  write <file> <text>  write text into a file (quotes preserved)",
  "  rm [-r] <path>       remove file/dir (-r for recursive)",
  "  cp [-r] <src> <dst>  copy file/dir",
  "  mv <src> <dst>       move/rename file/dir",
  "  find <name>          find files by name under cwd",
  "  search <text>        search inside text files",
  "  open <path|app|url>  open a file, launch an app or load a URL in Browser",
  "  apps                 list installed apps",
  "  theme <name>         set accent: " + "cyan|violet|emerald|amber|rose|sky|lime|fuchsia",
  "  date                 current date and time",
  "  history              show command history",
  "  tree [path]          directory tree",
  "  df                   storage usage",
  "  echo <text>          print text",
  "  neofetch             system info",
  "  whoami               current session user",
  "",
  "Runtimes & processes (real execution, real errors):",
  "  env [name]           show or switch execution environment",
  "  js <code>            run JavaScript in the sandboxed Web Worker",
  "  node <file.js>       run a file with real Node.js (WebContainer env)",
  "  npm <args>           run npm in the Node runtime (e.g. npm install)",
  "  ps                   list running processes / dev servers",
  "  kill <id>            terminate a process",
  "",
  "Version control (real Git objects via isomorphic-git):",
  "  git init|status|add <f>|commit -m <msg>|log|branch|checkout <ref>|diff",
  "",
  "Workspaces:",
  "  workspaces list|preset <id>|save <name>|open <id>",
  "",
  "  notify <text>        raise a system notification",
];

async function execCommand(argv: string[], ctx: ShellCtx): Promise<ExecResult> {
  const cmd = argv[0];
  const args = argv.slice(1);
  const fs = useFS;

  switch (cmd) {
    case "help":
      return { output: HELP_LINES, code: 0 };

    case "clear":
      ctx.clearScreen();
      return { output: [], code: 0 };

    case "pwd":
      return { output: [pathOf(fs.getState().nodes, ctx.cwdId)], code: 0 };

    case "whoami":
      return { output: ["nexus"], code: 0 };

    case "date":
      return { output: [new Date().toString()], code: 0 };

    case "echo":
      return { output: [args.join(" ")], code: 0 };

    case "ls": {
      const { flags, rest } = parseFlags(args, ["a", "l"]);
      const dirId = resolveDir(rest[0], ctx.cwdId);
      const nodes = fs.getState().nodes;
      const kids = childrenOf(nodes, dirId).filter((n) => flags.a || !n.name.startsWith("."));
      if (kids.length === 0) return { output: [], code: 0 };
      if (flags.l) {
        return {
          output: [
            `total ${kids.length}`,
            ...kids.map((n) => {
              const kind = n.type === "dir" ? "d" : "-";
              const size = n.type === "dir" ? "-" : formatBytes(nodeSize(n));
              const date = new Date(n.modified).toLocaleDateString();
              return `${kind}rw-r--r--  ${size.padStart(8)}  ${date}  ${n.name}${n.type === "dir" ? "/" : ""}`;
            }),
          ],
          code: 0,
        };
      }
      return { output: [kids.map((n) => (n.type === "dir" ? n.name + "/" : n.name)).join("   ")], code: 0 };
    }

    case "cd": {
      const target = args[0] ?? "~";
      if (target === "~" || target.startsWith("~/")) {
        // strip the tilde AND its slash — resolvePath treats a leading "/" as
        // root-absolute, which would look for /Projects outside /home
        const r = resolvePath(fs.getState().nodes, HOME_ID, target.slice(1).replace(/^\//, ""));
        if (!r?.id) throw new ShellError(`no such directory: ${target}`);
        ctx.setCwd(r.id);
        return { output: [], code: 0 };
      }
      ctx.setCwd(resolveDir(target, ctx.cwdId));
      return { output: [], code: 0 };
    }

    case "mkdir": {
      const { flags, rest } = parseFlags(args, ["p"]);
      if (rest.length === 0) throw new ShellError("usage: mkdir [-p] <path>");
      for (const p of rest) {
        if (flags.p) {
          const { startId, rel } = toCreateTarget(p, ctx.cwdId);
          const res = fs.getState().mkdirAtPath(rel, startId);
          if (typeof res === "string" && !fs.getState().nodes[res]) {
            throw new ShellError(res);
          }
        } else {
          const { parentId, name } = parentAndName(p, ctx.cwdId);
          const res = fs.getState().createNode({ parentId, name, type: "dir" });
          if ("error" in res) throw new ShellError(res.error);
        }
      }
      return { output: [], code: 0 };
    }

    case "touch": {
      if (args.length === 0) throw new ShellError("usage: touch <path>");
      for (const p of args) {
        const nodesNow = fs.getState().nodes;
        const r = resolvePath(nodesNow, ctx.cwdId, p);
        if (r?.id && nodesNow[r.id]) continue; // exists — ok
        const { startId, rel } = toCreateTarget(p, ctx.cwdId);
        const res = fs.getState().createFileAtPath(rel, startId, "");
        const after = fs.getState().nodes;
        const check = resolvePath(after, ctx.cwdId, p);
        if (!(check?.id && after[check.id])) throw new ShellError(typeof res === "string" && !after[res] ? res : "failed to create file");
      }
      return { output: [], code: 0 };
    }

    case "cat": {
      if (args.length === 0) throw new ShellError("usage: cat <file>");
      const out: string[] = [];
      for (const p of args) {
        const node = resolveExisting(p, ctx.cwdId);
        if (node.type === "dir") throw new ShellError(`${p} is a directory`);
        if (!isTextFile(node.name, node.mime) && node.binary) {
          out.push(`(binary file, ${formatBytes(nodeSize(node))} — open with Files to preview)`);
          continue;
        }
        out.push(...(node.content ?? "").split("\n"));
      }
      return { output: out, code: 0 };
    }

    case "write": {
      const { rest } = parseFlags(args, []);
      if (rest.length < 2) throw new ShellError('usage: write <file> <text>  (quote text: write notes.txt "hello world")');
      const [p, ...textParts] = rest;
      const text = textParts.join(" ");
      const nodesNow = fs.getState().nodes;
      const r = resolvePath(nodesNow, ctx.cwdId, p);
      if (r?.id && nodesNow[r.id]) {
        const e = fs.getState().writeFile(r.id, text);
        if (e) throw new ShellError(e);
        return { output: [], code: 0 };
      }
      const created = (() => {
        const { startId, rel } = toCreateTarget(p, ctx.cwdId);
        return fs.getState().createFileAtPath(rel, startId, text);
      })();
      const after = fs.getState().nodes;
      const check = resolvePath(after, ctx.cwdId, p);
      if (!(check?.id && after[check.id])) throw new ShellError(typeof created === "string" && !after[created] ? created : "failed to write file");
      return { output: [], code: 0 };
    }

    case "rm": {
      const { flags, rest } = parseFlags(args, ["r"]);
      if (rest.length === 0) throw new ShellError("usage: rm [-r] <path>");
      for (const p of rest) {
        const node = resolveExisting(p, ctx.cwdId);
        if (node.type === "dir" && !flags.r) throw new ShellError(`${p} is a directory (use -r)`);
        if (node.id === ROOT_ID || node.id === HOME_ID) throw new ShellError("refusing to remove a system directory");
        const e = fs.getState().remove(node.id);
        if (e) throw new ShellError(e);
      }
      return { output: [], code: 0 };
    }

    case "cp": {
      const { flags, rest } = parseFlags(args, ["r"]);
      if (rest.length !== 2) throw new ShellError("usage: cp [-r] <src> <dst>");
      const [srcArg, dstArg] = rest;
      const src = resolveExisting(srcArg, ctx.cwdId);
      if (src.type === "dir" && !flags.r) throw new ShellError(`${srcArg} is a directory (use -r)`);
      const nodesNow = fs.getState().nodes;
      const dstR = resolvePath(nodesNow, ctx.cwdId, dstArg);
      let dstParentId: string;
      let dstName: string | undefined;
      if (dstR?.id && nodesNow[dstR.id]?.type === "dir") {
        dstParentId = dstR.id;
      } else if (dstR && dstR.parentId && dstR.missingName) {
        dstParentId = dstR.parentId;
        dstName = dstR.missingName;
      } else {
        throw new ShellError(`no such directory: ${dstArg}`);
      }
      const e = fs.getState().copy(src.id, dstParentId, dstName);
      if (e) throw new ShellError(e);
      return { output: [], code: 0 };
    }

    case "mv": {
      if (args.length !== 2) throw new ShellError("usage: mv <src> <dst>");
      const [srcArg, dstArg] = args;
      const src = resolveExisting(srcArg, ctx.cwdId);
      const nodesNow = fs.getState().nodes;
      const dstR = resolvePath(nodesNow, ctx.cwdId, dstArg);
      if (dstR?.id && nodesNow[dstR.id]?.type === "dir") {
        const e = fs.getState().move(src.id, dstR.id);
        if (e) throw new ShellError(e);
      } else if (dstR && dstR.parentId && dstR.missingName) {
        // rename into same dir or move+rename
        if (src.parentId === dstR.parentId) {
          const e = fs.getState().rename(src.id, dstR.missingName);
          if (e) throw new ShellError(e);
        } else {
          const e = fs.getState().copy(src.id, dstR.parentId, dstR.missingName);
          if (e) throw new ShellError(e);
          fs.getState().remove(src.id);
        }
      } else {
        throw new ShellError(`no such directory: ${dstArg}`);
      }
      return { output: [], code: 0 };
    }

    case "find": {
      if (args.length === 0) throw new ShellError("usage: find <name>");
      const q = args[0].toLowerCase();
      const nodesNow = fs.getState().nodes;
      const ids = descendantsOf(nodesNow, ctx.cwdId);
      const hits = ids
        .map((id) => nodesNow[id])
        .filter((n) => n && n.id !== ctx.cwdId && n.name.toLowerCase().includes(q))
        .map((n) => displayPath(nodesNow, n.id));
      return { output: hits.length ? hits : ["(no matches)"], code: 0 };
    }

    case "search": {
      if (args.length === 0) throw new ShellError("usage: search <text>");
      const q = args.join(" ").toLowerCase();
      const nodesNow = fs.getState().nodes;
      const out: string[] = [];
      for (const node of Object.values(nodesNow)) {
        if (node.type !== "file" || !node.content) continue;
        const lines = node.content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(q)) {
            out.push(`${displayPath(nodesNow, node.id)}:${i + 1}: ${lines[i].trim().slice(0, 90)}`);
            if (out.length > 40) {
              out.push("(truncated)");
              return { output: out, code: 0 };
            }
          }
        }
      }
      return { output: out.length ? out : ["(no matches)"], code: 0 };
    }

    case "open": {
      if (args.length === 0) throw new ShellError("usage: open <path|app|url>");
      const target = args[0];
      // URLs go to the internal Browser via the event bus
      if (/^https?:\/\//i.test(target) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(target)) {
        const url = /^https?:\/\//i.test(target) ? target : `https://${target}`;
        emit("browser:navigate", { url });
        return { output: [`opening ${url} in Browser…`], code: 0 };
      }
      const metaApps = Object.values(useOS.getState()) && (await import("../../apps/meta")).APP_META;
      if (metaApps[target]) {
        ctx.openApp(target);
        return { output: [`launching ${target}…`], code: 0 };
      }
      const node = resolveExisting(target, ctx.cwdId);
      if (node.type === "dir") {
        ctx.openApp("files", { openId: node.id });
      } else if (isTextFile(node.name, node.mime)) {
        ctx.openApp("studio", { openFileId: node.id });
      } else {
        ctx.openApp("files", { openId: node.id });
      }
      return { output: [`opening ${displayPath(fs.getState().nodes, node.id)}…`], code: 0 };
    }

    case "apps": {
      const { APP_META } = await import("../../apps/meta");
      return {
        output: Object.values(APP_META).map((m) => `${m.id.padEnd(10)} ${m.name.padEnd(14)} ${m.tagline}`),
        code: 0,
      };
    }

    case "theme": {
      const accents = ["cyan", "violet", "emerald", "amber", "rose", "sky", "lime", "fuchsia"];
      if (args.length === 0) {
        return { output: [`current accent: ${useSettings.getState().accent}`, `available: ${accents.join(", ")}`], code: 0 };
      }
      const name = args[0].toLowerCase();
      const map: Record<string, string> = {
        cyan: "#22d3ee", violet: "#a78bfa", emerald: "#34d399", amber: "#fbbf24",
        rose: "#fb7185", sky: "#38bdf8", lime: "#a3e635", fuchsia: "#e879f9",
      };
      if (!map[name]) throw new ShellError(`unknown theme. available: ${accents.join(", ")}`);
      useSettings.getState().set({ accent: map[name] });
      return { output: [`accent set to ${name}`], code: 0 };
    }

    case "history": {
      return { output: ctx.history ?? [], code: 0 };
    }

    case "tree": {
      const nodesNow = fs.getState().nodes;
      const start = args[0] ? resolveDir(args[0], ctx.cwdId) : ctx.cwdId;
      const out: string[] = [displayPath(nodesNow, start)];
      const walk = (id: string, prefix: string, depth: number) => {
        if (depth > 6) return;
        const kids = childrenOf(nodesNow, id);
        kids.forEach((k, i) => {
          const last = i === kids.length - 1;
          out.push(`${prefix}${last ? "└── " : "├── "}${k.name}${k.type === "dir" ? "/" : ""}`);
          if (k.type === "dir") walk(k.id, prefix + (last ? "    " : "│   "), depth + 1);
        });
      };
      walk(start, "", 0);
      return { output: out, code: 0 };
    }

    case "df": {
      const nodesNow = fs.getState().nodes;
      let bytes = 0;
      let files = 0;
      let dirs = 0;
      for (const n of Object.values(nodesNow)) {
        if (n.type === "dir") dirs++;
        else {
          files++;
          bytes += nodeSize(n);
        }
      }
      let quota = "";
      try {
        const est = await navigator.storage?.estimate?.();
        if (est) quota = `   (browser quota: ${formatBytes(est.quota ?? 0)}, used: ${formatBytes(est.usage ?? 0)})`;
      } catch { /* noop */ }
      return {
        output: [
          `virtual filesystem: ${files} files, ${dirs} directories, ${formatBytes(bytes)}${quota}`,
        ],
        code: 0,
      };
    }

    case "neofetch": {
      const { OS_VERSION } = await import("../../apps/meta");
      const nodesNow = fs.getState().nodes;
      const fileCount = Object.values(nodesNow).filter((n) => n.type === "file").length;
      return {
        output: [
          "        ▄▄▄▄▄▄        nexus@browser",
          "     ▄█████████▄      ─────────────────────",
          "    ███████████████    OS: NEXUS OS v" + OS_VERSION,
          "    ███████████████    Shell: nexus-sh",
          "     ▀█████████▀      Windows: " + String(useOS.getState().windows.length),
          "        ▀▀▀▀▀▀        Files: " + fileCount,
          "                       Engine: " + (typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 40) + "…" : "unknown"),
          "                       Theme: " + useSettings.getState().theme + " / " + useSettings.getState().accent,
        ],
        code: 0,
      };
    }

    case "env": {
      if (args.length === 0) {
        const runtime = useRuntime.getState();
        runtime.checkCaps();
        const lines = [
          `current environment: ${ctx.env} (${ENV_LABEL[ctx.env]})`,
          "",
          "available environments:",
          `  shell         NEXUS sh — virtual filesystem operations (always available)`,
          `  worker        JavaScript in a sandboxed Web Worker (always available)`,
          `  webcontainer  real Node.js + npm — ${runtime.caps.webcontainer ? "AVAILABLE in this browser tab" : "unavailable: " + (runtime.wcError ?? "not cross-origin isolated")}`,
          "",
          "switch with: env <shell|worker|webcontainer>",
        ];
        return { output: lines, code: 0 };
      }
      const name = args[0].toLowerCase();
      if (name === "shell" || name === "worker") {
        ctx.setEnv(name);
        return { output: [`environment set to ${name} (${ENV_LABEL[name as RuntimeEnv]})`], code: 0 };
      }
      if (name === "webcontainer" || name === "node") {
        await requireWebContainerEnv();
        ctx.setEnv("webcontainer");
        return {
          output: [
            "environment set to webcontainer (real Node.js + npm)",
            "note: this directory's text files are synced into the runtime when you run node/npm.",
          ],
          code: 0,
        };
      }
      throw new ShellError(`unknown environment '${name}'. available: shell, worker, webcontainer`);
    }

    case "js": {
      // take the code from the raw line so shell quoting doesn't mangle JS
      let code = ctx.line && /^["']?js\s+/.test(ctx.line.trim()) ? ctx.line.trim().replace(/^js\s+/, "") : args.join(" ");
      if (!code.trim()) throw new ShellError('usage: js <code>  — e.g. js console.log(2+2)  or: js script.js');
      // allow `js file.js` to execute a file from the VFS
      if (/^[\w./-]+$/.test(code) && extOf(code) === "js") {
        const node = resolveExisting(code, ctx.cwdId);
        if (node.type === "file" && typeof node.content === "string") {
          code = node.content;
        }
      }
      const runtime = useRuntime.getState();
      const res = await runtime.workerRun(code);
      const out: string[] = [];
      if (res.logs.length) out.push(...res.logs);
      if (res.error) out.push(res.error);
      out.push(`[worker exited ${res.exitCode} in ${res.durationMs}ms — sandboxed Web Worker, no DOM access]`);
      return { output: out, error: res.exitCode !== 0, code: res.exitCode };
    }

    case "node": {
      await requireWebContainerEnv();
      if (args.length === 0) throw new ShellError("usage: node <file.js> [args…]");
      const [file, ...rest] = args;
      const node = resolveExisting(file, ctx.cwdId);
      if (node.type !== "file") throw new ShellError(`${file} is not a file`);
      const count = await syncCwdToRuntime(ctx.cwdId);
      const rel = pathOf(useFS.getState().nodes, node.id).split("/").pop() ?? file;
      const res = await useRuntime.getState().wcRun({
        command: "node",
        args: [rel, ...rest],
        label: `node ${rel}`,
      });
      emit("task:finished", {
        label: `node ${rel}`,
        ok: res.exitCode === 0,
        detail: `exit ${res.exitCode}`,
      });
      return {
        output: res.output.length ? res.output : [`(no output — exited ${res.exitCode})`],
        error: res.exitCode !== 0,
        code: res.exitCode ?? 1,
        ansi: true,
      };
    }

    case "npm":
    case "npx": {
      await requireWebContainerEnv();
      if (args.length === 0) throw new ShellError(`usage: ${cmd} <args>  — e.g. npm install express`);
      const nodesNow = useFS.getState().nodes;
      const hasPkg = childrenOf(nodesNow, ctx.cwdId).some((n) => n.name === "package.json");
      if (!hasPkg && cmd === "npm") {
        throw new ShellError("no package.json in this directory — create one first (npm init works too, via: js or Studio template)");
      }
      const count = await syncCwdToRuntime(ctx.cwdId);
      const res = await useRuntime.getState().wcRun({
        command: cmd,
        args,
        label: `${cmd} ${args.join(" ")}`,
      });
      emit("task:finished", { label: `${cmd} ${args.join(" ")}`, ok: res.exitCode === 0 });
      return {
        output: res.output.length ? res.output : [`(no output — exited ${res.exitCode})`],
        error: res.exitCode !== 0,
        code: res.exitCode ?? 1,
        ansi: true,
      };
    }

    case "ps": {
      const procs = useRuntime.getState().processes;
      if (procs.length === 0) return { output: ["no processes — run `js`, `node` or a dev server"], code: 0 };
      const out = [
        "ID            ENV           STATE      COMMAND",
        ...procs.map((p) => {
          const id = p.id.slice(0, 12).padEnd(13);
          const env = p.env.padEnd(13);
          const state = (p.state + (p.url ? "" : "")).padEnd(10);
          const extra = p.url ? `  → ${p.url}` : "";
          return `${id}${env}${state}${p.command}${extra}`;
        }),
      ];
      return { output: out, code: 0 };
    }

    case "kill": {
      if (args.length === 0) throw new ShellError("usage: kill <id>  (see ps)");
      const q = args[0];
      const proc = useRuntime
        .getState()
        .processes.find((p) => p.id === q || p.id.startsWith(q));
      if (!proc) throw new ShellError(`no such process: ${q}`);
      await useRuntime.getState().kill(proc.id);
      return { output: [`terminated ${proc.label} (${proc.id})`], code: 0 };
    }

    case "git": {
      const nodesNow = useFS.getState().nodes;
      const projectPath = pathOf(nodesNow, ctx.cwdId);
      if (args.length === 0) {
        return {
          output: [
            "usage: git <command>  (operates on the current directory)",
            "  git init                    create a real repository (.git/ appears in Files)",
            "  git status                  working tree status",
            "  git add <file|-A>           stage changes",
            "  git commit -m \"message\"     record a real commit",
            "  git log                     commit history",
            "  git branch [name]           list branches / create one",
            "  git checkout <branch>       switch branches",
            "  git diff [file]             line-level diff",
          ],
          code: 0,
        };
      }
      const sub = args[0];
      switch (sub) {
        case "init":
          return { output: [await gitops.gitInit(projectPath)], code: 0 };
        case "status": {
          const rows = await gitops.gitStatus(projectPath);
          if (rows.length === 0) return { output: ["nothing to commit, working tree clean"], code: 0 };
          const { current } = await gitops.gitBranches(projectPath);
          const out = [`On branch ${current}`, ""];
          for (const r of rows) out.push(`  ${r.label.padEnd(10)} ${r.path}`);
          return { output: out, code: 0 };
        }
        case "add": {
          if (args[1] === "-A" || args[1] === "-." || args[1] === "--all") {
            return { output: [await gitops.gitStageAll(projectPath)], code: 0 };
          }
          if (!args[1]) throw new ShellError("usage: git add <file> | git add -A");
          const paths = args.slice(1).filter((p) => p !== "-A" && p !== "--all");
          return { output: [await gitops.gitStage(projectPath, paths)], code: 0 };
        }
        case "commit": {
          const mIdx = args.indexOf("-m");
          const msg = mIdx >= 0 ? args[mIdx + 1] : undefined;
          if (!msg) throw new ShellError('usage: git commit -m "message"');
          const { short } = await gitops.gitCommit(projectPath, msg);
          return { output: [`[${await currentBranch(projectPath)} ${short}] ${msg}`], code: 0 };
        }
        case "log": {
          const entries = await gitops.gitLog(projectPath);
          if (entries.length === 0) return { output: ["(no commits yet)"], code: 0 };
          return {
            output: entries.flatMap((e) => [
              `commit ${e.oid}`,
              `Author: ${e.author}`,
              `Date:   ${new Date(e.timestamp).toLocaleString()}`,
              "",
              `    ${e.message.split("\n").join("\n    ")}`,
              "",
            ]),
            code: 0,
          };
        }
        case "branch": {
          if (args[1]) return { output: [await gitops.gitCreateBranch(projectPath, args[1])], code: 0 };
          const { current, all } = await gitops.gitBranches(projectPath);
          return {
            output: all.map((b) => (b === current ? `* ${b}` : `  ${b}`)),
            code: 0,
          };
        }
        case "checkout": {
          if (!args[1]) throw new ShellError("usage: git checkout <branch>");
          return { output: [await gitops.gitCheckout(projectPath, args[1])], code: 0 };
        }
        case "diff": {
          const rows = await gitops.gitStatus(projectPath);
          const target = args[1] ?? rows.find((r) => r.label !== "staged")?.path;
          if (!target) return { output: ["nothing to diff"], code: 0 };
          const lines = await gitops.gitFileDiff(projectPath, target);
          return {
            output: lines.map((l) =>
              l.kind === "add" ? `+${l.text}` : l.kind === "del" ? `-${l.text}` : l.kind === "gap" ? l.text : ` ${l.text}`
            ),
            code: 0,
          };
        }
        case "remote": {
          if (args[1] === "add" && args[2] && args[3]) {
            return { output: [await gitops.gitAddRemote(projectPath, args[2], args[3])], code: 0 };
          }
          const remotes = await gitops.gitRemotes(projectPath);
          if (remotes.length === 0) return { output: ["(no remotes configured)"], code: 0 };
          return { output: remotes.map((r) => `${r.remote}\t${r.url}`), code: 0 };
        }
        case "push": {
          const remotes = await gitops.gitRemotes(projectPath);
          const remote = remotes.find((r) => r.remote === (args[1] ?? "origin")) ?? remotes[0];
          if (!remote) throw new ShellError("no remote configured — git remote add origin <url>");
          try {
            return { output: [await gitops.gitPush(projectPath, remote.url)], code: 0 };
          } catch (e) {
            // Honest failure: most Git hosts refuse browser CORS requests.
            throw new ShellError(
              `push failed (this is real, not simulated): ${e instanceof Error ? e.message : String(e)}. ` +
              "Most Git servers (including GitHub) do not allow direct browser pushes (CORS). Use the native-agent path or GitHub's web UI."
            );
          }
        }
        default:
          throw new ShellError(`git: '${sub}' is not supported here. try: init, status, add, commit, log, branch, checkout, diff, remote, push`);
      }
    }

    case "workspaces": {
      const sub = args[0] ?? "list";
      if (sub === "list") {
        const sessions = await loadSessions();
        const out = [
          "presets (arrange real windows):",
          ...WORKSPACE_PRESETS.map((p) => `  ${p.id.padEnd(10)} ${p.name.padEnd(12)} ${p.description}`),
          "",
          "saved sessions:",
          ...(sessions.length
            ? sessions.map((s) => `  ${s.id}  ${s.name}  (${s.windows.length} windows)`)
            : ["  (none yet — workspaces save <name>)"]),
        ];
        return { output: out, code: 0 };
      }
      if (sub === "preset") {
        const p = WORKSPACE_PRESETS.find((x) => x.id === args[1]);
        if (!p) throw new ShellError(`unknown preset. try: ${WORKSPACE_PRESETS.map((x) => x.id).join(", ")}`);
        await applyPreset(p);
        return { output: [`applied preset '${p.name}'`], code: 0 };
      }
      if (sub === "save") {
        const s = await saveSession(args.slice(1).join(" "));
        return { output: [`saved session '${s.name}' with ${s.windows.length} windows`], code: 0 };
      }
      if (sub === "open" || sub === "restore") {
        const sessions = await loadSessions();
        const s = sessions.find((x) => x.id === args[1] || x.name === args.slice(1).join(" "));
        if (!s) throw new ShellError("no such session — see: workspaces list");
        await restoreSession(s);
        return { output: [`restored '${s.name}'`], code: 0 };
      }
      if (sub === "delete") {
        await deleteSession(args[1] ?? "");
        return { output: ["session deleted (if it existed)"], code: 0 };
      }
      throw new ShellError("usage: workspaces list|preset <id>|save <name>|open <id>|delete <id>");
    }

    case "notify": {
      const text = args.join(" ") || "Hello from the terminal";
      useOS.getState().notify({ title: "Terminal", body: text, appId: "terminal" });
      return { output: [`notification raised: ${text}`], code: 0 };
    }

    default:
      throw new ShellError(`command not found: ${cmd}. Type 'help' for available commands.`);
  }
}

async function currentBranch(projectPath: string): Promise<string> {
  try {
    const { current } = await gitops.gitBranches(projectPath);
    return current;
  } catch {
    return "main";
  }
}

/** Split a raw line on && / ; outside quotes (lightweight shell chaining). */
function splitChained(line: string): Array<{ line: string; joiner: "&" | ";" }> {
  const out: Array<{ line: string; joiner: "&" | ";" }> = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let pending: "&" | ";" | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    if (c === "&" && line[i + 1] === "&") {
      out.push({ line: cur, joiner: pending ?? "&" });
      cur = "";
      pending = "&";
      i++;
      continue;
    }
    if (c === ";") {
      out.push({ line: cur, joiner: pending ?? ";" });
      cur = "";
      pending = ";";
      continue;
    }
    cur += c;
  }
  out.push({ line: cur, joiner: pending ?? "&" });
  return out
    .map((p) => ({ ...p, line: p.line.trim() }))
    .filter((p) => p.line.length > 0);
}

/**
 * Run one command line. Never throws — errors are returned as output.
 * Routing: commands in COMMAND_NAMES run on the NEXUS shell (VFS). In the
 * `webcontainer` environment any other command is executed by the real
 * Node.js runtime; in `shell`/`worker` environments unknown commands fail
 * honestly with "command not found".
 * Supports && and ; chaining in the shell environment (early-exit on && failure).
 */
export async function runCommand(
  line: string,
  ctx: ShellCtx & { history?: string[] }
): Promise<ExecResult> {
  const chained = ctx.env === "shell" || ctx.env === "worker" ? splitChained(line) : [{ line, joiner: "&" as const }];
  if (chained.length > 1) {
    const allOutput: string[] = [];
    let anyErr = false;
    let lastCode = 0;
    let cwdOverride: string | null = null; // `cd x && ls` must carry cwd forward
    for (let i = 0; i < chained.length; i++) {
      const part = chained[i];
      const partCtx: ShellCtx & { history?: string[] } = {
        ...ctx,
        cwdId: cwdOverride ?? ctx.cwdId,
        setCwd: (id: string) => {
          cwdOverride = id;
          ctx.setCwd(id);
        },
      };
      const res = await runSingle(part.line, partCtx, part.line);
      allOutput.push(...res.output);
      lastCode = res.code;
      if (res.error || res.code !== 0) {
        anyErr = true;
        if (part.joiner === "&") break; // && short-circuits on failure
      }
    }
    return { output: allOutput, error: anyErr, code: lastCode, ansi: false };
  }
  return runSingle(line, ctx, line);
}

async function runSingle(
  line: string,
  ctx: ShellCtx & { history?: string[] },
  rawLine?: string
): Promise<ExecResult> {
  const argv = tokenize(line);
  if (argv.length === 0) return { output: [], code: 0 };
  const isShellCommand = COMMAND_NAMES.includes(argv[0]) || /^[-\w]/.test(argv[0]) === false;
  const ctxWithLine: ShellCtx & { history?: string[] } = { ...ctx, line: rawLine ?? line };

  // In the Node environment, non-shell commands go to the real runtime.
  if (ctx.env === "webcontainer" && !COMMAND_NAMES.includes(argv[0])) {
    try {
      await requireWebContainerEnv();
      const count = await syncCwdToRuntime(ctx.cwdId);
      const res = await useRuntime.getState().wcRun({
        command: argv[0],
        args: argv.slice(1),
        label: line,
      });
      const note = count >= 0 ? [] : [];
      return {
        output: [...note, ...(res.output.length ? res.output : [`(exited ${res.exitCode})`])],
        error: res.exitCode !== 0,
        code: res.exitCode ?? 1,
        ansi: true,
      };
    } catch (e) {
      if (e instanceof ShellError) return { output: [`nexus: ${e.message}`], error: true, code: 1 };
      return { output: [`node runtime: ${e instanceof Error ? e.message : String(e)}`], error: true, code: 1 };
    }
  }

  if (!isShellCommand) {
    return { output: [`nexus: command not found: ${argv[0]}`], error: true, code: 1 };
  }

  try {
    return await execCommand(argv, ctxWithLine);
  } catch (e) {
    if (e instanceof ShellError) return { output: [`nexus: ${e.message}`], error: true, code: 1 };
    return { output: [`nexus: internal error: ${e instanceof Error ? e.message : String(e)}`], error: true, code: 1 };
  }
}

export { extOf };
