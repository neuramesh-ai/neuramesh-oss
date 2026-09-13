#!/usr/bin/env node
// Remove the parked runners of Free workspaces (source release, 2026-09-12, unit U1a).
//
//   DATABASE_URL=postgres://... node scripts/tombstone-free-runners.mjs            # dry run: lists
//   DATABASE_URL=postgres://... node scripts/tombstone-free-runners.mjs --apply    # deletes the rows
//
// WHY. Before the source release every workspace was born with a cloud runner, so the fleet
// carries one StatefulSet and one PersistentVolumeClaim per Free workspace, most of them parked
// (desired_replicas = 0) and every one of them a disk we pay for. Free has no cloud machine any
// more: the runner is minted by the Stripe webhook when a workspace flips to Pro (plan-flip.ts).
//
// WHAT. A parked `kind = 'runner'` row on a `plan = 'free'` workspace is DELETED, not tombstoned:
// `machines_one_runner` (0126) is unique on (workspace_id) where kind = 'runner' with no lifecycle
// exclusion, so a row marked 'destroyed' would still block the runner a later Pro flip mints.
// Every foreign key onto machines cascades or nulls (0001, 0045, 0114, 0134, 0135). The fleet
// operator's next poll no longer sees the machine in the desired feed and deletes the
// StatefulSet, the token Secret and — deliberately — the PVC (packages/fleet/src/plan.ts, the
// "removed machines" pass). An AWAKE runner (desired_replicas = 1) is listed and left alone: park
// it first (or let the zero-balance sweep do it), then run again.
//
// Run it ONCE after the U1a deploy, against the hosted database. Dry run by default; nothing is
// written without --apply.
import { createRequire } from 'node:module';

// `postgres` is the control-api's dependency; resolve it from there rather than hoisting it.
const require = createRequire(new URL('../packages/control-api/package.json', import.meta.url));
const postgres = (await import(require.resolve('postgres'))).default;

const apply = process.argv.includes('--apply');
const url = process.env.DATABASE_URL || '';
if (!url) {
  console.error('DATABASE_URL is not set. Point it at the hosted database and run again.');
  process.exit(2);
}

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 30, prepare: false });
try {
  const rows = await sql`
    select m.id, m.name, m.lifecycle, m.desired_replicas, m.created_at, w.id as workspace_id, w.slug
      from machines m join workspaces w on w.id = m.workspace_id
     where m.kind = 'runner' and w.plan = 'free'
     order by w.slug, m.created_at`;
  const parked = rows.filter((r) => Number(r.desired_replicas) === 0);
  const awake = rows.filter((r) => Number(r.desired_replicas) !== 0);

  console.log(`${rows.length} runner row(s) on free workspaces: ${parked.length} parked, ${awake.length} awake.`);
  for (const r of parked) {
    console.log(`  parked  ${r.id}  ${r.slug}  ${r.name}  lifecycle=${r.lifecycle ?? 'null'}  created=${new Date(r.created_at).toISOString().slice(0, 10)}`);
  }
  for (const r of awake) {
    console.log(`  AWAKE   ${r.id}  ${r.slug}  ${r.name}  lifecycle=${r.lifecycle ?? 'null'}  (left alone: park it first)`);
  }

  if (parked.length === 0) {
    console.log('Nothing to remove.');
  } else if (!apply) {
    console.log(`Dry run. ${parked.length} row(s) would be deleted. Re-run with --apply to delete them.`);
  } else {
    const ids = parked.map((r) => r.id);
    const gone = await sql`delete from machines where id = any(${ids}::uuid[]) and kind = 'runner' and desired_replicas = 0 returning id`;
    console.log(`Deleted ${gone.length} runner row(s). The fleet operator removes their StatefulSets, Secrets and PVCs on its next poll.`);
  }
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
