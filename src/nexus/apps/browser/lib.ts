// NEXUS OS — Browser helpers: URL resolution, hostnames, blocked-site detection.
// Pure functions only — no React, no DOM access.

export const HOME_ENTRY = "nx://home";
export const SEARCH_BASE = "https://duckduckgo.com/?q=";

const HTTP_URL_RE = /^https?:\/\//i;
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const DOMAIN_LIKE_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+/i;
const LOCALHOST_RE = /^localhost(:\d+)?([/?#].*)?$/i;
/** "example.com:8080/path" — a dotted host with an explicit port, not a scheme. */
const HOST_PORT_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+:\d+([/?#].*)?$/i;

/**
 * Resolve raw address-bar input to a navigable target:
 * - HOME_ENTRY          → internal home page (rendered by us, no iframe)
 * - "localhost[:port]…" → https:// prefix
 * - http(s) URL         → used as-is
 * - domain-like text    → https:// prefix
 * - anything else       → DuckDuckGo search
 *
 * Honesty/safety choice: input carrying a non-http scheme (javascript:,
 * file:, data:, …) is treated as a search query — NEXUS Browser never
 * executes or loads custom-scheme targets.
 * Returns null for empty input.
 */
export function resolveInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s === HOME_ENTRY) return HOME_ENTRY;
  if (LOCALHOST_RE.test(s)) return "https://" + s;
  if (HTTP_URL_RE.test(s)) return s;
  if (HOST_PORT_RE.test(s)) return "https://" + s;
  if (SCHEME_RE.test(s)) return SEARCH_BASE + encodeURIComponent(s);
  const head = s.split(/[/?#]/, 1)[0] ?? "";
  if (DOMAIN_LIKE_RE.test(head)) return "https://" + s;
  return SEARCH_BASE + encodeURIComponent(s);
}

/**
 * Validate/normalize a launchProps url ({ url?: string }).
 * Non-string values and the home sentinel resolve to null → start at home.
 */
export function resolveLaunchUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const resolved = resolveInput(value);
  return resolved === HOME_ENTRY ? null : resolved;
}

/** Hostname of a URL, or the raw string if parsing fails (never throws). */
export function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Hostnames that send X-Frame-Options / CSP frame-ancestors headers which
 * prohibit embedding. Checked against the parsed hostname so subdomains and
 * deep paths are covered uniformly.
 */
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /(^|\.)google\./,
  /(^|\.)youtube\./,
  /(^|\.)github\./,
  /(^|\.)x\.com$/,
  /(^|\.)twitter\./,
  /(^|\.)facebook\./,
  /(^|\.)instagram\./,
  /(^|\.)reddit\./,
  /(^|\.)amazon\./,
  /(^|\.)linkedin\./,
  /(^|\.)chatgpt\./,
  /(^|\.)openai\./,
];

/** True when the URL's host is known to refuse iframe embedding. */
export function isKnownBlocked(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}
