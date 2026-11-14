// THE INTAKE SCORER (round 9): pure, no network, no dependencies. intake-evals.mjs feeds it the labelled
// cases (evals/intake/cases.json) and what intake decided for each, and it says what passed.
//
//   clear coding  coding-greenfield + coding-repo: correct when the kind is `coding` AND the workspace
//                 is the expected one (scratch with no repository named, repo when one is). Target 95%.
//   questions     category `question`: a coding route is a failure, whatever else is right. Target 0.
//   others        content, research, board: kind accuracy, reported, not gated.
//   ambiguous     reported only. A case's `accept` list names the other kinds that are also right.
//
// A missing decision (intake did not run, or did not answer in time) is its own outcome, `missing`. It
// counts as wrong for clear coding, and it is not a coding route for a question (nothing routed).

export const TARGETS = { clearCoding: 0.95, questionCodingRoutes: 0 };
export const CLEAR_CODING = ['coding-greenfield', 'coding-repo'];

/** is this decision right for this case? `{ kind, workspace }` may be null (no decision) */
export function judge(c, got) {
  if (!got || !got.kind) return { ok: false, kindOk: false, workspaceOk: false, missing: true, codingRoute: false };
  const kinds = [c.expect.kind, ...(c.accept ?? [])];
  const kindOk = kinds.includes(got.kind);
  // the workspace matters only where the expected kind is coding: any non-coding kind must say none
  const wantWs = got.kind === 'coding' ? (c.expect.kind === 'coding' ? c.expect.workspace : null) : 'none';
  const workspaceOk = wantWs === null ? true : (got.workspace ?? 'none') === wantWs;
  const codingRoute = got.kind === 'coding';
  const strict = CLEAR_CODING.includes(c.category);
  const ok = strict ? got.kind === 'coding' && (got.workspace ?? 'none') === c.expect.workspace : kindOk && workspaceOk;
  return { ok, kindOk, workspaceOk, missing: false, codingRoute };
}

/**
 * Score every case. `results` maps a case id to `{ kind, workspace } | null`.
 * Returns the per-category tallies, the two gated numbers, and the failures with what was expected.
 */
export function score(cases, results) {
  const byCategory = {};
  const failures = [];
  let codingTotal = 0;
  let codingOk = 0;
  let questionRoutes = 0;
  for (const c of cases) {
    const got = results[c.id] ?? null;
    const j = judge(c, got);
    const cat = (byCategory[c.category] ??= { total: 0, ok: 0, missing: 0, codingRoutes: 0 });
    cat.total += 1;
    if (j.ok) cat.ok += 1;
    if (j.missing) cat.missing += 1;
    if (j.codingRoute) cat.codingRoutes += 1;
    if (CLEAR_CODING.includes(c.category)) { codingTotal += 1; if (j.ok) codingOk += 1; }
    if (c.category === 'question' && j.codingRoute) questionRoutes += 1;
    if (!j.ok) failures.push({ id: c.id, category: c.category, text: c.text, expect: c.expect, accept: c.accept ?? [], got, missing: j.missing });
  }
  for (const cat of Object.values(byCategory)) cat.accuracy = cat.total ? cat.ok / cat.total : null;
  const clearCoding = codingTotal ? codingOk / codingTotal : null;
  const gates = {
    clearCoding: { value: clearCoding, target: TARGETS.clearCoding, pass: clearCoding !== null && clearCoding >= TARGETS.clearCoding },
    questionCodingRoutes: { value: questionRoutes, target: TARGETS.questionCodingRoutes, pass: questionRoutes <= TARGETS.questionCodingRoutes },
  };
  return { cases: cases.length, byCategory, gates, pass: gates.clearCoding.pass && gates.questionCodingRoutes.pass, failures };
}

/**
 * The OFFLINE gate: the deterministic rule alone decides only the clear build asks and leaves the rest
 * to the agent (null). So it is held to no false coding routes on every non-coding category, and its
 * coding recall is reported rather than gated.
 */
export function scoreRule(cases, results) {
  const s = score(cases, results);
  const falseRoutes = cases.filter((c) => !CLEAR_CODING.includes(c.category) && c.category !== 'ambiguous' && results[c.id]?.kind === 'coding').map((c) => c.id);
  const coding = cases.filter((c) => CLEAR_CODING.includes(c.category));
  const recall = coding.length ? coding.filter((c) => results[c.id]?.kind === 'coding').length / coding.length : null;
  return { ...s, rule: { falseCodingRoutes: falseRoutes, codingRecall: recall }, pass: falseRoutes.length === 0 };
}

/** `{repo}` in a case's words becomes the repository the eval created */
export const fill = (text, repo) => text.replaceAll('{repo}', repo);

/** a short text table for the log */
export function table(s) {
  const rows = Object.entries(s.byCategory).map(([k, v]) => `  ${k.padEnd(18)} ${String(v.ok).padStart(3)}/${String(v.total).padEnd(3)} ${v.accuracy === null ? '' : `${Math.round(v.accuracy * 100)}%`.padStart(5)}  missing ${v.missing}  coding routes ${v.codingRoutes}`);
  const g = s.gates;
  rows.push(`  GATE clear coding ${g.clearCoding.value === null ? 'n/a' : `${Math.round(g.clearCoding.value * 1000) / 10}%`} (target ${g.clearCoding.target * 100}%) ${g.clearCoding.pass ? 'PASS' : 'FAIL'}`);
  rows.push(`  GATE question coding routes ${g.questionCodingRoutes.value} (target ${g.questionCodingRoutes.target}) ${g.questionCodingRoutes.pass ? 'PASS' : 'FAIL'}`);
  return rows.join('\n');
}
