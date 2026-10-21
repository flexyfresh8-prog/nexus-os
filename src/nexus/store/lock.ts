"use client";

// NEXUS OS — lock screen state + store.
//
// The passcode never leaves this module as plaintext:
//   - enabling the lock stores a verifier (random token sealed under the
//     passcode with PBKDF2-600k + AES-GCM) in the KV store
//   - unlocking decrypts the verifier; wrong passcode fails authentication
//   - runtime lock state is in-memory only and always starts locked when a
//     verifier exists (reload = locked, session cannot bypass the passcode)

import { create } from "zustand";
import { kvGet, kvSet, idbDelete, STORE_KV } from "../lib/idb";
import type { SealedPayload } from "../lib/crypto";
import { verifyPasscode, passcodeProblem } from "../lib/crypto";
import { audit } from "../lib/secure";

const LOCK_KEY = "security:lock";

export interface LockConfig {
  enabled: boolean;
  /** verifier payload — ciphertext only; plaintext passcode is never stored */
  verifier: SealedPayload;
  enabledAt: number;
}

interface LockState {
  /** config known? (async boot check) */
  checked: boolean;
  /** does this installation have a passcode? */
  hasLock: boolean;
  /** runtime gate — true shows the LockScreen overlay */
  locked: boolean;
  /** failed-attempt backoff */
  cooldownUntil: number;
  failedAttempts: number;

  /** read persisted config on boot */
  init: () => Promise<void>;
  lock: (reason?: "manual" | "idle") => void;
  unlock: (passcode: string) => Promise<boolean>;
  /** enable the lock (stores verifier). Returns an error string or null. */
  enable: (newPasscode: string) => Promise<string | null>;
  /** change passcode — requires the current one to verify first */
  change: (current: string, next: string) => Promise<string | null>;
  /** remove the lock entirely — requires the current passcode */
  disable: (current: string) => Promise<string | null>;
}

export const useLock = create<LockState>((set, get) => ({
  checked: false,
  hasLock: false,
  locked: false,
  cooldownUntil: 0,
  failedAttempts: 0,

  init: async () => {
    try {
      const cfg = await kvGet<LockConfig>(LOCK_KEY);
      set({
        checked: true,
        hasLock: !!cfg?.enabled && !!cfg?.verifier,
        locked: !!cfg?.enabled && !!cfg?.verifier, // boot into the locked state
      });
      if (cfg?.enabled) audit("lock:locked", "boot with lock enabled");
    } catch {
      set({ checked: true, hasLock: false, locked: false });
    }
  },

  lock: (reason = "manual") => {
    if (!get().hasLock || get().locked) return;
    set({ locked: true, failedAttempts: 0, cooldownUntil: 0 });
    audit("lock:locked", reason === "idle" ? "auto-lock (idle timeout)" : "locked by user");
  },

  unlock: async (passcode) => {
    const cfg = await kvGet<LockConfig>(LOCK_KEY);
    if (!cfg?.enabled || !cfg.verifier) {
      set({ locked: false, hasLock: false });
      return true;
    }
    if (Date.now() < get().cooldownUntil) return false;
    const ok = await verifyPasscode(cfg.verifier, passcode);
    if (ok) {
      set({ locked: false, failedAttempts: 0, cooldownUntil: 0 });
      audit("lock:unlocked");
      return true;
    }
    const attempts = get().failedAttempts + 1;
    // exponential-ish backoff: 3 fails → 15s, 5 → 60s, 7+ → 5 min
    const cooldown = attempts >= 7 ? 300_000 : attempts >= 5 ? 60_000 : attempts >= 3 ? 15_000 : 0;
    set({ failedAttempts: attempts, cooldownUntil: cooldown ? Date.now() + cooldown : 0 });
    audit("lock:failed-attempt", `attempt #${attempts}${cooldown ? `, cooldown ${cooldown / 1000}s` : ""}`);
    return false;
  },

  enable: async (newPasscode) => {
    const problem = passcodeProblem(newPasscode);
    if (problem) return problem;
    const { createVerifier } = await import("../lib/crypto");
    const { payload } = await createVerifier(newPasscode);
    const cfg: LockConfig = { enabled: true, verifier: payload, enabledAt: Date.now() };
    await kvSet(LOCK_KEY, cfg);
    set({ hasLock: true, locked: false, failedAttempts: 0, cooldownUntil: 0 });
    audit("lock:enabled");
    return null;
  },

  change: async (current, next) => {
    const problem = passcodeProblem(next);
    if (problem) return problem;
    const cfg = await kvGet<LockConfig>(LOCK_KEY);
    if (!cfg?.verifier) return "No passcode is configured.";
    if (!(await verifyPasscode(cfg.verifier, current))) {
      audit("lock:failed-attempt", "during passcode change");
      return "Current passcode is incorrect.";
    }
    const { createVerifier } = await import("../lib/crypto");
    const { payload } = await createVerifier(next);
    const nextCfg: LockConfig = { ...cfg, verifier: payload, enabledAt: Date.now() };
    await kvSet(LOCK_KEY, nextCfg);
    audit("lock:passcode-changed");
    return null;
  },

  disable: async (current) => {
    const cfg = await kvGet<LockConfig>(LOCK_KEY);
    if (!cfg?.verifier) {
      set({ hasLock: false, locked: false });
      return null;
    }
    if (!(await verifyPasscode(cfg.verifier, current))) {
      audit("lock:failed-attempt", "during lock disable");
      return "Current passcode is incorrect.";
    }
    await idbDelete(STORE_KV, LOCK_KEY);
    set({ hasLock: false, locked: false, failedAttempts: 0, cooldownUntil: 0 });
    audit("lock:disabled");
    return null;
  },
}));
