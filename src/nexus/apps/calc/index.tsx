"use client";

// NEXUS OS — Calculator app. Real expression parsing (lib/calc.ts), keyboard
// input, tape history. No eval anywhere.

import { useCallback, useEffect, useRef, useState } from "react";
import { Delete, History } from "lucide-react";
import type { AppInstanceProps } from "../../types";
import { evaluateExpression, formatCalcResult } from "../../lib/calc";

const KEYS: Array<Array<{ label: string; insert?: string; action?: string; cls?: string }>> = [
  [
    { label: "C", action: "clear", cls: "text-red-300" },
    { label: "(", insert: "(" },
    { label: ")", insert: ")" },
    { label: "÷", insert: "/", cls: "text-[var(--nx-accent)]" },
  ],
  [
    { label: "7", insert: "7" },
    { label: "8", insert: "8" },
    { label: "9", insert: "9" },
    { label: "×", insert: "*", cls: "text-[var(--nx-accent)]" },
  ],
  [
    { label: "4", insert: "4" },
    { label: "5", insert: "5" },
    { label: "6", insert: "6" },
    { label: "−", insert: "-", cls: "text-[var(--nx-accent)]" },
  ],
  [
    { label: "1", insert: "1" },
    { label: "2", insert: "2" },
    { label: "3", insert: "3" },
    { label: "+", insert: "+", cls: "text-[var(--nx-accent)]" },
  ],
  [
    { label: "0", insert: "0" },
    { label: ".", insert: "." },
    { label: "^", insert: "^" },
    { label: "=", action: "equals", cls: "bg-[var(--nx-accent)] text-black font-semibold" },
  ],
];

const EXTRA_FUNCS = ["sqrt(", "sin(", "cos(", "tan(", "log(", "ln(", "abs(", "pi", "e", "%"];

interface TapeItem {
  id: number;
  expr: string;
  result: string;
  ok: boolean;
}

export default function CalculatorApp(_props: AppInstanceProps) {
  const [expr, setExpr] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [tape, setTape] = useState<TapeItem[]>([]);
  const [showTape, setShowTape] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const idRef = useRef(1);

  // live preview — errors stay silent until Enter
  useEffect(() => {
    if (!expr.trim()) {
      setPreview(null);
      return;
    }
    try {
      const v = evaluateExpression(expr);
      setPreview(formatCalcResult(v));
    } catch {
      setPreview(null);
    }
  }, [expr]);

  const commit = useCallback(() => {
    const text = expr.trim();
    if (!text) return;
    try {
      const v = evaluateExpression(text);
      const result = formatCalcResult(v);
      setTape((t) => [{ id: idRef.current++, expr: text, result, ok: true }, ...t].slice(0, 50));
      setExpr(result);
    } catch (e) {
      setTape((t) => [
        { id: idRef.current++, expr: text, result: e instanceof Error ? e.message : "error", ok: false },
        ...t,
      ]);
    }
    setShowTape(true);
  }, [expr]);

  const press = (k: { label: string; insert?: string; action?: string }) => {
    if (k.action === "clear") {
      setExpr("");
      return;
    }
    if (k.action === "equals") {
      commit();
      return;
    }
    if (k.insert) setExpr((e) => e + k.insert);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
    if (e.key === "Escape") {
      setExpr("");
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* display */}
      <div className="shrink-0 border-b border-white/5 bg-black/20 px-4 pb-3 pt-4">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={expr}
            onChange={(e) => setExpr(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type an expression…"
            aria-label="Expression"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 border-none bg-transparent text-right font-mono text-xl text-[var(--nx-text)] outline-none placeholder:text-sm placeholder:text-[var(--nx-text-dim)]"
          />
          <button
            onClick={() => setExpr((e) => e.slice(0, -1))}
            title="Backspace"
            className="rounded-md p-1.5 text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]"
          >
            <Delete size={16} />
          </button>
          <button
            onClick={() => setShowTape((v) => !v)}
            title="History"
            className={`rounded-md p-1.5 transition ${showTape ? "bg-white/10 text-[var(--nx-text)]" : "text-[var(--nx-text-dim)] hover:bg-white/5 hover:text-[var(--nx-text)]"}`}
          >
            <History size={16} />
          </button>
        </div>
        <div className="mt-1 h-6 text-right font-mono text-sm text-[var(--nx-text-dim)]">
          {preview !== null ? <span className="text-[var(--nx-accent)]">= {preview}</span> : ""}
        </div>
      </div>

      {/* quick funcs */}
      <div className="nx-scroll flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/5 px-3 py-2">
        {EXTRA_FUNCS.map((f) => (
          <button
            key={f}
            onClick={() => setExpr((e) => e + f)}
            className="shrink-0 rounded-md bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-[var(--nx-text-dim)] transition hover:bg-white/10 hover:text-[var(--nx-text)]"
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* keypad */}
        <div className="grid flex-1 grid-cols-4 gap-2 p-3">
          {KEYS.flat().map((k) => (
            <button
              key={k.label}
              onClick={() => press(k)}
              className={`rounded-xl border border-white/[0.06] bg-white/[0.04] text-base text-[var(--nx-text)] transition-all hover:bg-white/[0.09] active:scale-[0.97] ${k.cls ?? ""}`}
            >
              {k.label}
            </button>
          ))}
        </div>

        {/* tape */}
        {showTape && (
          <div className="nx-scroll w-[46%] min-w-[170px] overflow-y-auto border-l border-white/5 bg-black/20 p-2">
            {tape.length === 0 ? (
              <p className="p-2 text-[11px] text-[var(--nx-text-dim)]">No calculations yet.</p>
            ) : (
              tape.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setExpr(t.expr)}
                  className="mb-1 block w-full rounded-lg px-2 py-1.5 text-left transition hover:bg-white/5"
                >
                  <div className="truncate font-mono text-[10px] text-[var(--nx-text-dim)]">{t.expr}</div>
                  <div className={`truncate font-mono text-xs ${t.ok ? "text-[var(--nx-text)]" : "text-red-400"}`}>
                    = {t.result}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
