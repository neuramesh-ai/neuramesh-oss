// GET /v1/machines/agents/:agentId/board-credentials against the REAL schema: the machine by its
// token, the agent by its row. The unit suite (boards-core.test.ts) answers these two reads from a
// fake; this proves the SQL itself: an agent of the machine's workspace gets its credential, and a
// retired agent, an agent of another workspace and an agent with no row all get one 404.
// Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import { BOARD_TOKEN_PREFIX } from '@neuramesh/shared';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boardsRoutes } from '../src/boards-credentials';
import { createCloudMachine } from '../src/fleet';
import { mintMachineToken } from '../src/machine-auth';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
// its OWN two workspaces, so no other pg suite can collide
const WS = 'b0a2d500-0000-4000-8000-00000000b0a1';
const OTHER_WS = 'b0a2d500-0000-4000-8000-00000000b0a2';
const GEORGE = '00000000-0000-0000-0000-000000000001';
const BOARDS = 'https://boards.test';

const store = DB ? new PostgresStore(DB) : null;
const sql = DB ? postgres(DB) : null;
const machine = mintMachineToken();
const calls: Array<{ url: string; body: unknown }> = [];
const issued = { token: `${BOARD_TOKEN_PREFIX}${'a'.repeat(8)}_${'b'.repeat(36)}`, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), apiUrl: `${BOARDS}/api/v1`, boards: [{ boardSlug: 'ops', workspaceSlug: 'boards-cred', perm: 'post' }] };
const app = new Hono();
if (store) {
  boardsRoutes(app, store, {
    env: { NM_BOARDS_URL: BOARDS },
    idToken: async () => 'oidc-test-token',
    fetch: (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return Response.json(issued); }) as unknown as typeof fetch,
  });
}
const get = (agentId: string, token = machine.token) => app.request(`/v1/machines/agents/${agentId}/board-credentials`, { headers: { authorization: `Bearer ${token}` } });

let MACHINE = '';
const agents = { live: '', retired: '', foreign: '' };

beforeAll(async () => {
  if (!sql) return;
  for (const [id, slug] of [[WS, 'boards-cred'], [OTHER_WS, 'boards-cred-other']] as const) {
    await sql`insert into workspaces (id, name, slug, created_by, plan) values (${id}::uuid, 'Boards Credentials', ${slug}, ${GEORGE}::uuid, 'cloud') on conflict (id) do nothing`;
    await sql`insert into workspace_members (workspace_id, user_id, role) values (${id}::uuid, ${GEORGE}::uuid, 'owner') on conflict do nothing`;
  }
  const tag = Date.now().toString(36);
  MACHINE = (await createCloudMachine(sql, { workspaceId: WS, kind: 'runner', ownerUserId: GEORGE, name: `boards-runner-${tag}`, tokenHash: machine.hash, replicas: 0, substrate: 'volume' })).id;
  const agent = async (workspace: string, name: string, retired: boolean): Promise<string> => {
    const [row] = await sql<{ id: string }[]>`insert into agents (workspace_id, name, retired_at) values (${workspace}::uuid, ${`${name}-${tag}`}, ${retired ? sql`now()` : null}) returning id`;
    return row!.id;
  };
  agents.live = await agent(WS, 'boards-live', false);
  agents.retired = await agent(WS, 'boards-retired', true);
  agents.foreign = await agent(OTHER_WS, 'boards-foreign', false);
});

afterAll(async () => {
  if (sql && MACHINE) await sql`update machines set lifecycle = 'destroyed', name = name || '-gone' where id = ${MACHINE}::uuid`.catch(() => {});
  await sql?.end({ timeout: 2 });
  await store?.close();
});

describe.skipIf(!DB)('the managed credentials route on postgres', () => {
  it('gives a live agent of the machine\'s workspace its credential, and names the workspace, the agent and the machine to nm-boards', async () => {
    const res = await get(agents.live);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual(issued);
    expect(calls).toEqual([{ url: `${BOARDS}/internal/managed-credentials`, body: { workspaceId: WS, agentId: agents.live, machineId: MACHINE } }]);
  });

  it('answers one 404 for a retired agent, an agent of another workspace and an agent with no row, with no call to nm-boards', async () => {
    const before = calls.length;
    for (const id of [agents.retired, agents.foreign, 'b0a2d500-0000-4000-8000-0000000000ff']) {
      const res = await get(id);
      expect(res.status, id).toBe(404);
      expect(await res.json()).toEqual({ error: 'This agent does not exist, or this machine has no access to it.', code: 'NOT_FOUND' });
    }
    expect(calls.length).toBe(before);
  });

  it('stops at the retirement: the same agent gets 404 at its next call', async () => {
    expect((await get(agents.live)).status).toBe(200);
    await sql!`update agents set retired_at = now() where id = ${agents.live}::uuid`;
    expect((await get(agents.live)).status).toBe(404);
    await sql!`update agents set retired_at = null where id = ${agents.live}::uuid`;
    expect((await get(agents.live)).status).toBe(200);
  });

  it('refuses a token that is no machine of this database, and a machine that is gone', async () => {
    expect((await get(agents.live, mintMachineToken().token)).status).toBe(401);
    await sql!`update machines set lifecycle = 'destroyed' where id = ${MACHINE}::uuid`;
    expect((await get(agents.live)).status).toBe(401);
    await sql!`update machines set lifecycle = 'provisioning' where id = ${MACHINE}::uuid`;
    expect((await get(agents.live)).status).toBe(200);
  });
});
