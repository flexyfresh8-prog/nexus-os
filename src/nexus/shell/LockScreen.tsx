"use client";

// NEXUS OS — LockScreen: full-viewport security gate.
//
// Renders above everything when the runtime lock is engaged. The desktop
// stays mounted underneath (state preserved) but is covered, blurred and
// made inert: no clicks, no focus, no keyboard reach-through to the shell.

import React, { useEffect, useRef, useState } from "react";
import { Lock, ShieldAlert } from "lucide-react";
import { useLock } from "../store/lock";
import { OS_VERSION } from "../apps/meta";

export function LockScreen() {
  const locked = useLock((s) => s.locked);
  const hasLock = useLock((s) => s.hasLock);
  const cooldownUntil = useLock((s) => s.cooldownUntil);
  const failedAttempts = useLock((s) => s.failedAttempts);
  const unlock = useLock((s) => s.unlock);

  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [now, setNow] = useState(() => new Date());
  const inputRef = useRef<HTMLInputElement | null>(null);

  // clock
  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, [locked]);

  // focus the passcode field when the gate appears
  useEffect(() => {
    if (locked) {
      setValue("");
      setError(null);
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [locked]);

  // cooldown ticker
  const [cooldownLeft, setCooldownLeft] = useState(0);
  useEffect(() => {
    if (!cooldownUntil) {
      setCooldownLeft(0);
      return;
    }
    const tick = () => setCooldownLeft(Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [cooldownUntil]);

  if (!locked || !hasLock) return null;

  const submit = async () => {
    if (busy || cooldownLeft > 0 || !value) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await unlock(value);
      if (!ok) {
        setError("Incorrect passcode.");
        setShake((s) => s + 1);
        setValue("");
      }
    } catch {
      setError("Unlock failed — try again.");
    } finally {
      setBusy(false);
    }
  };

  const time = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const date = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  return (
    <div
      data-testid="lock-screen"
      className="fixed inset-0 z-[11000] flex flex-col items-center justify-center bg-[#050507]/80 backdrop-blur-2xl"
      style={{ WebkitBackdropFilter: "blur(48px)" }}
      onKeyDown={(e) => {
        if (e.key === "Enter") void submit();
      }}
    >
      {/* veil over whatever is behind */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#050507]/40 via-transparent to-[#050507]/70" />

      <div className="relative flex flex-col items-center gap-1">
        <div className="text-[64px] font-extralight leading-none tracking-tight text-[#eef0f6] tabular-nums">{time}</div>
        <div className="text-[13px] text-[#8b91a0]">{date}</div>
      </div>

      <div
        key={shake}
        className="nx-glass-strong relative mt-10 w-[min(88vw,340px)] rounded-2xl border border-white/10 p-6 shadow-2xl"
        style={shake ? { animation: "nx-shake 0.4s ease" } : undefined}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="grid h-12 w-12 place-items-center rounded-full border border-[rgba(var(--nx-accent-rgb),0.35)] bg-[rgba(var(--nx-accent-rgb),0.12)]">
            <Lock size={20} className="text-[var(--nx-accent)]" />
          </div>
          <div className="text-center">
            <div className="text-[14px] font-semibold tracking-wide text-[#e8eaf1]">NEXUS OS is locked</div>
            <div className="mt-0.5 text-[11px] text-[#7b8291]">Enter your passcode to continue · v{OS_VERSION}</div>
          </div>

          <input
            ref={inputRef}
            type="password"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Passcode"
            disabled={busy || cooldownLeft > 0}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="Passcode"
            className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-center font-mono text-[14px] tracking-[0.35em] text-[#eef0f6] outline-none transition-colors placeholder:tracking-normal placeholder:text-[#5b6270] focus:border-[rgba(var(--nx-accent-rgb),0.6)] disabled:opacity-50"
          />

          {error && (
            <div className="flex items-center gap-1.5 text-[11px] text-rose-400" role="alert">
              <ShieldAlert size={12} />
              {error}
              {failedAttempts >= 3 ? ` (${failedAttempts} failed attempts)` : ""}
            </div>
          )}

          {cooldownLeft > 0 && (
            <div className="text-[11px] text-amber-400" role="alert">
              Too many attempts — retry in {cooldownLeft}s
            </div>
          )}

          <button
            onClick={() => void submit()}
            disabled={busy || cooldownLeft > 0 || !value}
            className="mt-1 w-full rounded-xl bg-[rgba(var(--nx-accent-rgb),0.9)] py-2.5 text-[13px] font-semibold text-black transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Verifying…" : "Unlock"}
          </button>

          <p className="text-center text-[10px] leading-relaxed text-[#5b6270]">
            Passcode verification uses PBKDF2 (600k rounds) + AES-GCM via WebCrypto. The
            passcode itself is never stored.
          </p>
        </div>
      </div>
    </div>
  );
}
