"use client";

// NEXUS OS — Nexus AI task history, persisted under kv key "ai:tasks"
// (IndexedDB). Records are capped at 20; transcripts at 40 messages each.
// Shapes are narrowed defensively so corrupted rows are dropped, not fatal.

import { kvGet, kvSet } from "../../lib/idb";
import type { HistoryStep, TaskRecord, TranscriptMessage } from "./types";

const KEY = "ai:tasks";
const MAX_TASKS = 20;
export const MAX_TRANSCRIPT = 40;

function narrowStep(v: unknown): HistoryStep | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string") return null;
  return {
    name: o.name,
    status: typeof o.status === "string" ? o.status : "unknown",
    summary: typeof o.summary === "string" ? o.summary : undefined,
    error: typeof o.error === "string" ? o.error : undefined,
  };
}

function narrowMsg(v: unknown): TranscriptMessage | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const role =
    o.role === "user" || o.role === "assistant" || o.role === "error" ? o.role : null;
  if (!role || typeof o.text !== "string") return null;
  return { role, text: o.text };
}

function narrowTask(v: unknown): TaskRecord | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.task !== "string" || typeof o.ts !== "number") {
    return null;
  }
  const status: TaskRecord["status"] =
    o.status === "completed" ||
    o.status === "failed" ||
    o.status === "stopped" ||
    o.status === "awaiting-approval"
      ? o.status
      : "failed";
  const steps = Array.isArray(o.steps)
    ? o.steps.map(narrowStep).filter((s): s is HistoryStep => s !== null)
    : [];
  const transcript = Array.isArray(o.transcript)
    ? o.transcript.map(narrowMsg).filter((m): m is TranscriptMessage => m !== null).slice(-MAX_TRANSCRIPT)
    : [];
  return {
    id: o.id,
    task: o.task,
    ts: o.ts,
    status,
    summary: typeof o.summary === "string" ? o.summary : "",
    steps,
    transcript,
  };
}

export async function loadTasks(): Promise<TaskRecord[]> {
  try {
    const raw = await kvGet<unknown>(KEY);
    if (!Array.isArray(raw)) return [];
    const out: TaskRecord[] = [];
    for (const item of raw) {
      const rec = narrowTask(item);
      if (rec) out.push(rec);
    }
    return out.sort((a, b) => b.ts - a.ts);
  } catch {
    return [];
  }
}

export async function saveTask(rec: TaskRecord): Promise<void> {
  const prev = await loadTasks();
  const next = [rec, ...prev.filter((t) => t.id !== rec.id)].slice(0, MAX_TASKS);
  await kvSet(KEY, next);
}

export async function clearTasks(): Promise<void> {
  await kvSet(KEY, []);
}
