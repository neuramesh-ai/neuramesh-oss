// MANAGED MESSAGE BOARDS CREDENTIALS FOR NEURAMESH AGENTS (docs/design/message-boards-2026-11/plan.md §7.6).
//
// A NeuraMesh agent granted on a board never sees a pasted token. Before one of its turns gets the
// Message boards tools, the daemon asks HERE, with its machine token:
//
//   GET /v1/machines/agents/:agentId/board-credentials      (Bearer nmm_…)
//
// and nm-api asks nm-boards on its behalf (`POST /internal/managed-credentials`, OIDC as nm-api's
// service account, boards-internal.ts). Message boards never sees a machine token; core never stores a
// board token — it passes the credential straight through with `cache-control: no-store`. nm-boards
// keeps ONE managed credential for each agent and machine, so the machine id rides the call and a
// fetch from one machine leaves the other machine's token alive.
//
// Answers:
//   200 BoardCredential     the agent has live grants: the daemon offers the tool family
//   204                     no grants, or Message boards is off on this deployment: no tools
//   401 / 403 / 409         not a machine (only a machine lane may ask — a person's session, a local
//                           human token or no credential is refused), or a replaced Cloud Run token
//   404                     the agent is not in the machine's workspace, or it is retired (fail
//                           closed, one answer: no existence leak)
//   502                     nm-boards failed; the detail goes to our log, never to the caller
//
// Registered ABOVE the /v1 gate (app.ts, with the nmbd_ refusal) because it proves the machine bearer
// itself, the machine-facts.ts idiom: the gate's other lanes have no business here.
import { isBoardToken } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { boardsOrigin, refuseBoardTokens } from './boards-guard';
import { BoardsUpstreamError, postBoardsInternal, type BoardsInternalDeps } from './boards-internal';
import { sqlOf } from './credits';
import { machineFromBearer } from './fleet-cloudrun-boot';
import type { Store } from './store';

export const BOARD_CREDENTIALS_PATH = '/v1/machines/agents/:agentId/board-credentials';

/** what the daemon reads. Typed here and not imported: this package is public, the boards packages are private */
export interface BoardCredential {
  /** starts with nmbd_ */
  token: string;
  expiresAt: string;
  /** the REST base of nm-boards, on the origin of NM_BOARDS_URL */
  apiUrl: string;
  mcpUrl?: string;
  boards: Array<{ boardSlug: string; workspaceSlug: string; perm: string }>;
}

export interface BoardCredentialDeps extends BoardsInternalDeps {
  /** the workspace of an agent that is not retired (null: no row, or retired). The default reads the agents row */
  liveAgentWorkspace?: (agentId: string) => Promise<string | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** the shape nm-boards promises, rebuilt field by field; anything else is an upstream fault. `origin`
 *  is where this deployment says Message boards is: the daemon sends the token to `apiUrl` only */
export function boardCredentialOf(v: unknown, origin: string | null): BoardCredential | null {
  if (!v || typeof v !== 'object' || !origin) return null;
  const o = v as Record<string, unknown>;
  if (!str(o['token']) || !isBoardToken(o['token']) || !str(o['expiresAt']) || Number.isNaN(Date.parse(o['expiresAt']))) return null;
  if (!str(o['apiUrl']) || !Array.isArray(o['boards'])) return null;
  try { if (new URL(o['apiUrl']).origin !== origin) return null; } catch { return null; }
  const boards: BoardCredential['boards'] = [];
  for (const b of o['boards'] as Array<Record<string, unknown> | null>) {
    if (!b || !str(b['boardSlug']) || !str(b['workspaceSlug']) || !str(b['perm'])) return null;
    boards.push({ boardSlug: b['boardSlug'], workspaceSlug: b['workspaceSlug'], perm: b['perm'] });
  }
  return { token: o['token'], expiresAt: o['expiresAt'], apiUrl: o['apiUrl'], ...(str(o['mcpUrl']) ? { mcpUrl: o['mcpUrl'] } : {}), boards };
}

/** nm-boards refuses a retired agent too (its view reads retired_at) and the migration's trigger drops
 *  the grants: this is the first of three lines. A store with no postgres has no retired fact to read */
async function liveAgentWorkspace(store: Store, agentId: string): Promise<string | null> {
  const sql = sqlOf(store);
  if (!sql) return store.agentWorkspace(agentId);
  const [a] = await sql<{ w: string }[]>`select workspace_id::text as w from agents where id = ${agentId}::uuid and retired_at is null`;
  return a?.w ?? null;
}

const NOT_FOUND = { error: 'This agent does not exist, or this machine has no access to it.', code: 'NOT_FOUND' } as const;
const UNAVAILABLE = { error: 'Message boards is not available now. The turn continues with no Message boards tools.', code: 'BOARDS_UNAVAILABLE' } as const;

/**
 * Every core touch point that must sit in front of the routes: the nmbd_ refusal for the whole app,
 * then the managed-credentials route. ONE registration call in app.ts, at the top.
 */
export function boardsRoutes<E extends Env>(app: Hono<E>, store: Store, deps: BoardCredentialDeps = {}): void {
  app.use('*', refuseBoardTokens);

  app.get(BOARD_CREDENTIALS_PATH, async (c) => {
    const authorization = c.req.header('authorization');
    if (!authorization) return c.json({ error: 'A machine token is necessary.', code: 'AUTH_REQUIRED' }, 401);
    const machine = await machineFromBearer(store, authorization);
    if ('error' in machine) return c.json({ error: machine.error, code: machine.code }, machine.status);

    const agentId = c.req.param('agentId');
    if (!UUID.test(agentId)) return c.json(NOT_FOUND, 404);
    const home = await (deps.liveAgentWorkspace ?? ((id: string) => liveAgentWorkspace(store, id)))(agentId);
    if (!home || home.toLowerCase() !== machine.workspace_id.toLowerCase()) return c.json(NOT_FOUND, 404);

    const env = deps.env ?? process.env;
    try {
      const res = await postBoardsInternal('managed-credentials', { workspaceId: machine.workspace_id, agentId, machineId: machine.id }, deps);
      if (!res || res.status === 204) return c.body(null, 204);
      if (!res.ok) {
        console.warn(`boards_credentials agent=${agentId} machine=${machine.id} upstream_status=${res.status}`);
        return c.json(UNAVAILABLE, 502);
      }
      const body: unknown = await res.json().catch(() => undefined);
      // the contract allows a JSON `null` for "no grants" too
      if (body === null) return c.body(null, 204);
      const credential = boardCredentialOf(body, boardsOrigin(env));
      if (!credential) {
        console.warn(`boards_credentials agent=${agentId} machine=${machine.id} upstream_shape_invalid`);
        return c.json(UNAVAILABLE, 502);
      }
      c.header('cache-control', 'no-store');
      return c.json(credential, 200);
    } catch (e) {
      console.warn(`boards_credentials agent=${agentId} machine=${machine.id} failed: ${e instanceof BoardsUpstreamError ? e.detail : String(e)}`);
      return c.json(UNAVAILABLE, 502);
    }
  });
}
