"use client";

// NEXUS OS — runtime layer: real execution environments.
//
// Three environments, always clearly labeled in the UI:
//
//   "shell"         — the NEXUS shell operating on the virtual filesystem
//                     (pure TS engine, no eval, browser-local).
//
//   "worker"        — user JavaScript executed inside a dedicated Web Worker
//                     (Blob-constructed). The worker has no DOM, no access to
//                     the parent app's state, no localStorage and cannot touch
//                     NEXUS. Compiling the user's JS is the entire point of a
//                     JS runtime — isolation is provided by the Worker
//                     boundary, and the environment badge says so.
//
//   "webcontainer"  — a real Node.js runtime via @webcontainer/api (StackBlitz).
//                     Requires cross-origin isolation (COOP/COEP) and is only
//                     available in browsers/surfaces that provide it. When it
//                     is NOT available we say so honestly and the shell/worker
//                     environments keep working.
//
// The store also maintains the global process registry consumed by the
// System Monitor app and the dev-server manager.

import { create } from "zustand";
import type { WebContainer, WebContainerProcess, FileSystemTree } from "@webcontainer/api";
import { uid } from "../lib/utils";

export type RuntimeEnv = "shell" | "worker" | "webcontainer";

export const ENV_LABEL: Record<RuntimeEnv, string> = {
  shell: "NEXUS sh",
  worker: "JS Worker",
  webcontainer: "Node (WebContainer)",
};

export const ENV_DESC: Record<RuntimeEnv, string> = {
  shell: "NEXUS shell — operates on the virtual filesystem inside this browser tab.",
  worker: "JavaScript executed in a sandboxed Web Worker (no DOM, no NEXUS state).",
  webcontainer: "Real Node.js + npm running in an isolated browser runtime (StackBlitz WebContainers).",
};

// ---------------------------------------------------------------- processes

export type ProcState = "running" | "exited" | "failed" | "stopped" | "listening";

export interface ProcLogLine {
  text: string;
  stream: "out" | "err" | "sys";
  ts: number;
}

export interface ProcessRecord {
  id: string;
  env: RuntimeEnv;
  kind: "worker" | "command" | "server";
  label: string;
  command: string;
  cwd?: string;
  state: ProcState;
  exitCode?: number;
  startedAt: number;
  endedAt?: number;
  /** dev-server URL once server-ready fired */
  url?: string;
  port?: number;
  logs: ProcLogLine[];
  /** live handle — WebContainer process for kill() */
  _wc?: unknown;
}

const MAX_LOGS = 600;

interface RuntimeState {
  caps: {
    /** page is cross-origin isolated (SharedArrayBuffer available) */
    coi: boolean;
    /** WebContainer can boot in this browser */
    webcontainer: boolean;
    /** WebContainer already booted */
    webcontainerBooted: boolean;
    /** embedded preview iframe without cross-origin-isolated permission */
    embedded: boolean;
    checked: boolean;
  };
  wcError: string | null;
  wcBusy: boolean;
  processes: ProcessRecord[];

  checkCaps: () => void;
  ensureWebContainer: () => Promise<WebContainer>;
  /** spawn a command in the Node runtime; streams into the process record */
  wcRun: (o: {
    command: string;
    args?: string[];
    cwd?: string;
    label?: string;
    /** treat as a long-lived server: listen for server-ready */
    server?: boolean;
  }) => Promise<{ processId: string; exitCode: number | null; output: string[] }>;
  /** execute user JS in the worker sandbox and return its transcript */
  workerRun: (code: string, timeoutMs?: number) => Promise<{
    processId: string;
    logs: string[];
    error?: string;
    exitCode: number;
    durationMs: number;
  }>;
  kill: (processId: string) => Promise<void>;
  clearFinished: () => void;
  appendLog: (processId: string, text: string, stream?: ProcLogLine["stream"]) => void;
}

// ------------------------------------------------------------ webcontainer

let wcInstance: WebContainer | null = null;
let wcBootPromise: Promise<WebContainer> | null = null;

function coiStatus(): { coi: boolean; embedded: boolean } {
  if (typeof window === "undefined") return { coi: false, embedded: false };
  const coi = typeof window.crossOriginIsolated === "boolean" ? window.crossOriginIsolated : false;
  const embedded = window.self !== window.top;
  return { coi, embedded };
}

/** Convert a slice of the NEXUS VFS into a WebContainer FileSystemTree. */
export function vfsToContainerTree(
  files: Array<{ relPath: string; content: string }>
): FileSystemTree {
  const tree: FileSystemTree = {};
  for (const f of files) {
    const segs = f.relPath.split("/").filter(Boolean);
    let node = tree;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (i === segs.length - 1) {
        node[seg] = { file: { contents: f.content } };
      } else {
        const next = node[seg];
        if (next && "directory" in next) node = next.directory;
        else {
          const dir: FileSystemTree = {};
          node[seg] = { directory: dir };
          node = dir;
        }
      }
    }
  }
  return tree;
}

export const useRuntime = create<RuntimeState>((set, get) => ({
  caps: { coi: false, webcontainer: false, webcontainerBooted: false, embedded: false, checked: false },
  wcError: null,
  wcBusy: false,
  processes: [],

  checkCaps: () => {
    if (get().caps.checked) return;
    const { coi, embedded } = coiStatus();
    // WebContainers are Chromium-first; be conservative but allow future support
    const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
    const plausible = !/firefox\/(\d+)/i.test(ua) || parseInt((ua.match(/firefox\/(\d+)/i)?.[1]) ?? "0", 10) >= 111;
    set({
      caps: { coi, embedded, webcontainer: coi && plausible, webcontainerBooted: false, checked: true },
    });
  },

  ensureWebContainer: async () => {
    if (wcInstance) return wcInstance;
    if (!wcBootPromise) {
      get().checkCaps();
      if (!get().caps.webcontainer) {
        const { coi, embedded } = get().caps;
        const why = !coi
          ? embedded
            ? "This page is embedded without cross-origin isolation. Open NEXUS in its own browser tab to enable the Node runtime."
            : "This document is not cross-origin isolated (needs COOP/COEP headers). The Node runtime cannot start here."
          : "This browser does not support WebContainers.";
        set({ wcError: why });
        throw new Error(why);
      }
      set({ wcBusy: true, wcError: null });
      wcBootPromise = (async () => {
        try {
          const { WebContainer: WC } = await import("@webcontainer/api");
          const instance = await WC.boot({ coep: "credentialless" });
          wcInstance = instance;
          instance.on("server-ready", (port, url) => {
            set((s) => ({
              processes: s.processes.map((p) =>
                p.state === "running" && p.env === "webcontainer" && !p.url
                  ? { ...p, state: "listening", url, port }
                  : p
              ),
            }));
            // find the most recent running webcontainer process and tag it
            const procs = get().processes;
            const candidate = [...procs]
              .reverse()
              .find((p) => p.env === "webcontainer" && p.state === "running" && !p.url);
            if (candidate) {
              set((s) => ({
                processes: s.processes.map((p) =>
                  p.id === candidate.id ? { ...p, state: "listening", url, port } : p
                ),
              }));
              import("../lib/bus").then(({ emit }) =>
                emit("server:ready", { processId: candidate.id, url, label: candidate.label })
              );
            }
          });
          instance.on("error", (err) => {
            set({ wcError: err.message });
          });
          set((s) => ({
            caps: { ...s.caps, webcontainerBooted: true },
            wcBusy: false,
          }));
          // register a synthetic record so System Monitor shows the runtime
          set((s) => ({
            processes: [
              ...s.processes,
              {
                id: "wc-runtime",
                env: "webcontainer" as RuntimeEnv,
                kind: "command" as const,
                label: "Node runtime",
                command: "WebContainer.boot()",
                state: "running" as ProcState,
                startedAt: Date.now(),
                logs: [
                  { text: "Node runtime booted (StackBlitz WebContainers).", stream: "sys" as const, ts: Date.now() },
                ],
              },
            ],
          }));
          window.addEventListener("beforeunload", () => {
            try {
              wcInstance?.teardown();
            } catch { /* noop */ }
          });
          return instance;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          wcBootPromise = null;
          set({ wcBusy: false, wcError: msg });
          throw e;
        }
      })();
    }
    return wcBootPromise;
  },

  wcRun: async ({ command, args = [], cwd, label, server }) => {
    const wc = await get().ensureWebContainer();
    const cmdline = [command, ...args].join(" ");
    const id = uid();
    const rec: ProcessRecord = {
      id,
      env: "webcontainer",
      kind: server ? "server" : "command",
      label: label ?? cmdline,
      command: cmdline,
      cwd,
      state: "running",
      startedAt: Date.now(),
      logs: [{ text: `$ ${cmdline}`, stream: "sys", ts: Date.now() }],
      _wc: null,
    };
    set((s) => ({ processes: [...s.processes, rec] }));
    const append = (text: string, stream: ProcLogLine["stream"]) => {
      set((s) => ({
        processes: s.processes.map((p) =>
          p.id === id
            ? {
                ...p,
                logs: [...p.logs, { text, stream, ts: Date.now() }].slice(-MAX_LOGS),
              }
            : p
        ),
      }));
    };
    const output: string[] = [];
    try {
      const proc: WebContainerProcess = cwd
        ? await wc.spawn(command, args, { cwd })
        : await wc.spawn(command, args);
      set((s) => ({
        processes: s.processes.map((p) => (p.id === id ? { ...p, _wc: proc } : p)),
      }));
      const reader = (stream: ProcLogLine["stream"]) => (data: string) => {
        const lines = data.replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
        for (const l of lines) {
          output.push(l);
          append(l, stream);
        }
      };
      // single merged terminal-output stream (stdout + stderr per the API)
      proc.output.pipeTo(new WritableStream({ write: reader("out") }));
      const exitCode = await proc.exit;
      set((s) => ({
        processes: s.processes.map((p) =>
          p.id === id
            ? {
                ...p,
                state: exitCode === 0 ? "exited" : "failed",
                exitCode,
                endedAt: Date.now(),
                _wc: null,
              }
            : p
        ),
      }));
      return { processId: id, exitCode, output };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      append(`runtime error: ${msg}`, "err");
      set((s) => ({
        processes: s.processes.map((p) =>
          p.id === id ? { ...p, state: "failed", exitCode: 1, endedAt: Date.now(), _wc: null } : p
        ),
      }));
      return { processId: id, exitCode: 1, output };
    }
  },

  workerRun: (code, timeoutMs = 10000) => {
    const id = uid();
    const startedAt = Date.now();
    const rec: ProcessRecord = {
      id,
      env: "worker",
      kind: "worker",
      label: "JS worker",
      command: "worker.eval()",
      state: "running",
      startedAt,
      logs: [],
    };
    set((s) => ({ processes: [...s.processes, rec] }));

    return new Promise((resolve) => {
      let logs: string[] = [];
      let settled = false;
      const workerSrc = buildWorkerSource();
      const blob = new Blob([workerSrc], { type: "text/javascript" });
      const url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      URL.revokeObjectURL(url);

      const finish = (error?: string, exitCode = 0) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { worker.terminate(); } catch { /* noop */ }
        const durationMs = Date.now() - startedAt;
        set((s) => ({
          processes: s.processes.map((p) =>
            p.id === id
              ? {
                  ...p,
                  state: error ? "failed" : "exited",
                  exitCode,
                  endedAt: Date.now(),
                  logs: logs.map((text) => ({ text, stream: "out" as const, ts: Date.now() })),
                }
              : p
          ),
        }));
        resolve({ processId: id, logs, error, exitCode: error ? exitCode : 0, durationMs });
      };

      const timer = setTimeout(() => {
        logs.push(`worker: execution timed out after ${timeoutMs}ms and was terminated`);
        finish(`Execution timed out after ${timeoutMs}ms`, 124);
      }, timeoutMs);

      worker.onmessage = (e: MessageEvent) => {
        const d = e.data as { type: string; text?: string; error?: string };
        if (d.type === "log" && typeof d.text === "string") {
          logs.push(d.text);
          set((s) => ({
            processes: s.processes.map((p) =>
              p.id === id
                ? { ...p, logs: [...p.logs, { text: d.text!, stream: "out" as const, ts: Date.now() }].slice(-MAX_LOGS) }
                : p
            ),
          }));
        } else if (d.type === "done") {
          finish(undefined, 0);
        } else if (d.type === "error") {
          finish(d.error ?? "Unknown worker error", 1);
        }
      };
      worker.onerror = (e) => {
        finish(e.message || "Worker error", 1);
      };
      worker.postMessage({ code });
    });
  },

  kill: async (processId) => {
    const proc = get().processes.find((p) => p.id === processId);
    if (!proc) return;
    if (proc._wc && typeof (proc._wc as WebContainerProcess).kill === "function") {
      try {
        (proc._wc as WebContainerProcess).kill();
      } catch { /* already dead */ }
    }
    set((s) => ({
      processes: s.processes.map((p) =>
        p.id === processId && p.state === "running"
          ? { ...p, state: "stopped", endedAt: Date.now(), _wc: null }
          : p
      ),
    }));
    import("../lib/bus").then(({ emit }) =>
      emit("server:stopped", { processId, reason: "killed by user" })
    );
  },

  clearFinished: () =>
    set((s) => ({ processes: s.processes.filter((p) => p.state === "running" || p.state === "listening") })),

  appendLog: (processId, text, stream = "out") =>
    set((s) => ({
      processes: s.processes.map((p) =>
        p.id === processId
          ? { ...p, logs: [...p.logs, { text, stream, ts: Date.now() }].slice(-MAX_LOGS) }
          : p
      ),
    })),
}));

// -------------------------------------------------------- worker sandbox src

/**
 * Worker bootstrap. The user's code is executed inside this worker via
 * postMessage — the Worker boundary is the sandbox (no DOM, no parent state,
 * no NEXUS stores). Console output is forwarded to the parent.
 */
function buildWorkerSource(): string {
  return `
'use strict';
function fmt(v, depth) {
  try {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    var t = typeof v;
    if (t === 'string') return depth ? JSON.stringify(v) : v;
    if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
    if (t === 'function') return '[Function: ' + (v.name || 'anonymous') + ']';
    if (Array.isArray(v)) {
      if (depth > 2) return '[Array]';
      return '[ ' + v.map(function (x) { return fmt(x, (depth||0)+1); }).join(', ') + ' ]';
    }
    if (v instanceof Error) return (v.stack || String(v));
    if (depth > 2) return '[Object]';
    var keys = Object.keys(v);
    var body = keys.slice(0, 40).map(function (k) { return k + ': ' + fmt(v[k], (depth||0)+1); }).join(', ');
    return '{ ' + body + (keys.length > 40 ? ', …' : '') + ' }';
  } catch (e) { return String(v); }
}
['log','info','warn','error','debug'].forEach(function (m) {
  var orig = console[m];
  console[m] = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(fmt(arguments[i], 0));
    self.postMessage({ type: 'log', text: parts.join(' ') });
    try { orig.apply(console, arguments); } catch (e) {}
  };
});
self.onmessage = function (e) {
  var code = e.data.code;
  var AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  try {
    var fn = new AsyncFunction('"use strict";' + code);
    Promise.resolve(fn()).then(function () {
      self.postMessage({ type: 'done' });
    }, function (err) {
      self.postMessage({ type: 'error', error: (err && (err.stack || err.message)) || String(err) });
    });
  } catch (err) {
    self.postMessage({ type: 'error', error: (err && (err.stack || err.message)) || String(err) });
  }
};
`;
}

/** convenience for the terminal/monitor UIs */
export function useRuntimeCaps() {
  return useRuntime((s) => s.caps);
}
