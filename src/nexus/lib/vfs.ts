// NEXUS OS — virtual filesystem: pure path/tree logic (no React)
// All operations are symbolic; nodes live in a flat map. Paths can never
// escape the virtual root because resolution only walks the node tree.

import type { FSNode } from "../types";

export const ROOT_ID = "root";
export const HOME_ID = "home";

export const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "json", "js", "jsx", "ts", "tsx", "css", "scss",
  "html", "htm", "xml", "yml", "yaml", "csv", "svg", "sh", "py", "toml",
  "ini", "log", "gitignore", "env", "conf",
]);

export const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
export const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);
export const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "avi"]);
export const CODE_EXTS = new Set([
  "js", "jsx", "ts", "tsx", "css", "scss", "html", "htm", "json", "xml",
  "yml", "yaml", "py", "sh", "md", "svg", "toml", "csv",
]);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function isTextFile(name: string, mime?: string): boolean {
  if (mime?.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "image/svg+xml") return true;
  return TEXT_EXTS.has(extOf(name));
}

export function nodeSize(node: FSNode): number {
  if (node.type === "dir") return 0;
  if (typeof node.content === "string") return new Blob([node.content]).size;
  return node.binary?.byteLength ?? 0;
}

/** File name validation — returns an error message or null when valid. */
export function validateFileName(name: string): string | null {
  if (!name || !name.trim()) return "Name cannot be empty";
  if (name.length > 120) return "Name is too long (max 120 characters)";
  if (/[\\/]/.test(name)) return "Name cannot contain slashes";
  if (name === "." || name === "..") return "Invalid name";
  if (/[\u0000-\u001f]/.test(name)) return "Name contains control characters";
  return null;
}

/** Absolute VFS path of a node, e.g. /home/Documents/notes.txt */
export function pathOf(nodes: Record<string, FSNode>, id: string): string {
  const parts: string[] = [];
  let cur: FSNode | undefined = nodes[id];
  let guard = 0;
  while (cur && cur.parentId !== null && guard++ < 512) {
    parts.unshift(cur.name);
    cur = nodes[cur.parentId];
  }
  return "/" + parts.join("/");
}

/** Path with ~ substitution for the home directory */
export function displayPath(nodes: Record<string, FSNode>, id: string): string {
  const p = pathOf(nodes, id);
  const home = pathOf(nodes, HOME_ID);
  if (p === home) return "~";
  if (p.startsWith(home + "/")) return "~" + p.slice(home.length);
  return p;
}

export interface ResolveResult {
  id: string;
  /** id of the parent dir when the final segment is missing (for creation) */
  parentId?: string;
  missingName?: string;
}

/**
 * Resolve a path string against a working directory.
 * Supports: "/", "~", "~user"-style tilde-free paths, ".", "..", relative paths.
 * Returns the node id, or (when only the final segment is missing) enough info
 * to create it — enabling `touch a/b/c.txt` style flows.
 */
export function resolvePath(
  nodes: Record<string, FSNode>,
  cwdId: string,
  input: string
): ResolveResult | null {
  if (!nodes[cwdId] || nodes[cwdId].type !== "dir") return null;
  let startId = cwdId;
  let raw = input.trim();
  if (!raw) return { id: cwdId };

  if (raw === "~" || raw.startsWith("~/")) {
    startId = HOME_ID in nodes ? HOME_ID : ROOT_ID;
    raw = raw.slice(1);
    if (raw.startsWith("/")) raw = raw.slice(1);
  } else if (raw.startsWith("/")) {
    startId = ROOT_ID;
    raw = raw.slice(1);
  }

  const segments = raw.split("/").filter((s) => s.length > 0);
  let cur = startId;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === ".") continue;
    if (seg === "..") {
      const parent = nodes[cur]?.parentId;
      cur = parent ?? ROOT_ID;
      continue;
    }
    if (!nodes[cur] || nodes[cur].type !== "dir") return null;
    const child = findChild(nodes, cur, seg);
    if (child) {
      cur = child.id;
    } else if (i === segments.length - 1) {
      return { id: "", parentId: cur, missingName: seg };
    } else {
      return null;
    }
  }
  return { id: cur };
}

export function findChild(
  nodes: Record<string, FSNode>,
  parentId: string,
  name: string
): FSNode | undefined {
  return Object.values(nodes).find((n) => n.parentId === parentId && n.name === name);
}

export function childrenOf(
  nodes: Record<string, FSNode>,
  id: string
): FSNode[] {
  return Object.values(nodes)
    .filter((n) => n.parentId === id)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
}

/** Collect a node and all of its descendants (for recursive delete) */
export function descendantsOf(
  nodes: Record<string, FSNode>,
  id: string
): string[] {
  const out: string[] = [id];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const n of Object.values(nodes)) {
      if (n.parentId === cur) {
        out.push(n.id);
        stack.push(n.id);
      }
    }
  }
  return out;
}

/** Would moving `id` under `target` create a cycle? */
export function createsCycle(
  nodes: Record<string, FSNode>,
  id: string,
  target: string
): boolean {
  let cur: string | null = target;
  let guard = 0;
  while (cur && guard++ < 512) {
    if (cur === id) return true;
    cur = nodes[cur]?.parentId ?? null;
  }
  return false;
}

export function uniqueName(
  nodes: Record<string, FSNode>,
  parentId: string,
  desired: string
): string {
  if (!findChild(nodes, parentId, desired)) return desired;
  const dot = desired.lastIndexOf(".");
  const base = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : "";
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!findChild(nodes, parentId, candidate)) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

export function mimeForFile(name: string): string {
  const ext = extOf(name);
  const map: Record<string, string> = {
    txt: "text/plain", md: "text/markdown", json: "application/json",
    html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript",
    ts: "text/typescript", svg: "image/svg+xml", png: "image/png",
    jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", mp4: "video/mp4",
    webm: "video/webm", pdf: "application/pdf", csv: "text/csv",
  };
  return map[ext] ?? "application/octet-stream";
}
