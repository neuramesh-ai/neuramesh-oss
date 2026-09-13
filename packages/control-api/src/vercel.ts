// Vercel serverless entry, pre-bundled by esbuild (see package.json `build:vercel`
// + vercel.json `buildCommand`). We do NOT ship raw TS to Vercel: its Hono build
// tsc-compiles with NodeNext resolution, which rejects this monorepo's
// bundler-style (extensionless) imports and can't resolve @neuramesh/shared.
// esbuild bundles this entry + our src + @neuramesh/shared into a single ESM JS
// file (api/index.js) that Vercel deploys verbatim — no tsc. fastembed/onnxruntime
// are externalised (+ a computed import in embedder.ts) so the ~500MB native dep
// never enters the function bundle (it's unused on Vercel; NM_EMBED off → FTS recall).
import { createApp } from './app';
import { PostgresStore } from './pgstore';
import { expoFetchSender, PushService } from './push';
import { MemoryStore } from './store';

// Native Vercel-Hono entry: export the raw Hono app and let Vercel's Hono preset
// turn its routes into Functions automatically (no api/ + handle + rewrite). esbuild
// pre-bundles this to the root index.js (a Hono-preset-detected location) so Vercel
// deploys plain JS — never tsc-ing our bundler-resolution source.
const dbUrl =
  process.env['DATABASE_URL'] ?? process.env['SUPABASE_DB_POOLER_URL'] ?? process.env['SUPABASE_DB_URL'];
const store = dbUrl ? new PostgresStore(dbUrl) : new MemoryStore();
const push = process.env['PUSH_ENABLED'] === '0' ? undefined : new PushService(store, expoFetchSender(process.env['EXPO_ACCESS_TOKEN']));

export default createApp(store, { push });
