// THE POWERSYNC CONNECTOR, one per connection (connections.ts).
//
// Two duties the SDK asks of it: a token for the stream, and the upload of every queued write.
// Both are decided by the connection's auth mode, never by a process-wide one — a local replica
// and a cloud replica live in the same process now, and each must sign as itself.
import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/node';
import { apiBearerHeader } from '../apiauth';
import { DEV_WS, type Connection } from '../connections';
import { signDevToken } from '../token';
import { uploadCrudEntry, type UploadIdentity } from './upload';

/** the expiry a JWT names, so the SDK can refresh before it lapses instead of retrying a dead
 *  token as 401 noise. Undefined for an unreadable token — the SDK then refreshes on 401. */
export function jwtExpiry(token: string): Date | undefined {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()) as { exp?: number };
    return payload.exp ? new Date(payload.exp * 1000) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * LOCAL MODE'S SYNC TOKEN (review F1). The desktop no longer signs with the committed dev key on
 * this lane: the stack mints the token from the `nmh_` bearer, for its own subject only, and the
 * HS256 key that validates it is the per-install `NM_SYNC_KEY` the app wrote into the stack's env.
 * `endpoint` comes back too, so a stack on non-default ports still says where its PowerSync is.
 */
export async function fetchLocalCredentials(conn: Connection, fetchImpl: typeof fetch = fetch): Promise<{ endpoint: string; token: string; expiresAt?: Date }> {
  if (!conn.bearer) throw new Error('local bearer not loaded — the keychain read has not happened yet');
  const res = await fetchImpl(`${conn.apiUrl}/auth/local/token`, { method: 'POST', headers: { authorization: `Bearer ${conn.bearer}` } });
  const data = (await res.json().catch(() => ({}))) as { token?: string; endpoint?: string; error?: string };
  if (!res.ok || !data.token) throw new Error(data.error ?? `local sync token failed (${res.status})`);
  return { endpoint: data.endpoint || conn.powersyncUrl, token: data.token, expiresAt: jwtExpiry(data.token) };
}

// auth.ts and auth-clerk.ts import electron at the top level (they boot the app), so they are
// loaded ON USE — this module is what the connector TEST imports, and a static import would drag
// electron into its graph (electronlazy.ts).
const supabaseToken = async () => (await import('../auth')).getAccessToken();
const clerkToken = async (apiUrl: string) => (await import('../auth-clerk')).clerkPowerSyncToken(apiUrl);

export class Connector implements PowerSyncBackendConnector {
  constructor(
    private readonly conn: Connection,
    private readonly actorId: (c: Connection) => string,
    /** injectable for tests — the uploader and the local token both dial through it */
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchCredentials() {
    const c = this.conn;
    // expiresAt lets the SDK re-fetch before expiry — without it, a cached
    // token gets retried as 401 noise forever after the hour is up.
    if (c.authMode === 'supabase') {
      const { token, expiresAt } = await supabaseToken();
      console.log(`auth_token mode=supabase exp_in=${Math.round((expiresAt.getTime() - Date.now()) / 1000)}s`);
      return { endpoint: c.powersyncUrl, token, expiresAt };
    }
    if (c.authMode === 'clerk') {
      // PowerSync validates Clerk's own token (its JWKS); the sub is the Clerk id,
      // which the workspace sync rule maps to our internal uuid via nm_users. The
      // control-api re-mints it from the live session — no client holds a key.
      const token = await clerkToken(c.apiUrl);
      // ~10-min lifetime — hand the SDK an expiry so it refreshes ahead of it (without
      // expiresAt a cached token is retried as 401 noise once it lapses).
      const expiresAt = jwtExpiry(token);
      c.clerkTokenExp = expiresAt;
      console.log(`auth_token mode=clerk exp_in=${expiresAt ? Math.round((expiresAt.getTime() - Date.now()) / 1000) : '?'}s`);
      return { endpoint: c.powersyncUrl, token, expiresAt };
    }
    if (c.authMode === 'local') {
      const cred = await fetchLocalCredentials(c, this.fetchImpl);
      console.log(`auth_token mode=local exp_in=${cred.expiresAt ? Math.round((cred.expiresAt.getTime() - Date.now()) / 1000) : '?'}s`);
      return cred;
    }
    return { endpoint: c.powersyncUrl, token: signDevToken(this.actorId(c)) };
  }

  async uploadData(db: AbstractPowerSyncDatabase) {
    const c = this.conn;
    // a throw here makes PowerSync retry the transaction AND hold back
    // checkpoint application — downloads wedge behind a failing write. The table
    // branches live in sync/upload.ts, shared with machined so coverage can't drift.
    if (!c.apiUrl) throw new Error('control-api not ready — write queued');
    const ident: UploadIdentity = {
      apiUrl: c.apiUrl,
      workspaceFallback: DEV_WS,
      defaultActor: { kind: 'human', id: this.actorId(c) },
      // the uploader assembles its own header bag so machined and the desktop can share it with
      // different credentials — this is where the desktop's verified bearer goes in
      authHeaders: await apiBearerHeader(c.apiUrl),
      fetchImpl: this.fetchImpl,
    };
    let tx;
    while ((tx = await db.getNextCrudTransaction()) != null) {
      for (const op of tx.crud) {
        const outcome = await uploadCrudEntry(ident, op);
        // desktop's historical policy for tables the uploader doesn't know: drop —
        // but say so (it used to be fully silent, which hid exactly this gap)
        if (outcome === 'unhandled') console.error(`upload_unhandled table=${op.table} op=${op.op} id=${op.id} — dropped`);
      }
      await tx.complete();
    }
  }
}
