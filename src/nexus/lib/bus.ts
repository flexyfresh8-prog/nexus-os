// NEXUS OS — internal event bus
//
// Applications must interoperate (open a file in Studio from Files, send a
// terminal error to the AI agent, open a dev server URL in the Browser…).
// This tiny pub/sub is the sanctioned way to do it: typed channels, no
// direct app-to-app imports, listeners can be cleaned up on unmount.

export type NexusEvents = {
  /** a file was opened in Nexus Studio */
  "studio:file-opened": { fileId: string; path: string; windowId?: string };
  /** ask Studio to open a specific file (Files, Terminal, AI → Studio) */
  "studio:open-file": { fileId: string };
  /** ask Studio to open a project directory */
  "studio:open-project": { dirId: string };
  /** Files (or another app) asks for a Terminal in a given folder */
  "terminal:open-at": { dirId: string };
  /** a command produced an error — AI can pick this up to diagnose */
  "terminal:error": { command: string; output: string[]; env: string };
  /** a dev server became ready */
  "server:ready": { processId: string; url: string; label: string };
  /** a dev server stopped (by choice or crash) */
  "server:stopped": { processId: string; reason: string };
  /** a long task (build/install) finished — hook for notifications */
  "task:finished": { label: string; ok: boolean; detail?: string };
  /** request the internal Browser to navigate somewhere */
  "browser:navigate": { url: string };
  /** a git commit was created — used to refresh panels */
  "git:commit": { projectId: string; message: string };
  /** workspace layout changed */
  "workspace:changed": { id: string; name: string };
  /** generic app-to-app request to open a path with the best app */
  "os:open-path": { fileId: string };
};

type Handler<T> = (payload: T) => void;

const handlers = new Map<keyof NexusEvents, Set<Handler<never>>>();

export function on<K extends keyof NexusEvents>(
  event: K,
  fn: Handler<NexusEvents[K]>
): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(fn as Handler<never>);
  return () => {
    set!.delete(fn as Handler<never>);
  };
}

export function emit<K extends keyof NexusEvents>(
  event: K,
  payload: NexusEvents[K]
): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      (fn as Handler<NexusEvents[K]>)(payload);
    } catch (e) {
      // a faulty listener must never break the emitter
      console.warn(`[nexus bus] handler for "${String(event)}" failed`, e);
    }
  }
}

/** React helper: subscribe for the lifetime of a component. */
export function useNexusEvent<K extends keyof NexusEvents>(
  event: K,
  fn: Handler<NexusEvents[K]>
) {
  // imported lazily to keep this module usable outside React tests
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useEffect, useRef } = require("react") as typeof import("react");
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => on(event, (p) => ref.current(p)), [event]);
}
