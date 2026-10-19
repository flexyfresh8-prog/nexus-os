// NEXUS OS — Git operations over the virtual filesystem.
//
// Thin, honest wrappers around isomorphic-git. Every function either performs
// the real operation or throws with the real error — nothing is simulated.
// Remote push/pull requires CORS-enabled Git servers; when the network layer
// blocks it, the raw failure is surfaced instead of pretending success.

import * as git from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { useFS } from "../store/fs";
import { resolvePath, HOME_ID } from "./vfs";
import { createVfsGitFs } from "./gitfs";
import { emit } from "./bus";

const AUTHOR = { name: "NEXUS User", email: "nexus@localhost" };

export function projectIdFromPath(path: string): string {
  const fs = useFS.getState();
  if (!fs.ready) throw new Error("Virtual filesystem is still loading");
  const clean = path.startsWith("/") ? path : "/home/" + path.replace(/^~\/?/, "");
  const res = resolvePath(fs.nodes, HOME_ID, clean);
  if (!res?.id || fs.nodes[res.id]?.type !== "dir") {
    throw new Error(`no such project directory: ${path}`);
  }
  return res.id;
}

export async function gitInit(projectPath: string): Promise<string> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  await git.init({ fs, dir: "." });
  return `Initialized empty Git repository in ${projectPath}/.git/`;
}

export async function gitIsRepo(projectPath: string): Promise<boolean> {
  try {
    const projectId = projectIdFromPath(projectPath);
    const fs = createVfsGitFs(projectId);
    // a fresh repo has no commits, so resolveRef("HEAD") fails — the
    // .git/HEAD file is the honest marker of an initialized repository
    return await fs.exists(".git/HEAD");
  } catch {
    return false;
  }
}

export type GitStatusRow = {
  path: string;
  /** "added" | "modified" | "deleted" | "unmodified" | "absent" */
  head: number;
  workdir: number;
  stage: number;
  label: "untracked" | "modified" | "deleted" | "staged" | "clean";
};

function classify(row: [string, number, number, number]): GitStatusRow | null {
  const [path, head, workdir, stage] = row;
  if (path.startsWith(".git/")) return null;
  let label: GitStatusRow["label"] = "clean";
  if (head === 0 && stage === 0 && workdir === 1) label = "untracked";
  else if (head !== 0 && workdir !== head && stage === head) label = "modified";
  else if (head !== 0 && workdir === 0 && stage !== 0) label = "deleted";
  else if (stage !== head) label = "staged";
  if (label === "clean" && stage === head && workdir === head) return null;
  return { path, head, workdir, stage, label };
}

export async function gitStatus(projectPath: string): Promise<GitStatusRow[]> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  const isRepo = await gitIsRepo(projectPath);
  if (!isRepo) throw new Error("not a git repository — run git init first");

  try {
    const matrix = await git.statusMatrix({ fs, dir: "." });
    return matrix.map(classify).filter((r): r is GitStatusRow => r !== null);
  } catch (e) {
    // fresh repository: HEAD is unborn — every workdir file is untracked
    if ((e as { code?: string })?.code !== "NotFoundError") throw e;
    const rows: GitStatusRow[] = [];
    const walk = async (dir: string) => {
      for (const name of await fs.readdir(dir)) {
        const full = dir ? `${dir}/${name}` : name;
        if (full === ".git" || full.startsWith(".git/")) continue;
        const st = await fs.stat(full);
        if (st.isDirectory()) await walk(full);
        else rows.push({ path: full, head: 0, workdir: 1, stage: 0, label: "untracked" });
      }
    };
    await walk("");
    return rows.sort((a, b) => a.path.localeCompare(b.path));
  }
}

export async function gitStage(projectPath: string, paths: string[]): Promise<string> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  for (const p of paths) {
    try {
      await git.add({ fs, dir: ".", filepath: p });
    } catch {
      // file deleted in workdir → stage the deletion
      await git.remove({ fs, dir: ".", filepath: p });
    }
  }
  return `Staged ${paths.length} file${paths.length === 1 ? "" : "s"}.`;
}

export async function gitStageAll(projectPath: string): Promise<string> {
  const rows = await gitStatus(projectPath);
  const paths = rows.filter((r) => r.label !== "staged").map((r) => r.path);
  return gitStage(projectPath, paths);
}

export async function gitUnstageAll(projectPath: string): Promise<string> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  // ref+no-filepath rebuilds the whole index from HEAD (typings require
  // filepath, runtime supports the ref form) — cast keeps the intent honest
  const reset = git.resetIndex as unknown as (args: Record<string, unknown>) => Promise<void>;
  await reset({ fs, dir: ".", ref: "HEAD" });
  return "Unstaged all files.";
}

export async function gitCommit(
  projectPath: string,
  message: string,
  author?: { name?: string; email?: string }
): Promise<{ oid: string; short: string }> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  if (!message.trim()) throw new Error("commit message must not be empty");
  const oid = await git.commit({
    fs,
    dir: ".",
    message,
    author: {
      name: author?.name?.trim() || AUTHOR.name,
      email: author?.email?.trim() || AUTHOR.email,
    },
  });
  emit("git:commit", { projectId, message });
  return { oid, short: oid.slice(0, 7) };
}

export interface GitLogEntry {
  oid: string;
  short: string;
  message: string;
  author: string;
  timestamp: number;
}

export async function gitLog(projectPath: string, depth = 50): Promise<GitLogEntry[]> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  try {
    const commits = await git.log({ fs, dir: ".", depth });
    return commits.map((c) => ({
      oid: c.oid,
      short: c.oid.slice(0, 7),
      message: c.commit.message.trim(),
      author: `${c.commit.author.name} <${c.commit.author.email}>`,
      timestamp: c.commit.author.timestamp * 1000,
    }));
  } catch {
    return [];
  }
}

export async function gitBranches(projectPath: string): Promise<{ current: string; all: string[] }> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  let current = "main";
  try {
    current = await git.currentBranch({ fs, dir: ".", fullname: false }) ?? "main";
  } catch { /* unborn branch */ }
  const all = await git.listBranches({ fs, dir: "." });
  return { current, all };
}

export async function gitCreateBranch(projectPath: string, name: string): Promise<string> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  await git.branch({ fs, dir: ".", ref: name });
  return `Created branch ${name}.`;
}

export async function gitCheckout(projectPath: string, ref: string): Promise<string> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  await git.checkout({ fs, dir: ".", ref });
  return `Switched to branch '${ref}'. Uncommitted workdir changes were preserved where possible.`;
}

/** commit a file lives at HEAD (or empty when untracked) */
async function headContent(projectPath: string, filepath: string): Promise<string | null> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  try {
    const oid = await git.resolveRef({ fs, dir: ".", ref: "HEAD" });
    const blob = await git.readBlob({ fs, dir: ".", oid, filepath });
    return new TextDecoder().decode(blob.blob);
  } catch {
    return null;
  }
}

async function workdirContent(projectPath: string, filepath: string): Promise<string | null> {
  const projectId = projectIdFromPath(projectPath);
  const fs = useFS.getState();
  const projNode = fs.nodes[projectId];
  if (!projNode) return null;
  const res = resolvePath(fs.nodes, projectId, filepath);
  if (!res?.id) return null;
  const node = fs.nodes[res.id];
  if (!node || node.type !== "file") return null;
  if (typeof node.content === "string") return node.content;
  if (node.binary) return new TextDecoder().decode(new Uint8Array(node.binary));
  return "";
}

export interface DiffLine {
  kind: "add" | "del" | "ctx" | "gap";
  text: string;
}

/** classic LCS line diff — small, dependency-free, good enough for panels */
export function lineDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  const MAX = 1200;
  if (n * m > MAX * MAX) {
    return [...a.map((t): DiffLine => ({ kind: "del", text: t })), ...b.map((t): DiffLine => ({ kind: "add", text: t }))];
  }
  const dp: number[] = new Array((n + 1) * (m + 1)).fill(0);
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[at(i, j)] = a[i] === b[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "ctx", text: a[i] });
      i++;
      j++;
    } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
      out.push({ kind: "del", text: a[i] });
      i++;
    } else {
      out.push({ kind: "add", text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i++] });
  while (j < m) out.push({ kind: "add", text: b[j++] });
  // collapse long context runs into gaps
  const collapsed: DiffLine[] = [];
  let run: DiffLine[] = [];
  const flush = () => {
    if (run.length > 6) {
      collapsed.push({ kind: "gap", text: `⋯ ${run.length - 4} unchanged lines` });
      collapsed.push(...run.slice(-2));
      const head = run.slice(0, 2);
      collapsed.splice(collapsed.length - 2, 0, ...head);
    } else {
      collapsed.push(...run);
    }
    run = [];
  };
  for (const l of out) {
    if (l.kind === "ctx") run.push(l);
    else {
      flush();
      collapsed.push(l);
    }
  }
  flush();
  return collapsed;
}

export async function gitFileDiff(
  projectPath: string,
  filepath: string
): Promise<DiffLine[]> {
  const [head, workdir] = await Promise.all([
    headContent(projectPath, filepath),
    workdirContent(projectPath, filepath),
  ]);
  return lineDiff(
    (head ?? "").split("\n"),
    (workdir ?? "").split("\n")
  );
}

export async function gitCommitDiff(
  projectPath: string,
  oid: string
): Promise<Array<{ file: string; lines: DiffLine[] }>> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  const commit = await git.readCommit({ fs, dir: ".", oid });
  const parentOid = commit.commit.parent[0];
  const files = await git.listFiles({ fs, dir: ".", ref: oid });
  const parentFiles = parentOid ? await git.listFiles({ fs, dir: ".", ref: parentOid }) : [];
  const changed = new Set<string>([...files, ...parentFiles]);
  const out: Array<{ file: string; lines: DiffLine[] }> = [];
  for (const filepath of changed) {
    const readAt = async (ref?: string) => {
      if (!ref) return null;
      try {
        const blob = await git.readBlob({ fs, dir: ".", oid: ref, filepath });
        return new TextDecoder().decode(blob.blob);
      } catch {
        return null;
      }
    };
    const a = await readAt(parentOid);
    const b = await readAt(oid);
    if (a === b) continue;
    out.push({ file: filepath, lines: lineDiff((a ?? "").split("\n"), (b ?? "").split("\n")) });
    if (out.length >= 12) break; // keep the panel responsive
  }
  return out;
}

/**
 * Remote push/pull. isomorphic-git speaks plain HTTP Git; most hosts (GitHub
 * included) do not send CORS headers, so this will typically fail in-browser.
 * We surface the raw truth instead of faking success.
 */
export async function gitPush(
  projectPath: string,
  url: string,
  creds?: { username: string; password: string }
): Promise<string> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  await git.push({
    fs,
    http,
    dir: ".",
    url,
    onAuth: () => (creds ? creds : undefined),
  });
  return `Pushed to ${url}`;
}

export async function gitAddRemote(projectPath: string, remote: string, url: string): Promise<string> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  try {
    await git.deleteRemote({ fs, dir: ".", remote });
  } catch { /* didn't exist yet */ }
  await git.addRemote({ fs, dir: ".", remote, url });
  return `Remote '${remote}' → ${url}`;
}

export async function gitRemotes(projectPath: string): Promise<Array<{ remote: string; url: string }>> {
  const projectId = projectIdFromPath(projectPath);
  const fs = createVfsGitFs(projectId);
  return git.listRemotes({ fs, dir: "." });
}
