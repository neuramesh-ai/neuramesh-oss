// The one identity the export cannot carry (docs/export-format.md "What the import leaves as it
// is"): the local workspace's human is the stack's seeded `nmh_` user, and that id is not a user
// in the cloud. Before a batch is sent, every column that names the local human with kind `human`
// is rewritten to the cloud connection's user id. Agents are untouched: the server merges them by
// name and re-points their ids itself. Pure, so every column is a unit test.
import type { ExportTable } from '@neuramesh/shared';

/** a column that names a human or an agent, and the `*_kind` column beside it. `address` marks the
 *  `kind:id` string form threads.created_by uses, which carries its kind in the value. */
export interface HumanActorColumn { column: string; kind?: string; address?: true }

export const HUMAN_ACTOR_COLUMNS: Partial<Record<ExportTable, readonly HumanActorColumn[]>> = {
  channels: [{ column: 'created_by', kind: 'created_by_kind' }],
  agent_channels: [{ column: 'created_by', kind: 'created_by_kind' }],
  threads: [{ column: 'created_by', address: true }],
  tasks: [{ column: 'creator_id', kind: 'creator_kind' }, { column: 'assignee_id', kind: 'assignee_kind' }],
  messages: [{ column: 'author_id', kind: 'author_kind' }],
  artifacts: [{ column: 'created_by', kind: 'created_by_kind' }],
};

type Row = Record<string, unknown>;

/** the rows of one table with the local human's id replaced by the cloud user's, wherever the
 *  kind beside it says `human`. Rows that change are copied, the rest are returned as they are. */
export function rewriteHumanActors(table: ExportTable, rows: readonly Row[], from: string, to: string): Row[] {
  const cols = HUMAN_ACTOR_COLUMNS[table];
  if (!cols || !from || from === to) return rows.slice();
  return rows.map((row) => {
    let out: Row | null = null;
    for (const c of cols) {
      const v = row[c.column];
      if (typeof v !== 'string') continue;
      const next = c.address ? (v === `human:${from}` ? `human:${to}` : v) : (v === from && row[c.kind!] === 'human' ? to : v);
      if (next === v) continue;
      out ??= { ...row };
      out[c.column] = next;
    }
    return out ?? row;
  });
}
