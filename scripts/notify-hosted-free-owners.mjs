#!/usr/bin/env node
// Tell every owner of a hosted free workspace what changes on 2026-09-29 (source release
// 2026-09, unit U1b, decision D12). The founder runs it ONCE on 2026-09-15.
//
//   DATABASE_URL=postgres://... node scripts/notify-hosted-free-owners.mjs          # dry run: lists owners
//   DATABASE_URL=postgres://... node scripts/notify-hosted-free-owners.mjs --send   # sends, once per owner
//
// WHAT. Every workspace with plan = 'free' in the hosted database, grouped by its owner. One email
// per owner (an owner of three free workspaces gets one email that names all three). The template
// is renderHostedFreeNotice in @neuramesh/shared (`pnpm mail:preview` renders it as hostedFreeNotice).
//
// IDEMPOTENT. --send writes an `emails` outbox row per owner first, keyed
// hosted_free_notice:2026-09-29:<user id> (UNIQUE), then hands it to Resend through mail.ts. A
// second run finds every key taken and sends nothing. NM_MAIL_DRY_RUN=1 records the rows and skips
// the transport, which is how the pg lane tests it. RESEND_API_KEY unset does the same.
//
// The logic lives in packages/control-api/src/hosted-notice.ts (TypeScript); this launcher loads
// tsx from the control-api's own devDependencies so a .mjs can import it.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../packages/control-api/package.json', import.meta.url));
const { register } = await import(require.resolve('tsx/esm/api'));
register();

const send = process.argv.includes('--send');
const url = process.env.DATABASE_URL || '';
if (!url) {
  console.error('DATABASE_URL is not set. Point it at the hosted database and run again.');
  process.exit(2);
}

const { PostgresStore } = await import('../packages/control-api/src/pgstore.ts');
const { notifyHostedFreeOwners, HOSTED_FREE_NOTICE_EFFECTIVE } = await import('../packages/control-api/src/hosted-notice.ts');

const store = new PostgresStore(url);
try {
  const { owners, noAddress, outcomes } = await notifyHostedFreeOwners(store, store.sql, { send });
  const workspaces = owners.reduce((n, o) => n + o.workspaces.length, 0);
  console.log(`${owners.length} owner(s) of ${workspaces} free hosted workspace(s). Effective ${HOSTED_FREE_NOTICE_EFFECTIVE}.${noAddress ? ` ${noAddress} workspace(s) skipped: owner has no email address.` : ''}`);
  for (const o of owners) {
    const outcome = outcomes.find((x) => x.email === o.email)?.outcome ?? 'listed';
    console.log(`  ${outcome.padEnd(9)} ${o.email}  ${o.workspaces.map((w) => w.slug).join(', ')}`);
  }
  if (!send) {
    console.log(`Dry run. ${owners.length} email(s) would be sent. Re-run with --send to send them.`);
  } else {
    const tally = outcomes.reduce((t, x) => ({ ...t, [x.outcome]: (t[x.outcome] ?? 0) + 1 }), {});
    console.log(`Done: ${Object.entries(tally).map(([k, v]) => `${v} ${k}`).join(', ')}.`);
  }
} finally {
  await store.close().catch(() => {});
}
