// A person's model for each agent (0148) against the REAL schema: the jsonb merge keeps the other
// agents' picks, the `-` clear drops one key, the row written is the actor's own, and an agent of
// another workspace 404s at set time. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const WS = 'a0000000-0000-0000-0000-00000000000a';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;

function send(actor: Actor, body: unknown) {
  return app!.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });
}
const picks = async (user: string) =>
  ((await sql!`select agent_models from workspace_members where workspace_id = ${WS}::uuid and user_id = ${user}::uuid`)[0]?.['agent_models'] ?? null) as Record<string, unknown> | null;

// this suite makes its OWN machine and agents: a sibling file's side effects are not a fixture
let A = '';
let B = '';
beforeAll(async () => {
  if (!sql) return;
  const [m] = await sql`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at, runtimes)
    values (${WS}::uuid, ${george.id}::uuid, 'agent-models-host', 'darwin', '1', now(), '["claude-code"]'::jsonb)
    on conflict (workspace_id, name) do update set last_seen_at = now() returning id`;
  const agent = async (name: string) => ((await sql`insert into agents (workspace_id, machine_id, name, role, model)
    values (${WS}::uuid, ${m!['id'] as string}::uuid, ${name}, 'marketer', 'claude-sonnet-5')
    on conflict (workspace_id, name) do update set retired_at = null returning id`)[0]!['id'] as string);
  A = await agent('agent-models-a');
  B = await agent('agent-models-b');
  await sql`update workspace_members set agent_models = '{}'::jsonb where workspace_id = ${WS}::uuid and user_id = ${george.id}::uuid`;
});

afterAll(async () => {
  await sql?.end();
  await store?.close();
});

describe.skipIf(!DB)('member.set_agent_model on postgres (0148)', () => {
  it('merges one agent\'s pick and keeps the others, then clears one key', async () => {
    expect((await send(george, { type: 'member.set_agent_model', workspace: WS, agent: A, model: 'claude-opus-5', thinking: 'high' })).status).toBe(200);
    expect((await send(george, { type: 'member.set_agent_model', workspace: WS, agent: B, model: 'gpt-5.6-terra' })).status).toBe(200);
    expect(await picks(george.id)).toEqual({ [A]: { model: 'claude-opus-5', thinking: 'high' }, [B]: { model: 'gpt-5.6-terra' } });
    expect((await store!.agentModels.get(WS, george.id))[A]).toEqual({ model: 'claude-opus-5', thinking: 'high' });
    expect((await send(george, { type: 'member.set_agent_model', workspace: WS, agent: A, model: null })).status).toBe(200);
    expect(await picks(george.id)).toEqual({ [B]: { model: 'gpt-5.6-terra' } });
  });

  it('refuses an agent that is not in the workspace', async () => {
    const r = await send(george, { type: 'member.set_agent_model', workspace: WS, agent: '9f000000-0000-4000-8000-0000000000f9', model: 'claude-opus-5' });
    expect(r.status).toBe(404);
  });
});
