// The claim substrate's server half against the REAL schema (0143, fleet-claims.ts): the desired
// feed carries the substrate, a spare cannot bootstrap before nm-fleet binds it, the bind clears
// any earlier token, the bootstrap mints for exactly the bound (pod, uid) and re-issues to the same
// pod only, and a promotion moves the row to a volume awake. Run via scripts/test-pg.sh — skipped
// without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { createHash, generateKeyPairSync } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createCloudMachine } from '../src/fleet';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
// its OWN workspace: the pg harness runs suites in parallel, and the one-runner and one-member
// unique indexes on the shared fixture workspace would make two suites' machines collide
const WS = 'a5a5a5a5-0000-0000-0000-00000000c1a1';
// a second one for the default-substrate test: machines_one_runner (0126) has no tombstone clause,
// so a workspace whose runner was ever retired can never mint another one
const WS2 = 'a5a5a5a5-0000-0000-0000-00000000c1a2';
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const rex: Actor = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };

const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;

// GitHub as a fixture for the write token (github-write.ts): installation 4242 covers acme/marketing-site
// (the fixtures' repo); the scoped mint records what it was asked for, and `appWrite` flips it to 422
const githubCalls: { path: string; body: unknown }[] = [];
let appWrite = true;
const github: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  githubCalls.push({ path, body });
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (path === '/repos/acme/marketing-site/installation') return json({ id: 4242, account: { login: 'acme' } });
  if (path === '/app/installations/4242/access_tokens') {
    if (body?.permissions && !appWrite) return json({ message: 'Validation Failed' }, 422);
    return json({ token: body?.permissions ? 'ghs_write_4242' : 'ghs_read_4242', expires_at: new Date(Date.now() + 3_600_000).toISOString() }, 201);
  }
  if (path === '/app/installations/4242') return json({ account: { login: 'acme' }, repository_selection: 'selected' });
  return json({ message: 'Not Found' }, 404);
};
const appWithGitHub = store ? createApp(store, { announce: { fetchFn: github } }) : null;
const pem = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;

process.env['FLEET_SECRET'] = 'test-fleet-secret';
process.env['FLEET_POOL_TOKEN'] = 'test-pool-token';

const fleet = { authorization: 'Bearer test-fleet-secret', 'content-type': 'application/json' };
const json = (body: unknown) => JSON.stringify(body);
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

let MACHINE = '';
/** the machine token the bootstrap hands out, kept for the write-token test */
let MACHINE_TOKEN = '';
beforeAll(async () => {
  if (!sql) return;
  process.env['GITHUB_APP_ID'] = '4994365';
  process.env['GITHUB_APP_PRIVATE_KEY_B64'] = Buffer.from(pem).toString('base64');
  for (const [ws, slug] of [[WS, 'claim-test'], [WS2, 'claim-test-2']] as const) {
    await sql`insert into workspaces (id, name, slug, created_by, plan) values (${ws}::uuid, 'Claim Test', ${slug}, ${george.id}::uuid, 'cloud') on conflict (id) do nothing`;
    await sql`insert into workspace_members (workspace_id, user_id, role) values (${ws}::uuid, ${george.id}::uuid, 'owner') on conflict do nothing`;
  }
  // this suite mints its own claim runner the way plan-flip does
  const { id } = await createCloudMachine(sql, { workspaceId: WS, kind: 'runner', ownerUserId: george.id, name: 'claim-runner', tokenHash: sha('placeholder'), substrate: 'claim' });
  MACHINE = id;
});

afterAll(async () => {
  if (sql && MACHINE) await sql`update machines set lifecycle = 'destroyed', name = name || '-gone' where id = ${MACHINE}::uuid`.catch(() => {});
  await sql?.end();
  await store?.close();
});

const row = async () => (await sql!`select substrate, pod_name, pod_uid, bootstrapped_at, token_hash, desired_replicas from machines where id = ${MACHINE}::uuid`)[0]!;

describe.skipIf(!DB)('the claim substrate on postgres (0143)', () => {
  it('the desired feed carries the substrate, and only when it is claim', async () => {
    const res = await app!.request('/internal/fleet-desired', { headers: fleet });
    expect(res.status).toBe(200);
    const body = await res.json() as { workspaces: { id: string; machines: { id: string; substrate?: string }[] }[] };
    const m = body.workspaces.find((w) => w.id === WS)!.machines.find((x) => x.id === MACHINE)!;
    expect(m.substrate).toBe('claim');
  });

  it('a spare cannot bootstrap before the bind, and never with the wrong pool token', async () => {
    const unbound = await app!.request('/v1/machines/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ poolToken: 'test-pool-token', pod: 'nm-machine-abc', uid: 'uid-1' }) });
    expect(unbound.status).toBe(404);
    expect((await unbound.json() as { code: string }).code).toBe('UNBOUND');
    const wrong = await app!.request('/v1/machines/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ poolToken: 'nope', pod: 'nm-machine-abc', uid: 'uid-1' }) });
    expect(wrong.status).toBe(401);
  });

  it('the bind needs the fleet secret and clears the placeholder token', async () => {
    const forbidden = await app!.request(`/internal/machines/${MACHINE}/bind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ pod: 'nm-machine-abc', uid: 'uid-1' }) });
    expect(forbidden.status).toBe(403);
    const res = await app!.request(`/internal/machines/${MACHINE}/bind`, { method: 'POST', headers: fleet, body: json({ pod: 'nm-machine-abc', uid: 'uid-1' }) });
    expect(res.status).toBe(200);
    const r = await row();
    expect(r['pod_name']).toBe('nm-machine-abc');
    expect(r['pod_uid']).toBe('uid-1');
    expect(r['token_hash']).toBeNull();
    expect(r['bootstrapped_at']).toBeNull();
  });

  it('the bound pod bootstraps into its identity and a fresh token; a sibling with the wrong uid cannot', async () => {
    const wrongUid = await app!.request('/v1/machines/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ poolToken: 'test-pool-token', pod: 'nm-machine-abc', uid: 'uid-guess' }) });
    expect(wrongUid.status).toBe(404);
    const res = await app!.request('/v1/machines/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ poolToken: 'test-pool-token', pod: 'nm-machine-abc', uid: 'uid-1' }) });
    expect(res.status).toBe(200);
    const identity = await res.json() as { machineId: string; workspaceId: string; kind: string; ownerUserId: string; token: string };
    expect(identity).toMatchObject({ machineId: MACHINE, workspaceId: WS, kind: 'runner', ownerUserId: george.id });
    expect(identity.token.startsWith('nmm_')).toBe(true);
    const r = await row();
    expect(r['token_hash']).toBe(sha(identity.token));
    expect(r['bootstrapped_at']).not.toBeNull();
    // the token is a real machine bearer now: the sync-token exchange recognises it
    const sync = await app!.request('/v1/machines/sync-token', { method: 'POST', headers: { authorization: `Bearer ${identity.token}` } });
    expect([200, 503]).toContain(sync.status); // 503 only when no issuer key is configured here
    // the same pod re-issues (a restarted container lost its copy) and the old token dies
    const again = await app!.request('/v1/machines/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ poolToken: 'test-pool-token', pod: 'nm-machine-abc', uid: 'uid-1' }) });
    const second = await again.json() as { token: string };
    expect(second.token).not.toBe(identity.token);
    expect((await row())['token_hash']).toBe(sha(second.token));
    MACHINE_TOKEN = second.token; // the live one, for the write-token test below
  });

  it('a machine mints a per-run repository write token, narrowed to the room\'s repository (D6)', async () => {
    // the room: a project with the fixtures\' GitHub repository attached, and a connected github row
    const proj = await (await appWithGitHub!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) }, body: json({ type: 'project.create', workspace: WS, name: 'Write token' }) })).json() as { projectId: string };
    const chan = await (await appWithGitHub!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) }, body: json({ type: 'channel.create', workspace: WS, project: proj.projectId, slug: 'write-token' }) })).json() as { channelId: string };
    await sql!`insert into project_repos (project_id, repo_id, is_primary) values (${proj.projectId}::uuid, 'b0000000-0000-0000-0000-000000000001'::uuid, true)`;
    await store!.upsertConnector({ workspace: WS, channelId: chan.channelId, provider: 'github', handle: 'acme/marketing-site', connectedBy: george.id, scopes: 'contents:read' });
    const mint = (auth: Record<string, string>) => appWithGitHub!.request('/v1/repo/token', { method: 'POST', headers: { 'content-type': 'application/json', ...auth }, body: json({ channel: chan.channelId }) });
    // a person cannot: the token is a machine\'s
    expect((await mint({ 'x-nm-actor': JSON.stringify(george) })).status).toBe(403);
    // the machine can, and the mint asked GitHub for exactly one repository and the write pair
    const res = await mint({ authorization: `Bearer ${MACHINE_TOKEN}` });
    expect(res.status).toBe(200);
    const out = await res.json() as { slug: string; token: string; permissions: Record<string, string> };
    expect(out).toMatchObject({ slug: 'acme/marketing-site', token: 'ghs_write_4242', permissions: { contents: 'write', pull_requests: 'write' } });
    const scoped = githubCalls.find((c) => c.path === '/app/installations/4242/access_tokens' && (c.body as { permissions?: unknown })?.permissions);
    expect(scoped?.body).toEqual({ repositories: ['marketing-site'], permissions: { contents: 'write', pull_requests: 'write', metadata: 'read' } });
    // nothing at rest: the machine row still carries only its own token hash
    expect((await row())['token_hash']).toBe(sha(MACHINE_TOKEN));
    // an App without the write permissions: GitHub\'s 422 becomes the named fix
    appWrite = false;
    const refused = await mint({ authorization: `Bearer ${MACHINE_TOKEN}` });
    expect(refused.status).toBe(409);
    expect((await refused.json() as { code: string }).code).toBe('APP_NEEDS_WRITE');
    appWrite = true;
  });

  it('a re-created pod (new uid) rebinds and the previous token is dead before the new pod redeems', async () => {
    const res = await app!.request(`/internal/machines/${MACHINE}/bind`, { method: 'POST', headers: fleet, body: json({ pod: 'nm-machine-abc', uid: 'uid-2' }) });
    expect(res.status).toBe(200);
    const r = await row();
    expect(r['pod_uid']).toBe('uid-2');
    expect(r['token_hash']).toBeNull();
    const old = await app!.request('/v1/machines/bootstrap', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json({ poolToken: 'test-pool-token', pod: 'nm-machine-abc', uid: 'uid-1' }) });
    expect(old.status).toBe(404);
  });

  it('a promotion is human-only, moves the row to a volume awake, and clears the binding', async () => {
    const byAgent = await app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(rex) }, body: json({ type: 'machine.promote', workspace: WS, machineId: MACHINE }) });
    expect(byAgent.status).toBe(403);
    const res = await app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) }, body: json({ type: 'machine.promote', workspace: WS, machineId: MACHINE }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, promoted: true });
    const r = await row();
    expect(r['substrate']).toBe('volume');
    expect(r['pod_name']).toBeNull();
    expect(r['token_hash']).toBeNull();
    expect(r['desired_replicas']).toBe(1);
    // already a volume: the second promotion changes nothing and says so
    const twice = await app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) }, body: json({ type: 'machine.promote', workspace: WS, machineId: MACHINE }) });
    expect(await twice.json()).toMatchObject({ ok: true, promoted: false });
    // and a bind no longer applies to it
    const bind = await app!.request(`/internal/machines/${MACHINE}/bind`, { method: 'POST', headers: fleet, body: json({ pod: 'nm-machine-xyz', uid: 'uid-3' }) });
    expect(bind.status).toBe(404);
  });

  it('a new runner takes the env default substrate; a member is always a volume', async () => {
    process.env['FLEET_RUNNER_SUBSTRATE'] = 'claim';
    const m = await createCloudMachine(sql!, { workspaceId: WS2, kind: 'member', ownerUserId: george.id, name: 'claim-test-member', tokenHash: sha('x') , replicas: 0 });
    const r = await createCloudMachine(sql!, { workspaceId: WS2, kind: 'runner', ownerUserId: george.id, name: 'claim-test-runner-2', tokenHash: sha('y') });
    delete process.env['FLEET_RUNNER_SUBSTRATE'];
    const subs = await sql!`select id, substrate from machines where id in (${m.id}::uuid, ${r.id}::uuid)`;
    expect(Object.fromEntries(subs.map((x) => [x['id'], x['substrate']]))).toEqual({ [m.id]: 'volume', [r.id]: 'claim' });
    await sql!`update machines set lifecycle = 'destroyed', name = name || '-gone' where id in (${m.id}::uuid, ${r.id}::uuid)`;
  });
});
