"use client";

// NEXUS OS — security primitives (WebCrypto).
//
// Everything here is honest, real cryptography provided by the browser:
//   - PBKDF2-HMAC-SHA256 (600k iterations) for passcode key derivation
//   - AES-GCM-256 for authenticated encryption of secrets at rest
//   - A random "verifier" payload pattern for passcode checking:
//     the verifier only decrypts with the correct key.
//
// Threat model note: these helpers protect data AT REST (IndexedDB dumps,
// backup files, shoulder-surfing via the lock screen). No browser app can
// protect against an attacker who can run JavaScript inside the page while
// it is unlocked — that is what the sandbox, CSP and permission layers are
// for. See SECURITY.md for the full model.

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BITS = 256;

function subtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("WebCrypto is not available in this environment.");
  }
  return crypto.subtle;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function randomToken(bytes = 32): string {
  const raw = randomBytes(bytes);
  let s = "";
  for (const b of raw) s += b.toString(16).padStart(2, "0");
  return s;
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    s += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveBitsFromPasscode(passcode: string, salt: Uint8Array): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const key = await subtle().importKey("raw", enc.encode(passcode), "PBKDF2", false, ["deriveBits"]);
  return subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    KEY_BITS
  );
}

async function aesKey(rawBits: ArrayBuffer | Uint8Array): Promise<CryptoKey> {
  return subtle().importKey("raw", rawBits as BufferSource, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

// ------------------------------------------------------------ AES-GCM JSON

export interface SealedPayload {
  /** format marker */
  f: "nexus-enc";
  /** base64 salt (only meaningful for passcode-derived keys) */
  s?: string;
  /** base64 AES-GCM IV */
  iv: string;
  /** base64 ciphertext */
  ct: string;
}

/** Encrypt a JSON-serializable value with a raw key (device key path). */
export async function sealWithKey(value: unknown, rawKey: ArrayBuffer | Uint8Array): Promise<SealedPayload> {
  const iv = randomBytes(IV_BYTES);
  const key = await aesKey(rawKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext);
  return { f: "nexus-enc", iv: toBase64(iv), ct: toBase64(ct) };
}

/** Decrypt a payload produced by sealWithKey. Throws on tamper/wrong key. */
export async function openWithKey<T>(payload: SealedPayload, rawKey: ArrayBuffer | Uint8Array): Promise<T> {
  if (!payload || payload.f !== "nexus-enc" || typeof payload.iv !== "string" || typeof payload.ct !== "string") {
    throw new Error("Malformed encrypted payload.");
  }
  const key = await aesKey(rawKey);
  const pt = await subtle().decrypt(
    { name: "AES-GCM", iv: fromBase64(payload.iv) as BufferSource },
    key,
    fromBase64(payload.ct) as BufferSource
  );
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}

// ------------------------------------------------------------ passcode seal

/** Seal `value` under a user passcode. Salt is embedded in the payload. */
export async function sealWithPasscode(value: unknown, passcode: string): Promise<SealedPayload> {
  const salt = randomBytes(SALT_BYTES);
  const bits = await deriveBitsFromPasscode(passcode, salt);
  const sealed = await sealWithKey(value, bits);
  return { ...sealed, s: toBase64(salt) };
}

/** Try to open a passcode-sealed payload. Returns null when the passcode is wrong. */
export async function openWithPasscode<T>(payload: SealedPayload, passcode: string): Promise<T | null> {
  try {
    if (!payload?.s) return null;
    const salt = fromBase64(payload.s);
    const bits = await deriveBitsFromPasscode(passcode, salt);
    return await openWithKey<T>(payload, bits);
  } catch {
    // AES-GCM authentication failure → wrong passcode or tampered payload
    return null;
  }
}

/**
 * Create a passcode verifier: a random token sealed under the passcode.
 * Correct passcode → verifier opens to the exact token (and matches itself).
 */
export async function createVerifier(passcode: string): Promise<{ payload: SealedPayload; token: string }> {
  const token = randomToken(24);
  const payload = await sealWithPasscode(token, passcode);
  return { payload, token };
}

export async function verifyPasscode(payload: SealedPayload, passcode: string): Promise<boolean> {
  const token = await openWithPasscode<string>(payload, passcode);
  return typeof token === "string" && token.length > 0;
}

/** Has the user's passcode at least this strength? (policy, not crypto) */
export function passcodeProblem(passcode: string): string | null {
  if (typeof passcode !== "string" || passcode.length < 4) {
    return "Passcode must be at least 4 characters.";
  }
  if (passcode.length > 128) return "Passcode is too long.";
  if (/^([0-9])\1+$/.test(passcode)) return "Passcode cannot be a single repeated digit.";
  const weak = new Set(["1234", "0000", "1111", "1212", "7777", "1004", "2000", "2580", "1122", "1313", "8888", "4321", "6789", "password", "qwerty", "letmein", "admin"]);
  if (weak.has(passcode.toLowerCase())) return "That passcode is too common — choose a stronger one.";
  return null;
}
