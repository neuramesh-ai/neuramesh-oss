import postgres from 'postgres';
import { startCloudSql } from './cloudsql.mjs';
import { bootstrapBoardsRole, bootstrapRuntimeRole } from './db-runtime.mjs';

if (!process.env.DATABASE_URL) throw new Error('The database bootstrap Job requires DATABASE_URL');
const connection = await startCloudSql();
const sql = postgres(process.env.DATABASE_URL, { ...(connection.path ? { path: connection.path } : {}), max: 1, prepare: false, connect_timeout: 30, onnotice: () => {} });
try {
  await bootstrapRuntimeRole(sql, process.env.NM_RUNTIME_DB_USER ?? 'nm_api', process.env.NM_RUNTIME_DB_ROLE ?? 'nm_runtime');
  console.log('Database runtime role prepared. Assign its membership through the Pulumi SQL User resource before deploying the API.');
  const boards = await bootstrapBoardsRole(sql);
  console.log(`The Message boards role ${boards.role} exists and has no login. ${boards.granted
    ? 'The role has its rights on schema boards.'
    : 'This database has no function boards.grant_service_role. The migration gives the rights to the role.'}`);
  console.log({
    absent: `The login ${boards.user} does not exist. Add it through the Pulumi SQL User resource. Then run this Job again.`,
    narrowed: `The login ${boards.user} lost the right to make a database or a role.`,
    ready: `The login ${boards.user} has no right to make a database or a role.`,
  }[boards.login]);
} catch (error) {
  console.error(`Database bootstrap failed: ${String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[database]')}`);
  process.exitCode = 1;
} finally { await sql.end({ timeout: 5 }).catch(() => {}); await connection.close(); }
