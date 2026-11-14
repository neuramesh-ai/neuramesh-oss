/** TLS terminates before the Node API. Its request URL can be HTTP on an internal Cloud Run
 * host, including when HQ proxies /connect. OAuth must use the configured public origin for
 * BOTH the authorization request and token exchange, never forwarded headers from a caller. */
export function connectorRedirectUri(requestUrl: string, provider: string): string {
  const base = new URL(process.env['NM_API_URL'] || new URL(requestUrl).origin);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Configure the public API origin before connecting an account.');
  }
  return `${base.origin}/connect/${encodeURIComponent(provider)}/callback`;
}
