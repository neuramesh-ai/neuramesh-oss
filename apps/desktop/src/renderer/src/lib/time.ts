// Time + title formatting — extracted from App.tsx (track A1).

// Compact relative time for the message hover bar ("just now" · "2 mins ago" · "3 hours ago").
/**
 * A header-safe title from free text: first line, cut on a WORD boundary, ellipsis when it
 * actually lost something. The caller keeps the full text as the description, so trimming
 * here costs nothing — which is the difference between this and the `slice(0, 80)` it replaces.
 */
export const TITLE_MAX = 72;
export function shortTitle(text: string): string {
  const line = (text.split('\n').find((l) => l.trim()) ?? '').trim();
  if (line.length <= TITLE_MAX) return line;
  const cut = line.slice(0, TITLE_MAX);
  const at = cut.lastIndexOf(' ');
  return `${(at > TITLE_MAX * 0.5 ? cut.slice(0, at) : cut).replace(/[,;:.\-–—]+$/, '')}…`;
}

export function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
}
export function fmtDur(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * `4 mins ago` costs ~70px of a 266px row, and on Home the row is already carrying a state
 * dot, a number, a title AND its room — enough that a title collapsed to "Com…". The rail
 * gets the compact form (`4m`, `20h`, `3d`); the overlay keeps the readable one, because it
 * has the width to spend.
 */
export function timeAgoShort(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const m = Math.round(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d` : `${Math.round(d / 7)}w`;
}
