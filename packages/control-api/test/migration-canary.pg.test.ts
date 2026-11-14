import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { computeFleetDesired, machineByTokenHash } from '../src/fleet';

const DB = process.env['DATABASE_URL'];
if (DB && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(DB).hostname)) throw new Error('Canary tests require an isolated loopback database');
const sql = DB ? postgres(DB, { max: 1, onnotice: () => {} }) : null;
const suffix = randomUUID();
const workspace = randomUUID();
const qa = randomUUID(), customer = randomUUID();
const qaMachine = randomUUID(), customerMachine = randomUUID();
const qaHash = createHash('sha256').update('qa-' + suffix).digest('hex');
const customerHash = createHash('sha256').update('customer-' + suffix).digest('hex');
const qaSubject = 'user_qa_' + suffix.replaceAll('-', '');

describe.skipIf(!DB)('migration canary ownership on real PostgreSQL', () => {
  beforeAll(async () => {
    await sql!`insert into nm_users(id,clerk_user_id,email) values (${qa},${qaSubject},'qa@example.invalid'),(${customer},${'user_customer_' + suffix},'customer@example.invalid')`;
    await sql!`insert into workspaces(id,name,slug,created_by,plan) values (${workspace},'Migration isolation',${'migration-' + suffix},${qa},'cloud')`;
    await sql!`insert into workspace_members(workspace_id,user_id,role) values (${workspace},${qa},'owner'),(${workspace},${customer},'member')`;
    await sql!`insert into machines(id,workspace_id,owner_user_id,name,platform,kind,lifecycle,desired_replicas,token_hash,substrate)
      values (${qaMachine},${workspace},${qa},'qa','linux','member','running',1,${qaHash},'volume'),
             (${customerMachine},${workspace},${customer},'customer','linux','member','running',1,${customerHash},'volume')`;
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    if (!sql) return;
    await sql`delete from workspaces where id=${workspace}`;
    await sql`delete from nm_users where id in (${qa},${customer})`;
    await sql.end({ timeout: 2 });
  });
  it('rejects a valid customer machine token and excludes it from desired fleet state until live promotion', async () => {
    vi.stubEnv('NM_DEPLOYMENT', 'production'); vi.stubEnv('NM_MIGRATION_MODE', 'canary');
    vi.stubEnv('NM_CANARY_CLERK_USER_IDS', qaSubject);
    expect((await machineByTokenHash(sql!, qaHash))?.id).toBe(qaMachine);
    expect(await machineByTokenHash(sql!, customerHash)).toBeNull();
    const desired = JSON.stringify(await computeFleetDesired(sql!));
    expect(desired).toContain(qaMachine); expect(desired).not.toContain(customerMachine);
    vi.stubEnv('NM_MIGRATION_MODE', 'live');
    expect((await machineByTokenHash(sql!, customerHash))?.id).toBe(customerMachine);
    expect(JSON.stringify(await computeFleetDesired(sql!))).toContain(customerMachine);
  });
});
