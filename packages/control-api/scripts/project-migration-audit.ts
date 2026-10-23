import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { projectMigrationAudit } from '../src/project-migration-audit';

const { values } = parseArgs({ options: { workspace: { type: 'string' }, out: { type: 'string' } } });
if (!process.env['DATABASE_URL']) throw new Error('Set DATABASE_URL for the database to inspect.');
const sql = postgres(process.env['DATABASE_URL'], { prepare: false, max: 1, connect_timeout: 15 });
try {
  const report = await projectMigrationAudit(sql, values.workspace ?? null);
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (values.out) await writeFile(values.out, body, { mode: 0o600 });
  else process.stdout.write(body);
  console.error(`Read-only audit: ${report.projects.length} projects. No data changed.`);
} catch (error) {
  // Connection errors may include a credential-bearing URL. Never print the connection object.
  console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[database]') : 'The audit failed.');
  process.exitCode = 1;
} finally {
  await sql.end();
}
