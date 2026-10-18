"use client";

// NEXUS OS — filesystem store: in-memory tree synced to IndexedDB

import { create } from "zustand";
import type { FSNode } from "../types";
import {
  STORE_FS,
  idbGetAll,
  isIDBAvailable,
  scheduleWrite,
  flushWrites,
  kvGet,
  kvSet,
} from "../lib/idb";
import {
  ROOT_ID,
  HOME_ID,
  validateFileName,
  findChild,
  uniqueName,
  descendantsOf,
  createsCycle,
  mimeForFile,
} from "../lib/vfs";
import { uid } from "../lib/utils";

function now() {
  return Date.now();
}

function makeNode(partial: Partial<FSNode> & { name: string; type: FSNode["type"] }): FSNode {
  const t = now();
  return {
    id: partial.id ?? uid(),
    parentId: partial.parentId ?? null,
    created: t,
    modified: t,
    ...partial,
  } as FSNode;
}

async function seedFS(): Promise<Record<string, FSNode>> {
  const nodes: Record<string, FSNode> = {};
  const t = now();
  const add = (n: FSNode) => {
    nodes[n.id] = n;
    return n;
  };

  add(makeNode({ id: ROOT_ID, name: "", type: "dir", parentId: null }));
  add(
    makeNode({
      id: HOME_ID,
      name: "home",
      type: "dir",
      parentId: ROOT_ID,
      created: t,
      modified: t,
    })
  );

  const homeDirs = ["Documents", "Downloads", "Projects", "Pictures", "Music", "Desktop"];
  for (const d of homeDirs) {
    add(makeNode({ name: d, type: "dir", parentId: HOME_ID }));
  }

  const docs = findChild(nodes, HOME_ID, "Documents")!;
  const projects = findChild(nodes, HOME_ID, "Projects")!;
  const desktop = findChild(nodes, HOME_ID, "Desktop")!;

  add(
    makeNode({
      name: "welcome.md",
      type: "file",
      parentId: docs.id,
      content: [
        "# Welcome to NEXUS OS",
        "",
        "This is a **virtual filesystem** living inside your browser (IndexedDB).",
        "Nothing here touches your real files unless you explicitly import or export them.",
        "",
        "## Try this",
        "- Open the Terminal and run `help`",
        "- Browse files in File Explorer",
        "- Open Projects/hello-site in Nexus Studio and hit Preview",
        "- Press Ctrl+K anywhere for global search",
        "",
        "Everything persists across refreshes. Settings → Storage lets you back up or wipe the system.",
      ].join("\n"),
    })
  );

  // Sample web project for Studio
  const hello = add(makeNode({ name: "hello-site", type: "dir", parentId: projects.id }));
  add(
    makeNode({
      name: "index.html",
      type: "file",
      parentId: hello.id,
      content: [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        '  <meta charset="utf-8" />',
        "  <title>Hello NEXUS</title>",
        '  <link rel="stylesheet" href="styles.css" />',
        "</head>",
        "<body>",
        '  <main class="card">',
        "    <h1>Hello from NEXUS OS</h1>",
        "    <p>Edit me in Nexus Studio — the preview updates live.</p>",
        '    <button id="go">Count up</button>',
        '    <p>Count: <span id="n">0</span></p>',
        "  </main>",
        '  <script src="app.js"></script>',
        "</body>",
        "</html>",
      ].join("\n"),
    })
  );
  add(
    makeNode({
      name: "styles.css",
      type: "file",
      parentId: hello.id,
      content: [
        "body {",
        "  margin: 0;",
        "  min-height: 100vh;",
        "  display: grid;",
        "  place-items: center;",
        "  font-family: system-ui, sans-serif;",
        "  background: #0b0d12;",
        "  color: #e8ecf3;",
        "}",
        ".card {",
        "  padding: 2.5rem 3rem;",
        "  border-radius: 16px;",
        "  background: rgba(255,255,255,0.04);",
        "  border: 1px solid rgba(255,255,255,0.09);",
        "  text-align: center;",
        "}",
        "button {",
        "  margin-top: 1rem;",
        "  padding: 0.5rem 1.2rem;",
        "  border-radius: 10px;",
        "  border: 1px solid rgba(34,211,238,0.4);",
        "  background: rgba(34,211,238,0.12);",
        "  color: #22d3ee;",
        "  cursor: pointer;",
        "  font-size: 1rem;",
        "}",
      ].join("\n"),
    })
  );
  add(
    makeNode({
      name: "app.js",
      type: "file",
      parentId: hello.id,
      content: [
        "let n = 0;",
        "const el = document.getElementById('n');",
        "document.getElementById('go').addEventListener('click', () => {",
        "  n += 1;",
        "  el.textContent = String(n);",
        "});",
      ].join("\n"),
    })
  );
  add(
    makeNode({
      name: "readme.txt",
      type: "file",
      parentId: desktop.id,
      content: "Desktop shortcut test — right-click me.\n",
    })
  );
  return nodes;
}

export interface FSState {
  nodes: Record<string, FSNode>;
  ready: boolean;
  persistOK: boolean;
  init: () => Promise<void>;
  createNode: (o: {
    parentId: string;
    name: string;
    type: "file" | "dir";
    content?: string;
    binary?: ArrayBuffer;
    mime?: string;
    autoRename?: boolean;
  }) => { id: string } | { error: string };
  rename: (id: string, name: string) => string | null; // error or null
  remove: (id: string) => string | null;
  move: (id: string, newParentId: string) => string | null;
  copy: (id: string, newParentId: string, newName?: string) => string | null;
  writeFile: (id: string, content: string) => string | null;
  writeBinary: (id: string, buf: ArrayBuffer, mime?: string) => string | null;
  createFileAtPath: (path: string, cwdId: string, content?: string) => string | null;
  mkdirAtPath: (path: string, cwdId: string) => string | null;
  replaceAll: (nodes: Record<string, FSNode>) => void;
  wipe: () => void;
}

/** fire-and-forget persistence of one node */
function persistNode(node: FSNode) {
  scheduleWrite(STORE_FS, `n:${node.id}`, { type: "put", value: node });
}

function persistDelete(id: string) {
  scheduleWrite(STORE_FS, `n:${id}`, { type: "del", key: id }, 0);
}

export const useFS = create<FSState>((set, get) => ({
  nodes: {},
  ready: false,
  persistOK: true,

  init: async () => {
    try {
      const rows = await idbGetAll<FSNode>(STORE_FS);
      if (rows.length > 0) {
        const map: Record<string, FSNode> = {};
        for (const r of rows) map[r.id] = r;
        if (!map[ROOT_ID]) map[ROOT_ID] = makeNode({ id: ROOT_ID, name: "", type: "dir", parentId: null });
        set({ nodes: map, ready: true });
      } else {
        const seeded = await seedFS();
        set({ nodes: seeded, ready: true });
        for (const n of Object.values(seeded)) persistNode(n);
      }
      // schema version marker for future migrations
      const v = await kvGet<number>("schema:version");
      if (v === undefined) await kvSet("schema:version", 1);
    } catch {
      // IndexedDB unavailable — run in-memory so the OS still works
      const seeded = await seedFS();
      set({ nodes: seeded, ready: true, persistOK: false });
    }
  },

  createNode: (o) => {
    const err = validateFileName(o.name);
    if (err) return { error: err };
    const { nodes } = get();
    const parent = nodes[o.parentId];
    if (!parent || parent.type !== "dir") return { error: "Parent folder not found" };
    let name = o.name;
    const existing = findChild(nodes, o.parentId, name);
    if (existing) {
      if (!o.autoRename) return { error: `"${name}" already exists` };
      name = uniqueName(nodes, o.parentId, name);
    }
    const node = makeNode({
      name,
      type: o.type,
      parentId: o.parentId,
      content: o.type === "file" ? (o.content ?? "") : undefined,
      binary: o.binary,
      mime: o.mime ?? (o.type === "file" ? mimeForFile(name) : undefined),
    });
    set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }));
    persistNode(node);
    return { id: node.id };
  },

  rename: (id, name) => {
    const err = validateFileName(name);
    if (err) return err;
    const { nodes } = get();
    const node = nodes[id];
    if (!node) return "File not found";
    if (node.parentId !== null) {
      const clash = findChild(nodes, node.parentId, name);
      if (clash && clash.id !== id) return `"${name}" already exists`;
    }
    const updated = { ...node, name, modified: now() };
    set((s) => ({ nodes: { ...s.nodes, [id]: updated } }));
    persistNode(updated);
    return null;
  },

  remove: (id) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node) return "File not found";
    if (id === ROOT_ID || id === HOME_ID) return "Cannot delete a system directory";
    const ids = descendantsOf(nodes, id);
    const next = { ...nodes };
    for (const del of ids) {
      delete next[del];
      persistDelete(del);
    }
    set({ nodes: next });
    return null;
  },

  move: (id, newParentId) => {
    const { nodes } = get();
    const node = nodes[id];
    const target = nodes[newParentId];
    if (!node || !target) return "Path not found";
    if (target.type !== "dir") return "Destination is not a folder";
    if (id === ROOT_ID || id === HOME_ID) return "Cannot move a system directory";
    if (node.parentId === newParentId) return null;
    if (createsCycle(nodes, id, newParentId)) return "Cannot move a folder into itself";
    const clash = findChild(nodes, newParentId, node.name);
    const name = clash ? uniqueName(nodes, newParentId, node.name) : node.name;
    const updated = { ...node, parentId: newParentId, name, modified: now() };
    set((s) => ({ nodes: { ...s.nodes, [id]: updated } }));
    persistNode(updated);
    return null;
  },

  copy: (id, newParentId, newName) => {
    const { nodes } = get();
    const node = nodes[id];
    const target = nodes[newParentId];
    if (!node || !target) return "Path not found";
    if (target.type !== "dir") return "Destination is not a folder";
    if (createsCycle(nodes, id, newParentId)) return "Cannot copy a folder into itself";
    const baseName = newName ?? node.name;
    const name = uniqueName(nodes, newParentId, baseName);
    const cloneInto = (src: FSNode, parentId: string) => {
      const clone = makeNode({
        name: src.name,
        type: src.type,
        parentId,
        content: src.content,
        binary: src.binary?.slice(0),
        mime: src.mime,
      });
      set((s) => ({ nodes: { ...s.nodes, [clone.id]: clone } }));
      persistNode(clone);
      return clone.id;
    };
    const walk = (srcId: string, parentId: string) => {
      const src = get().nodes[srcId];
      if (!src) return;
      const cloneId = cloneInto(src, parentId);
      for (const child of Object.values(get().nodes)) {
        if (child.parentId === srcId) walk(child.id, cloneId);
      }
    };
    const rootCloneId = (() => {
      const clone = makeNode({
        name,
        type: node.type,
        parentId: newParentId,
        content: node.content,
        binary: node.binary?.slice(0),
        mime: node.mime,
      });
      set((s) => ({ nodes: { ...s.nodes, [clone.id]: clone } }));
      persistNode(clone);
      return clone.id;
    })();
    if (node.type === "dir") {
      for (const child of Object.values(nodes)) {
        if (child.parentId === id) walk(child.id, rootCloneId);
      }
    }
    return null;
  },

  writeFile: (id, content) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node) return "File not found";
    if (node.type !== "file") return "Not a file";
    const updated = { ...node, content, modified: now() };
    if (node.binary) delete (updated as { binary?: ArrayBuffer }).binary;
    updated.mime = node.mime ?? mimeForFile(node.name);
    set((s) => ({ nodes: { ...s.nodes, [id]: updated } }));
    persistNode(updated);
    return null;
  },

  writeBinary: (id, buf, mime) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node) return "File not found";
    if (node.type !== "file") return "Not a file";
    const updated: FSNode = { ...node, binary: buf, modified: now(), mime: mime ?? node.mime };
    if (typeof updated.content === "string" && !isSmallText(buf)) delete updated.content;
    set((s) => ({ nodes: { ...s.nodes, [id]: updated } }));
    persistNode(updated);
    return null;
  },

  createFileAtPath: (path, cwdId, content) => {
    const { nodes } = get();
    // manual walk so missing parents are created
    const segs = path.split("/").filter(Boolean);
    if (segs.length === 0) return "Invalid path";
    let cur = cwdId;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      const existing = findChild(get().nodes, cur, seg);
      if (i === segs.length - 1) {
        if (existing) {
          if (existing.type !== "file") return `"${seg}" is a directory`;
          const e = get().writeFile(existing.id, content ?? "");
          return e ?? existing.id;
        }
        const res = get().createNode({ parentId: cur, name: seg, type: "file", content: content ?? "", autoRename: false });
        return "id" in res ? res.id : res.error;
      }
      if (!existing) {
        const res = get().createNode({ parentId: cur, name: seg, type: "dir", autoRename: false });
        if (!("id" in res)) return res.error;
        cur = res.id;
      } else if (existing.type !== "dir") {
        return `"${seg}" is not a directory`;
      } else {
        cur = existing.id;
      }
    }
    return "Invalid path";
  },

  mkdirAtPath: (path, cwdId) => {
    const { nodes } = get();
    const segs = path.split("/").filter(Boolean);
    if (segs.length === 0) return "Invalid path";
    let cur = cwdId;
    for (const seg of segs) {
      const existing = findChild(get().nodes, cur, seg);
      if (!existing) {
        const res = get().createNode({ parentId: cur, name: seg, type: "dir", autoRename: false });
        if (!("id" in res)) return res.error;
        cur = res.id;
      } else if (existing.type !== "dir") {
        return `"${seg}" is not a directory`;
      } else {
        cur = existing.id;
      }
    }
    return cur;
  },

  replaceAll: (nodes) => {
    set({ nodes });
    // rewrite the whole store
    import("../lib/idb").then(({ idbClear, idbPut, STORE_FS }) => {
      idbClear(STORE_FS)
        .then(() => Promise.allSettled(Object.values(nodes).map((n) => idbPut(STORE_FS, n))))
        .catch(() => undefined);
    });
  },

  wipe: () => {
    import("../lib/idb").then(({ idbClear, STORE_FS }) => {
      idbClear(STORE_FS).catch(() => undefined);
    });
    (async () => {
      const seeded = await seedFS();
      set({ nodes: seeded });
      for (const n of Object.values(seeded)) persistNode(n);
    })();
  },
}));

function isSmallText(buf: ArrayBuffer): boolean {
  return false; // keep content+binary mutually exclusive: binary wins
}

export async function flushFSPersistence(): Promise<void> {
  const ids = Object.keys(useFS.getState().nodes).map((id) => `n:${id}`);
  await flushWrites(STORE_FS, ids);
}

export function homeDirId(): string {
  return HOME_ID;
}

export function useFSReady(): boolean {
  return useFS((s) => s.ready);
}
