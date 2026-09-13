// The plan-words gate: TWO PLANS, Free and Pro (shared/entitlements.ts PLAN_LABELS). Every plan
// word the renderer shows reads planLabel(), so the old names (Individual, Team) and the retired
// three-project cap (PROJECT_CAP, projectCap, atCap) can never come back through a literal.
// The onboarding "Team" STEP and "Team brains" are not plan names and stay.
// Run from apps/desktop:  pnpm exec tsx --test src/renderer/src/plan-words.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const RENDERER = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SOURCES = readdirSync(RENDERER, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && /\.(tsx?|css|html)$/.test(d.name) && !d.name.endsWith('.test.ts'))
  .map((d) => join(d.parentPath, d.name))
  .filter((p) => p !== SELF && !p.includes('/public/'));

/** a plan word: the old plan names in the positions a plan name takes, and the cap symbols */
const BANNED: Array<[string, RegExp]> = [
  ['the retired project cap', /\bPROJECT_CAP\b|\bprojectCap\b|\batCap\b/],
  ['the old plan name Individual', /\bIndividual\b/],
  ['the old plan name Team', /\bTeam\s*·|\bGo Team\b|Upgrade to Team|\bgo Team\b|\bTeam feature\b|\b(with|to|on|for) Team\b|\bTeam (for|when|connects)\b|>Team</],
  ['a plan pill that is not planLabel()', /className="gatelock">(Team|Cloud|Individual|Pro|Free)</],
];

test('the renderer has sources to scan', () => {
  assert.ok(SOURCES.length > 100, `scanned ${SOURCES.length} files`);
});

for (const [what, re] of BANNED) {
  test(`no source carries ${what}`, () => {
    const hits = SOURCES.flatMap((p) => {
      const lines = readFileSync(p, 'utf8').split('\n');
      return lines.flatMap((l, i) => (re.test(l) ? [`${p.slice(RENDERER.length)}:${i + 1}: ${l.trim().slice(0, 120)}`] : []));
    });
    assert.deepEqual(hits, [], hits.join('\n'));
  });
}
