// Build-time generator for the bundled default skill packs. Clones the source
// repos (MIT — gstack + addyosmani/agent-skills), walks **/SKILL.md, parses
// frontmatter + body with the shared parser, captures the HEAD commit, and
// writes packages/control-api/src/seed/skill-seed.ts (committed) + a manifest
// (skill-seed.manifest.md) — the local log of which third-party skills we ship,
// so an upgrade is an easy diff. Re-run on app release to refresh the defaults.
//
//   pnpm --filter @neuramesh/control-api gen:skill-seed
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { parseSkillFiles, type ParsedSkill } from '@neuramesh/shared';

// gstack ships ~59 skills, most of them gstack-product-specific (browser, gbrain,
// ios, deploy/queue tooling, meta). We curate to the engineering-methodology
// skills that are genuinely useful to a NeuraMesh agent. Edit this allowlist to
// change what ships. addyosmani's 24 lifecycle skills are all relevant → no filter.
const GSTACK_ALLOW = new Set([
  'investigate', // root-cause debugging
  'review', // pre-landing diff review
  'plan-ceo-review', // scope/strategy review of a plan
  'plan-eng-review', // architecture/edge-case review of a plan
  'plan-design-review', // design review of a plan
  'plan-devex-review', // developer-experience review of a plan
  'qa', // systematic QA test + fix
  'qa-only', // QA report (no fix)
  'design-review', // visual QA of a built UI
  'document-generate', // write missing docs
  'document-release', // post-ship doc sync
  'health', // code-quality dashboard
  'retro', // engineering retrospective
  'cso', // security audit
]);

const SOURCES: Array<{ name: string; description: string; url: string; ref: string; allow?: Set<string>; companions?: boolean }> = [
  { name: 'gstack', description: 'GStack — curated engineering skills (plan/design reviews, QA, docs, security).', url: 'https://github.com/garrytan/gstack', ref: 'main', allow: GSTACK_ALLOW },
  { name: 'agent-skills', description: 'Addy Osmani — lifecycle agent skills (spec, build, test, review, ship).', url: 'https://github.com/addyosmani/agent-skills', ref: 'main' },
  // companions: review-animations tells the agent to "load STANDARDS.md for precise
  // values" — NeuraMesh skills are single-body, so sibling .md references are inlined.
  { name: 'design-craft', description: 'Emil Kowalski — design-engineering craft: animation taste, UI polish, motion review (animations.dev).', url: 'https://github.com/emilkowalski/skills', ref: 'main', companions: true },
];

function walkSkillFiles(root: string): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const recurse = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) recurse(full);
      else if (ent.name === 'SKILL.md') out.push({ path: relative(root, full), content: readFileSync(full, 'utf8') });
    }
  };
  recurse(root);
  return out;
}

const CAP = 32_000; // cap bodies so the seed + per-member sync stay light + agent-loadable

interface Built {
  pack: { name: string; description: string; source_url: string; source_ref: string; version: string };
  skills: ParsedSkill[];
  excluded: string[];
}

// Opt-in (per source): a SKILL.md may reference sibling reference files ("load
// STANDARDS.md for the exact values") — NeuraMesh skills are ONE body, so inline
// each sibling .md under a labeled divider. Content stays verbatim; the divider
// makes "see STANDARDS.md" resolve to the section below. The 32KB cap still guards.
function inlineCompanions(root: string, files: Array<{ path: string; content: string }>): Array<{ path: string; content: string }> {
  return files.map((f) => {
    const dirOf = join(root, f.path, '..');
    const sibs = readdirSync(dirOf)
      .filter((n) => n !== 'SKILL.md' && n.toLowerCase().endsWith('.md'))
      .sort();
    if (!sibs.length) return f;
    const parts = sibs.map((n) => `\n\n---\n\n# ${n} (companion file — inlined; references to it above resolve here)\n\n${readFileSync(join(dirOf, n), 'utf8').trim()}`);
    return { ...f, content: `${f.content.trimEnd()}${parts.join('')}\n` };
  });
}

const built: Built[] = SOURCES.map((src) => {
  const dir = mkdtempSync(join(tmpdir(), `nm-seed-${src.name}-`));
  try {
    console.error(`cloning ${src.url} …`);
    execFileSync('git', ['clone', '--depth', '1', '--branch', src.ref, src.url, dir], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    const sha = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const files = walkSkillFiles(dir);
    const all = parseSkillFiles(src.companions ? inlineCompanions(dir, files) : files);
    const excluded = src.allow ? all.filter((s) => !src.allow!.has(s.name)).map((s) => s.name) : [];
    const kept = (src.allow ? all.filter((s) => src.allow!.has(s.name)) : all).map((s) =>
      s.body.length > CAP ? { ...s, body: `${s.body.slice(0, CAP)}\n\n…(truncated — full skill at ${src.url})` } : s,
    );
    console.error(`  ${src.name}: ${kept.length} kept${excluded.length ? ` / ${excluded.length} excluded` : ''} @ ${sha.slice(0, 7)}`);
    return { pack: { name: src.name, description: src.description, source_url: src.url, source_ref: src.ref, version: `bundled@${sha.slice(0, 12)}` }, skills: kept, excluded };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const packs = built.map(({ pack, skills }) => ({ pack, skills }));
const outDir = join(import.meta.dirname, '..', 'src', 'seed');
mkdirSync(outDir, { recursive: true });

const header = `// GENERATED by scripts/gen-skill-seed.ts — do not edit by hand.
// Bundled default skill packs (MIT: garrytan/gstack, addyosmani/agent-skills,
// emilkowalski/skills — see NOTICE). Inserted into a workspace's #dev channel at
// creation + backfilled into existing #dev channels by the host reconciler.
// Refreshed on app release. Included/excluded skills: skill-seed.manifest.md.
import type { ParsedSkill } from '@neuramesh/shared';

export interface SeedPack {
  pack: { name: string; description: string; source_url: string; source_ref: string; version: string };
  skills: ParsedSkill[];
}

export const SKILL_SEED: SeedPack[] = ${JSON.stringify(packs, null, 2)};
`;
writeFileSync(join(outDir, 'skill-seed.ts'), header);

// the local log of third-party skills we ship — diff this on upgrade
const today = new Date().toISOString().slice(0, 10);
const manifest = `# Bundled skill packs — manifest

Generated ${today} by \`pnpm --filter @neuramesh/control-api gen:skill-seed\`.
This is the local log of third-party skills NeuraMesh ships as defaults — diff it
when upgrading a pack to see what was added / removed / curated. Bodies capped at
${CAP.toLocaleString()} chars. Licenses + copyright: see /NOTICE.

${built
  .map(
    (b) => `## ${b.pack.name} — ${b.pack.version}

Source: ${b.pack.source_url} (${b.pack.source_ref})

**Included (${b.skills.length}):**
${b.skills.map((s) => `- \`${s.name}\` — ${s.description}`).join('\n')}
${b.excluded.length ? `\n**Excluded (${b.excluded.length}, not relevant to NeuraMesh agents):**\n${b.excluded.map((n) => `- \`${n}\``).join('\n')}\n` : ''}`,
  )
  .join('\n')}`;
writeFileSync(join(outDir, 'skill-seed.manifest.md'), manifest);

const total = packs.reduce((n, p) => n + p.skills.length, 0);
console.error(`wrote ${packs.length} packs / ${total} skills → src/seed/skill-seed.ts (+ manifest)`);
