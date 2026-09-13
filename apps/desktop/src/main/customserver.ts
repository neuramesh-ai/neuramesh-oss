// A SERVER SOMEONE RUNS THEMSELVES — the `custom` connection's validator and boot hook (Settings ›
// Connections › Manual setup, artboard D). The person pastes an API address, a PowerSync address
// and the `nmh_` bearer their stack minted; before anything is written the pair is PROVED: the
// address must answer `/.well-known/nm-config` with a `mode`, and the bearer must be accepted by
// `GET /v1/me`. Only then does the server land in the connections store and the bearer in the
// keychain, held exactly like the local stack's own (memory at boot, never on disk in the clear).
//
// Pure around an injected fetch so the three verdicts — a bad address, a bad bearer, a good
// pair — are unit tests, not a server. No electron import: index.ts wires the keychain and the
// connection at boot, and this module is what it calls.
import type { Keychain } from './keychain';

export interface CustomServerInput { apiUrl: string; powersyncUrl?: string; bearer: string }

export type CustomServerVerdict =
  | { ok: true; apiUrl: string; powersyncUrl: string; mode: string; version: string | null; actorId: string; workspaces: Array<{ id: string; name: string; slug: string }> }
  | { ok: false; code: 'ADDRESS' | 'NM_CONFIG' | 'BEARER' | 'UNREACHABLE'; message: string };

/** the keychain account a custom server's bearer is filed under (keychain.ts KEYCHAIN_SERVICE) */
export const customBearerAccount = (id: string): string => `custom-bearer:${id}`;

/** one id per address: the host and port, safe for a file name and a keychain account */
export const customServerId = (apiUrl: string): string => new URL(apiUrl).host.replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();

const trimSlash = (u: string): string => u.replace(/\/+$/, '');

export async function validateCustomServer(input: CustomServerInput, fetchImpl: typeof fetch): Promise<CustomServerVerdict> {
  let apiUrl: string;
  try {
    const u = new URL(input.apiUrl.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme');
    apiUrl = trimSlash(u.toString());
  } catch {
    return { ok: false, code: 'ADDRESS', message: 'The API address must start with http:// or https://.' };
  }
  const bearer = input.bearer.trim();
  if (!bearer) return { ok: false, code: 'BEARER', message: 'Paste the bearer from your stack.' };

  let cfg: { mode?: unknown; version?: unknown; powersyncUrl?: unknown } = {};
  try {
    const res = await fetchImpl(`${apiUrl}/.well-known/nm-config`);
    if (!res.ok) return { ok: false, code: 'NM_CONFIG', message: `The address did not answer as a NeuraMesh API (${res.status}).` };
    cfg = (await res.json().catch(() => ({}))) as typeof cfg;
  } catch {
    return { ok: false, code: 'UNREACHABLE', message: 'The address did not answer.' };
  }
  if (typeof cfg.mode !== 'string' || !cfg.mode) return { ok: false, code: 'NM_CONFIG', message: 'The address did not answer as a NeuraMesh API. It has no mode.' };

  let me: { actor?: { id?: unknown; kind?: unknown }; workspaces?: Array<{ id: string; name: string; slug: string }> } = {};
  try {
    const res = await fetchImpl(`${apiUrl}/v1/me`, { headers: { authorization: `Bearer ${bearer}` } });
    if (res.status === 401 || res.status === 403) return { ok: false, code: 'BEARER', message: 'The server did not accept the bearer.' };
    if (!res.ok) return { ok: false, code: 'BEARER', message: `The server refused the bearer (${res.status}).` };
    me = (await res.json().catch(() => ({}))) as typeof me;
  } catch {
    return { ok: false, code: 'UNREACHABLE', message: 'The address did not answer.' };
  }
  if (typeof me.actor?.id !== 'string' || me.actor.kind !== 'human') return { ok: false, code: 'BEARER', message: 'The bearer is not a human bearer.' };

  const powersyncUrl = trimSlash((input.powersyncUrl?.trim() || (typeof cfg.powersyncUrl === 'string' ? cfg.powersyncUrl : '')));
  if (!powersyncUrl) return { ok: false, code: 'ADDRESS', message: 'Paste the PowerSync address. The server did not name one.' };
  return { ok: true, apiUrl, powersyncUrl, mode: cfg.mode, version: typeof cfg.version === 'string' ? cfg.version : null, actorId: me.actor.id, workspaces: me.workspaces ?? [] };
}

/**
 * The boot hook for a custom connection with a bearer (index.ts waitUntilReachable): the bearer
 * comes out of the keychain into memory, then `/v1/me` names the actor — the same two steps the
 * local stack's hook takes (localStack/ipc.ts), so the header lane stays closed here too.
 */
export async function customReachable(c: { id: string; apiUrl: string; bearer?: string; identity: { actorId: string; display: string } }, keychain: Keychain, fetchImpl: typeof fetch = fetch): Promise<void> {
  const bearer = await keychain.get(customBearerAccount(c.id.replace(/^custom:/, '')));
  if (!bearer) throw new Error(`no bearer in the keychain for ${c.id} — remove the server and add it again`);
  c.bearer = bearer;
  const res = await fetchImpl(`${c.apiUrl}/v1/me`, { headers: { authorization: `Bearer ${bearer}` } });
  const me = (await res.json().catch(() => ({}))) as { actor?: { id: string; kind: string } };
  if (!res.ok || !me.actor?.id) throw new Error(`/v1/me failed (${res.status}) — the bearer for ${c.id} was not accepted`);
  c.identity = { actorId: me.actor.id, display: new URL(c.apiUrl).host };
}
