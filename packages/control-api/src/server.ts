import { serve } from '@hono/node-server';
import { shutdownAnalytics } from './analytics';
import { createApp } from './app';
import { e2eRoutes, e2eRoutesOn } from './e2e-routes';
import { e2eMachineDoors } from './e2e-machine-doors';
import { parseInprocCrons, startInprocCrons } from './inproc-crons';
import { seedLocalUser } from './local-auth';
import { localMode } from './localmode';
import { startMemoryMaintenance } from './maintenance';
import { PostgresStore } from './pgstore';
import { expoFetchSender, PushService } from './push';
import { MemoryStore } from './store';
import { assertProductionConfig } from './production-config';
import { startCloudSql } from '../scripts/cloudsql.mjs';
import { assertRuntimeRole } from '../scripts/db-runtime.mjs';

assertProductionConfig();
const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '0.0.0.0';
const dbUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_POOLER_URL ?? process.env.SUPABASE_DB_URL;
const cloudSql = await startCloudSql();
const store = dbUrl ? new PostgresStore(dbUrl, cloudSql.path) : new MemoryStore();
if (process.env['NM_DEPLOYMENT'] === 'production') {
  if (!(store instanceof PostgresStore)) throw new Error('Production requires PostgreSQL');
  await assertRuntimeRole(store.sql);
  const migration = process.env['NM_REQUIRED_MIGRATION']!;
  const rows = await store.sql`select name from schema_migrations where name = ${migration}`;
  if (rows.length !== 1) throw new Error(`Production database has not applied ${migration}`);
}
// the local stack's one human, seeded BEFORE the port opens: a stack nobody can sign in to must
// not report healthy (local-auth.ts — idempotent, and a re-minted bearer lands on the next boot)
if (localMode()) {
  await seedLocalUser(store).catch((e: unknown) => {
    console.error(`[local] boot refused: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
const push = process.env.PUSH_ENABLED === '0' ? undefined : new PushService(store, expoFetchSender(process.env.EXPO_ACCESS_TOKEN));
const app = createApp(store, { push });
// the Cloud Run end-to-end test's doors (e2e-routes.ts): only on this entry, only with NM_E2E_ROUTES=1,
// and each still needs the fleet secret. Vercel's entry (vercel.ts) never mounts them.
if (e2eRoutesOn()) {
  e2eRoutes(app, store);
  e2eMachineDoors(app, store);
  console.warn('[e2e] NM_E2E_ROUTES=1: the /internal/e2e/* and machine drain test doors are mounted (fleet secret required). Never on a deploy real people use.');
}
// a long-running host runs Vercel's crons itself when told to (inproc-crons.ts); unset starts nothing
const crons = parseInprocCrons(process.env['NM_INPROC_CRONS']);

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`control-api listening on ${hostname}:${info.port} (${dbUrl ? 'postgres' : 'memory'} store)`);
  startMemoryMaintenance(store); // NM_EMBED-gated: warm the embedder, then backfill NULL embeddings
  startInprocCrons(crons, (path, init) => app.request(path, init));
});

// flush queued activation telemetry before the process exits (no-op without POSTHOG_KEY)
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => { void shutdownAnalytics().finally(() => cloudSql.close()).finally(() => process.exit(0)); });
}
