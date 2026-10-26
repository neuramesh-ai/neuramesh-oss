import { TABLE_COLUMNS } from './schema';
import type { ReplicaChange } from './replica';
import type { CrudEntry } from './crud-upload';
import { quoteIdentifier, type SQLiteDriver } from './sqlite-store';

export interface LegacyReplica {
  rows: ReplicaChange[];
  pending: Array<CrudEntry & { sequence: string }>;
}

/** Read the old cache without loading its SDK or connecting to its service. Leave the source
 * file untouched; the target records an atomic import marker together with its new outbox.
 * Unknown queued operations fail the upgrade instead of silently discarding a user's edit. */
export async function readLegacyReplica(source: SQLiteDriver): Promise<LegacyReplica> {
  const tables = new Set((await source.query("select name from sqlite_master where type='table'")).rows.map(r => r['name']));
  const rows: ReplicaChange[] = [];
  for (const table of Object.keys(TABLE_COLUMNS)) {
    const raw = `ps_data__${table}`;
    if (!tables.has(raw)) continue;
    for (const r of (await source.query(`select id,data from ${quoteIdentifier(raw)}`)).rows) {
      const row = JSON.parse(String(r['data'])) as Record<string, unknown>;
      rows.push({ table, id: String(r['id']), row: { ...row, id: r['id'] } });
    }
  }
  const pending: LegacyReplica['pending'] = [];
  if (tables.has('ps_crud')) for (const row of (await source.query('select id,data from ps_crud order by id')).rows) {
    const op = JSON.parse(String(row['data'])) as { op: CrudEntry['op']; type: string; id: string; data?: Record<string, unknown> };
    if (typeof op.id !== 'string' || !(['messages','artifacts','whiteboards'].includes(op.type)) || !['PUT','PATCH','DELETE'].includes(op.op)) throw new Error('An unsupported legacy write needs recovery before upgrading');
    const cached = rows.find(r => r.table === op.type && r.id === op.id)?.row ?? {};
    pending.push({ id: op.id, table: op.type, op: op.op, opData: { ...cached, ...op.data }, sequence: String(row['id']) });
  }
  return { rows, pending };
}
