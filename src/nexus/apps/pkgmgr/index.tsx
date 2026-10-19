"use client";

// NEXUS OS — Package & App Manager. Real inventory: installed applications,
// runtime capabilities and their honest status, project templates, and every
// dependency declared in project package.json files across the virtual
// filesystem (scanned live from the VFS).

import { useMemo, useState } from "react";
import { Blocks, Box, Package, Puzzle } from "lucide-react";
import type { AppInstanceProps, FSNode } from "../../types";
import { useFS } from "../../store/fs";
import { useRuntime } from "../../store/runtime";
import { APP_META, DOCK_ORDER, OS_VERSION } from "../meta";
import { PROJECT_TEMPLATES } from "../studio/templates";
import { childrenOf } from "../../lib/vfs";

interface DepRow {
  project: string;
  name: string;
  range: string;
}

function scanDependencies(nodes: Record<string, FSNode>): DepRow[] {
  const rows: DepRow[] = [];
  for (const node of Object.values(nodes)) {
    if (node.type !== "file" || node.name !== "package.json") continue;
    if (typeof node.content !== "string") continue;
    try {
      const pkg = JSON.parse(node.content) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const path = (function dirPath(n: FSNode): string {
        return n.parentId ? dirPath(nodes[n.parentId]) + "/" + n.name : "";
      })(nodes[node.parentId ?? ""] ?? node);
      for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
        rows.push({ project: path, name, range });
      }
      for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) {
        rows.push({ project: path, name: `${name} (dev)`, range });
      }
    } catch { /* malformed package.json — skip honestly */ }
  }
  return rows;
}

export default function PackageManagerApp(_props: AppInstanceProps) {
  const nodes = useFS((s) => s.nodes);
  const caps = useRuntime((s) => s.caps);
  const wcError = useRuntime((s) => s.wcError);
  const [tab, setTab] = useState<"apps" | "runtime" | "deps">("apps");
  const deps = useMemo(() => scanDependencies(nodes), [nodes]);
  const depProjects = useMemo(() => [...new Set(deps.map((d) => d.project))], [deps]);

  const apps = Object.values(APP_META);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/5 px-3 py-2">
        {(
          [
            ["apps", "Applications", <Blocks key="a" size={12} />],
            ["runtime", "Runtimes", <Box key="b" size={12} />],
            ["deps", `Dependencies (${deps.length})`, <Package key="c" size={12} />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id as typeof tab)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] transition ${
              tab === id ? "bg-white/10 text-[var(--nx-text)]" : "text-[var(--nx-text-dim)] hover:bg-white/5"
            }`}
          >
            {icon} {label}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[10px] text-[var(--nx-text-dim)]">NEXUS OS v{OS_VERSION}</span>
      </div>

      <div className="nx-scroll min-h-0 flex-1 overflow-y-auto p-4">
        {tab === "apps" && (
          <div className="grid gap-2 sm:grid-cols-2">
            {apps.map((a) => (
              <div key={a.id} className="nx-glass flex items-start gap-3 rounded-xl p-3">
                <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br ${a.gradient} text-white`}>
                  <Puzzle size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-[var(--nx-text)]">{a.name}</span>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-[var(--nx-text-dim)]">{a.id}</span>
                    {DOCK_ORDER.includes(a.id) ? (
                      <span className="rounded-full bg-[rgba(var(--nx-accent-rgb),0.12)] px-1.5 py-0.5 text-[9px] text-[var(--nx-accent)]">docked</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">{a.tagline}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "runtime" && (
          <div className="space-y-2">
            <RuntimeRow
              name="NEXUS sh (virtual filesystem)"
              status="built-in"
              ok
              desc="Shell commands over the IndexedDB-backed VFS. Path-validated, always available, works offline."
            />
            <RuntimeRow
              name="JS Worker sandbox"
              status="built-in"
              ok
              desc="User JavaScript compiled and executed inside a dedicated Web Worker. No DOM, no NEXUS state. Timeout-protected."
            />
            <RuntimeRow
              name="Node.js + npm (WebContainers)"
              status={caps.webcontainer ? (caps.webcontainerBooted ? "running" : "available") : "unavailable"}
              ok={caps.webcontainer}
              desc={
                caps.webcontainer
                  ? "Real Node.js runtime by StackBlitz (@webcontainer/api). npm install/dev/run execute against the real registry; dev servers become reachable via localhost."
                  : `Unavailable here — ${wcError ?? "cross-origin isolation is off"}. WebContainers require a top-level page with COOP/COEP headers and a Chromium-class browser.`
              }
            />
            <RuntimeRow
              name="Git (isomorphic-git)"
              status="built-in"
              ok
              desc="Real Git object databases inside project folders (.git/ is visible in Files). Local operations fully supported; network push/pull depends on server CORS and usually fails honestly on GitHub."
            />
            <RuntimeRow
              name="Native host agent"
              status="not installed"
              ok={false}
              desc="Optional connector for a real Windows/Linux/macOS machine (native compilers, real shell). Not bundled — the protocol is an explicit opt-in extension point; browser-only builds never fake it."
            />
            <div className="pt-2">
              <h3 className="mb-2 text-[12px] font-semibold text-[var(--nx-text)]">Project templates</h3>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {PROJECT_TEMPLATES.map((t) => (
                  <div key={t.id} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                    <div className="text-[12px] font-medium text-[var(--nx-text)]">{t.name}</div>
                    <p className="text-[10px] leading-relaxed text-[var(--nx-text-dim)]">{t.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "deps" && (
          <div>
            {deps.length === 0 ? (
              <p className="text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
                No dependencies yet. Create a Node project from a Studio template and declare
                dependencies in package.json — installs happen for real via npm in the Node runtime.
              </p>
            ) : (
              depProjects.map((project) => (
                <div key={project} className="mb-4">
                  <h3 className="mb-1.5 font-mono text-[12px] text-[var(--nx-accent)]">{project}</h3>
                  <div className="overflow-hidden rounded-lg border border-white/5">
                    {deps
                      .filter((d) => d.project === project)
                      .map((d, i) => (
                        <div
                          key={`${d.name}-${i}`}
                          className={`flex items-center gap-3 px-3 py-1.5 text-[12px] ${
                            i % 2 ? "bg-white/[0.02]" : ""
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-[var(--nx-text)]">{d.name}</span>
                          <span className="shrink-0 font-mono text-[11px] text-[var(--nx-text-dim)]">{d.range}</span>
                          <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--nx-text-dim)]">
                            declared
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-[var(--nx-text-dim)]">
              Dependencies are listed exactly as declared in each project&apos;s package.json.
              Whether a package actually runs inside WebContainers depends on it being pure
              JS/WASM — native modules fail honestly at install/run time.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function RuntimeRow({
  name,
  status,
  ok,
  desc,
}: {
  name: string;
  status: string;
  ok: boolean;
  desc: string;
}) {
  return (
    <div className="nx-glass rounded-xl p-3">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-zinc-500"}`} />
        <span className="text-[13px] font-medium text-[var(--nx-text)]">{name}</span>
        <span
          className={`ml-auto rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide ${
            ok ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-[var(--nx-text-dim)]"
          }`}
        >
          {status}
        </span>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">{desc}</p>
    </div>
  );
}

// childrenOf import kept for future per-project file counts
void childrenOf;
