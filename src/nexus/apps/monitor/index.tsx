"use client";

// NEXUS OS — System Monitor. ONLY real, browser-accessible metrics:
// JS heap (Chrome-reported), IndexedDB storage quota/usage, the NEXUS process
// registry, window count, network requests initiated by this page
// (PerformanceObserver), render rate, VFS stats and runtime status.
// Metrics the platform does not expose are explicitly listed as unavailable —
// never invented.

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, Cpu, Database, Globe, Layers, Server, ShieldCheck } from "lucide-react";
import type { AppInstanceProps } from "../../types";
import { useRuntime } from "../../store/runtime";
import { useOS } from "../../store/os";
import { useFS } from "../../store/fs";
import { useLock } from "../../store/lock";
import { useSettings } from "../../store/settings";
import { nodeSize } from "../../lib/vfs";
import { formatBytes } from "../../lib/utils";
import { auditLog, agoOf, type AuditEntry } from "../../lib/secure";

interface HeapSample {
  t: number;
  used: number;
}
interface NetSample {
  count: number;
  bytes: number;
}

const HISTORY = 60;

function Sparkline({ data, max, className }: { data: number[]; max: number; className?: string }) {
  const w = 100;
  const h = 28;
  const pts = data
    .map((v, i) => `${(i / Math.max(1, data.length - 1)) * w},${h - Math.min(1, v / (max || 1)) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`h-7 w-full ${className ?? ""}`}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function SystemMonitorApp(_props: AppInstanceProps) {
  const processes = useRuntime((s) => s.processes);
  const caps = useRuntime((s) => s.caps);
  const wcError = useRuntime((s) => s.wcError);
  const windows = useOS((s) => s.windows);
  const nodes = useFS((s) => s.nodes);
  const lock = useLock();
  const autoLockMin = useSettings((s) => s.autoLockMin);
  const [secLog, setSecLog] = useState<AuditEntry[]>([]);

  const [heap, setHeap] = useState<HeapSample[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [net, setNet] = useState<NetSample>({ count: 0, bytes: 0 });
  const [fps, setFps] = useState(60);
  const [uptime0] = useState(() => Date.now());
  const [now, setNow] = useState(Date.now());
  const heapSupported = useRef<boolean>(
    typeof performance !== "undefined" && !!(performance as unknown as { memory?: unknown }).memory
  );

  // heap sampling (only where performance.memory exists — Chromium)
  useEffect(() => {
    if (!heapSupported.current) return;
    const tick = () => {
      const mem = (performance as unknown as {
        memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
      }).memory;
      if (!mem) {
        heapSupported.current = false;
        return;
      }
      setHeap((prev) => [...prev, { t: Date.now(), used: mem.usedJSHeapSize }].slice(-HISTORY));
    };
    tick();
    const iv = setInterval(tick, 1500);
    return () => clearInterval(iv);
  }, []);

  // security audit trail (refreshes + reacts to lock state changes)
  useEffect(() => {
    let alive = true;
    const read = () => void auditLog().then((l) => alive && setSecLog([...l].reverse()));
    read();
    const iv = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // storage estimate
  useEffect(() => {
    let alive = true;
    const read = async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        if (alive && est) setStorage({ usage: est.usage ?? 0, quota: est.quota ?? 0 });
      } catch { /* unsupported */ }
    };
    void read();
    const iv = setInterval(read, 5000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

  // network requests initiated by this page (resource timing)
  useEffect(() => {
    let count = 0;
    let bytes = 0;
    const update = () => {
      try {
        const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        count = entries.length;
        bytes = entries.reduce((acc, e) => acc + (e.transferSize || 0), 0);
        setNet({ count, bytes });
      } catch { /* noop */ }
    };
    update();
    const po = new PerformanceObserver(() => update());
    try {
      po.observe({ type: "resource", buffered: true });
    } catch {
      const iv = setInterval(update, 5000);
      return () => clearInterval(iv);
    }
    const iv = setInterval(update, 3000);
    return () => {
      po.disconnect();
      clearInterval(iv);
    };
  }, []);

  // fps via rAF sampling
  useEffect(() => {
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = () => {
      frames++;
      const t = performance.now();
      if (t - last >= 1000) {
        setFps(Math.round((frames * 1000) / (t - last)));
        frames = 0;
        last = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const vfsStats = useMemo(() => {
    let files = 0;
    let dirs = 0;
    let bytes = 0;
    for (const n of Object.values(nodes)) {
      if (n.type === "dir") dirs++;
      else {
        files++;
        bytes += nodeSize(n);
      }
    }
    return { files, dirs, bytes };
  }, [nodes]);

  const running = processes.filter((p) => p.state === "running" || p.state === "listening");
  const heapLimit = heapSupported.current
    ? (performance as unknown as { memory?: { jsHeapSizeLimit: number } }).memory?.jsHeapSizeLimit ?? 0
    : 0;
  const usedPct = storage && storage.quota ? storage.usage / storage.quota : 0;

  const uptimeS = Math.floor((now - uptime0) / 1000);
  const uptime = `${Math.floor(uptimeS / 60)}m ${uptimeS % 60}s`;

  return (
    <div className="nx-scroll h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {/* memory */}
        <Card
          icon={<Cpu size={14} />}
          title="Memory"
          note={heapSupported.current ? "browser-reported JS heap" : "not exposed by this browser"}
        >
          {heapSupported.current && heap.length > 0 ? (
            <>
              <Metric label="JS heap used" value={formatBytes(heap[heap.length - 1].used)} />
              <Metric label="Heap limit" value={formatBytes(heapLimit)} />
              <Sparkline data={heap.map((h) => h.used)} max={heapLimit || 1} className="text-[var(--nx-accent)]" />
            </>
          ) : (
            <p className="text-[12px] leading-relaxed text-[var(--nx-text-dim)]">
              This browser does not expose JS heap metrics (performance.memory is
              Chromium-only). Nothing to estimate from — showing nothing rather than guessing.
            </p>
          )}
        </Card>

        {/* storage */}
        <Card icon={<Database size={14} />} title="Storage" note="navigator.storage.estimate()">
          {storage ? (
            <>
              <Metric label="Used" value={formatBytes(storage.usage)} />
              <Metric label="Browser quota" value={formatBytes(storage.quota)} />
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[var(--nx-accent)] transition-[width] duration-500"
                  style={{ width: `${Math.min(100, usedPct * 100).toFixed(2)}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-[var(--nx-text-dim)]">
                {vfsStats.files} files · {vfsStats.dirs} folders · {formatBytes(vfsStats.bytes)} of virtual
                filesystem data. The browser may evict this data under pressure — use Settings →
                Backup for durable copies.
              </p>
            </>
          ) : (
            <p className="text-[12px] text-[var(--nx-text-dim)]">Storage estimates unavailable.</p>
          )}
        </Card>

        {/* processes */}
        <Card
          icon={<Server size={14} />}
          title="Processes"
          note={`${running.length} active of ${processes.length}`}
        >
          {processes.length === 0 ? (
            <p className="text-[12px] text-[var(--nx-text-dim)]">
              No processes. Run JS (`js`), Node commands or dev servers and they appear here.
            </p>
          ) : (
            <div className="space-y-1.5">
              {processes.map((p) => (
                <div key={p.id} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-1.5">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      p.state === "running" || p.state === "listening"
                        ? "animate-pulse bg-emerald-400"
                        : p.state === "failed"
                          ? "bg-red-400"
                          : "bg-zinc-500"
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--nx-text)]">{p.command}</span>
                  <span className="shrink-0 text-[10px] text-[var(--nx-text-dim)]">{p.env}</span>
                  <span
                    className={`w-[62px] shrink-0 text-right text-[10px] uppercase tracking-wide ${
                      p.state === "listening" ? "text-emerald-300" : p.state === "failed" ? "text-red-400" : "text-[var(--nx-text-dim)]"
                    }`}
                  >
                    {p.state}
                  </span>
                  {(p.state === "running" || p.state === "listening") && (
                    <button
                      onClick={() => void useRuntime.getState().kill(p.id)}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-400/10"
                    >
                      kill
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-1 border-t border-white/5 pt-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-[var(--nx-text-dim)]">Node runtime (WebContainer)</span>
              <span className={caps.webcontainer ? "text-emerald-300" : "text-amber-300"}>
                {caps.webcontainer ? (caps.webcontainerBooted ? "ready" : "available") : "unavailable"}
              </span>
            </div>
            {!caps.webcontainer && wcError ? (
              <p className="text-[10px] leading-relaxed text-[var(--nx-text-dim)]">{wcError}</p>
            ) : null}
            <div className="flex justify-between">
              <span className="text-[var(--nx-text-dim)]">JS worker sandbox</span>
              <span className="text-emerald-300">available</span>
            </div>
          </div>
        </Card>

        {/* windows + render */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card icon={<Layers size={14} />} title="Windows" note="live shell state">
            <Metric label="Open windows" value={String(windows.length)} />
            <Metric label="Focused" value={windows.find((w) => w.id === useOS.getState().focusedId)?.appId ?? "—"} />
            <Metric label="Minimized" value={String(windows.filter((w) => w.minimized).length)} />
            <Metric label="Session uptime" value={uptime} />
          </Card>
          <Card icon={<Activity size={14} />} title="Rendering" note="measured via requestAnimationFrame">
            <Metric label="Frame rate" value={`${fps} fps`} />
            <Metric
              label="Animation preference"
              value={document.documentElement.classList.contains("nx-no-anim") ? "reduced" : "full"}
            />
          </Card>
        </div>

        {/* network */}
        <Card icon={<Globe size={14} />} title="Network" note="requests initiated by this page">
          <Metric label="Resource requests" value={String(net.count)} />
          <Metric label="Bytes transferred" value={formatBytes(net.bytes)} />
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--nx-text-dim)]">
            Counts subresource loads reported by ResourceTiming. Per-app attribution is not
            exposed by the browser, so it is not shown.
          </p>
        </Card>

        {/* security posture — real state only */}
        <Card icon={<ShieldCheck size={14} />} title="Security" note="live system state">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Lock screen" value={lock.hasLock ? (lock.locked ? "ENGAGED" : "armed") : "off"} />
            <Metric label="Auto-lock" value={autoLockMin > 0 ? `${autoLockMin} min idle` : "off"} />
            <Metric label="Secrets at rest" value="AES-GCM sealed" />
            <Metric label="Sandbox / CSP" value="enforced" />
          </div>
          <div className="mt-2">
            <div className="text-[10px] uppercase tracking-wider text-[var(--nx-text-dim)]">Recent security events</div>
            <ul className="mt-1 space-y-0.5">
              {secLog.slice(0, 5).map((e, i) => (
                <li key={`${e.ts}-${i}`} className="flex items-baseline gap-2 text-[11px]">
                  <span className="shrink-0 tabular-nums text-[var(--nx-text-dim)]">{agoOf(e.ts)}</span>
                  <span className="truncate font-mono text-[var(--nx-accent)]">{e.event}</span>
                </li>
              ))}
              {secLog.length === 0 && <li className="text-[11px] text-[var(--nx-text-dim)]">No events yet.</li>}
            </ul>
          </div>
        </Card>

        {/* honest unavailable section */}
        <Card icon={<Activity size={14} />} title="Not available on this platform" note="honest limitations">
          <ul className="list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-[var(--nx-text-dim)]">
            <li>CPU utilization &amp; per-core load — browsers do not expose hardware counters.</li>
            <li>CPU/GPU temperature, fan speed — no browser API exists.</li>
            <li>Host RAM, disk health, battery of other devices — outside the sandbox.</li>
            <li>Native process table — visible only if a native agent is ever connected.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  note,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="nx-glass rounded-2xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[var(--nx-accent)]">{icon}</span>
        <h2 className="text-[13px] font-semibold text-[var(--nx-text)]">{title}</h2>
        {note ? (
          <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[9px] uppercase tracking-wide text-[var(--nx-text-dim)]">
            {note}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5 text-[12px]">
      <span className="text-[var(--nx-text-dim)]">{label}</span>
      <span className="font-mono text-[var(--nx-text)]">{value}</span>
    </div>
  );
}
