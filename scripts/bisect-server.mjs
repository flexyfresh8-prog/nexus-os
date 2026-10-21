// Bisect which response header on the PARENT breaks sandboxed-child scripts.
// Serves the csp-test dir; header selection via ?h= query param:
//   none | xfo | nosniff | perms | refpol | coop | coep | csp
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const port = Number(process.argv[2] || 8910);
const dir = "/home/z/my-project/scripts/csp-test";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css" };

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self'";

createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let path = u.pathname;
  if (path === "/" || path === "") path = "/index.html";
  const mode = u.searchParams.get("h") || "none";
  const file = join(dir, path);
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("nope");
    return;
  }
  const headers = { "Content-Type": MIME[extname(file)] || "application/octet-stream" };
  // The shell (and everything under __preview) is NEVER given security headers.
  if (!path.includes("shell") && !path.includes("__preview")) {
    if (mode === "xfo") headers["X-Frame-Options"] = "DENY";
    if (mode === "nosniff") headers["X-Content-Type-Options"] = "nosniff";
    if (mode === "perms") headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    if (mode === "refpol") headers["Referrer-Policy"] = "no-referrer";
    if (mode === "coop") headers["Cross-Origin-Opener-Policy"] = "same-origin";
    if (mode === "coep") headers["Cross-Origin-Embedder-Policy"] = "credentialless";
    if (mode === "csp") headers["Content-Security-Policy"] = CSP;
  }
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}).listen(port, () => console.log(`bisect server on :${port}`));
