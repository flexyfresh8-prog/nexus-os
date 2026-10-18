"use client";

// NEXUS OS — terminal command engine (shared with Nexus Studio's terminal panel)
// Pure TypeScript, no React rendering — returns output lines as strings.
// Commands operate ONLY on the NEXUS virtual filesystem (browser-local).
// Never uses eval/Function: arguments are parsed with a tokenizer.

import { useFS } from "../../store/fs";
import { useSettings } from "../../store/settings";
import { useOS } from "../../store/os";
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

export interface ShellCtx {
  /** current working directory node id */
  cwdId: string;
  setCwd: (id: string) => void;
  clearScreen: () => void;
  openApp: (appId: string, props?: Record<string, unknown>) => void;
  /** session command history (for the history command) */
  history?: string[];
}

export interface ExecResult {
  /** lines to append to terminal output */
  output: string[];
  /** render output in error color */
  error?: boolean;
  /** exit code style convention: 0 ok, 1 error */
  code: number;
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
  "NEXUS shell — all commands run locally in your browser against the virtual filesystem.",
  "",
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
  "  open <path|app>      open a file or launch an app",
  "  apps                 list installed apps",
  "  theme <name>         set accent: " + "cyan|violet|emerald|amber|rose|sky|lime|fuchsia",
  "  date                 current date and time",
  "  history              show command history",
  "  tree [path]          directory tree",
  "  df                   storage usage",
  "  echo <text>          print text",
  "  neofetch             system info",
  "  whoami               current session user",
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
        const r = resolvePath(fs.getState().nodes, HOME_ID, target.slice(1) || "/");
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
          fs.getState().mkdirAtPath(p, ctx.cwdId);
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
        const res = fs.getState().createFileAtPath(p, ctx.cwdId, "");
        // verify the file now exists — createFileAtPath returns an id on success or an error string
        const after = fs.getState().nodes;
        const check = resolvePath(after, ctx.cwdId, p);
        if (!(check?.id && after[check.id])) throw new ShellError(res || "failed to create file");
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
      const created = fs.getState().createFileAtPath(p, ctx.cwdId, text);
      const after = fs.getState().nodes;
      const check = resolvePath(after, ctx.cwdId, p);
      if (!(check?.id && after[check.id])) throw new ShellError(created || "failed to write file");
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
      if (args.length === 0) throw new ShellError("usage: open <path|app>");
      const target = args[0];
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

    default:
      throw new ShellError(`command not found: ${cmd}. Type 'help' for available commands.`);
  }
}

/** Run one command line. Never throws — errors are returned as output. */
export async function runCommand(
  line: string,
  ctx: ShellCtx & { history?: string[] }
): Promise<ExecResult> {
  const argv = tokenize(line);
  if (argv.length === 0) return { output: [], code: 0 };
  try {
    return await execCommand(argv, ctx);
  } catch (e) {
    if (e instanceof ShellError) return { output: [`nexus: ${e.message}`], error: true, code: 1 };
    return { output: [`nexus: internal error: ${e instanceof Error ? e.message : String(e)}`], error: true, code: 1 };
  }
}

export { extOf };
