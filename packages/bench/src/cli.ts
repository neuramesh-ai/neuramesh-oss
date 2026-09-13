// The benchmark CLI. Rerun with new models trivially:
//   pnpm bench --models claude-opus-4-8,gpt-5.5,gemini-3.5-flash --roles reviewer --runs 10
// It iterates the @neuramesh/shared catalog, runs each role's suite, aggregates with Wilson
// CIs, and writes the web-schema JSON the page reads. On a missing credential it stops with a
// clear message and writes NOTHING — the harness never fabricates a result.
import { developerRole, reviewerRole } from './roles';
import { judgeSpendTotal, judgedRole, orchestratorRole } from './roles-judged';
import { skippedModels } from './skips';
import { mergeSkips, mergeWithPrior, readPrior } from './merge';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveModels } from './catalog';
import { SUITE_VERSION, assembleReport } from './report';
import { NoCredError } from './runtime';
import type { ModelRoleAggregate, RoleId } from './types';

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/**
 * The commit the fixtures were pinned at. `git rev-parse` beats a hand-set env var, and beats the
 * old default, which was the literal string 'measured' in a field meant to hold a sha.
 */
function suiteSha(): string {
  const set = process.env['NM_BENCH_SHA'];
  if (set) return set;
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: HERE, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}






// Reconstruct prior per-model aggregates from an existing report (its leaderboard rows ARE
// aggregates), so a partial re-run can merge instead of clobbering the rest.
//
// A row may only merge into a report of the SAME suite version. Rows from an older suite were
// produced by different adapters, prices and judges, so mixing them publishes one leaderboard whose
// numbers were never comparable — the same reason the judge roster is frozen inside a version.
// Crossing a version boundary starts the file clean, which is the honest thing to do.
/** every role the harness knows, which is what --smoke exercises */
const ALL_ROLES: RoleId[] = ['reviewer', 'developer', 'research', 'architect', 'orchestrator'];

/**
 * Re-assemble the published report from the rows it already holds, measuring nothing.
 *
 * The pack cards and the per-role winner are DERIVED from the live catalog and the seat rules, not
 * from the measurement, so a seat change makes them stale while every number stays correct. Before
 * this the only way to refresh them was to re-run the whole suite, which costs real money to
 * recompute something that needs no model at all.
 */
function reportOnly(out: string): void {
  const prior = readPrior(out, SUITE_VERSION);
  if (!prior?.roles?.length) {
    console.error(`✗ ${out} has no suite ${SUITE_VERSION} rows to re-assemble.`);
    process.exit(1);
  }
  const rows: Partial<Record<RoleId, ModelRoleAggregate[]>> = {};
  for (const role of prior.roles) rows[role.id as RoleId] = role.leaderboard;
  const meta = prior.meta ?? {};
  const report = assembleReport(rows, {
    runsPerTask: 0,
    // provenance belongs to the RUN that produced the numbers, so it is carried, never restamped
    suiteSha: meta.suiteSha ?? suiteSha(),
    generatedAt: meta.generatedAt ?? new Date().toISOString().slice(0, 10),
    judgeSpendUsd: meta.judgeSpendUsd ?? 0,
    skipped: meta.skipped ?? [],
  });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(`✓ re-assembled ${out} from its existing rows (packs and winners refreshed, nothing measured)`);
}

async function main(): Promise<void> {
  // --smoke: every model in every role, one task, one run, written nowhere. It costs a few dollars
  // and it catches the failures that used to surface only after a full paid run: a rejected
  // parameter, a model the account cannot serve, an expired key.
  const smoke = flag('smoke');
  if (flag('report-only')) {
    reportOnly(resolve(arg('out') ?? resolve(HERE, '../../../apps/web/src/benchmarks.v1.json')));
    return;
  }
  const models = resolveModels(arg('models'));
  const roles = smoke ? ALL_ROLES : ((arg('roles', 'reviewer') ?? 'reviewer').split(',').map((s) => s.trim()) as RoleId[]);
  const runs = smoke ? 1 : Math.max(1, Number(arg('runs', '10')));
  const limit = smoke ? 1 : arg('tasks') ? Number(arg('tasks')) : undefined;
  const out = resolve(arg('out') ?? resolve(HERE, '../../../apps/web/src/benchmarks.v1.json'));
  if (smoke) console.log('SMOKE: 1 task × 1 run per (model, role). Nothing is written.\n');

  console.log(`models: ${models.map((m) => m.id).join(', ')}\nroles: ${roles.join(', ')}\n`);
  const roleAggs: Partial<Record<RoleId, ModelRoleAggregate[]>> = {};
  try {
    for (const role of roles) {
      if (role === 'reviewer') roleAggs.reviewer = await reviewerRole(models, runs, limit);
      else if (role === 'developer') roleAggs.developer = await developerRole(models, runs, limit);
      else if (role === 'research') roleAggs.research = await judgedRole('research', models, runs, limit);
      else if (role === 'architect') roleAggs.architect = await judgedRole('architect', models, runs, limit);
      else if (role === 'orchestrator') roleAggs.orchestrator = await orchestratorRole(models, runs, limit);
      else console.warn(`role '${role}' is not a known role — skipping (see docs/11-model-benchmarks.md).`);
    }
  } catch (e) {
    if (e instanceof NoCredError) {
      console.error(`\n✗ ${e.message}\n  No data written — the harness never fabricates results. Export the key(s) and re-run.`);
      process.exit(2);
    }
    throw e;
  }
  if (!Object.values(roleAggs).some((a) => a && a.length)) {
    console.error('no roles produced results — nothing to write.');
    process.exit(1);
  }
  const spend = judgeSpendTotal();
  const merged = mergeWithPrior(out, roleAggs, SUITE_VERSION);
  const skipped = smoke ? skippedModels() : mergeSkips(readPrior(out, SUITE_VERSION)?.meta?.skipped ?? [], skippedModels(), merged);
  if (!smoke) {
    const report = assembleReport(merged, {
      runsPerTask: runs,
      suiteSha: suiteSha(),
      generatedAt: new Date().toISOString().slice(0, 10),
      judgeSpendUsd: spend,
      skipped,
    });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
    console.log(`\n✓ wrote ${out}`);
  }
  if (spend > 0) console.log(`  (cross-family judge spend: $${spend.toFixed(2)})`);

  // A partial board that reads as complete is the failure this guards. The report is still
  // written (the rows that DID measure are real), but the run ends non-zero and says what is
  // missing, so nobody publishes it by accident.
  if (skipped.length) {
    console.error(`\n${skipped.length} (model, role) pair(s) produced NO row:`);
    for (const s of skipped) console.error(`  INCOMPLETE: ${s.model} ${s.role} — ${s.reason}`);
    console.error('\nFix the cause or drop the model from the roster, then re-run those pairs (a partial run merges).');
    process.exit(3);
  }
  if (smoke) console.log('\n✓ smoke clean — every model answered in every role.');
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
