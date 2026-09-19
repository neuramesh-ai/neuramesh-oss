#!/usr/bin/env node
// WHICH SURFACES A CHANGE TOUCHES — the classifier every pull request runs (George, 2026-09-19,
// after #548 took the live web app down at boot while every unit suite was green: "any new
// release going forward is assessed for impact on web, desktop, mobile, and runs the appropriate
// end-to-end test").
//
//   node scripts/impact.mjs                 # the diff against origin/main
//   node scripts/impact.mjs <base> [head]   # a range
//   node scripts/impact.mjs --paths a b c   # explicit paths (tests, dry runs)
//
// It answers with the surfaces (web · desktop · mobile · cloud · api) and, for each, the path that
// implicated it. The workflow (.github/workflows/surface-e2e.yml) turns the answer into jobs. The
// rules are DATA, and deliberately broad: a shared package reaches every client, and the daemon
// runs on the desktop and on every cloud machine. Missing a surface is the failure this exists to
// end, so a doubtful path implicates rather than exempts.
import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** the surfaces, in the order the report lists them */
export const SURFACES = ['web', 'desktop', 'mobile', 'cloud', 'api'];

/** prefix (or exact path) → surfaces. The FIRST match that implicates wins nothing: every rule applies. */
export const RULES = [
  // the browser client and the site
  { prefix: 'apps/desktop/src/renderer/', surfaces: ['web', 'desktop'] },
  { prefix: 'apps/desktop/src/preload/', surfaces: ['desktop'] },
  { prefix: 'apps/desktop/vite.web.config.mts', surfaces: ['web'] },
  { prefix: 'apps/desktop/index.html', surfaces: ['desktop'] },
  { prefix: 'apps/web/', surfaces: ['web'] },
  // the daemon: the desktop app and every cloud machine run it
  { prefix: 'apps/desktop/src/main/', surfaces: ['desktop', 'cloud'] },
  { prefix: 'apps/desktop/resources/', surfaces: ['desktop'] },
  { prefix: 'apps/desktop/electron.vite.config', surfaces: ['desktop'] },
  { prefix: 'apps/desktop/package.json', surfaces: ['desktop', 'cloud'] },
  { prefix: 'infra/images/machine/', surfaces: ['cloud'] },
  // packages every client carries
  { prefix: 'packages/shared/', surfaces: ['web', 'desktop', 'mobile', 'cloud', 'api'] },
  { prefix: 'packages/client-core/', surfaces: ['web', 'desktop', 'mobile'] },
  { prefix: 'packages/fonts/', surfaces: ['web', 'desktop'] },
  { prefix: 'packages/relay-client/', surfaces: ['web', 'desktop'] },
  // the phone
  { prefix: 'apps/mobile/', surfaces: ['mobile'] },
  // the server and its schema
  { prefix: 'packages/control-api/', surfaces: ['api'] },
  { prefix: 'packages/relay/', surfaces: ['api'] },
  { prefix: 'packages/fleet/', surfaces: ['cloud'] },
  { prefix: 'supabase/', surfaces: ['api'] },
  { prefix: 'dev/stack/', surfaces: ['api'] },
  // the lockfile moves every runtime
  { prefix: 'pnpm-lock.yaml', surfaces: ['web', 'desktop', 'mobile', 'cloud', 'api'] },
  // the checks themselves: a change here re-runs everything, so a broken check cannot hide
  { prefix: '.github/workflows/surface-e2e.yml', surfaces: ['web', 'desktop', 'mobile', 'cloud', 'api'] },
  { prefix: 'scripts/web-boot-e2e.mjs', surfaces: ['web'] },
  { prefix: 'scripts/impact.mjs', surfaces: ['web', 'desktop', 'mobile', 'cloud', 'api'] },
];

/** paths that never implicate a surface, whatever else they match */
const INERT = [/^docs\//, /\.md$/, /^\.claude\//, /^mockups\//, /^\.nm-evidence\//, /(^|\/)evidence\//, /\.test\.(ts|tsx|mjs|js)$/, /\.pg\.test\.ts$/];

/** the surfaces a set of changed paths touches, each with the path that implicated it first */
export function classify(paths) {
  const hit = Object.fromEntries(SURFACES.map((s) => [s, null]));
  for (const raw of paths) {
    const p = raw.trim();
    if (!p || INERT.some((r) => r.test(p))) continue;
    for (const rule of RULES) {
      if (!p.startsWith(rule.prefix)) continue;
      for (const s of rule.surfaces) if (!hit[s]) hit[s] = p;
    }
  }
  return { surfaces: Object.fromEntries(SURFACES.map((s) => [s, !!hit[s]])), why: hit };
}

function changedPaths(base, head) {
  const range = head ? `${base}...${head}` : `${base}...HEAD`;
  const out = execSync(`git diff --name-only ${range}`, { encoding: 'utf8' });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function main() {
  const args = process.argv.slice(2);
  let paths;
  if (args[0] === '--paths') paths = args.slice(1);
  else {
    const base = args[0] ?? 'origin/main';
    try { paths = changedPaths(base, args[1]); } catch (e) { console.error(`[impact] cannot diff against ${base}: ${e instanceof Error ? e.message : String(e)}`); process.exit(2); }
  }
  const r = classify(paths);
  console.log(JSON.stringify({ changed: paths.length, ...r }, null, 2));
  // GitHub Actions: one output per surface, read by the workflow's `if:`
  const out = process.env['GITHUB_OUTPUT'];
  if (out) for (const s of SURFACES) appendFileSync(out, `${s}=${r.surfaces[s] ? 'true' : 'false'}\n`);
  const touched = SURFACES.filter((s) => r.surfaces[s]);
  console.error(`[impact] ${paths.length} path(s) → ${touched.length ? touched.join(' · ') : 'no surface'}`);
}

if (process.argv[1] && process.argv[1].endsWith('impact.mjs')) main();
