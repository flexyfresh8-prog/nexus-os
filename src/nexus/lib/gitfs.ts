// NEXUS OS — isomorphic-git filesystem adapter over the NEXUS virtual FS.
//
// This makes Git REAL: commits, branches and history are genuine Git object
// databases (loose objects inside <project>/.git, visible in the Files app)
// stored in IndexedDB through the normal VFS persistence path. No fakery —
// if isomorphic-git accepts our fs, standard tooling could read the repo.

import { useFS } from "../store/fs";
import { resolvePath, validateFileName } from "./vfs";
import type { FSNode } from "../types";

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function resolveFromProject(projectId: string, filepath: string) {
  const fs = useFS.getState();
  if (!fs.ready) throw new Error("Virtual filesystem is still loading");
  const clean = filepath.replace(/\\/g, "/").replace(/^\/+/, "");
  const res = resolvePath(fs.nodes, projectId, clean);
  return { fs, res };
}

function nodeOf(projectId: string, filepath: string): FSNode | null {
  const { fs, res } = resolveFromProject(projectId, filepath);
  if (!res || !res.id) return null;
  return fs.nodes[res.id] ?? null;
}

function parentOf(projectId: string, filepath: string): { parentId: string; name: string } {
  const fs = useFS.getState();
  const clean = filepath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  const slash = clean.lastIndexOf("/");
  const name = slash >= 0 ? clean.slice(slash + 1) : clean;
  const dirPart = slash >= 0 ? clean.slice(0, slash) : "";
  let parentId = projectId;
  if (dirPart) {
    const r = resolvePath(fs.nodes, projectId, dirPart);
    if (!r || !r.id || fs.nodes[r.id]?.type !== "dir") {
      throw new Error(`no such directory: ${dirPart}`);
    }
    parentId = r.id;
  }
  return { parentId, name };
}

/**
 * Promise-style fs plugin for isomorphic-git, backed by the NEXUS VFS,
 * rooted at a project directory node.
 */
export function createVfsGitFs(projectId: string) {
  const check = useFS.getState().nodes[projectId];
  if (!check || check.type !== "dir") throw new Error("Project directory not found");

  return {
    async readFile(filepath: string, opts?: { encoding?: string } | string): Promise<Uint8Array | string> {
      const node = nodeOf(projectId, filepath);
      if (!node) {
        const e = new Error(`ENOENT: ${filepath}`) as Error & { code?: string };
        e.code = "ENOENT";
        throw e;
      }
      const encoding = typeof opts === "string" ? opts : opts?.encoding;
      // binary wins over the createNode "" content default
      if (node.binary) {
        const bytes = new Uint8Array(node.binary.slice(0));
        return encoding === "utf8" ? DEC.decode(bytes) : bytes;
      }
      if (typeof node.content === "string") return encoding === "utf8" ? node.content : ENC.encode(node.content);
      return encoding === "utf8" ? "" : new Uint8Array(0);
    },

    async writeFile(filepath: string, data: Uint8Array | string): Promise<void> {
      const fs = useFS.getState();
      const bytes = typeof data === "string" ? ENC.encode(data) : data;
      const existing = nodeOf(projectId, filepath);
      if (existing && existing.type === "file") {
        const err = fs.writeBinary(existing.id, bytes.slice().buffer as ArrayBuffer, "application/octet-stream");
        if (err) throw new Error(err);
        return;
      }
      const { parentId, name } = parentOf(projectId, filepath);
      const nameErr = validateFileName(name);
      if (nameErr) throw new Error(nameErr);
      const res = fs.createNode({
        parentId,
        name,
        type: "file",
        binary: bytes.slice().buffer as ArrayBuffer,
        mime: "application/octet-stream",
      });
      if ("error" in res) throw new Error(res.error);
    },

    async unlink(filepath: string): Promise<void> {
      const node = nodeOf(projectId, filepath);
      if (!node) {
        const e = new Error(`ENOENT: ${filepath}`) as Error & { code?: string };
        e.code = "ENOENT";
        throw e;
      }
      if (node.type !== "file") throw new Error(`EISDIR: ${filepath}`);
      const err = useFS.getState().remove(node.id);
      if (err) throw new Error(err);
    },

    async readdir(filepath: string): Promise<string[]> {
      const node = nodeOf(projectId, filepath);
      if (!node) {
        const e = new Error(`ENOENT: ${filepath}`) as Error & { code?: string };
        e.code = "ENOENT";
        throw e;
      }
      if (node.type !== "dir") throw new Error(`ENOTDIR: ${filepath}`);
      const fs = useFS.getState();
      return Object.values(fs.nodes)
        .filter((n) => n.parentId === node.id)
        .map((n) => n.name);
    },

    async mkdir(filepath: string): Promise<void> {
      // git writes nested paths (.git/objects/xx) — behave like mkdir -p
      const clean = filepath.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
      if (!clean) return;
      const fs = useFS.getState();
      const segs = clean.split("/").filter(Boolean);
      let cur = projectId;
      for (const seg of segs) {
        const existing = (function find(parentId: string): FSNode | undefined {
          return Object.values(useFS.getState().nodes).find((n) => n.parentId === parentId && n.name === seg);
        })(cur);
        if (existing) {
          if (existing.type !== "dir") throw new Error(`ENOTDIR: ${seg}`);
          cur = existing.id;
        } else {
          const res = useFS.getState().createNode({ parentId: cur, name: seg, type: "dir", autoRename: false });
          if ("error" in res) throw new Error(res.error);
          cur = res.id;
        }
      }
      void fs;
    },

    async rmdir(filepath: string, opts?: { recursive?: boolean }): Promise<void> {
      const node = nodeOf(projectId, filepath);
      if (!node) {
        const e = new Error(`ENOENT: ${filepath}`) as Error & { code?: string };
        e.code = "ENOENT";
        throw e;
      }
      if (node.type !== "dir") throw new Error(`ENOTDIR: ${filepath}`);
      const fs = useFS.getState();
      const hasKids = Object.values(fs.nodes).some((n) => n.parentId === node.id);
      if (hasKids && !opts?.recursive) {
        const e = new Error(`ENOTEMPTY: ${filepath}`) as Error & { code?: string };
        e.code = "ENOTEMPTY";
        throw e;
      }
      const err = useFS.getState().remove(node.id);
      if (err) throw new Error(err);
    },

    async stat(filepath: string): Promise<{
      isDirectory(): boolean;
      isFile(): boolean;
      isSymbolicLink(): boolean;
      size: number;
      mode: number;
      mtimeMs: number;
      ctimeMs: number;
    }> {
      const node = nodeOf(projectId, filepath);
      if (!node) {
        const e = new Error(`ENOENT: ${filepath}`) as Error & { code?: string };
        e.code = "ENOENT";
        throw e;
      }
      const size =
        node.type === "dir"
          ? 0
          : typeof node.content === "string"
            ? new Blob([node.content]).size
            : (node.binary?.byteLength ?? 0);
      return {
        isDirectory: () => node.type === "dir",
        isFile: () => node.type === "file",
        isSymbolicLink: () => false,
        size,
        mode: node.type === "dir" ? 0o40000 : 0o100644,
        mtimeMs: node.modified,
        ctimeMs: node.created,
      };
    },

    async lstat(filepath: string) {
      return this.stat(filepath);
    },

    async readlink(): Promise<string> {
      throw new Error("symlinks are not supported in the NEXUS filesystem");
    },

    async symlink(): Promise<void> {
      throw new Error("symlinks are not supported in the NEXUS filesystem");
    },

    // isomorphic-git calls fs.exists in some code paths
    async exists(filepath: string): Promise<boolean> {
      return nodeOf(projectId, filepath) !== null;
    },
  };
}

export type VfsGitFs = ReturnType<typeof createVfsGitFs>;
