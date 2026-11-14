// THE REFERENCE BUILD RULE for the offline intake eval (scripts/e2e-cloudrun/intake-evals.mjs --offline).
//
// The intake service has its own deterministic rule for the case where the starter brain is not
// available (round 9 brief: "a deterministic rule decides the clear build asks"). The offline eval scores
// THAT rule when it can load it (--rule=<module>). This file is the baseline it falls back to, and the
// shape every rule must have:
//
//   intakeRule(text, { repos }) -> { kind: 'coding', workspace: 'scratch' | 'repo', repoId? } | null
//
// null means "not a clear build ask": the starter brain or the agent decides. The rule must never send a
// question, a content ask or a research ask to coding. Pure, no dependencies.

const BUILD = /\b(build|make|create|code|write|implement|scaffold|develop|program|fix|add|refactor|upgrade|update)\b/i;
const THING = /\b(app|application|website|web ?site|page|landing page|game|script|tool|cli|command line|api|server|bot|extension|component|function|program|test|tests|calculator|timer|converter|generator|tracker|dashboard|form|bug|feature|repo|repository|readme|dependencies|login|dark mode|search box)\b/i;
const TECH = /\b(html|css|javascript|typescript|react|vue|svelte|node(\.js)?|express|python|rust|go|golang|java|kotlin|swift|sql)\b/i;
const QUESTION = /^(what|why|how|when|where|who|which|is|are|does|do|can you explain|explain|tell me)\b/i;
const NOT_CODE = /\b(post|tweet|tweets|newsletter|blog|linkedin|copy|announcement|email|research|compare|summari[sz]e|market|competitors?|whiteboard|diagram|roadmap|sketch|spec)\b/i;

export function intakeRule(text, { repos = [] } = {}) {
  const t = String(text ?? '').trim();
  if (!t || QUESTION.test(t) || t.endsWith('?') && !/^(can|could|will|would) you (build|make|create|code|write)/i.test(t)) return null;
  if (NOT_CODE.test(t) && !TECH.test(t)) return null;
  if (!BUILD.test(t) || !(THING.test(t) || TECH.test(t))) return null;
  const named = repos.find((r) => r?.name && new RegExp(`\\b${r.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
  return named ? { kind: 'coding', workspace: 'repo', repoId: named.id ?? null } : { kind: 'coding', workspace: 'scratch' };
}
