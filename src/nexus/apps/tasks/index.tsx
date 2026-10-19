"use client";

// NEXUS OS — Task Manager. Real task lists with priorities, due dates and
// completion state, persisted in IndexedDB (kv) so they survive reloads.

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Circle, ListChecks, Plus, Trash2 } from "lucide-react";
import type { AppInstanceProps } from "../../types";
import { kvGet, kvSet } from "../../lib/idb";
import { uid } from "../../lib/utils";

interface Task {
  id: string;
  title: string;
  done: boolean;
  priority: "low" | "normal" | "high";
  due?: string; // YYYY-MM-DD
  created: number;
}

const KEY = "tasks:items";
const PRIO_CLS: Record<Task["priority"], string> = {
  low: "text-zinc-400",
  normal: "text-sky-300",
  high: "text-rose-300",
};

function dueLabel(due?: string): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const d = new Date(due + "T23:59:59");
  const today = new Date();
  const diff = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  if (diff < 0) return { text: `${-diff}d overdue`, overdue: true };
  if (diff === 0) return { text: "due today", overdue: false };
  if (diff === 1) return { text: "due tomorrow", overdue: false };
  return { text: `due in ${diff}d`, overdue: false };
}

export default function TaskManagerApp(_props: AppInstanceProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("normal");
  const [due, setDue] = useState("");
  const [filter, setFilter] = useState<"all" | "open" | "done">("open");

  useEffect(() => {
    void (async () => {
      try {
        const raw = await kvGet<Task[]>(KEY);
        if (Array.isArray(raw)) setTasks(raw);
      } catch { /* fresh start */ }
      setLoaded(true);
    })();
  }, []);

  const persist = (next: Task[]) => {
    setTasks(next);
    void kvSet(KEY, next).catch(() => undefined);
  };

  const add = () => {
    const t = title.trim();
    if (!t) return;
    persist([{ id: uid(), title: t, done: false, priority, due: due || undefined, created: Date.now() }, ...tasks]);
    setTitle("");
    setDue("");
  };

  const toggle = (id: string) =>
    persist(tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

  const remove = (id: string) => persist(tasks.filter((t) => t.id !== id));

  const visible = useMemo(() => {
    const base = tasks.filter((t) => (filter === "all" ? true : filter === "open" ? !t.done : t.done));
    const rank = { high: 0, normal: 1, low: 2 };
    return base.sort((a, b) => rank[a.priority] - rank[b.priority] || a.created - b.created);
  }, [tasks, filter]);

  const openCount = tasks.filter((t) => !t.done).length;

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="shrink-0 border-b border-white/5 p-3">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="Add a task…"
            aria-label="New task"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[13px] outline-none placeholder:text-[var(--nx-text-dim)] focus:border-[rgba(var(--nx-accent-rgb),0.5)]"
          />
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Task["priority"])}
            aria-label="Priority"
            className="shrink-0 rounded-lg border border-white/10 bg-black/25 px-2 text-[12px] text-[var(--nx-text)] outline-none"
          >
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            aria-label="Due date"
            className="w-[128px] shrink-0 rounded-lg border border-white/10 bg-black/25 px-2 text-[12px] text-[var(--nx-text)] outline-none [color-scheme:dark]"
          />
          <button
            onClick={add}
            disabled={!title.trim()}
            aria-label="Add task"
            className="shrink-0 rounded-lg bg-[rgba(var(--nx-accent-rgb),0.15)] px-3 text-[var(--nx-accent)] transition hover:bg-[rgba(var(--nx-accent-rgb),0.25)] disabled:opacity-40"
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="mt-2 flex items-center gap-1 text-[11px]">
          {(["open", "all", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-md px-2.5 py-1 capitalize transition ${
                filter === f ? "bg-white/10 text-[var(--nx-text)]" : "text-[var(--nx-text-dim)] hover:bg-white/5"
              }`}
            >
              {f}
            </button>
          ))}
          <span className="ml-auto flex items-center gap-1 text-[var(--nx-text-dim)]">
            <ListChecks size={12} /> {openCount} open · {tasks.length} total
          </span>
        </div>
      </div>

      {/* list */}
      <div className="nx-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {!loaded ? null : visible.length === 0 ? (
          <div className="grid h-full place-items-center text-center">
            <div>
              <div className="mb-2 text-3xl">✅</div>
              <p className="text-[13px] text-[var(--nx-text)]">
                {filter === "open" ? "All clear — nothing open." : "No tasks here yet."}
              </p>
              <p className="mt-1 text-[11px] text-[var(--nx-text-dim)]">
                Tasks persist in IndexedDB on this device.
              </p>
            </div>
          </div>
        ) : (
          visible.map((t) => {
            const d = dueLabel(t.due);
            return (
              <div
                key={t.id}
                className="group mb-1 flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 transition hover:border-white/5 hover:bg-white/[0.03]"
              >
                <button onClick={() => toggle(t.id)} aria-label={t.done ? "Mark open" : "Mark done"} className="shrink-0">
                  {t.done ? (
                    <CheckCircle2 size={16} className="text-emerald-400" />
                  ) : (
                    <Circle size={16} className="text-[var(--nx-text-dim)] transition hover:text-[var(--nx-accent)]" />
                  )}
                </button>
                <span className={`min-w-0 flex-1 truncate text-[13px] ${t.done ? "text-[var(--nx-text-dim)] line-through" : "text-[var(--nx-text)]"}`}>
                  {t.title}
                </span>
                <span className={`shrink-0 text-[10px] font-medium uppercase tracking-wide ${PRIO_CLS[t.priority]}`}>
                  {t.priority}
                </span>
                {d ? (
                  <span className={`shrink-0 text-[10px] ${d.overdue && !t.done ? "font-medium text-red-400" : "text-[var(--nx-text-dim)]"}`}>
                    {d.text}
                  </span>
                ) : null}
                <button
                  onClick={() => remove(t.id)}
                  aria-label="Delete task"
                  className="shrink-0 rounded p-1 text-[var(--nx-text-dim)] opacity-0 transition hover:bg-red-400/10 hover:text-red-400 group-hover:opacity-100"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
