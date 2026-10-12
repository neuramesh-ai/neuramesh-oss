import { serve } from '@hono/node-server';
import { createApp } from './app';
import { brainIngress } from './brain-ingress';
import { PostgresStore } from './pgstore';

const db = process.env['DATABASE_URL'];
if (!db || !process.env['NM_BRAIN_GCS_BUCKET'] || !process.env['CLERK_PUBLISHABLE_KEY']) throw new Error('The brain API requires database, GCS and Clerk configuration.');
if (process.env['NM_LOCAL'] === '1' || process.env['NM_ALLOW_ACTOR_HEADER'] === '1' || process.env['NM_BRAIN_GCS_AUTH'] === 'gcloud') throw new Error('Development authentication is prohibited on the hosted brain API.');
const store = new PostgresStore(db);
const app = createApp(store);
const server = serve({ hostname: '0.0.0.0', port: Number(process.env['PORT'] ?? 8787),
  fetch: brainIngress(request => app.fetch(request), async () => {
    await store.sql`select 1 from brain_commits limit 0`;
  }),
}, () => console.log('brain-api listening'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  server.close(() => { void store.close().finally(() => process.exit(0)); });
});
