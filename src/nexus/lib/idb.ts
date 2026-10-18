// NEXUS OS — IndexedDB layer (versioned stores + migration hook)

const DB_NAME = "nexus-os";
const DB_VERSION = 1;

export const STORE_FS = "fs";
export const STORE_KV = "kv";

let dbPromise: Promise<IDBDatabase> | null = null;
let idbAvailable = true;

export function isIDBAvailable(): boolean {
  return idbAvailable;
}

export function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    idbAvailable = false;
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_FS)) {
        const fs = db.createObjectStore(STORE_FS, { keyPath: "id" });
        fs.createIndex("byParent", "parentId");
      }
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV, { keyPath: "key" });
      }
      // Future migrations: bump DB_VERSION and add cases here
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      idbAvailable = false;
      reject(req.error ?? new Error("Failed to open IndexedDB"));
    };
  });
  return dbPromise;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return tx<T>(store, "readonly", (s) => s.get(key) as IDBRequest<T>);
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
}

export function idbPut(store: string, value: unknown): Promise<void> {
  return tx(store, "readwrite", (s) => s.put(value)).then(() => undefined);
}

export function idbDelete(store: string, key: string): Promise<void> {
  return tx(store, "readwrite", (s) => s.delete(key)).then(() => undefined);
}

export function idbClear(store: string): Promise<void> {
  return tx(store, "readwrite", (s) => s.clear()).then(() => undefined);
}

export function idbCount(store: string): Promise<number> {
  return tx<number>(store, "readonly", (s) => s.count());
}

/** KV helpers — every system datum lives under a namespaced key */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  const row = await idbGet<{ key: string; value: T }>(STORE_KV, key);
  return row?.value;
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  return idbPut(STORE_KV, { key, value });
}

// ---------- debounced writes ----------

type PendingOp = { type: "put"; value: unknown } | { type: "del"; key: string };
const pending = new Map<string, PendingOp>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Debounce rapid writes to the same key (e.g. typing in the editor).
 * `flushMs` trades durability for performance.
 */
export function scheduleWrite(
  store: string,
  key: string,
  op: PendingOp,
  flushMs = 400
): void {
  pending.set(key, op);
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  timers.set(
    key,
    setTimeout(() => {
      const op2 = pending.get(key);
      timers.delete(key);
      if (!op2) return;
      pending.delete(key);
      const p =
        op2.type === "put" ? idbPut(store, op2.value) : idbDelete(store, op2.key);
      p.catch(() => {
        /* surfaced via quota/persist checks elsewhere */
      });
    }, flushMs)
  );
}

export async function flushWrites(store: string, keys: string[]): Promise<void> {
  const ops: Promise<unknown>[] = [];
  for (const k of keys) {
    const op = pending.get(k);
    if (!op) continue;
    pending.delete(k);
    const t = timers.get(k);
    if (t) {
      clearTimeout(t);
      timers.delete(k);
    }
    ops.push(op.type === "put" ? idbPut(store, op.value) : idbDelete(store, op.key));
  }
  await Promise.allSettled(ops);
}
