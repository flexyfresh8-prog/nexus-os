"use client";

// NEXUS OS — dev-server manager panel (Nexus Studio).
// Shows REAL runtime processes: state, launch command, server URL, logs.
// Restart re-syncs the project's virtual files into the Node runtime and
// re-runs the command. Stop kills the actual WebContainer process.

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, RefreshCw, Square } from "lucide-react";
import { useRuntime, ENV_LABEL } from "../../store/runtime";
import { useOS } from "../../store/os";
import { collectProjectFiles } from "../terminal/engine";
import { vfsToContainerTree } from "../../store/runtime";
import { pathOf } from "../../lib/vfs";
import { useFS } from "../../store/fs";

const STATE_CLS: Record<string, string> = {
  running: "text-sky-300",
  listening: "text-emerald-300",
  exited: "text-[var(--nx-text-dim)]",
  failed: "text-red-400",
  stopped: "text-amber-300",
};

export function ServersPanel({ projectId }: { projectId: string }) {
  const processes = useRuntime((s) => s.processes);
  const caps = useRuntime((s) => s.caps);
  const wcBusy = useRuntime((s) => s.wcBusy);
  const wcError = useRuntime((s) => s.wcError);
  const nodes = useFS((s) => s.nodes);
  const launch = useOS((s) => s.launch);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const relevant = useMemo(
    () => processes.filter((p) => p.env === "webcontainer"),
    [processes]
  );

  // auto-expand the newest process
  useEffect(() => {
    if (relevant.length > 0 && !relevant.find((p) => p.id === expandedId)) {
      setExpandedId(relevant[relevant.length - 1].id);
    }
  }, [relevant, expandedId]);

  const projectPath = nodes[projectId] ? pathOf(nodes, projectId) : "";

  const resyncAndRun = async (command: string, args: string[], server: boolean) => {
    const runtime = useRuntime.getState();
    const wc = await runtime.ensureWebContainer();
    const files = collectProjectFiles(projectId);
    await wc.mount(vfsToContainerTree(files));
    return runtime.wcRun({ command, args, server, label: [command, ...args].join(" ") });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.04] px-3 py-1.5">
        <span className="text-[11px] text-[var(--nx-text-dim)]">
          {caps.webcontainer
            ? wcBusy
              ? "Booting Node runtime…"
              : `Node runtime ready — projects run for real (WebContainers). Project: ${projectPath}`
            : `Node runtime unavailable here — ${wcError ?? "cross-origin isolation is off"}. Dev servers need NEXUS open in its own browser tab.`}
        </span>
        {relevant.length > 0 ? (
          <button
            onClick={() => useRuntime.getState().clearFinished()}
            className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]"
          >
            clear finished
          </button>
        ) : null}
      </div>

      <div className="nx-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {relevant.length === 0 ? (
          <div className="grid h-full place-items-center">
            <div className="max-w-[380px] text-center text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
              No server processes. Run one from this project:
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button
                  onClick={() => void resyncAndRun("npm", ["install"], false).catch(() => undefined)}
                  disabled={!caps.webcontainer}
                  className="rounded-lg bg-white/5 px-3 py-1.5 text-[11px] transition hover:bg-white/10 disabled:opacity-40"
                >
                  npm install
                </button>
                <button
                  onClick={() => void resyncAndRun("npm", ["run", "dev"], true).catch(() => undefined)}
                  disabled={!caps.webcontainer}
                  className="rounded-lg bg-[rgba(var(--nx-accent-rgb),0.15)] px-3 py-1.5 text-[11px] text-[var(--nx-accent)] transition hover:bg-[rgba(var(--nx-accent-rgb),0.25)] disabled:opacity-40"
                >
                  npm run dev
                </button>
                <button
                  onClick={() => void resyncAndRun("node", ["index.js"], false).catch(() => undefined)}
                  disabled={!caps.webcontainer}
                  className="rounded-lg bg-white/5 px-3 py-1.5 text-[11px] transition hover:bg-white/10 disabled:opacity-40"
                >
                  node index.js
                </button>
              </div>
              <p className="mt-3 text-[11px]">
                Requires a <code className="rounded bg-white/5 px-1">package.json</code> with the
                script (Studio templates include one). Server readiness comes from the
                runtime&apos;s real <code className="rounded bg-white/5 px-1">server-ready</code> event.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {relevant.map((p) => {
              const expanded = expandedId === p.id;
              const isServer = p.state === "listening" && p.url;
              return (
                <div key={p.id} className="rounded-lg border border-white/5 bg-white/[0.02]">
                  <button
                    onClick={() => setExpandedId(expanded ? null : p.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.state === "running" || p.state === "listening" ? "animate-pulse bg-emerald-400" : p.state === "failed" ? "bg-red-400" : "bg-zinc-500"}`} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{p.command}</span>
                    <span className={`shrink-0 text-[10px] uppercase tracking-wide ${STATE_CLS[p.state]}`}>{p.state}</span>
                    {p.exitCode !== undefined && p.state !== "running" ? (
                      <span className="shrink-0 text-[10px] text-[var(--nx-text-dim)]">exit {p.exitCode}</span>
                    ) : null}
                  </button>

                  {isServer ? (
                    <div className="flex items-center gap-2 border-t border-white/5 px-3 py-1.5">
                      <span className="truncate rounded bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">{p.url}</span>
                      <button
                        title="Open in NEXUS Browser"
                        onClick={() => {
                          launch("browser", { url: p.url });
                          void import("../../lib/bus").then(({ emit }) =>
                            emit("browser:navigate", { url: p.url! })
                          );
                        }}
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]"
                      >
                        <ExternalLink size={10} /> open in Browser
                      </button>
                      <button
                        title="Copy URL"
                        onClick={() => void navigator.clipboard?.writeText(p.url!)}
                        className="rounded p-1 text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]"
                      >
                        <Copy size={10} />
                      </button>
                    </div>
                  ) : null}

                  {expanded ? (
                    <div className="border-t border-white/5">
                      <div className="nx-scroll max-h-[220px] min-h-0 overflow-y-auto bg-black/30 px-3 py-2 font-mono text-[11px] leading-[1.5]">
                        {p.logs.length === 0 ? (
                          <span className="text-[var(--nx-text-dim)]">(no output yet)</span>
                        ) : (
                          p.logs.map((l, i) => (
                            <div
                              key={i}
                              className={`whitespace-pre-wrap break-words ${
                                l.stream === "err" ? "text-red-300" : l.stream === "sys" ? "text-[var(--nx-accent)]" : "text-[var(--nx-text)]"
                              }`}
                            >
                              {l.text}
                            </div>
                          ))
                        )}
                      </div>
                      <div className="flex items-center gap-2 border-t border-white/5 px-3 py-1.5">
                        <span className="text-[10px] text-[var(--nx-text-dim)]">
                          {ENV_LABEL[p.env]} · started {new Date(p.startedAt).toLocaleTimeString()}
                          {p.endedAt ? ` · ended ${new Date(p.endedAt).toLocaleTimeString()}` : ""}
                        </span>
                        <div className="ml-auto flex gap-1.5">
                          {p.state === "running" || p.state === "listening" ? (
                            <button
                              onClick={() => void useRuntime.getState().kill(p.id)}
                              className="flex items-center gap-1 rounded bg-red-400/10 px-2 py-0.5 text-[10px] text-red-300 hover:bg-red-400/20"
                            >
                              <Square size={9} /> stop
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                const [command, ...args] = p.command.split(/\s+/);
                                void resyncAndRun(command, args, p.kind === "server").catch(() => undefined);
                              }}
                              className="flex items-center gap-1 rounded bg-white/5 px-2 py-0.5 text-[10px] hover:bg-white/10"
                            >
                              <RefreshCw size={9} /> restart
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
