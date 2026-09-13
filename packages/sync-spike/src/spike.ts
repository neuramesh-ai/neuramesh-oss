// PowerSync go/no-go spike (docs/02 §4, docs/04 W1 gate).
// Proves: first sync, downstream replication, upload connector, offline
// write queue, reconnect drain — against the self-hosted open edition.
import { mkdirSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  AbstractPowerSyncDatabase,
  column,
  PowerSyncDatabase,
  Schema,
  Table,
  UpdateType,
  type PowerSyncBackendConnector,
} from '@powersync/node';
import postgres from 'postgres';
import { signSpikeToken } from './token';

const ENDPOINT = 'http://127.0.0.1:58080';
const PG_URL = 'postgresql://postgres:nm@127.0.0.1:55433/spike';
const DATA_DIR = new URL('../.data/', import.meta.url).pathname;

const messages = new Table({
  channel: column.text,
  body: column.text,
  created_at: column.text,
});

const AppSchema = new Schema({ messages });

const sql = postgres(PG_URL, { max: 2 });

class SpikeConnector implements PowerSyncBackendConnector {
  async fetchCredentials() {
    return { endpoint: ENDPOINT, token: signSpikeToken() };
  }

  // Stand-in for the control-api write path: apply CRUD to Postgres.
  async uploadData(db: AbstractPowerSyncDatabase) {
    let tx;
    while ((tx = await db.getNextCrudTransaction()) != null) {
      for (const op of tx.crud) {
        if (op.table !== 'messages') continue;
        const d = op.opData ?? {};
        if (op.op === UpdateType.PUT) {
          await sql`
            insert into messages (id, channel, body, created_at)
            values (${op.id}, ${d.channel ?? ''}, ${d.body ?? ''}, ${d.created_at ?? new Date().toISOString()})
            on conflict (id) do update set body = excluded.body, channel = excluded.channel
          `;
        } else if (op.op === UpdateType.PATCH) {
          await sql`update messages set body = coalesce(${d.body ?? null}, body) where id = ${op.id}`;
        } else if (op.op === UpdateType.DELETE) {
          await sql`delete from messages where id = ${op.id}`;
        }
      }
      await tx.complete();
    }
  }
}

async function poll(label: string, timeoutMs: number, fn: () => Promise<boolean>): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return Date.now() - t0;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for: ${label}`);
}

async function main() {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const db = new PowerSyncDatabase({
    schema: AppSchema,
    database: { dbFilename: 'spike.db', dbLocation: DATA_DIR },
  });
  const connector = new SpikeConnector();

  // 1 — first sync
  let t0 = Date.now();
  await db.connect(connector);
  await db.waitForFirstSync();
  const firstSyncMs = Date.now() - t0;

  // 2 — downstream: a row written straight to Postgres appears locally
  const downId = randomUUID();
  await sql`insert into messages (id, channel, body) values (${downId}, 'dev', 'from-postgres')`;
  const downMs = await poll('downstream replication', 15_000, async () => {
    const rows = await db.getAll('select id from messages where id = ?', [downId]);
    return rows.length === 1;
  });

  // 3 — upstream: a local optimistic write lands in Postgres via uploadData
  const upId = randomUUID();
  await db.execute('insert into messages (id, channel, body, created_at) values (?, ?, ?, ?)', [
    upId,
    'dev',
    'from-client',
    new Date().toISOString(),
  ]);
  const upMs = await poll('upload to postgres', 15_000, async () => {
    const rows = await sql`select id from messages where id = ${upId}`;
    return rows.length === 1;
  });

  // 4 — offline: writes queue locally, visible immediately, absent from Postgres
  await db.disconnect();
  const offA = randomUUID();
  const offB = randomUUID();
  for (const [id, body] of [
    [offA, 'offline-1'],
    [offB, 'offline-2'],
  ] as const) {
    await db.execute('insert into messages (id, channel, body, created_at) values (?, ?, ?, ?)', [
      id,
      'dev',
      body,
      new Date().toISOString(),
    ]);
  }
  const localVisible = await db.getAll(
    'select id from messages where id in (?, ?)',
    [offA, offB],
  );
  if (localVisible.length !== 2) throw new Error('offline writes not visible locally');

  const queued = await db.getAll<{ n: number }>('select count(*) as n from ps_crud');
  const queuedCount = Number(queued[0]?.n ?? 0);
  if (queuedCount < 2) throw new Error(`expected >=2 queued ops while offline, got ${queuedCount}`);

  const inPgWhileOffline = await sql`select id from messages where id in (${offA}, ${offB})`;
  if (inPgWhileOffline.length !== 0) throw new Error('offline writes leaked to postgres');

  // 5 — reconnect: queue drains, rows land in Postgres
  t0 = Date.now();
  await db.connect(connector);
  const drainMs = await poll('offline queue drain', 20_000, async () => {
    const pg = await sql`select id from messages where id in (${offA}, ${offB})`;
    const q = await db.getAll<{ n: number }>('select count(*) as n from ps_crud');
    return pg.length === 2 && Number(q[0]?.n ?? 1) === 0;
  });

  console.log(
    JSON.stringify(
      {
        verdict: 'GO',
        first_sync_ms: firstSyncMs,
        downstream_ms: downMs,
        upstream_ms: upMs,
        offline_queued_ops: queuedCount,
        reconnect_drain_ms: drainMs,
      },
      null,
      2,
    ),
  );

  await db.disconnectAndClear();
  await db.close();
  await sql.end();
}

main().catch(async (err) => {
  console.error('SPIKE FAILED:', err?.message ?? err);
  await sql.end().catch(() => {});
  process.exit(1);
});
