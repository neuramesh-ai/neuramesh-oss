// THE PUBLIC DOOR READS A PRIVATE REPOSITORY ONLY THROUGH ITS OWN GRANT (R10 lane A, NM-001).
//
// /announce/detect and POST /announce (no sign-in) looked up "the App's installation for this
// repository" by slug, from the table or from GitHub itself, and minted its token: any NeuraMesh
// tenant's installation (and any installation anyone had ever pointed the door's callback at)
// answered for anyone. Name a private repository the App can read and the door returned its latest
// release and merged-PR count, and the job drafted posts from it for the asker. GitHub signs nothing
// on the install callback, so the callback alone proves nobody either.
//
// Now the door never looks an installation up. Its install link carries a sealed DOOR STATE (the
// repository, an issue time); the callback for it accepts an installation only when GitHub says it
// was created within GRANT_FRESH_MS (a fresh install by whoever followed the link, not someone's
// years-old one replayed by id), covers that repository, and is bound to no workspace; it then hands
// the browser a sealed GRANT for that repository and installation, short-lived. detect and create
// use an installation only from a grant for the same repository. A workspace's installation is never
// a door's: the in-app reads go through the room's connector (github-connect.ts).
import { seal, unseal } from './connector-crypto';

export const GRANT_FRESH_MS = 15 * 60_000;
export const GRANT_TTL_MS = 30 * 60_000;
const lower = (s: string): string => s.trim().toLowerCase();

interface DoorState { door: 1; slug: string; iat: number }
interface DoorGrant { grant: 1; installationId: number; slug: string; exp: number }

const canSeal = (): boolean => !!process.env['NM_CONNECTOR_KEY'];
const open = <T>(raw: string): Partial<T> | null => { try { return unseal<Partial<T>>(raw); } catch { return null; } };

/** the install link's state for the door: sealed when the server can seal, else the bare slug (no grant follows) */
export function doorState(slug: string, now = Date.now()): string {
  return canSeal() ? seal({ door: 1, slug: lower(slug), iat: now } satisfies DoorState) : slug;
}

/** the repository a sealed door state names, or null (a bare slug, an in-app state, garbage) */
export function readDoorState(raw: string, now = Date.now()): string | null {
  const s = canSeal() ? open<DoorState>(raw) : null;
  return s?.door === 1 && typeof s.slug === 'string' && typeof s.iat === 'number' && now - s.iat < 24 * 3_600_000 ? s.slug : null;
}

/** may this installation become the door's grant for this repository? (all three must hold) */
export function grantable(i: { createdAt: string | null; repos: string[]; boundToWorkspace: boolean }, slug: string, now = Date.now()): boolean {
  const created = i.createdAt ? Date.parse(i.createdAt) : NaN;
  return Number.isFinite(created) && now - created <= GRANT_FRESH_MS && created <= now + 60_000
    && i.repos.map(lower).includes(lower(slug)) && !i.boundToWorkspace;
}

export function sealGrant(installationId: number, slug: string, now = Date.now()): string {
  return seal({ grant: 1, installationId, slug: lower(slug), exp: now + GRANT_TTL_MS } satisfies DoorGrant);
}

/** the installation a grant lends THIS repository, or null */
export function grantFor(raw: unknown, slug: string, now = Date.now()): number | null {
  if (typeof raw !== 'string' || !raw || !canSeal()) return null;
  const g = open<DoorGrant>(raw);
  return g?.grant === 1 && typeof g.installationId === 'number' && g.slug === lower(slug) && typeof g.exp === 'number' && g.exp > now ? g.installationId : null;
}
