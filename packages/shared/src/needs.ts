// Dependency preflight (docs/design/triage-preflight-2026-08) — what an ask NEEDS before it can
// be staffed, and the card that goes up when a need is unmet.
//
// It exists because the live run staffed work that could not be done: the radar was handed to a
// marketer in a room with no connected account, the worker had nothing to read with, and the
// missing connector surfaced at the END as four tasks asking the human to go fix the thing that
// should have been the first question (George, 2026-08-26).
//
// The rule this encodes: **resolve dependencies at triage, and let an unmet one STOP the
// delegation.** Enforced where the unit is created, never as prompt etiquette — an orchestrator
// that can talk past a gate is not a gate.
import { fencedBlock, stripFenced } from './linear';
import { REPLY_PLATFORMS, type ReplyPlatform } from './replyops';

/** a declared dependency. `connector` is the only kind today; the shape leaves room for more. */
export interface ConnectorNeed {
  kind: 'connector';
  /** how many of `any` must be live — George, 2026-08-26: "the requirement is at least one" */
  min: number;
  /** the networks that satisfy it; the run covers EVERY connected one, not just the first */
  any: readonly ReplyPlatform[];
  why: string;
}
/** the room's project must have a repository (release drafts: the run reads its releases) */
export interface RepoNeed {
  kind: 'repo';
  why: string;
}
export type Need = ConnectorNeed | RepoNeed;
/** the project's primary repository as the preflight reads it: null when the project has none */
export interface RepoState { slug: string | null }

/** a room's connector as the preflight reads it — the shape `nm.connectors` already returns */
export interface ConnectorState { provider: string; status: string; handle?: string | null }

/** live = connected and usable. `reauth_required` is NOT live: the grant is dead until a human
 *  reconnects, and treating it as live is how a run starts and then fails on its first read. */
export function liveConnectors(rows: ReadonlyArray<ConnectorState>, within: readonly ReplyPlatform[] = REPLY_PLATFORMS): ReplyPlatform[] {
  const set = new Set(rows.filter((r) => r.status === 'connected').map((r) => r.provider));
  return within.filter((p) => set.has(p));
}

/**
 * Only X has a read API today (`/v1/x/search`); LinkedIn, Instagram and TikTok are
 * publish-only connectors. A run covers every CONNECTED network — it reads the readable ones
 * and researches the rest publicly — so this is what decides a row's `source`, never whether
 * the network is covered at all.
 */
export const READABLE: readonly ReplyPlatform[] = ['x'];
export const isReadable = (p: ReplyPlatform): boolean => READABLE.includes(p);

export interface NeedVerdict {
  ok: boolean;
  /** every connected network the run should cover */
  live: ReplyPlatform[];
  /** the connected networks whose conversations can be READ through the connector */
  readable: ReplyPlatform[];
  /** connected, but coverage comes from public research with no measured reach */
  unread: ReplyPlatform[];
  /** what to offer when it is not ok */
  missing: ReplyPlatform[];
  /** a `repo` need is declared and the project has no repository: the card offers the attach */
  repoMissing: boolean;
}

/** the whole preflight: pure, so the tool, the card and the tests agree by construction */
export function checkNeeds(needs: readonly Need[] | undefined, rows: ReadonlyArray<ConnectorState>, repo?: RepoState | null): NeedVerdict {
  const need = needs?.find((n): n is ConnectorNeed => n.kind === 'connector');
  const repoNeed = needs?.find((n): n is RepoNeed => n.kind === 'repo');
  const scope = need?.any ?? REPLY_PLATFORMS;
  const live = liveConnectors(rows, scope);
  const readable = live.filter(isReadable);
  const repoMissing = !!repoNeed && !repo?.slug;
  return {
    ok: (!need || live.length >= Math.max(1, need.min)) && !repoMissing,
    live,
    readable,
    unread: live.filter((p) => !isReadable(p)),
    missing: scope.filter((p) => !live.includes(p)),
    repoMissing,
  };
}

/** the ```nmneed card — one unmet dependency, with the actions that resolve it */
export interface NmNeed {
  channel: string;
  /** what wanted to run, named as the human asked for it */
  ask: string;
  why: string;
  /** the networks to offer, in order — each row is a Connect click */
  connect: ReplyPlatform[];
  /** which of those actually unblock reading (the card says so rather than implying parity) */
  readable?: ReplyPlatform[];
  /** the other fix a card can carry: the project needs a repository (release drafts) */
  attach?: 'repo';
  /** the project the attach lands in (repo.link needs it, a channel id names a room) */
  project?: string | null;
}

export function needBlock(data: NmNeed): string {
  return '```nmneed\n' + JSON.stringify(data) + '\n```';
}

export function parseNeed(body: string): NmNeed | null {
  const m = fencedBlock(body, 'nmneed');
  if (!m) return null;
  try {
    const d = JSON.parse(m.inner) as NmNeed;
    if (!d || typeof d.channel !== 'string' || typeof d.ask !== 'string') return null;
    const connect = (Array.isArray(d.connect) ? d.connect : []).filter((p): p is ReplyPlatform => (REPLY_PLATFORMS as readonly string[]).includes(p));
    const attach = d.attach === 'repo' ? 'repo' as const : undefined;
    if (!connect.length && !attach) return null;
    return {
      channel: d.channel, ask: d.ask.slice(0, 160), why: String(d.why ?? '').slice(0, 400), connect,
      ...(Array.isArray(d.readable) ? { readable: d.readable.filter((p): p is ReplyPlatform => (REPLY_PLATFORMS as readonly string[]).includes(p)) } : {}),
      ...(attach ? { attach, project: typeof d.project === 'string' ? d.project : null } : {}),
    };
  } catch { return null; }
}

export function stripNeed(body: string): string {
  return stripFenced(body, 'nmneed').trim();
}

/** the line a run puts in its own prompt: what it may read, and how each network is covered */
export function coverageNote(v: NeedVerdict): string {
  if (!v.live.length) return 'No account is connected in this room.';
  const parts = [
    v.readable.length ? `${v.readable.join(', ')} — read through the room's connected account (search_x), real engagement numbers` : '',
    v.unread.length ? `${v.unread.join(', ')} — connected but with NO read API: cover them by public web research, mark those rows source:"web", and NEVER attach engagement numbers to them` : '',
  ].filter(Boolean);
  return `Cover EVERY connected network: ${parts.join(' · ')}.`;
}
