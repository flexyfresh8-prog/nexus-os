"use client";

// NEXUS OS — central security layer.
//
// One place for the security-critical plumbing every other module shares:
//
//   - deviceKey()          — a per-installation random 256-bit key (IndexedDB),
//                            used to encrypt secrets at rest (API keys…)
//   - sealKV / openKV      — encrypted KV entries under the `secret:` prefix
//   - audit() / auditLog() — append-only security audit trail (ring buffer)
//   - redact()             — scrub secret-looking substrings before logging
//   - safeExternalOpen()   — https-only window.open with noopener+noreferrer
//   - isSelfOriginUrl()    — blocks the app's own origin from preview frames
//   - sanitizeImportedFS() — structural validation of imported backup nodes
//
// Honest scope: this hardens the browser environment. It cannot make data
// survive a browser wipe, and it cannot stop a attacker who already runs
// script on the page while it is unlocked. SECURITY.md has the full model.

import { kvGet, kvSet, idbDelete, STORE_KV } from "./idb";
import { sealWithKey, openWithKey, type SealedPayload } from "./crypto";
import type { FSNode } from "../types";

// ---------------------------------------------------------------- device key

const DEVICE_KEY_ENTRY = "secret:device-key";

let cachedKey: ArrayBuffer | null = null;
let keyPromise: Promise<ArrayBuffer> | null = null;

/**
 * Raw 256-bit key unique to this browser profile. Generated on first use.
 * Stored in IndexedDB alongside (not inside) the secrets it protects — it
 * raises the bar against database-only exfiltration and backup-file leaks,
 * and pairs with the lock screen for stronger guarantees.
 */
export function deviceKey(): Promise<ArrayBuffer> {
  if (cachedKey) return Promise.resolve(cachedKey);
  if (keyPromise) return keyPromise;
  keyPromise = (async () => {
    const existing = (await kvGet<unknown>(DEVICE_KEY_ENTRY)) as { raw?: unknown } | undefined;
    let bits: ArrayBuffer;
    if (existing && Array.isArray(existing.raw) && existing.raw.every((n) => typeof n === "number")) {
      bits = new Uint8Array(existing.raw as number[]).buffer;
    } else {
      const fresh = new Uint8Array(32);
      crypto.getRandomValues(fresh);
      bits = fresh.buffer;
      await kvSet(DEVICE_KEY_ENTRY, { raw: Array.from(fresh) });
    }
    cachedKey = bits;
    return bits;
  })();
  return keyPromise;
}

// ------------------------------------------------------------- encrypted KV

export type SecretKind = "ai-provider" | "lock" | "misc";

export interface SealedRecord {
  kind: SecretKind;
  sealed: SealedPayload;
  updatedAt: number;
}

/** Store a secret value encrypted with the device key (key gets `secret:` prefix). */
export async function sealKV<T>(key: string, kind: SecretKind, value: T): Promise<void> {
  const dk = await deviceKey();
  const sealed = await sealWithKey(value, dk);
  const rec: SealedRecord = { kind, sealed, updatedAt: Date.now() };
  await kvSet(key.startsWith("secret:") ? key : `secret:${key}`, rec);
}

/** Read + decrypt a `secret:` KV entry. Returns null when absent or undecryptable. */
export async function openKV<T>(key: string): Promise<T | null> {
  const rec = await kvGet<SealedRecord>(key.startsWith("secret:") ? key : `secret:${key}`);
  if (!rec || !rec.sealed) return null;
  try {
    const dk = await deviceKey();
    return await openWithKey<T>(rec.sealed, dk);
  } catch {
    audit("secret:undecryptable", { key: key.slice(0, 40) });
    return null;
  }
}

export async function deleteKV(key: string): Promise<void> {
  await idbDelete(STORE_KV, key.startsWith("secret:") ? key : `secret:${key}`);
}

// ---------------------------------------------------------------- audit log

export type AuditEvent =
  | "boot"
  | "lock:enabled"
  | "lock:disabled"
  | "lock:passcode-changed"
  | "lock:locked"
  | "lock:unlocked"
  | "lock:failed-attempt"
  | "lock:autolock"
  | "panic-wipe"
  | "backup:export"
  | "backup:import"
  | "secret:stored"
  | "secret:removed"
  | "secret:undecryptable"
  | "ai:provider-saved"
  | "ai:tool-danger"
  | "csp:violation"
  | "fs:import-rejected";

export interface AuditEntry {
  ts: number;
  event: AuditEvent;
  detail?: string;
}

const AUDIT_KEY = "security:audit";
const AUDIT_MAX = 200;

let memoryLog: AuditEntry[] | null = null;

/** Append an event to the security audit trail (ring buffer, best-effort). */
export function audit(event: AuditEvent, detail?: Record<string, unknown> | string): void {
  const entry: AuditEntry = {
    ts: Date.now(),
    event,
    detail: detail ? redact(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 300) : undefined,
  };
  if (!memoryLog) memoryLog = [];
  memoryLog.push(entry);
  memoryLog = memoryLog.slice(-AUDIT_MAX);
  // persist async, never block, never throw into caller
  kvSet(AUDIT_KEY, memoryLog).catch(() => {});
}

/** Read the audit trail (memory first, then storage). */
export async function auditLog(): Promise<AuditEntry[]> {
  if (memoryLog) return [...memoryLog];
  const stored = await kvGet<AuditEntry[]>(AUDIT_KEY).catch(() => null);
  memoryLog = Array.isArray(stored) ? stored.slice(-AUDIT_MAX) : [];
  return [...memoryLog];
}

export async function clearAudit(): Promise<void> {
  memoryLog = [];
  await kvSet(AUDIT_KEY, []).catch(() => {});
}

/** Age of an audit timestamp, humanized briefly. */
export function agoOf(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ---------------------------------------------------------------- redaction

const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{16,}/g, // GitHub tokens
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style keys
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /Bearer\s+[A-Za-z0-9._-]{8,}/gi,
  /x-api-key[:=]\s*[^\s,;"]+/gi,
  /api[_-]?key[:=]\s*[^\s,;"]+/gi,
];

/** Replace secret-looking substrings with a fixed mask before logging. */
export function redact(text: string): string {
  let out = text ?? "";
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[redacted]");
  return out;
}

// ---------------------------------------------------------------- safe opens

/**
 * window.open hardened: https(s)/localhost only, noopener + noreferrer,
 * returns false (and audits) instead of throwing.
 */
export function safeExternalOpen(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const ok =
    u.protocol === "https:" ||
    u.protocol === "http:" && (/^localhost$|^127(\.\d+){3}$/.test(u.hostname));
  if (!ok) {
    audit("csp:violation", `blocked external open: ${u.protocol}`);
    return false;
  }
  const w = window.open(u.toString(), "_blank", "noopener,noreferrer");
  return w !== null;
}

/**
 * True when the URL points at THIS app's own origin (same host+port).
 * Preview frames must never load same-origin documents: sandboxed or not,
 * it would hand embedded code the app's own-origin attack surface.
 */
export function isSelfOriginUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (typeof window === "undefined") return false;
    return u.host === window.location.host;
  } catch {
    return false;
  }
}

// ------------------------------------------------------- import sanitization

const MAX_IMPORT_NODES = 20_000;
const MAX_IMPORT_NAME = 120;
const MAX_IMPORT_BINARY = 64 * 1024 * 1024; // 64 MB per binary blob
const MAX_IMPORT_TOTAL = 256 * 1024 * 1024; // 256 MB total payload

export interface SanitizeReport {
  nodes: FSNode[];
  rejected: number;
  reason?: string;
}

/** Dangerous own-property names that must never survive an import. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  if (ArrayBuffer.isView(v) || v instanceof ArrayBuffer) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function stripDangerousKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    out[k] = isPlainObject(v) ? stripDangerousKeys(v) : v;
  }
  return out;
}

function validName(name: unknown): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= MAX_IMPORT_NAME &&
    !/[\\/]/.test(name) &&
    name !== "." &&
    name !== ".." &&
    !/[\u0000-\u001f]/.test(name)
  );
}

/**
 * Structural validation for backup FS nodes before they touch IndexedDB:
 * - rejects nodes with dangerous keys (__proto__ pollution attempts)
 * - rejects invalid names (path separators, control chars, oversized)
 * - enforces node-count and payload-size caps (import "zip bomb" guards)
 * - drops unknown node types
 */
export function sanitizeImportedFS(rawNodes: unknown[]): SanitizeReport {
  if (rawNodes.length > MAX_IMPORT_NODES) {
    return { nodes: [], rejected: rawNodes.length, reason: `Too many entries (${rawNodes.length} > ${MAX_IMPORT_NODES} cap).` };
  }
  const nodes: FSNode[] = [];
  let rejected = 0;
  let totalBytes = 0;

  for (const raw of rawNodes) {
    if (!raw || typeof raw !== "object") { rejected++; continue; }
    const obj = stripDangerousKeys(raw as Record<string, unknown>);
    if (!validName(obj.name) || (obj.type !== "file" && obj.type !== "dir") || typeof obj.id !== "string" || !obj.id) {
      rejected++;
      continue;
    }
    if (typeof obj.parentId !== "string" && obj.parentId !== null) { rejected++; continue; }
    if (obj.type === "file") {
      if (typeof obj.content === "string") {
        totalBytes += obj.content.length;
      } else if (obj.binary instanceof ArrayBuffer || obj.binary instanceof Uint8Array) {
        const size = obj.binary instanceof Uint8Array ? obj.binary.byteLength : (obj.binary as ArrayBuffer).byteLength;
        if (size > MAX_IMPORT_BINARY) { rejected++; continue; }
        totalBytes += size;
      } else {
        // neither text nor binary content → drop the phantom file
        rejected++;
        continue;
      }
    }
    nodes.push({
      id: obj.id,
      name: obj.name as string,
      type: obj.type as "file" | "dir",
      parentId: obj.parentId as string | null,
      ...(obj.type === "file"
        ? {
            content: typeof obj.content === "string" ? obj.content : undefined,
            binary: obj.binary as ArrayBuffer | undefined,
            mime: typeof obj.mime === "string" ? obj.mime : undefined,
            created: typeof obj.created === "number" ? obj.created : Date.now(),
            modified: typeof obj.modified === "number" ? obj.modified : Date.now(),
          }
        : {}),
    } as FSNode);
  }

  if (totalBytes > MAX_IMPORT_TOTAL) {
    return { nodes: [], rejected: nodes.length, reason: `Backup payload too large (${Math.round(totalBytes / 1048576)} MB > ${MAX_IMPORT_TOTAL / 1048576} MB cap).` };
  }
  return { nodes, rejected, reason: rejected > 0 ? `${rejected} invalid entries dropped` : undefined };
}

/** Format the marker used by Settings → Security to show crypto availability. */
export function cryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle;
}
