import { serve } from '@hono/node-server';
import { shutdownAnalytics } from './analytics';
import { createApp } from './app';
import { seedLocalUser } from './local-auth';
import { localMode } from './localmode';
import { startMemoryMaintenance } from './maintenance';
import { PostgresStore } from './pgstore';
import { expoFetchSender, PushService } from './push';
import { MemoryStore } from './store';

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '0.0.0.0';
const dbUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_POOLER_URL ?? process.env.SUPABASE_DB_URL;
const store = dbUrl ? new PostgresStore(dbUrl) : new MemoryStore();
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

serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`control-api listening on ${hostname}:${info.port} (${dbUrl ? 'postgres' : 'memory'} store)`);
  startMemoryMaintenance(store); // NM_EMBED-gated: warm the embedder, then backfill NULL embeddings
});

// flush queued activation telemetry before the process exits (no-op without POSTHOG_KEY)
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => { void shutdownAnalytics().finally(() => process.exit(0)); });
}
