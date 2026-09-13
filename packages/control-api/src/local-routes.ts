// The routes the local stack and its desktop meet on (source-release round U2, review F1/F7),
// plus the two non-Clerk token mints. Extracted from app.ts, which sits at its ratchet cap.
import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { signDevToken } from './devtoken';
import { LOCAL_USER, localUserIdForBearer, signLocalSyncToken } from './local-auth';
import { localMode } from './localmode';
import type { Store } from './store';
import { nmVersion } from './version';

const bearerOf = (authorization: string | undefined): string | undefined => /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];

/** PUBLIC routes — register beside /auth/clerk, outside the /v1 gate */
export function localAuthRoutes<E extends Env>(app: Hono<E>, store: Store): void {
  // Dev-only PowerSync token (HS256) for non-Clerk local testing — the mobile app in dev mode
  // fetches it to sync against the local dev stack. Gated by NM_ALLOW_DEV_TOKENS so it 404s (never
  // mints) in production, and OFF on the local stack, whose token below is minted for a proven
  // bearer only. sub defaults to the seeded dev user.
  app.post('/auth/dev/token', async (c) => {
    if (process.env['NM_ALLOW_DEV_TOKENS'] !== '1' || localMode()) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { sub?: string };
    return c.json({ token: signDevToken(body.sub || '00000000-0000-0000-0000-000000000001') });
  });

  // The local stack's PowerSync token: the `nmh_` bearer proves the human, the token is minted for
  // that user's own sub only (never a caller-chosen one — F1's dev-token hole), HS256 under the key
  // control-api and PowerSync share (NM_SYNC_KEY). `endpoint` is where the desktop connects.
  app.post('/auth/local/token', async (c) => {
    if (!localMode()) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    const bearer = bearerOf(c.req.header('authorization'));
    const userId = bearer ? await localUserIdForBearer(store, bearer) : null;
    if (!userId) return c.json({ error: 'the local bearer is missing or unknown', code: 'AUTH_FAILED' }, 401);
    const key = process.env['NM_SYNC_KEY'];
    if (!key) return c.json({ error: 'NM_SYNC_KEY is not set on the control-api', code: 'UNAVAILABLE' }, 503);
    const sub = (await store.userIdentity(userId))?.clerkUserId ?? LOCAL_USER.clerkUserId;
    return c.json({ token: signLocalSyncToken(sub, key), endpoint: process.env['NM_POWERSYNC_URL'] ?? null });
  });

  // What a client learns before it holds any credential: which kind of stack this is, where its
  // PowerSync lives, and the versions the desktop compares with its own (F7: a stack behind the app
  // shows the Update state, never a half-working shell). No ids — F1: an id here was the one value a
  // forger needed. `schemaVersion` is the last migration the runner applied.
  app.get('/.well-known/nm-config', async (c) =>
    c.json({
      mode: localMode() ? 'local' : 'cloud',
      powersyncUrl: process.env['NM_POWERSYNC_URL'] ?? null,
      version: nmVersion(),
      schemaVersion: store.schemaVersion ? await store.schemaVersion() : null,
    }),
  );
}

/** GATED route — register AFTER the /v1 middleware, which sets the actor */
export function meRoute<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  // The actor behind the credential and the workspaces it is a member of. This is how the desktop
  // learns its own user id on the local stack (nm-config carries none). Workspaces are MEMBERSHIPS,
  // so an agent actor — a member of nothing — gets an empty list with its identity.
  app.get('/v1/me', async (c) => {
    const actor = c.get('actor');
    const workspaces = actor.kind === 'human'
      ? (await store.listWorkspaces(actor.id)).map(({ id, name, slug }) => ({ id, name, slug }))
      : [];
    return c.json({ actor: { kind: actor.kind, id: actor.id }, workspaces });
  });
}
