import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { backfillThreadProjects } from '../src/thread-project-backfill';
import { backfillProjectOwnership } from '../src/project-ownership-backfill';

const { values } = parseArgs({ options: {
  all: { type: 'boolean', default: false }, workspace: { type: 'string' }, apply: { type: 'boolean', default: false },
  'batch-size': { type: 'string', default: '200' }, 'max-batches': { type: 'string', default: '10' },
} });
if (!process.env['DATABASE_URL'] || !values.workspace) throw new Error('Set DATABASE_URL and pass --workspace with its ID.');
const sql = postgres(process.env['DATABASE_URL'], { prepare: false, max: 1, connect_timeout: 15 });
try {
  if (values.apply) {
    console.log(await (values.all ? backfillProjectOwnership : backfillThreadProjects)(sql, values.workspace, { batchSize: Number(values['batch-size']), maxBatches: Number(values['max-batches']) }));
  } else {
    const result = await sql.begin('read only', async (tx) => {
      const counts: Record<string, unknown> = {};
      for (const table of values.all ? ['threads', 'tasks', 'artifacts', 'schedules', 'content_items', 'whiteboards', 'facts', 'skills', 'skill_packs'] : ['threads']) {
        const [row] = await tx`select count(*)::int as total,
          count(*) filter (where project_id is null and channel_id is not null)::int as pending
          from ${tx(table)} where workspace_id = ${values.workspace!}::uuid`;
        counts[table] = row;
      }
      return counts;
    });
    console.log({ dryRun: true, ...result });
  }
} catch (error) {
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database]') : 'The backfill failed.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
