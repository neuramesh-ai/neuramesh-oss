export const RESUME_GRACE_MS = 120_000;
export const RESUME_BUFFER_BYTES = 256 * 1024;
export const ROTATE_MS = 50 * 60_000;
export const envMs = (name: string, fallback: number): number => {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** WHAT A MACHINE CAN DIAL. `ws` throws at construction on a URL it cannot parse or a scheme it does
 *  not speak, and the first dial runs inside machined's boot. A typo in a deploy-wide relay URL
 *  (FLEET_RELAY_URL on nm-fleet, stamped on every Cloud Run machine) would crash every machine there,
 *  and Cloud Run restarts a crashed machine into a new epoch, again and again. So machined asks this
 *  first, and a bad URL costs the browser terminal, never the machine. null = dialable. */
export function relayUrlProblem(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return 'it is not an absolute URL (wss://host)'; }
  if (!['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol)) return `its scheme is ${url.protocol}, not wss: or ws:`;
  if (url.hash) return 'it carries a #fragment';
  return null;
}
