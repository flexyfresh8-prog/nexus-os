"use client";

// NEXUS OS — Nexus AI tool system. Validated OS tools the agent may call:
// filesystem operations (sandboxed to /home/Projects and /home/Documents)
// plus app launching. Model arguments are never trusted blindly — every
// call passes validateToolCall() and the fs store's own validation.

import { useFS } from "../../store/fs";
import { useOS } from "../../store/os";
import { APP_META } from "../meta";
import type { FSNode } from "../../types";
import {
  HOME_ID,
  childrenOf,
  descendantsOf,
  extOf,
  nodeSize,
  resolvePath,
  validateFileName,
} from "../../lib/vfs";
import { formatBytes } from "../../lib/utils";
import type { ToolSpec } from "./providers";

export type { ToolSpec } from "./providers";

const HOME_PREFIX = "/home/";
const SANDBOX_ROOTS = ["/home/Projects", "/home/Documents"];
const MAX_READ_CHARS = 8000;
const MAX_CONTENT_CHARS = 200000;
const MAX_PROJECT_FILES = 50;

// ---------------- sandbox guard ----------------

/**
 * Normalize a model-supplied path and enforce the sandbox.
 * Accepts absolute paths and ~/home-relative ones; rejects "." / ".."
 * segments and anything outside the sandbox roots. Throws on violation.
 */
function guardPath(raw: unknown, what = "path"): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(`${what} must be a non-empty string.`);
  }
  let p = raw.trim().replace(/\\/g, "/");
  if (p.startsWith("~")) p = "/home" + p.slice(1);
  if (!p.startsWith("/")) p = "/home/" + p;
  const segs = p.split("/").filter((s) => s.length > 0);
  if (segs.some((s) => s === "." || s === "..")) {
    throw new Error(`Path traversal rejected: "." and ".." segments are not allowed in "${raw.trim()}".`);
  }
  const canon = "/" + segs.join("/");
  const ok = SANDBOX_ROOTS.some((r) => canon === r || canon.startsWith(r + "/"));
  if (!ok) {
    throw new Error(
      `Access denied: "${canon}" is outside the sandbox. Allowed roots: ${SANDBOX_ROOTS.join(", ")}.`
    );
  }
  return canon;
}

function isRootDir(canon: string): boolean {
  return canon === "/home/Projects" || canon === "/home/Documents";
}

function strArg(args: Record<string, unknown>, key: string, allowEmpty = false): string {
  const v = args[key];
  if (typeof v !== "string" || (!allowEmpty && !v.trim())) {
    throw new Error(`Missing or invalid string argument "${key}".`);
  }
  return v;
}

function resolveNode(canon: string): FSNode | null {
  const fs = useFS.getState();
  if (!fs.ready) {
    throw new Error("The virtual filesystem is still loading — retry in a moment.");
  }
  const res = resolvePath(fs.nodes, HOME_ID, canon);
  if (!res || !res.id) return null;
  return fs.nodes[res.id] ?? null;
}

function requireNode(canon: string): FSNode {
  const node = resolveNode(canon);
  if (!node) throw new Error(`Path not found: ${canon}`);
  return node;
}

function requireFSReady(): void {
  if (!useFS.getState().ready) {
    throw new Error("The virtual filesystem is still loading — retry in a moment.");
  }
}

/** mkdir -p relative to /home, verified by re-resolving (id vs error ambiguity-safe) */
function ensureDirId(relFromHome: string): string {
  requireFSReady();
  const err = useFS.getState().mkdirAtPath(relFromHome, HOME_ID);
  const res = resolvePath(useFS.getState().nodes, HOME_ID, "/" + relFromHome);
  const id = res && res.id ? res.id : "";
  const node = id ? useFS.getState().nodes[id] : undefined;
  if (!node || node.type !== "dir") {
    const errText = typeof err === "string" && !useFS.getState().nodes[err] ? err : "unknown error";
    throw new Error(`Could not create directory "/home/${relFromHome}": ${errText}`);
  }
  return node.id;
}

/** Create a text file (parents auto-created) relative to /home. */
function createFileAt(relFromHome: string, content: string): void {
  const slash = relFromHome.lastIndexOf("/");
  const parentRel = slash > 0 ? relFromHome.slice(0, slash) : "";
  const name = slash > 0 ? relFromHome.slice(slash + 1) : relFromHome;
  const parentId = parentRel ? ensureDirId(parentRel) : HOME_ID;
  const nameErr = validateFileName(name);
  if (nameErr) throw new Error(`Invalid file name "${name}": ${nameErr}`);
  const res = useFS.getState().createNode({
    parentId,
    name,
    type: "file",
    content,
    autoRename: false,
  });
  if ("error" in res) throw new Error(res.error);
}

// ---------------- tool implementations ----------------

function tListDir(args: Record<string, unknown>): string {
  const canon = guardPath(args.path);
  const node = requireNode(canon);
  if (node.type !== "dir") {
    throw new Error(`${canon} is a file, not a directory. Use read_file instead.`);
  }
  const kids = childrenOf(useFS.getState().nodes, node.id);
  if (kids.length === 0) return `${canon} is empty.`;
  const lines = kids.map((k) => {
    const size = k.type === "file" ? `, ${formatBytes(nodeSize(k))}` : "";
    return `- ${k.name}${k.type === "dir" ? "/" : ""} (${k.type}${size})`;
  });
  return `${canon} — ${kids.length} item${kids.length === 1 ? "" : "s"}:\n${lines.join("\n")}`;
}

function tReadFile(args: Record<string, unknown>): string {
  const canon = guardPath(args.path);
  const node = requireNode(canon);
  if (node.type === "dir") {
    throw new Error(`${canon} is a directory. Use list_dir instead.`);
  }
  if (typeof node.content !== "string") {
    throw new Error(
      `${canon} is a binary file (mime: ${node.mime ?? "unknown"}) and cannot be read as text.`
    );
  }
  if (node.content.length > MAX_READ_CHARS) {
    return `${canon} (${node.content.length} chars, truncated to ${MAX_READ_CHARS}):\n${node.content.slice(0, MAX_READ_CHARS)}\n...[truncated]`;
  }
  return `${canon} (${node.content.length} chars):\n${node.content}`;
}

function tCreateFile(args: Record<string, unknown>): string {
  const canon = guardPath(args.path);
  if (isRootDir(canon)) throw new Error(`"${canon}" is a protected root directory.`);
  const content = strArg(args, "content", true);
  if (content.length > MAX_CONTENT_CHARS) {
    throw new Error(`"content" exceeds the ${MAX_CONTENT_CHARS}-character limit.`);
  }
  if (resolveNode(canon)) {
    throw new Error(`${canon} already exists — use write_file to overwrite a file, or pick another name.`);
  }
  requireFSReady();
  createFileAt(canon.slice(HOME_PREFIX.length), content);
  return `Created file ${canon} (${content.length} characters).`;
}

function tWriteFile(args: Record<string, unknown>): string {
  const canon = guardPath(args.path);
  const content = strArg(args, "content", true);
  if (content.length > MAX_CONTENT_CHARS) {
    throw new Error(`"content" exceeds the ${MAX_CONTENT_CHARS}-character limit.`);
  }
  const node = requireNode(canon);
  if (node.type !== "file") throw new Error(`${canon} is a directory — write_file targets files only.`);
  const err = useFS.getState().writeFile(node.id, content);
  if (err) throw new Error(err);
  return `Wrote ${content.length} characters to ${canon}.`;
}

function tDeletePath(args: Record<string, unknown>): string {
  const canon = guardPath(args.path);
  if (isRootDir(canon)) {
    throw new Error(
      "Refusing to delete a sandbox root (/home/Projects or /home/Documents). Delete specific items instead."
    );
  }
  const node = requireNode(canon);
  const count = descendantsOf(useFS.getState().nodes, node.id).length;
  const err = useFS.getState().remove(node.id);
  if (err) throw new Error(err);
  return `Deleted ${canon} (${count} item${count === 1 ? "" : "s"} including descendants).`;
}

function tCreateProject(args: Record<string, unknown>): string {
  const name = strArg(args, "name");
  const nameErr = validateFileName(name);
  if (nameErr) throw new Error(`Invalid project name "${name}": ${nameErr}`);
  const filesArg: unknown = args.files;
  if (!Array.isArray(filesArg) || filesArg.length === 0) {
    throw new Error(`"files" must be a non-empty array of {path, content} objects.`);
  }
  if (filesArg.length > MAX_PROJECT_FILES) {
    throw new Error(`"files" is limited to ${MAX_PROJECT_FILES} entries per call.`);
  }
  const projectsRoot = requireNode("/home/Projects");
  if (resolveNode("/home/Projects/" + name)) {
    throw new Error(`A project named "${name}" already exists at /home/Projects/${name}.`);
  }
  requireFSReady();
  const res = useFS.getState().createNode({
    parentId: projectsRoot.id,
    name,
    type: "dir",
    autoRename: false,
  });
  if ("error" in res) throw new Error(res.error);
  const created: string[] = [];
  try {
    for (let i = 0; i < filesArg.length; i++) {
      const f: unknown = filesArg[i];
      if (!f || typeof f !== "object" || Array.isArray(f)) {
        throw new Error(`files[${i}] must be an object with "path" and "content".`);
      }
      const o = f as Record<string, unknown>;
      const rel = typeof o.path === "string" ? o.path : "";
      const content = typeof o.content === "string" ? o.content : "";
      if (!rel.trim()) throw new Error(`files[${i}].path must be a non-empty string.`);
      if (content.length > MAX_CONTENT_CHARS) {
        throw new Error(`files[${i}].content exceeds the ${MAX_CONTENT_CHARS}-character limit.`);
      }
      const full = guardPath("/home/Projects/" + name + "/" + rel, "file path");
      createFileAt(full.slice(HOME_PREFIX.length), content);
      created.push(full);
    }
  } catch (e) {
    // roll back the half-built project so nothing broken is left behind
    useFS.getState().remove(res.id);
    throw e;
  }
  return `Created project /home/Projects/${name} with ${created.length} file${
    created.length === 1 ? "" : "s"
  }:\n${created.join("\n")}`;
}

function tOpenApp(args: Record<string, unknown>): string {
  const appId = strArg(args, "app_id");
  const meta = APP_META[appId];
  if (!meta) {
    throw new Error(`Unknown app "${appId}". Valid ids: ${Object.keys(APP_META).join(", ")}.`);
  }
  useOS.getState().launch(appId);
  return `Launched ${meta.name} (${appId}).`;
}

function tListApps(): string {
  const lines = Object.values(APP_META).map((m) => `- ${m.id} — ${m.name} (${m.tagline})`);
  return `Installed apps:\n${lines.join("\n")}`;
}

function tValidateProject(args: Record<string, unknown>): string {
  const canon = guardPath(args.path);
  const root = requireNode(canon);
  if (root.type !== "dir") throw new Error(`${canon} is not a directory.`);
  const nodes = useFS.getState().nodes;

  const files: FSNode[] = [];
  const stack: string[] = [root.id];
  while (stack.length) {
    const cur = stack.pop() as string;
    for (const n of Object.values(nodes)) {
      if (n.parentId === cur) {
        if (n.type === "dir") stack.push(n.id);
        else files.push(n);
      }
    }
  }

  const issues: string[] = [];
  const hasIndex = files.some((f) => f.parentId === root.id && f.name === "index.html");
  if (!hasIndex) issues.push("- index.html is missing in the project root.");

  const refRe = /(?:href|src)\s*=\s*["']([^"']+)["']/g;
  let checked = 0;
  for (const f of files) {
    if (typeof f.content !== "string") continue;
    const ext = extOf(f.name);
    if (ext !== "html" && ext !== "htm" && ext !== "css") continue;
    const baseDir = f.parentId ?? root.id;
    refRe.lastIndex = 0;
    let m: RegExpExecArray | null = refRe.exec(f.content);
    while (m !== null) {
      const ref = m[1].trim();
      const lower = ref.toLowerCase();
      const external =
        !ref ||
        ref.startsWith("#") ||
        lower.startsWith("http://") ||
        lower.startsWith("https://") ||
        lower.startsWith("//") ||
        lower.startsWith("data:") ||
        lower.startsWith("mailto:") ||
        lower.startsWith("javascript:");
      if (!external) {
        const clean = ref.split("#")[0].split("?")[0].trim();
        if (clean) {
          checked += 1;
          const target = resolvePath(nodes, baseDir, clean);
          const found = target && target.id ? nodes[target.id] : undefined;
          if (!found) issues.push(`- "${ref}" (referenced from ${f.name}) — target not found`);
        }
      }
      m = refRe.exec(f.content);
    }
  }

  const head = `Project ${canon}: ${files.length} file${files.length === 1 ? "" : "s"}, index.html ${
    hasIndex ? "present" : "MISSING"
  }, ${checked} local reference${checked === 1 ? "" : "s"} checked.`;
  return issues.length
    ? `${head}\nIssues:\n${issues.join("\n")}`
    : `${head}\nAll local references resolve. No issues found.`;
}

// ---------------- tool specs ----------------

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "list_dir",
    description: "List the contents of a directory in the NEXUS virtual filesystem.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path, e.g. /home/Projects" },
      },
      required: ["path"],
    },
    risk: "read",
  },
  {
    name: "read_file",
    description: "Read a text file from the virtual filesystem (max 8000 characters returned).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, e.g. /home/Documents/notes.md" },
      },
      required: ["path"],
    },
    risk: "read",
  },
  {
    name: "create_file",
    description:
      "Create a new text file; parent folders are created automatically. Fails if the file already exists (use write_file for that).",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "New file path, e.g. /home/Projects/site/index.html" },
        content: { type: "string", description: "Full text content of the new file" },
      },
      required: ["path", "content"],
    },
    risk: "write",
  },
  {
    name: "write_file",
    description: "Overwrite an existing text file with new content.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Existing file path" },
        content: { type: "string", description: "New full text content" },
      },
      required: ["path", "content"],
    },
    risk: "write",
  },
  {
    name: "delete_path",
    description:
      "Permanently delete a file or folder (recursive). Destructive — requires explicit user approval.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File or folder to delete" },
      },
      required: ["path"],
    },
    risk: "danger",
  },
  {
    name: "create_project",
    description:
      "Create a new project folder under /home/Projects with the given files. Each file is {path, content}; paths are relative to the project root.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project folder name, e.g. portfolio" },
        files: {
          type: "array",
          description: "Files to create",
          items: {
            type: "object",
            properties: {
              path: { type: "string", description: "Relative path, e.g. index.html" },
              content: { type: "string", description: "File text content" },
            },
            required: ["path", "content"],
          },
        },
      },
      required: ["name", "files"],
    },
    risk: "write",
  },
  {
    name: "open_app",
    description: "Launch an installed NEXUS OS application by id.",
    parameters: {
      type: "object",
      properties: {
        app_id: { type: "string", description: "App id, e.g. files, terminal, studio" },
      },
      required: ["app_id"],
    },
    risk: "read",
  },
  {
    name: "list_apps",
    description: "List installed NEXUS OS applications (ids, names, taglines).",
    parameters: { type: "object", properties: {} },
    risk: "read",
  },
  {
    name: "validate_project",
    description:
      "Static checks on a project folder: index.html presence and whether local href/src references resolve to existing files. Returns a report.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project folder path, e.g. /home/Projects/site" },
      },
      required: ["path"],
    },
    risk: "read",
  },
];

// ---------------- validation + execution ----------------

function needStr(a: Record<string, unknown>, key: string): string | null {
  const v = a[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    return `Missing required non-empty string argument "${key}".`;
  }
  return null;
}

/** Allowlist + basic argument type checks. Returns an error string or null. */
export function validateToolCall(name: string, args: unknown): string | null {
  const spec = TOOL_SPECS.find((t) => t.name === name);
  if (!spec) {
    return `Unknown tool "${name}". Available tools: ${TOOL_SPECS.map((t) => t.name).join(", ")}.`;
  }
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return `Arguments for "${name}" must be a JSON object.`;
  }
  const a = args as Record<string, unknown>;
  switch (name) {
    case "list_dir":
    case "read_file":
    case "delete_path":
    case "validate_project":
      return needStr(a, "path");
    case "create_file":
    case "write_file": {
      const e1 = needStr(a, "path");
      if (e1) return e1;
      if (typeof a.content !== "string") return `"content" must be a string.`;
      if (a.content.length > MAX_CONTENT_CHARS) {
        return `"content" exceeds the ${MAX_CONTENT_CHARS}-character limit.`;
      }
      return null;
    }
    case "create_project": {
      const e1 = needStr(a, "name");
      if (e1) return e1;
      const nameErr = validateFileName(a.name as string);
      if (nameErr) return `Invalid project name: ${nameErr}`;
      const files = a.files;
      if (!Array.isArray(files) || files.length === 0) {
        return `"files" must be a non-empty array of {path, content} objects.`;
      }
      if (files.length > MAX_PROJECT_FILES) {
        return `"files" is limited to ${MAX_PROJECT_FILES} entries per call.`;
      }
      for (let i = 0; i < files.length; i++) {
        const f: unknown = files[i];
        if (!f || typeof f !== "object" || Array.isArray(f)) {
          return `files[${i}] must be an object with "path" and "content".`;
        }
        const o = f as Record<string, unknown>;
        if (typeof o.path !== "string" || !o.path.trim()) {
          return `files[${i}].path must be a non-empty string.`;
        }
        if (typeof o.content !== "string") {
          return `files[${i}].content must be a string.`;
        }
        if (o.content.length > MAX_CONTENT_CHARS) {
          return `files[${i}].content exceeds the ${MAX_CONTENT_CHARS}-character limit.`;
        }
      }
      return null;
    }
    case "open_app": {
      const e = needStr(a, "app_id");
      if (e) return e;
      if (!APP_META[a.app_id as string]) {
        return `"${String(a.app_id)}" is not an installed app. Valid ids: ${Object.keys(APP_META).join(", ")}.`;
      }
      return null;
    }
    case "list_apps":
      return null;
    default:
      return `Unknown tool "${name}".`;
  }
}

/** Execute a tool. Throws Error with an honest message on invalid calls/failures. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ summary: string }> {
  const vErr = validateToolCall(name, args);
  if (vErr) throw new Error(vErr);
  switch (name) {
    case "list_dir":
      return { summary: tListDir(args) };
    case "read_file":
      return { summary: tReadFile(args) };
    case "create_file":
      return { summary: tCreateFile(args) };
    case "write_file":
      return { summary: tWriteFile(args) };
    case "delete_path":
      return { summary: tDeletePath(args) };
    case "create_project":
      return { summary: tCreateProject(args) };
    case "open_app":
      return { summary: tOpenApp(args) };
    case "list_apps":
      return { summary: tListApps() };
    case "validate_project":
      return { summary: tValidateProject(args) };
    default:
      throw new Error(`Unknown tool "${name}".`);
  }
}

/**
 * Approval-aware execution used by the agent runner: write/danger tools
 * await the user's decision before running. Denial is reported as a tool
 * result (not an exception) so the model can adapt.
 */
export async function executeToolWithApproval(
  name: string,
  args: Record<string, unknown>,
  requestApproval: (info: { name: string; args: Record<string, unknown> }) => Promise<boolean>
): Promise<{ summary: string }> {
  const vErr = validateToolCall(name, args);
  if (vErr) throw new Error(vErr);
  const spec = TOOL_SPECS.find((t) => t.name === name);
  if (spec && (spec.risk === "write" || spec.risk === "danger")) {
    let approved = false;
    try {
      approved = await requestApproval({ name, args });
    } catch {
      approved = false;
    }
    if (!approved) {
      return {
        summary: `The user DENIED the "${name}" action. Nothing was changed. Do not retry the same call; adjust your plan or ask the user what to do instead.`,
      };
    }
  }
  return executeTool(name, args);
}
