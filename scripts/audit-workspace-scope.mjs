#!/usr/bin/env node
// Every replica query must be scoped to ONE workspace (0113).
//
// Why this exists: the PowerSync sync rules are plural — `workspace_id in (select workspace_id
// from my_workspaces)` — so a person in two workspaces has BOTH sets of rows in the one local
// replica. Any query that forgets to filter therefore mixes them, and the symptom is another
// workspace's threads quietly appearing in Home, Recents, ⌘Y and the rail.
//
// The audit is only worth trusting if it can fail. `--self-test` injects a known-bad query and
// requires the checker to catch it — an audit whose matcher silently matches nothing reports
// SUCCESS, which is a failure mode this repo has hit before.
//
//   node scripts/audit-workspace-scope.mjs             # audit; non-zero on an unscoped query
//   node scripts/audit-workspace-scope.mjs --self-test # prove the checker catches a plant
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';

// Desktop reads the replica through db.watch/getAll in main; mobile reads it through
// PowerSync's useQuery in the screens. Both hit the SAME multi-workspace replica, so both get
// audited — mobile had MORE unscoped queries than desktop when the switcher landed (the Team
// tab, the capture channel picker, the project switcher, #ref linkify).
const FILES = [
  'apps/desktop/src/main/sync.ts',
  ...globSync('apps/mobile/app/**/*.tsx'),
  ...globSync('apps/mobile/src/*.tsx'),
];

// tables the sync rules stream per-workspace (dev/stack/powersync/sync-config.yaml)
const WS_TABLES = new Set([
  'channels', 'projects', 'messages', 'threads', 'tasks', 'machines', 'agents', 'repos',
  'artifacts', 'beats', 'runs', 'decisions', 'policies', 'memory_blocks', 'skills',
  'skill_packs', 'schedules', 'content_items', 'connectors', 'workspace_members', 'whiteboards',
]);

// Queries inside smokeSync() are the dev self-test harness driving a seeded workspace, not
// surfaces a user reads. Scoping them would be noise.
const HARNESS_FROM = /^(export )?async function smokeSync\(/m;

// The ONE query that cannot be workspace-scoped, because it is what discovers which workspaces
// you belong to. Matched on its exact text rather than by file, so a second unscoped query
// cannot hide behind the same exemption. If you find yourself adding to this list, the fix is
// almost certainly a `workspace_id = ?` instead.
const EXEMPT = new Set([
  'select distinct workspace_id as id from workspace_members',
]);

function findUnscoped(src) {
  const harnessAt = src.search(HARNESS_FROM);
  const out = [];
  // desktop: db.watch(`…`) / getAll(`…`)   ·   mobile: useQuery('…') / useQuery(`…`)
  const re = /\b(?:db|activeDb|target)\.(?:watch|getAll|get|execute)\(\s*`([^`]*)`|\buseQuery(?:<[^>]*>)?\(\s*(?:`([^`]*)`|'([^']*)')/g;
  let m;
  while ((m = re.exec(src))) {
    if (harnessAt >= 0 && m.index > harnessAt) continue;
    const q = m[1] ?? m[2] ?? m[3];
    if (!/^\s*select/i.test(q.trim())) continue;
    const root = [...q.matchAll(/\b(?:from|join)\s+([a-z_]+)/gi)].map((x) => x[1])[0];
    if (!WS_TABLES.has(root)) continue;
    // scoped explicitly, or by transitivity through an id the caller supplies — a channel,
    // project, task or thread id already belongs to exactly one workspace, so filtering on one
    // cannot return another workspace's rows
    const scoped = /workspace_id\s*=/.test(q);
    const viaId = /\b(?:channel_id|project_id|task_id|thread_id|message_id|agent_id|repo_id|parent_task_id)\s*(?:=|in)\s*\?/.test(q)
      || /\bwhere\s+[a-z_.]*\bid\s*=\s*\?/.test(q)
      || /\bjoin\s+[a-z_]+\s+[a-z]+\s+on\s+[a-z.]+\s*=\s*\?/i.test(q);
    if (scoped || viaId) continue;
    const flat = q.replace(/\s+/g, ' ').trim();
    if (EXEMPT.has(flat)) continue;
    out.push({ line: src.slice(0, m.index).split('\n').length, root, q: flat.slice(0, 120) });
  }
  return out;
}

if (process.argv.includes('--self-test')) {
  // one plant per dialect — a matcher that only understands desktop's would pass mobile blind
  const plants = [
    { file: 'apps/desktop/src/main/sync.ts', code: '\n  db.watch(`select id, title from threads where archived_at is null`, [], {}, {});\n' },
    { file: 'apps/mobile/src/thread.tsx', code: "\n  useQuery<X>('select id, name from agents order by name');\n" },
  ];
  for (const p of plants) {
    const src = readFileSync(p.file, 'utf8');
    // Spliced BEFORE smokeSync, not appended: appending lands the plant inside the harness
    // region the audit deliberately skips, so the self-test would "pass" by never testing
    // anything. That is the exact failure this mechanism exists to rule out — and it happened
    // on the very first run.
    const at = src.search(HARNESS_FROM);
    const planted = at >= 0 ? src.slice(0, at) + p.code + src.slice(at) : src + p.code;
    if (!findUnscoped(planted).length) {
      console.error(`SELF-TEST FAILED: the checker did not catch a planted unscoped query in ${p.file}.`);
      console.error('The audit cannot be trusted — a matcher that matches nothing reports success.');
      process.exit(2);
    }
  }
  console.log(`self-test OK — the checker catches a planted unscoped query in both dialects`);
}

let total = 0;
for (const file of FILES) {
  const hits = findUnscoped(readFileSync(file, 'utf8'));
  for (const h of hits) console.error(`  ${file}:${h.line}  [${h.root}]  ${h.q}`);
  total += hits.length;
}
if (total) {
  console.error(`\n${total} replica quer${total === 1 ? 'y is' : 'ies are'} not scoped to a workspace (listed above).`);
  console.error('Add `workspace_id = ?`, or scope through a channel/project/task id.\n');
  process.exit(1);
}
console.log(`workspace scope OK — every replica query across ${FILES.length} files is scoped`);
