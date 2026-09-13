// Dock mini-browser address bar (docs/21): whatever the user types resolves to exactly one
// committed http(s) URL. Script/file schemes can never come out of here — anything that isn't
// web-navigable becomes a search, so the guard in the main process is a backstop, not the UX.

/** loopback-ish hosts (plus bare IPv4s — typed IPs are dev boxes) default to http, not https */
const LOCAL_HOSTISH_RE = /^(localhost|[\p{L}\p{N}-]+\.localhost|\[::1\]|(\d{1,3}\.){3}\d{1,3})(:\d{1,5})?$/iu;
/** hostname.tld[:port] — unicode letters allowed, the URL constructor handles punycode */
const DOMAINISH_RE = /^[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)+(:\d{1,5})?$/u;

export function searchUrlFor(query: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
}

/** Address-bar input → a committed URL, or null for blank input. Never throws. */
export function normalizeUrlInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(s)?.[1]?.toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    try { return new URL(s).toString(); } catch { return searchUrlFor(s); }
  }
  // no whitespace + a host-shaped head (up to the first /, ? or #) → treat as a URL.
  // Shape wins over the scheme guess: "example.com:8443" parses as scheme "example.com",
  // but a dotted name with a numeric port is a host, not a protocol.
  if (!/\s/.test(s)) {
    const hostish = /^[^/?#]+/.exec(s)?.[0] ?? '';
    const local = LOCAL_HOSTISH_RE.test(hostish);
    if (local || DOMAINISH_RE.test(hostish)) {
      try { return new URL(`${local ? 'http' : 'https'}://${s}`).toString(); } catch { /* fall through */ }
    }
  }
  return searchUrlFor(s); // multi-word text, bare words, and every non-web scheme
}
