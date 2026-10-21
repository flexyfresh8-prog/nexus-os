import { NextRequest, NextResponse } from "next/server";

// NEXUS OS — security middleware (standalone server runtime only).
//
// Produces the production Content-Security-Policy for the app shell:
//   - a per-request nonce covers Next's inline bootstrap scripts and the
//     theme bootstrap (layout reads x-nonce); Next picks the nonce up
//     automatically when the CSP header carries `nonce-…`
//   - `strict-dynamic` lets our own nonced bundle load Monaco from its CDN
//     and create the Blob-constructed sandbox worker
//   - `wasm-unsafe-eval` + blob workers keep the WebContainer Node runtime
//     and the JS worker sandbox fully functional
//   - frame-ancestors 'none' + X-Frame-Options DENY block clickjacking
//     (the static GitHub Pages build instead gets a meta CSP with build-time
//     script hashes via scripts/gen-csp.mjs — middleware does not run there)
//
// Dev mode is exempt: HMR needs eval + inline and a strict policy there is
// pure noise. Localhost dev-server preview frames stay on plain http — no
// upgrade-insecure-requests anywhere.

const DEV = process.env.NODE_ENV === "development";

function cspFor(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://cdn.jsdelivr.net blob: 'wasm-unsafe-eval'`,
    // Monaco injects its editor stylesheet from the CDN at runtime
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss: ws://localhost:* ws://127.0.0.1:* http://localhost:* http://127.0.0.1:*",
    "frame-src 'self' https: http://localhost:* http://127.0.0.1:*",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function middleware(req: NextRequest) {
  if (DEV) {
    // Dev exemption: HMR needs eval + inline scripts, so no CSP here — but
    // keep cross-origin isolation so the WebContainer Node runtime boots.
    const res = NextResponse.next();
    res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    res.headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    return res;
  }

  const nonce = btoa(crypto.randomUUID() + crypto.randomUUID()).replace(/[/+]/g, "").slice(0, 32);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", cspFor(nonce));
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), midi=(), interest-cohort=()"
  );
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  return res;
}

export const config = {
  // Everything except Next internals — and preview-shell.html, which MUST
  // stay header-free: the sandboxed preview iframe loads it as a plain
  // network document (no CSP → user preview code runs; no XFO/frame-ancestors
  // → the frame is allowed at all). The shell is inert without its parent.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|preview-shell\\.html).*)"],
};
