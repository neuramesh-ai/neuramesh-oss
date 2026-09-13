// The hosted write gate (source release 2026-09, unit U1b, docs/07 "The hosted write gate").
//
// Free is the local desktop app and Pro is the cloud. A hosted workspace still on `free` after
// 2026-09-29 keeps its rows and its reads: sync, every GET, the export, billing, and the three
// commands a replica needs to stay alive. It does not write. The refusal is per LANE, because
// two clients read it differently:
//   · POST /v1/commands answers 402 PLAN_LIMIT, the code the desktop routes to its upgrade flow
//   · the PowerSync upload lanes (messages, artifacts, whiteboards) answer 409 PLAN_LIMIT, because
//     the uploader drops a 409 and RETRIES anything else while holding every download behind it
//     (apps/desktop/src/main/sync/upload.ts throwUnless409). 409 is the only answer an old client
//     survives. The typed message still vanishes at the next checkpoint, which is why the new
//     shell replaces the composer with the gate card (review F6).
// The same verdict runs inside executeCommand (assertCommandAllowed), so a command that reaches
// the handler by any path meets it there too. Enforced, not prompted.
//
// Active only when NM_HOSTED_FREE_GATE is '1', and never under NM_LOCAL. Off at merge, flipped on
// after the notice period (implementation-plan.md U1b deploy notes).
import type { MiddlewareHandler } from 'hono';
import { sqlOf } from './credits';
import { DomainError } from './errors';
import { localMode } from './localmode';
import type { Store } from './store';

export const GATE_REFUSAL = 'This workspace needs Pro. Your threads stay readable. Get Pro to write again.';

/** Active on the hosted API with the flag set. Local mode (localmode.ts) has no plan gate by construction. */
export function gateActive(): boolean {
  return process.env['NM_HOSTED_FREE_GATE'] === '1' && !localMode();
}

/** Routes the gate never touches. `sample` is the path the unit test drives through refusalStatus. */
export const GATE_EXEMPT_ROUTES: ReadonlyArray<{ method: 'GET' | 'POST' | 'ANY'; path: RegExp; sample: string; why: string }> = [
  { method: 'ANY', path: /^\/auth\//, sample: '/auth/clerk', why: 'sign-in establishes the actor; it is mounted outside /v1 and listed here so the list is complete' },
  { method: 'ANY', path: /^\/v1\/billing\//, sample: '/v1/billing/checkout', why: 'paying is how a workspace leaves Free' },
  { method: 'POST', path: /^\/v1\/machines\/sync-token$/, sample: '/v1/machines/sync-token', why: 'a Free workspace keeps its replica in sync' },
  { method: 'GET', path: /^\/v1\/workspaces$/, sample: '/v1/workspaces', why: 'the list the site and the app pick a workspace from' },
  { method: 'GET', path: /^\/v1\/me$/, sample: '/v1/me', why: 'who am I, and which workspaces (local-routes.ts meRoute)' },
  { method: 'GET', path: /^\/v1\/workspaces\/[^/]+\/export$/, sample: '/v1/workspaces/0b8c1a2e-1111-4222-8333-444455556666/export', why: 'the export is the way out' },
];

/** Commands a Free workspace still needs: to exist, and to keep its desktop replica registered. */
export const GATE_EXEMPT_COMMANDS: ReadonlySet<string> = new Set(['workspace.create', 'machine.register', 'machine.heartbeat']);

export function isExemptRoute(method: string, path: string): boolean {
  return GATE_EXEMPT_ROUTES.some((e) => (e.method === 'ANY' || e.method === method) && e.path.test(path));
}

/** The status a refused write on this route answers, or null when the route is never gated. */
export function refusalStatus(method: string, path: string): 402 | 409 | null {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return null;
  if (isExemptRoute(method, path)) return null;
  if (method === 'POST' && path === '/v1/commands') return 402;
  if (method === 'POST' && (path === '/v1/messages' || path === '/v1/artifacts' || path === '/v1/whiteboards')) return 409;
  if (method === 'PATCH' && WHITEBOARD_PATCH.test(path)) return 409;
  return null;
}

const WHITEBOARD_PATCH = /^\/v1\/whiteboards\/([^/]+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every id a command can carry, and the table whose workspace_id it resolves to. The first
 *  field present wins, so `workspace` (86 of 139 commands) never costs a query. A field whose
 *  value is not a uuid (a slug) resolves to nothing and the request passes to the route, which
 *  resolves or refuses it as it does today. account.delete carries nothing and passes. */
const ID_FIELDS: ReadonlyArray<[field: string, table: string]> = [
  ['taskId', 'tasks'], ['runId', 'runs'], ['machineId', 'machines'], ['agent', 'agents'], ['agentId', 'agents'],
  ['artifactId', 'artifacts'], ['factId', 'facts'], ['invite', 'workspace_invites'], ['skillId', 'skills'],
  ['packId', 'skill_packs'], ['project', 'projects'], ['channel', 'channels'], ['schedule', 'schedules'],
  ['item', 'content_items'], ['connector', 'connectors'], ['whiteboardId', 'whiteboards'], ['message', 'messages'],
  ['decisionId', 'decisions'],
];

/** The workspace a command body acts on, or null when it names none the gate can attribute. */
export async function workspaceOfCommand(store: Store, cmd: Record<string, unknown>): Promise<string | null> {
  for (const key of ['workspace', 'workspaceId']) {
    const v = cmd[key];
    if (typeof v === 'string' && UUID.test(v)) return v;
  }
  const sql = sqlOf(store);
  for (const [field, table] of ID_FIELDS) {
    const id = cmd[field];
    if (typeof id !== 'string' || !UUID.test(id)) continue;
    if (sql) {
      const [row] = await sql`select workspace_id from ${sql(table)} where id = ${id}::uuid`;
      return (row?.['workspace_id'] as string | undefined) ?? null;
    }
    // the memory store resolves what its contract can; the rest is the pg lane's job
    if (table === 'tasks') return (await store.getTask(id))?.workspace ?? null;
    if (table === 'agents') return store.agentWorkspace(id);
    if (table === 'whiteboards') return (await store.getWhiteboard(id))?.workspace ?? null;
    return null;
  }
  return null;
}

async function isFree(store: Store, workspace: string | null): Promise<boolean> {
  return !!workspace && UUID.test(workspace) && (await store.workspacePlan(workspace)) === 'free';
}

/** Defense in depth inside executeCommand: the FSM-guard idiom, one DomainError, 402 at the route. */
export async function assertCommandAllowed(store: Store, cmd: { type: string } & Record<string, unknown>): Promise<void> {
  if (!gateActive() || GATE_EXEMPT_COMMANDS.has(cmd.type)) return;
  if (await isFree(store, await workspaceOfCommand(store, cmd))) throw new DomainError('PLAN_LIMIT', GATE_REFUSAL);
}

/** The /v1/* middleware. Registered once in app.ts, right after the auth middleware. */
export function hostedFreeGate(store: Store): MiddlewareHandler {
  return async (c, next) => {
    if (!gateActive()) return next();
    const status = refusalStatus(c.req.method, c.req.path);
    if (!status) return next();
    let workspace: string | null = null;
    const patched = WHITEBOARD_PATCH.exec(c.req.path)?.[1];
    if (patched) {
      workspace = UUID.test(patched) ? (await store.getWhiteboard(patched))?.workspace ?? null : null;
    } else {
      // Hono caches the parsed body, so the route's own c.req.json() reads the same object
      const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body) return next();
      if (c.req.path === '/v1/commands') {
        if (typeof body['type'] !== 'string' || GATE_EXEMPT_COMMANDS.has(body['type'])) return next();
        workspace = await workspaceOfCommand(store, body);
      } else {
        workspace = await workspaceOfCommand(store, { workspace: body['workspace'], workspaceId: body['workspaceId'] });
      }
    }
    if (!(await isFree(store, workspace))) return next();
    return c.json({ error: GATE_REFUSAL, code: 'PLAN_LIMIT' }, status);
  };
}
