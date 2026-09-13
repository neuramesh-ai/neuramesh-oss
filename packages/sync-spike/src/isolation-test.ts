// Membership scoping, self-validating: a stranger must receive nothing
// (table + oplog empty), while a member on the same harness receives rows.
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { column, PowerSyncDatabase, Schema, SyncStreamConnectionMethod, Table } from '@powersync/node';
import { signSpikeToken } from './token';

const MEMBER = '00000000-0000-0000-0000-000000000001';
const channels = new Table({ workspace_id: column.text, slug: column.text });

async function syncedRows(sub: string, windowMs: number): Promise<{ rows: number; oplog: number }> {
  const dir = `/tmp/nm-isolation/${sub.slice(0, 8)}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const db = new PowerSyncDatabase({
    schema: new Schema({ channels }),
    database: { dbFilename: 'iso.db', dbLocation: dir },
  });
  await db.connect(
    { fetchCredentials: async () => ({ endpoint: 'http://127.0.0.1:58081', token: signSpikeToken(sub) }), uploadData: async () => {} },
    { connectionMethod: SyncStreamConnectionMethod.HTTP },
  );
  const deadline = Date.now() + windowMs;
  let rows = 0;
  for (;;) {
    rows = (await db.getAll('select id from channels')).length;
    if (rows > 0 || Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  const [op] = await db.getAll<{ n: number }>('select count(*) as n from ps_oplog');
  await db.disconnectAndClear();
  await db.close();
  return { rows, oplog: Number(op?.n ?? 0) };
}

const member = await syncedRows(MEMBER, 15_000);
if (member.rows < 2) {
  console.log(`ISOLATION=INVALID member_rows=${member.rows} (harness cannot see deliveries)`);
  process.exit(1);
}

const stranger = await syncedRows(randomUUID(), 8_000);
if (stranger.rows === 0 && stranger.oplog === 0) {
  console.log(`ISOLATION=PASS stranger_rows=0 stranger_oplog=0 member_rows=${member.rows}`);
  process.exit(0);
}
console.log(`ISOLATION=FAIL stranger_rows=${stranger.rows} stranger_oplog=${stranger.oplog}`);
process.exit(1);
