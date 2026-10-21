// Header matrix test server: serves the csp-test dir with selectable headers.
// Usage: node header-server.mjs <port> <coop|coep|both|none> [file]
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const port = Number(process.argv[2] || 8899);
const mode = process.argv[3] || "none";
const dir = process.argv[4] || "/home/z/my-project/scripts/csp-test";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
};

createServer((req, res) => {
  let path = req.url.split("?")[0];
  if (path === "/" || path === "") path = "/index.html";
  const file = join(dir, path);
  if (!existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("nope");
    return;
  }
  const headers = { "Content-Type": MIME[extname(file)] || "application/octet-stream" };
  if (mode === "coop" || mode === "both") headers["Cross-Origin-Opener-Policy"] = "same-origin";
  if (mode === "coep" || mode === "both") headers["Cross-Origin-Embedder-Policy"] = "credentialless";
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}).listen(port, () => console.log(`header-server ${mode} on :${port}`));
