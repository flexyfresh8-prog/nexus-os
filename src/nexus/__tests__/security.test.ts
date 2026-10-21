// NEXUS OS — security layer unit tests (crypto + import sanitization).
// Runs under bun (WebCrypto available globally).

import { describe, expect, test } from "bun:test";
import {
  sealWithKey,
  openWithKey,
  sealWithPasscode,
  openWithPasscode,
  createVerifier,
  verifyPasscode,
  passcodeProblem,
} from "../lib/crypto";
import {
  redact,
  isSelfOriginUrl,
  sanitizeImportedFS,
} from "../lib/secure";

// ---------------------------------------------------------------- crypto

describe("crypto: AES-GCM seal/open", () => {
  test("round-trips a value with a raw key", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await sealWithKey({ apiKey: "sk-test-123", n: 42 }, key);
    expect(sealed.f).toBe("nexus-enc");
    const opened = await openWithKey<{ apiKey: string; n: number }>(sealed, key);
    expect(opened.apiKey).toBe("sk-test-123");
    expect(opened.n).toBe(42);
  });

  test("ciphertext never contains the plaintext", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await sealWithKey({ secret: "super-secret-value" }, key);
    expect(JSON.stringify(sealed)).not.toContain("super-secret-value");
  });

  test("rejects a wrong key (authenticated encryption)", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const wrong = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await sealWithKey({ a: 1 }, key);
    expect(openWithKey(sealed, wrong)).rejects.toThrow();
  });

  test("rejects tampered ciphertext", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const sealed = await sealWithKey({ a: 1 }, key);
    // flip a byte in the base64 payload
    const flipped = sealed.ct.startsWith("A") ? "B" + sealed.ct.slice(1) : "A" + sealed.ct.slice(1);
    expect(openWithKey({ ...sealed, ct: flipped }, key)).rejects.toThrow();
  });
});

describe("crypto: passcode sealing", () => {
  test("correct passcode opens, wrong passcode returns null", async () => {
    const sealed = await sealWithPasscode({ k: "v" }, "correct horse");
    const ok = await openWithPasscode<{ k: string }>(sealed, "correct horse");
    expect(ok?.k).toBe("v");
    const bad = await openWithPasscode<{ k: string }>(sealed, "wrong passcode");
    expect(bad).toBeNull();
  });

  test("verifier pattern works and salts differ per seal", async () => {
    const { payload, token } = await createVerifier("1234");
    expect(await verifyPasscode(payload, "1234")).toBe(true);
    expect(await verifyPasscode(payload, "9999")).toBe(false);
    expect(token.length).toBeGreaterThan(0);

    const again = await createVerifier("1234");
    expect(again.payload.s).not.toBe(payload.s); // fresh salt each time
  });

  test("passcode policy rejects weak codes", () => {
    expect(passcodeProblem("123")).toContain("at least 4");
    expect(passcodeProblem("1111")).toContain("repeated");
    expect(passcodeProblem("1234")).toContain("too common");
    expect(passcodeProblem("password")).toContain("too common");
    expect(passcodeProblem("9t7#fQ2x")).toBeNull();
  });
});

// ---------------------------------------------------------------- redact

describe("secure: redact()", () => {
  test("masks common secret formats", () => {
    const out = redact("gh init failed with ghp_ABCDEFGHIJKLMNOPQR1234 and sk-ant-abc123def456ghi789");
    expect(out).not.toContain("ghp_ABCDEFGHIJKLMNOPQR1234");
    expect(out).not.toContain("sk-ant-abc123def456ghi789");
    expect(out).toContain("[redacted]");
  });

  test("masks Bearer headers and api key params", () => {
    const out = redact("Bearer abcdef12345 and apiKey=sk-live-abcdef123456789012");
    expect(out).not.toContain("abcdef12345 ");
    expect(out).toContain("[redacted]");
  });

  test("leaves normal text alone", () => {
    expect(redact("hello world")).toBe("hello world");
  });
});

// ------------------------------------------------------------- self-origin

describe("secure: isSelfOriginUrl()", () => {
  test("matches the current origin and rejects others", () => {
    // bun test has no window.location — the function must fail closed
    expect(isSelfOriginUrl("https://example.com/")).toBe(false);
    expect(isSelfOriginUrl("not a url")).toBe(false);
    expect(isSelfOriginUrl("javascript:alert(1)")).toBe(false);
  });
});

// ----------------------------------------------------------- import guard

describe("secure: sanitizeImportedFS()", () => {
  const baseDir = { id: "root", name: "root", type: "dir", parentId: null, created: 1, modified: 1 };

  test("passes through valid nodes", () => {
    const report = sanitizeImportedFS([baseDir, { id: "a", name: "a.txt", type: "file", parentId: "root", content: "hi", created: 1, modified: 1 }]);
    expect(report.nodes.length).toBe(2);
    expect(report.rejected).toBe(0);
  });

  test("strips __proto__ / constructor / prototype keys", () => {
    const evil = JSON.parse('{"id":"x","name":"evil.txt","type":"file","parentId":"root","content":"v","__proto__":{"polluted":true},"constructor":1}');
    const report = sanitizeImportedFS([baseDir, evil]);
    expect(report.nodes.length).toBe(2);
    const restored = report.nodes[1] as unknown as Record<string, unknown>;
    // check OWN properties — `obj.__proto__` reads the inherited prototype
    const own = Object.getOwnPropertyNames(restored);
    expect(own).not.toContain("__proto__");
    expect(own).not.toContain("constructor");
    expect(Object.getOwnPropertyNames(Object.prototype).includes("polluted")).toBe(false);
  });

  test("rejects traversal names, control chars, and oversized names", () => {
    const report = sanitizeImportedFS([
      baseDir,
      { id: "1", name: "../etc/passwd", type: "file", parentId: "root", content: "x" },
      { id: "2", name: "bad\u0000name", type: "file", parentId: "root", content: "x" },
      { id: "3", name: "x".repeat(300), type: "file", parentId: "root", content: "x" },
    ]);
    expect(report.nodes.length).toBe(1); // only root survives
    expect(report.rejected).toBe(3);
  });

  test("drops phantom files (neither text nor binary)", () => {
    const report = sanitizeImportedFS([baseDir, { id: "p", name: "phantom.txt", type: "file", parentId: "root" }]);
    expect(report.nodes.length).toBe(1);
    expect(report.rejected).toBe(1);
  });

  test("enforces the node-count cap", () => {
    const many = Array.from({ length: 25_000 }, (_, i) => ({ id: `n${i}`, name: `f${i}`, type: "file", parentId: "root", content: "x" }));
    const report = sanitizeImportedFS(many);
    expect(report.nodes.length).toBe(0);
    expect(report.reason).toContain("Too many entries");
  });

  test("enforces the binary size cap", () => {
    const big = new ArrayBuffer(65 * 1024 * 1024);
    const report = sanitizeImportedFS([baseDir, { id: "b", name: "big.bin", type: "file", parentId: "root", binary: big }]);
    expect(report.nodes.length).toBe(1);
    expect(report.rejected).toBe(1);
  });
});
