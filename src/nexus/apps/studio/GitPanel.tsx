"use client";

// NEXUS OS — Git panel for Nexus Studio.
// Real version control on the virtual project via isomorphic-git
// (see lib/gitops.ts). Every action either really happens or really fails.

import { useCallback, useEffect, useState } from "react";
import {
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import * as gitops from "../../lib/gitops";
import { pathOf } from "../../lib/vfs";
import { useFS } from "../../store/fs";

const KIND_CLS: Record<string, string> = {
  untracked: "text-amber-300",
  modified: "text-sky-300",
  deleted: "text-red-400",
  staged: "text-emerald-300",
  clean: "text-[var(--nx-text-dim)]",
};

export function GitPanel({ projectId }: { projectId: string }) {
  const nodes = useFS((s) => s.nodes);
  const [rows, setRows] = useState<gitops.GitStatusRow[]>([]);
  const [log, setLog] = useState<gitops.GitLogEntry[]>([]);
  const [branchInfo, setBranchInfo] = useState<{ current: string; all: string[] }>({ current: "", all: [] });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"changes" | "history" | "branches">("changes");
  const [diffFile, setDiffFile] = useState<string | null>(null);
  const [diffLines, setDiffLines] = useState<gitops.DiffLine[]>([]);
  const [isRepo, setIsRepo] = useState<boolean | null>(null);

  const projectPath = pathOf(nodes, projectId);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const repo = await gitops.gitIsRepo(projectPath);
      setIsRepo(repo);
      if (!repo) {
        setRows([]);
        setLog([]);
        return;
      }
      const [r, l, b] = await Promise.all([
        gitops.gitStatus(projectPath),
        gitops.gitLog(projectPath),
        gitops.gitBranches(projectPath),
      ]);
      setRows(r);
      setLog(l);
      setBranchInfo(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const showDiff = async (file: string) => {
    setDiffFile(file);
    setDiffLines([]);
    try {
      setDiffLines(await gitops.gitFileDiff(projectPath, file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (isRepo === null) {
    return <div className="p-4 text-sm text-[var(--nx-text-dim)]">Checking repository…</div>;
  }

  if (!isRepo) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <GitBranch size={28} className="text-[var(--nx-text-dim)]" />
        <p className="text-sm text-[var(--nx-text-dim)]">
          This project is not under version control yet. Initializing creates a real Git
          repository — its <code className="rounded bg-white/5 px-1">.git</code> directory is stored
          inside the project and appears in Files.
        </p>
        <button
          onClick={() => run(() => gitops.gitInit(projectPath))}
          disabled={busy}
          className="rounded-lg bg-[rgba(var(--nx-accent-rgb),0.15)] px-4 py-2 text-sm text-[var(--nx-accent)] transition hover:bg-[rgba(var(--nx-accent-rgb),0.25)] disabled:opacity-50"
        >
          Initialize repository
        </button>
        {error ? <p className="max-w-md text-xs text-red-400">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2">
        <GitBranch size={13} className="text-[var(--nx-accent)]" />
        <span className="text-xs font-medium">{branchInfo.current || "main"}</span>
        <div className="ml-2 flex gap-1 text-[11px]">
          {(["changes", "history", "branches"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-2 py-0.5 capitalize transition-colors ${
                tab === t ? "bg-white/10 text-[var(--nx-text)]" : "text-[var(--nx-text-dim)] hover:bg-white/5"
              }`}
            >
              {t}
              {t === "changes" && rows.length ? ` (${rows.length})` : ""}
            </button>
          ))}
        </div>
        <button
          onClick={() => void refresh()}
          title="Refresh"
          className="ml-auto rounded-md p-1 text-[var(--nx-text-dim)] transition hover:bg-white/5 hover:text-[var(--nx-text)]"
        >
          <RefreshCw size={13} className={busy ? "nx-spin" : ""} />
        </button>
      </div>

      {error ? (
        <div className="border-b border-red-400/20 bg-red-400/10 px-3 py-1.5 text-[11px] text-red-300">{error}</div>
      ) : null}

      {tab === "changes" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="nx-scroll min-h-0 flex-1 overflow-y-auto px-2 py-2">
            {rows.length === 0 ? (
              <p className="p-3 text-xs text-[var(--nx-text-dim)]">Working tree clean — nothing to commit.</p>
            ) : (
              rows.map((r) => (
                <button
                  key={r.path}
                  onClick={() => void showDiff(r.path)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/5"
                >
                  <span className={`w-[68px] shrink-0 font-medium ${KIND_CLS[r.label]}`}>{r.label}</span>
                  <span className="truncate font-mono">{r.path}</span>
                  <span
                    role="button"
                    aria-label="Stage file"
                    tabIndex={-1}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void run(() => gitops.gitStage(projectPath, [r.path]));
                    }}
                    className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] text-[var(--nx-text-dim)] opacity-70 transition hover:bg-white/10 hover:text-[var(--nx-text)]"
                  >
                    stage
                  </span>
                </button>
              ))
            )}
          </div>

          {diffFile ? (
            <div className="max-h-[38%] min-h-0 shrink-0 overflow-y-auto border-t border-white/5 bg-black/20 px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium text-[var(--nx-text-dim)]">diff · {diffFile}</span>
                <button onClick={() => setDiffFile(null)} className="text-[11px] text-[var(--nx-text-dim)] hover:text-[var(--nx-text)]">
                  close
                </button>
              </div>
              {diffLines.map((l, i) => (
                <div
                  key={i}
                  className={`whitespace-pre-wrap font-mono text-[11px] leading-[1.45] ${
                    l.kind === "add" ? "bg-emerald-400/10 text-emerald-300" : l.kind === "del" ? "bg-red-400/10 text-red-300" : l.kind === "gap" ? "text-[var(--nx-text-dim)]" : "text-[var(--nx-text-dim)]"
                  }`}
                >
                  {l.kind === "add" ? "+ " : l.kind === "del" ? "- " : "  "}
                  {l.text}
                </div>
              ))}
            </div>
          ) : null}

          {/* commit box */}
          <div className="shrink-0 border-t border-white/5 p-2">
            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && message.trim()) {
                    void run(async () => {
                      const res = await gitops.gitCommit(projectPath, message.trim());
                      setMessage("");
                      return `Committed ${res.short}`;
                    });
                  }
                }}
                placeholder="Commit message…"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs outline-none placeholder:text-[var(--nx-text-dim)] focus:border-[rgba(var(--nx-accent-rgb),0.5)]"
              />
              <button
                onClick={() =>
                  void run(async () => {
                    if (!message.trim()) throw new Error("commit message must not be empty");
                    const res = await gitops.gitCommit(projectPath, message.trim());
                    setMessage("");
                    return `Committed ${res.short}`;
                  })
                }
                disabled={busy || !message.trim()}
                className="flex shrink-0 items-center gap-1 rounded-lg bg-[rgba(var(--nx-accent-rgb),0.15)] px-3 py-1.5 text-xs text-[var(--nx-accent)] transition hover:bg-[rgba(var(--nx-accent-rgb),0.25)] disabled:opacity-40"
              >
                <GitCommitHorizontal size={13} /> Commit
              </button>
            </div>
            <div className="mt-1.5 flex gap-2 text-[10px] text-[var(--nx-text-dim)]">
              <button onClick={() => void run(() => gitops.gitStageAll(projectPath))} className="rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-[var(--nx-text)]">
                stage all
              </button>
              <button onClick={() => void run(() => gitops.gitUnstageAll(projectPath))} className="rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-[var(--nx-text)]">
                unstage all
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="nx-scroll min-h-0 flex-1 overflow-y-auto p-3">
          {log.length === 0 ? (
            <p className="text-xs text-[var(--nx-text-dim)]">No commits yet.</p>
          ) : (
            <div className="space-y-2">
              {log.map((c, i) => (
                <div key={c.oid} className="relative rounded-lg border border-white/5 bg-white/[0.02] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-[var(--nx-accent)]">{c.short}</span>
                    <span className="text-xs font-medium">{c.message.split("\n")[0]}</span>
                    {i === 0 ? (
                      <span className="ml-auto rounded-full bg-[rgba(var(--nx-accent-rgb),0.15)] px-2 py-0.5 text-[9px] uppercase tracking-wide text-[var(--nx-accent)]">HEAD</span>
                    ) : null}
                  </div>
                  <div className="mt-1 text-[10px] text-[var(--nx-text-dim)]">
                    {c.author} · {new Date(c.timestamp).toLocaleString()}
                  </div>
                  <button
                    onClick={() =>
                      void run(async () => {
                        const diffs = await gitops.gitCommitDiff(projectPath, c.oid);
                        setDiffFile(null);
                        setDiffLines(diffs.flatMap((d) => [{ kind: "gap" as const, text: `── ${d.file} ──` }, ...d.lines]));
                        setTab("changes");
                        return `Loaded diff for ${c.short}`;
                      })
                    }
                    className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--nx-text-dim)] transition hover:text-[var(--nx-text)]"
                  >
                    <RotateCcw size={10} /> view commit diff
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "branches" && (
        <BranchesTab projectId={projectId} projectPath={projectPath} branchInfo={branchInfo} busy={busy} run={run} onRefresh={refresh} />
      )}
    </div>
  );
}

function BranchesTab({
  projectPath,
  branchInfo,
  busy,
  run,
  onRefresh,
}: {
  projectId: string;
  projectPath: string;
  branchInfo: { current: string; all: string[] };
  busy: boolean;
  run: (fn: () => Promise<string>) => Promise<void>;
  onRefresh: () => Promise<void>;
}) {
  const [newBranch, setNewBranch] = useState("");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="space-y-1">
        {branchInfo.all.map((b) => (
          <div key={b} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/5">
            <GitBranch size={12} className={b === branchInfo.current ? "text-[var(--nx-accent)]" : "text-[var(--nx-text-dim)]"} />
            <span className={b === branchInfo.current ? "font-medium text-[var(--nx-text)]" : "text-[var(--nx-text-dim)]"}>{b}</span>
            {b === branchInfo.current ? (
              <span className="ml-auto text-[10px] text-[var(--nx-accent)]">current</span>
            ) : (
              <button
                onClick={() =>
                  void run(async () => {
                    const msg = await gitops.gitCheckout(projectPath, b);
                    await onRefresh();
                    return msg;
                  })
                }
                disabled={busy}
                className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)] disabled:opacity-40"
              >
                <GitMerge size={10} /> switch
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={newBranch}
          onChange={(e) => setNewBranch(e.target.value)}
          placeholder="new branch name…"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-xs outline-none placeholder:text-[var(--nx-text-dim)] focus:border-[rgba(var(--nx-accent-rgb),0.5)]"
        />
        <button
          onClick={() =>
            void run(async () => {
              if (!newBranch.trim()) throw new Error("branch name required");
              const msg = await gitops.gitCreateBranch(projectPath, newBranch.trim());
              setNewBranch("");
              await onRefresh();
              return msg;
            })
          }
          disabled={busy || !newBranch.trim()}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-white/5 px-3 py-1.5 text-xs transition hover:bg-white/10 disabled:opacity-40"
        >
          <Plus size={12} /> Branch
        </button>
      </div>
    </div>
  );
}
