"use client";

// NEXUS OS — full backup export/import (fs + kv), safe validation

import { STORE_FS, STORE_KV, idbGetAll, idbClear, idbPut } from "./idb";
import { sanitizeImportedFS } from "./secure";
import { audit } from "./secure";
import type { FSNode } from "../types";

export const BACKUP_VERSION = 1;

export interface BackupFile {
  app: "nexus-os";
  version: number;
  exportedAt: number;
  fs: FSNode[];
  kv: { key: string; value: unknown }[];
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Serialize binary payloads for JSON transport */
function prepare(node: FSNode): Record<string, unknown> {
  const out: Record<string, unknown> = { ...node };
  if (node.binary) {
    out.binary = { __b64: bufToBase64(node.binary) };
  }
  return out;
}

function restore(raw: Record<string, unknown>): FSNode {
  const node = { ...raw } as Record<string, unknown>;
  const b = node.binary as { __b64?: string } | undefined;
  if (b && b.__b64) {
    node.binary = base64ToBuf(b.__b64);
  } else {
    delete node.binary;
  }
  return node as unknown as FSNode;
}

export async function collectBackup(): Promise<BackupFile> {
  const [fs, kv] = await Promise.all([idbGetAll<FSNode>(STORE_FS), idbGetAll<{ key: string; value: unknown }>(STORE_KV)]);
  return {
    app: "nexus-os",
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    fs: fs.map(prepare) as unknown as FSNode[],
    kv: kv.filter((r) => typeof r.key === "string" && !r.key.startsWith("secret:")),
  };
}

export function downloadBackup(): Promise<void> {
  return collectBackup().then((backup) => {
    audit("backup:export", `${backup.fs.length} nodes exported (secrets excluded)`);
    const json = JSON.stringify(backup, (k, v) => {
      if (v instanceof ArrayBuffer) return { __b64: bufToBase64(v) };
      return v;
    });
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nexus-os-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}

export interface ImportResult {
  ok: boolean;
  message: string;
  files?: number;
}

export async function importBackup(json: string, mode: "merge" | "replace"): Promise<ImportResult> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return { ok: false, message: "Not a valid JSON file." };
  }
  const b = data as Partial<BackupFile>;
  if (!b || b.app !== "nexus-os" || !Array.isArray(b.fs)) {
    return { ok: false, message: "This file is not a NEXUS OS backup (missing app marker or filesystem data)." };
  }
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) {
    return { ok: false, message: `Backup version ${String(b.version)} is newer than this system supports (${BACKUP_VERSION}).` };
  }

  // structural validation: caps, name rules, prototype-pollution keys,
  // phantom files — before a single byte touches IndexedDB
  const report = sanitizeImportedFS(
    b.fs.map((n) => restore(n as unknown as Record<string, unknown>))
  );
  if (report.reason && report.nodes.length === 0) {
    audit("backup:import", `rejected: ${report.reason}`);
    return { ok: false, message: `Import rejected: ${report.reason}` };
  }
  const nodes = report.nodes;
  if (!nodes.some((n) => n.id === "root" && n.type === "dir")) {
    audit("backup:import", "rejected: missing filesystem root");
    return { ok: false, message: "Backup is missing the filesystem root — import aborted." };
  }

  try {
    if (mode === "replace") {
      await idbClear(STORE_FS);
    }
    await Promise.allSettled(nodes.map((n) => idbPut(STORE_FS, n)));
    if (Array.isArray(b.kv)) {
      for (const row of b.kv) {
        if (row && typeof row.key === "string" && mode === "merge") {
          // never import secret entries (they are device-key-encrypted and
          // useless across installs) or anything that is not a plain record
          if (row.key.startsWith("secret:")) continue;
          const existing = await idbGetAll<{ key: string }>(STORE_KV);
          if (!existing.some((e) => e.key === row.key)) {
            await idbPut(STORE_KV, row);
          }
        }
      }
    }
    audit("backup:import", `${nodes.length} nodes, ${mode} mode${report.rejected ? `, ${report.rejected} dropped` : ""}`);
    return { ok: true, message: `Imported ${nodes.length} items (${mode} mode).${report.rejected ? ` ${report.rejected} invalid entries dropped.` : ""}`, files: nodes.length };
  } catch (e) {
    return { ok: false, message: `Import failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
