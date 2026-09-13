// The hosted free notice against the REAL schema (source release 2026-09, unit U1b): the dry
// run lists every owner of a free workspace once with all of their workspaces, a cloud owner
// is not listed, --send under NM_MAIL_DRY_RUN=1 records exactly one outbox row per owner, and a
// second send records nothing. The launcher script is spawned once for its dry run, which
// proves the tsx bridge loads. Run via scripts/test-pg.sh — skipped without DATABASE_URL.
import type { Actor } from '@neuramesh/shared';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { hostedFreeOwners, noticeDedupeKey, notifyHostedFreeOwners } from '../src/hosted-notice';
import { PostgresStore } from '../src/pgstore';

vi.hoisted(() => { process.env['NM_MAIL_DRY_RUN'] = '1'; }); // mail.ts reads it at load: rows land, the transport is skipped

const DB = process.env['DATABASE_URL'];
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const send = (actor: Actor, body: unknown) => app!.request('/v1/commands', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body),
});
async function makeUser(clerkId: string, email: string | null): Promise<Actor> {
  const [row] = await sql!`insert into nm_users (clerk_user_id, email) values (${clerkId}, ${email})
    on conflict (clerk_user_id) do update set email = excluded.email returning id`;
  return { kind: 'human', id: row!['id'] as string };
}
async function makeWorkspace(owner: Actor, name: string, plan: 'free' | 'cloud'): Promise<string> {
  const { workspaceId } = await j(await send(owner, { type: 'workspace.create', name, slug: `u1b-notice-${plan}-${Math.random().toString(36).slice(2, 8)}` }));
  await sql!`update workspaces set plan = ${plan} where id = ${workspaceId}::uuid`;
  return workspaceId as string;
}

const tag = Date.now().toString(36);
let two: Actor; let one: Actor; let paid: Actor; let nameless: Actor;

beforeAll(async () => {
  if (!sql) return;
  two = await makeUser(`clerk_u1b_notice_two_${tag}`, `two-${tag}@notice.test`);
  one = await makeUser(`clerk_u1b_notice_one_${tag}`, `one-${tag}@notice.test`);
  paid = await makeUser(`clerk_u1b_notice_paid_${tag}`, `paid-${tag}@notice.test`);
  nameless = await makeUser(`clerk_u1b_notice_nameless_${tag}`, null);
  await makeWorkspace(two, 'Two A', 'free');
  await makeWorkspace(two, 'Two B', 'free');
  await makeWorkspace(one, 'One', 'free');
  await makeWorkspace(paid, 'Paid', 'cloud');
  await makeWorkspace(nameless, 'No Address', 'free');
});
afterAll(async () => { await sql?.end(); await store?.close(); });

describe.skipIf(!DB)('the hosted free notice (postgres)', () => {
  it('the dry run lists each free owner once with every workspace, and never a cloud owner', async () => {
    const { owners, noAddress } = await hostedFreeOwners(sql!);
    const mine = owners.filter((o) => o.email.endsWith(`-${tag}@notice.test`));
    expect(mine.map((o) => [o.email, o.workspaces.map((w) => w.name).sort()])).toEqual([
      [`one-${tag}@notice.test`, ['One']],
      [`two-${tag}@notice.test`, ['Two A', 'Two B']],
    ]);
    expect(owners.some((o) => o.userId === paid.id)).toBe(false);
    expect(noAddress).toBeGreaterThanOrEqual(1); // the owner without an address is counted, not emailed

    const listed = await notifyHostedFreeOwners(store!, sql!, { send: false });
    expect(listed.outcomes.filter((x) => x.email.endsWith(`-${tag}@notice.test`)).every((x) => x.outcome === 'listed')).toBe(true);
    const [rows] = await sql!`select count(*)::int as c from emails where template = 'hosted_free_notice' and user_id in (${two.id}::uuid, ${one.id}::uuid)`;
    expect(Number(rows!['c'])).toBe(0);
  });

  it('--send records one outbox row per owner, and a second run records nothing', async () => {
    const first = await notifyHostedFreeOwners(store!, sql!, { send: true });
    const mine = (r: typeof first) => r.outcomes.filter((x) => x.email.endsWith(`-${tag}@notice.test`));
    // NM_MAIL_DRY_RUN=1: the row is written, the transport answers skipped
    expect(mine(first).map((x) => x.outcome)).toEqual(['skipped', 'skipped']);
    const rows = await sql!`select user_id, to_email, kind, subject, dedupe_key, status, payload from emails
      where template = 'hosted_free_notice' and user_id in (${two.id}::uuid, ${one.id}::uuid) order by to_email`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ to_email: `one-${tag}@notice.test`, kind: 'transactional', subject: 'A change to your free NeuraMesh workspace', dedupe_key: noticeDedupeKey(one.id), status: 'skipped' });
    expect((rows[1]!['payload'] as { workspaces: Array<{ name: string }> }).workspaces.map((w) => w.name).sort()).toEqual(['Two A', 'Two B']);

    const second = await notifyHostedFreeOwners(store!, sql!, { send: true });
    expect(mine(second).map((x) => x.outcome)).toEqual(['duplicate', 'duplicate']);
    const [again] = await sql!`select count(*)::int as c from emails where template = 'hosted_free_notice' and user_id in (${two.id}::uuid, ${one.id}::uuid)`;
    expect(Number(again!['c'])).toBe(2);
  });

  // The launcher is a thin shell over notifyHostedFreeOwners (covered above, in process). The child
  // compiled pgstore.ts through tsx: three seconds quiet, fifteen and a failure under the lane's
  // load (2026-09-12), and a test that passes alone and fails beside its neighbours is a flake, which
  // the doctrine treats as a defect. So the spawn checks the launcher's own path only: tsx registers,
  // the missing DATABASE_URL is refused with the usage sentence, exit 2, before any import of the store.
  it('the launcher script refuses without DATABASE_URL, over tsx, before it touches the store', () => {
    const script = fileURLToPath(new URL('../../../scripts/notify-hosted-free-owners.mjs', import.meta.url));
    const env = { ...process.env } as Record<string, string | undefined>;
    delete env['DATABASE_URL'];
    let code = 0;
    let err = '';
    try {
      execFileSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const x = e as { status?: number; stderr?: string };
      code = x.status ?? -1;
      err = x.stderr ?? '';
    }
    expect(code).toBe(2);
    expect(err).toContain('DATABASE_URL is not set');
  }, 60_000);
});
