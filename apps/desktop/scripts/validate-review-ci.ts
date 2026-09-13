// Controlled validation for the review→rework CI-bounce fix (the #1013 loop).
//
// The bug: scout's LLM Definition-of-Done reviewer independently re-judged CI. When a DoD
// says "open a PR and CI must pass", the reviewer couldn't verify CI from the artifacts/summary,
// declared that item UNMET, and requested changes — even though the host's structural gate had
// already settled CI. The developer then looped: re-doing work to satisfy a check it had no way
// to influence from the diff.
//
// The fix moves CI to a SINGLE host authority (waitForCi → ciNote) and tells the reviewer NOT to
// re-judge CI. This harness proves the fix at the exact decision boundary: same CI-gated DoD,
// same delivered artifacts (every substantive item satisfied), the ONLY un-provable item is CI.
//   OLD prompt (no CI clause, no host CI note)  → expect verdict "changes" (bounces on CI)  ← the loop
//   NEW prompt (CI clause + host "CI PASSED" note) → expect verdict "approve"               ← fixed
//
// Run from apps/desktop (needs ANTHROPIC_API_KEY in the repo .env):
//   pnpm exec tsx scripts/validate-review-ci.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

// load ANTHROPIC_API_KEY from the repo .env without printing it
function loadKey(): string {
  if (process.env['ANTHROPIC_API_KEY']) return process.env['ANTHROPIC_API_KEY'];
  for (const p of ['../../.env', '../../../.env']) {
    try {
      const txt = readFileSync(join(__dirname, p), 'utf8');
      const m = txt.match(/^ANTHROPIC_API_KEY=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* try next */ }
  }
  throw new Error('ANTHROPIC_API_KEY not found in env or .env');
}

const MODEL = 'claude-opus-4-8'; // DEFAULT_MODEL['claude-code'] — the reviewer's default
const RUNS = 3; // the model is stochastic; run each variant a few times to show consistency

// A realistic CI-gated DoD (mirrors #1013). Every substantive item below is SATISFIED by the
// delivered artifacts — only the CI item is unverifiable from the review context.
const DOD = `Definition of Done — the AUTHORITATIVE acceptance contract; gate on THIS:
- The app exposes a /terms route and a /privacy route, each rendering the policy copy.
- A screenshot of the rendered /terms page is attached as an artifact.
- A screenshot of the rendered /privacy page is attached as an artifact.
- The work is delivered as a pull request and the PR's CI checks pass (gh pr checks green).`;

const ARTIFACTS = `- [image] terms-page.png
- [image] privacy-page.png
- [diff] nm-1013-terms-privacy.patch`;

const SUMMARY = `Added /terms and /privacy routes rendering the policy copy, wired into the router. Captured rendered screenshots of both pages (attached). Opened PR #22 from nm/1013-terms-privacy and pushed the branch; CI is running on the PR.`;

const REPO_BINDING = 'bound; pushed 17583b6c2a';

// ─── OLD reviewer (pre-fix): no CI-is-separate clause; user prompt has no host CI note ───
const OLD_SYSTEM =
  'You are a strict reviewer checking a completed task against its Definition of Done before approval. Approve ONLY if every item in the acceptance contract is demonstrably satisfied by the delivered artifacts; if any item is unmet, unverifiable from what was delivered, or only partially done, request changes. If the contract names a concrete piece of evidence (a screenshot, image, recording, file, or report) that is NOT present in the delivered-artifacts list, treat that item as UNMET — do not accept the worker\'s prose claim in place of the artifact. Output ONLY one JSON object: {"verdict":"approve"|"changes","reason":"one or two specific sentences naming any unmet Definition-of-Done item"}.';
const OLD_USER = `${DOD}\n\nRepo binding: ${REPO_BINDING}\n\nDelivered artifacts:\n${ARTIFACTS}\n\nWorker summary:\n${SUMMARY}`;

// ─── NEW reviewer (post-fix): CI is gated by the host separately; ciNote carries the verdict ───
const NEW_SYSTEM =
  'You are a strict reviewer checking a completed task against its Definition of Done before approval. Approve ONLY if every item in the acceptance contract is demonstrably satisfied by the delivered artifacts; if any item is unmet, unverifiable from what was delivered, or only partially done, request changes. If the contract names a concrete piece of evidence (a screenshot, image, recording, file, or report) that is NOT present in the delivered-artifacts list, treat that item as UNMET — do not accept the worker\'s prose claim in place of the artifact. CI / check status is gated by the host SEPARATELY and reported below in a "System CI gate" note — do NOT request changes because CI is pending, in-progress, or unverifiable from the summary; trust that note for anything CI-related and judge only the substantive deliverable criteria. Output ONLY one JSON object: {"verdict":"approve"|"changes","reason":"one or two specific sentences naming any unmet Definition-of-Done item"}.';
const CI_NOTE = `\n\nSystem CI gate: the PR's CI checks have PASSED (verified by the host) — treat any "CI passes / checks green" Definition-of-Done item as SATISFIED.`;
const NEW_USER = `${DOD}\n\nRepo binding: ${REPO_BINDING}${CI_NOTE}\n\nDelivered artifacts:\n${ARTIFACTS}\n\nWorker summary:\n${SUMMARY}`;

async function verdict(client: Anthropic, system: string, user: string): Promise<{ verdict: string; reason: string }> {
  const r = await client.messages.create({
    model: MODEL,
    max_tokens: 400,
    system,
    messages: [{ role: 'user', content: user }],
  });
  const text = r.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const j = JSON.parse((text.match(/\{[\s\S]*\}/)?.[0]) ?? '{}') as { verdict?: string; reason?: string };
  return { verdict: j.verdict ?? '(unparsed)', reason: j.reason ?? text.slice(0, 200) };
}

async function main(): Promise<void> {
  const client = new Anthropic({ apiKey: loadKey() });
  console.log(`\n  Controlled review→rework CI-bounce validation  (model: ${MODEL}, ${RUNS} runs/variant)`);
  console.log('  DoD has a CI item; every other item is satisfied by the delivered artifacts.\n');

  const tally = async (label: string, system: string, user: string) => {
    const out: Array<{ verdict: string; reason: string }> = [];
    for (let i = 0; i < RUNS; i++) out.push(await verdict(client, system, user));
    const changes = out.filter((o) => o.verdict === 'changes').length;
    const approve = out.filter((o) => o.verdict === 'approve').length;
    console.log(`  ── ${label} ──`);
    console.log(`     approve: ${approve}/${RUNS}   changes: ${changes}/${RUNS}`);
    out.forEach((o, i) => console.log(`       run ${i + 1}: ${o.verdict.padEnd(8)} ${o.reason.slice(0, 110)}`));
    console.log('');
    return { approve, changes };
  };

  const oldR = await tally('OLD reviewer (pre-fix)  — expect: bounces on CI (changes)', OLD_SYSTEM, OLD_USER);
  const newR = await tally('NEW reviewer (post-fix) — expect: approves (CI gated by host)', NEW_SYSTEM, NEW_USER);

  const oldBounces = oldR.changes >= 1 && oldR.changes >= oldR.approve; // pre-fix tends to bounce on CI
  const newApproves = newR.approve === RUNS; // post-fix must never bounce on CI
  const pass = oldBounces && newApproves;
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log(`  OLD bounced on CI (reproduces the loop):  ${oldBounces ? 'YES ✓' : 'no  ✗'}`);
  console.log(`  NEW approved every run (loop fixed):      ${newApproves ? 'YES ✓' : 'no  ✗'}`);
  console.log(`\n  RESULT: ${pass ? 'PASS ✓  — the CI-bounce loop is fixed' : 'FAIL ✗ — investigate'}\n`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('validation error:', e instanceof Error ? e.message : e); process.exit(2); });
