// MACHINE RELEASES AND UPGRADES, as data (docs/design/whats-new-upgrades-2026-11/plan.md). A cloud machine
// runs one release, and its owner chooses when to move to the newest. The server (control-api
// machine-upgrade.ts) decides. hq, the phone and the server read these same rules, so a surface never
// shows a button that the server would refuse.

/** a release name: year, month and a number, e.g. 2026.11.3 */
export const MACHINE_VERSION_RE = /^\d{4}\.\d{2}\.\d+$/;

/** order two release names. A name that is not a release sorts first */
export function compareMachineVersions(a: string, b: string): number {
  const parts = (v: string) => (MACHINE_VERSION_RE.test(v) ? v.split('.').map(Number) : [-1, -1, -1]);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

export type MachineReleaseState = 'candidate' | 'qualified' | 'published' | 'withdrawn';
export type UpgradeMode = 'start' | 'next_start' | 'now' | 'when_idle' | 'forced';
export type UpgradeState = 'armed' | 'staged' | 'draining' | 'booting' | 'ready' | 'failed' | 'rolled_back' | 'cancelled';
export const OPEN_UPGRADE_STATES: readonly UpgradeState[] = ['armed', 'staged', 'draining', 'booting'];

/** one feature of a release: the manifest's words and its demo (a dark and a light take) */
export interface ReleaseFeature {
  id: string;
  title: string;
  text: string;
  /** false: it is live in hq already (hq ships on merge). true: the machine must upgrade for it */
  needsUpgrade: boolean;
  media?: {
    video: { dark: string; light: string };
    poster: { dark: string; light: string };
    alt: string;
    width: number;
    height: number;
    seconds: number;
  };
}

/** what a client reads for one release (GET /v1/whats-new) */
export interface MachineReleaseNote {
  version: string;
  date: string | null;
  /** set = a security release: no Later and no ×, and the server upgrades at the deadline */
  securityDeadline: string | null;
  features: ReleaseFeature[];
  /** the person's own view of it (release_views) */
  seenAt: string | null;
  snoozedUntil: string | null;
  dismissedAt: string | null;
}

/** what the daemon reports of the work in flight (the status report's `work`) */
export interface MachineWork {
  turns: Array<{ threadId?: string; kind: 'agent' | 'code' | 'finance'; since?: number; title?: string; who?: string }>;
  /** terminals that are open now: a restart closes each one */
  terminals: number;
  /** the last input into a terminal or a Code session, epoch ms (0 = none) */
  lastInputAt: number;
}

/** a work report older than this tells nothing: the server then asks before it stops work */
export const WORK_FRESH_MS = 10_000;
/** the sleep rule's terminal window (machined-busy.ts DEFAULT_TERMINAL_IDLE_MS): the same idle for an upgrade */
export const UPGRADE_TERMINAL_IDLE_MS = 10 * 60_000;
/** how long "Later" hides the card */
export const WHATS_NEW_SNOOZE_MS = 3 * 24 * 3_600_000;
/** a boot on the new release that is not ready after this returns to the last good release (plan §8.1) */
export const UPGRADE_BOOT_DEADLINE_MS = 5 * 60_000;

/** idle for an upgrade: no turn runs, and nobody typed into a terminal for 10 minutes */
export function workIsIdle(work: MachineWork | null | undefined, now: number, idleMs = UPGRADE_TERMINAL_IDLE_MS): boolean {
  if (!work) return false;
  if (work.turns.length > 0) return false;
  return !(work.lastInputAt > 0 && now - work.lastInputAt < idleMs);
}

/** the work report says something only while it is fresh */
export function freshWork(work: MachineWork | null | undefined, at: string | number | null | undefined, now: number): MachineWork | null {
  if (!work || at === null || at === undefined) return null;
  const t = typeof at === 'number' ? at : Date.parse(at);
  return Number.isFinite(t) && now - t <= WORK_FRESH_MS ? work : null;
}

/** the work that a restart stops: each turn, and each open terminal (even an idle one closes) */
export function workToStop(work: MachineWork | null | undefined): { turns: number; terminals: number } {
  return { turns: work?.turns.length ?? 0, terminals: work?.terminals ?? 0 };
}

/** who may upgrade a machine (D2: anyone with access). The rule is mayAttach's: a member machine is
 *  its owner's alone, and a shared runner is open to every person in the workspace */
export function mayUpgradeMachine(kind: string | null | undefined, ownerUserId: string | null | undefined, selfUserId: string | null): boolean {
  if (!selfUserId) return false;
  if (kind === 'runner') return true;
  if (kind === 'member') return ownerUserId === selfUserId;
  return false;
}

/** the releases newer than `current`, newest first. A machine with no known release sees the newest only */
export function releasesSince<T extends { version: string }>(current: string | null | undefined, published: T[]): T[] {
  const sorted = [...published].sort((a, b) => compareMachineVersions(b.version, a.version));
  if (!current || !MACHINE_VERSION_RE.test(current)) return sorted.slice(0, 1);
  return sorted.filter((r) => compareMachineVersions(r.version, current) > 0);
}

/** may the card show this release to this person now? Not after ×, not while snoozed. A security release
 *  ignores both, because it has no Later and no × */
export function cardMayShow(r: Pick<MachineReleaseNote, 'securityDeadline' | 'snoozedUntil' | 'dismissedAt'>, now: number): boolean {
  if (r.securityDeadline) return true;
  if (r.dismissedAt) return false;
  return !(r.snoozedUntil && Date.parse(r.snoozedUntil) > now);
}

/** the one problem with a manifest, or null. The release check (scripts/whats-new-check.mjs) and the
 *  server's record route both run it, so a bad manifest never reaches a card */
export function manifestProblem(m: unknown, version?: string): string | null {
  if (!m || typeof m !== 'object') return 'the manifest is not an object';
  const o = m as Record<string, unknown>;
  if (typeof o['version'] !== 'string' || !MACHINE_VERSION_RE.test(o['version'])) return 'version is not YYYY.MM.N';
  if (version && o['version'] !== version) return `version ${String(o['version'])} does not match ${version}`;
  if (!Array.isArray(o['features']) || o['features'].length === 0) return 'features is empty';
  for (const f of o['features'] as Array<Record<string, unknown>>) {
    const id = String(f?.['id'] ?? '?');
    for (const key of ['id', 'title', 'text'] as const) if (typeof f?.[key] !== 'string' || !(f[key] as string).trim()) return `feature ${id}: ${key} is missing`;
    if (typeof f['needsUpgrade'] !== 'boolean') return `feature ${id}: needsUpgrade is not true or false`;
    const words = `${String(f['title'])} ${String(f['text'])}`;
    if (/[—;]/.test(words)) return `feature ${id}: no em dash and no semicolon (STE)`;
    for (const sentence of String(f['text']).split(/(?<=[.!?])\s+/)) if (sentence.split(/\s+/).length > 25) return `feature ${id}: a sentence has more than 25 words (STE)`;
    const media = f['media'] as Record<string, unknown> | undefined;
    if (media !== undefined) {
      const pair = (k: string) => media[k] && typeof (media[k] as Record<string, unknown>)['dark'] === 'string' && typeof (media[k] as Record<string, unknown>)['light'] === 'string';
      if (!pair('video') || !pair('poster')) return `feature ${id}: media needs a dark and a light video and poster`;
      if (typeof media['alt'] !== 'string' || !media['alt'].trim()) return `feature ${id}: media needs alt text`;
    }
  }
  return null;
}

/** the support window (D4): every release published in the last 30 days, and never fewer than the newest three */
export const SUPPORT_WINDOW_MS = 30 * 86_400_000;
export const SUPPORT_MIN_RELEASES = 3;

/** the oldest supported release, from the published releases and an ops floor (the higher one wins).
 *  null: nothing to hold a machine to yet. A machine below it gets a forced upgrade at its next idle moment */
export function supportFloor(published: Array<{ version: string; publishedAt: string | number | Date | null }>, opsFloor: string | null, now: number): string | null {
  const sorted = [...published].sort((a, b) => compareMachineVersions(b.version, a.version));
  const recent = sorted.filter((r) => r.publishedAt !== null && now - new Date(r.publishedAt).getTime() <= SUPPORT_WINDOW_MS);
  const kept = sorted.slice(0, Math.max(SUPPORT_MIN_RELEASES, recent.length === 0 ? 0 : sorted.indexOf(recent[recent.length - 1]!) + 1));
  const window = kept.length >= sorted.length ? null : kept[kept.length - 1]?.version ?? null;
  if (!window) return opsFloor;
  if (!opsFloor) return window;
  return compareMachineVersions(opsFloor, window) > 0 ? opsFloor : window;
}
