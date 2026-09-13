// The GitHub + git surface the daemon shells out to — extracted from agents.ts (track B1).
// Closure-free by construction: every function takes what it needs, which is why this was
// the first thing that could leave the 8.5k-line host closure.
//
// NM_GH_FAKE (and the PR-state / release variants) keep the gates deterministic offline;
// ghFakeCalls is the recorded sequence the e2e asserts against.
import type { ReleaseSignal, ReleaseVerdict } from '../shipverify';
import { checkRunSignals, commitStatusSignals, workflowRunSignals, classifyRelease } from '../shipverify';
import { gitChildEnv } from '../harness/workspaces';

export async function git(args: string[], cwd?: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const { stdout } = await run('git', args, { cwd, env: gitChildEnv() });
  return stdout.trim();
}

// The PR flow uses the machine's own `gh` (GitHub CLI) — v1 BYO creds, the
// platform never holds a repo token (remote agents get a GitHub App in phase 2).
// NM_GH_FAKE=1 is a deterministic shim for the gate: no network, no real GitHub —
// it records the calls so the merge-on-accept watch + FSM can be proven in echo.
export const ghFakeCalls: string[] = [];

export async function ghRaw(args: string[], cwd?: string): Promise<{ ok: boolean; code: number; stdout: string; stderr: string }> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('gh', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, maxBuffer: 10_000_000 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
      resolve({ ok: !err, code, stdout: (stdout || '').trim(), stderr: (stderr || '').trim() });
    });
  });
}

// a machine without a working gh credential (the BYOK runner lane) must not run the
// repo-cred watches: the live gads runner retried `gh pr merge` on every sweep, failing
// forever and posting a ⚠️ thread message per retry. capability is a boot fact —
// memoized; a mid-life `gh auth login` lands on the next daemon restart. NM_GH_FAKE
// short-circuits true so the echo/e2e gates keep proving the merge flow without auth.
let ghCapableP: Promise<boolean> | undefined;
export function ghCapable(): Promise<boolean> {
  if (process.env['NM_GH_FAKE'] === '1') return Promise.resolve(true);
  ghCapableP ??= ghRaw(['auth', 'status']).then((r) => {
    if (!r.ok) console.log('gh capability: absent — repo-cred watches idle on this machine (a gh-capable daemon merges)');
    return r.ok;
  }).catch(() => false);
  return ghCapableP;
}

// owner/repo from a clone URL (https or ssh), for `gh -R`.
export function repoSlug(cloneUrl: string): string {
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(cloneUrl);
  return m ? `${m[1]}/${m[2]}` : '';
}

// A repo attached from a local checkout (provider=local) can carry an EMPTY clone_url even though the
// checkout itself is a git repo with a real remote. Resolve that remote (its `origin`) so the worker
// runs the normal clone → branch → push → PR flow against it — "auto-detect the local git repo and
// open a PR for its change". '' when there's no origin to detect (caller surfaces an actionable error).
export async function localRepoRemote(localPath: string): Promise<string> {
  return (await git(['remote', 'get-url', 'origin'], localPath).catch(() => '')).trim();
}

// The owner/repo slug to pass to `gh -R` for a repo row, resolved the SAME way the worker
// resolves it to push + open the PR: prefer the clone_url, else the local checkout's `origin`
// remote. A locally-attached repo stores a placeholder org_name ('local') + an empty clone_url,
// so `${org_name}/${name}` = `local/<name>` — which gh CANNOT resolve (the merge-on-accept
// GraphQL error). org_name/name is only a last-resort fallback when no real remote is derivable.
export async function repoSlugFor(row: { clone_url?: string | null; local_path?: string | null; org_name?: string | null; name?: string | null }): Promise<string> {
  let url = (row.clone_url ?? '').trim();
  if (!url && row.local_path) url = await localRepoRemote(row.local_path);
  return repoSlug(url) || (row.org_name && row.name ? `${row.org_name}/${row.name}` : '');
}

// Open a PR for the pushed branch (idempotent: reuse an existing one). Returns
// null when gh is absent/unauthed/failed — the caller falls back to push-only.
export async function ghPrCreate(cwd: string, slug: string, base: string, head: string, title: string, body: string): Promise<{ url: string; number: number } | null> {
  if (process.env['NM_GH_FAKE'] === '1') { ghFakeCalls.push(`pr create ${slug} ${head}`); return { url: `https://github.com/${slug}/pull/7`, number: 7 }; }
  // reuse an existing PR for the branch (re-submits land on the same PR)
  const view = await ghRaw(['pr', 'view', head, '-R', slug, '--json', 'url,number'], cwd);
  if (view.ok) { try { const j = JSON.parse(view.stdout) as { url?: string; number?: number }; if (j.url && j.number) return { url: j.url, number: j.number }; } catch { /* create below */ } }
  const create = await ghRaw(['pr', 'create', '-R', slug, '--base', base, '--head', head, '--title', title, '--body', body], cwd);
  if (!create.ok) return null;
  const url = create.stdout.split('\n').map((l) => l.trim()).find((l) => /\/pull\/\d+/.test(l)) ?? create.stdout.trim();
  const m = /\/pull\/(\d+)/.exec(url);
  return m ? { url, number: Number(m[1]) } : null;
}

// CI verdict for a PR's checks. 'none' = no CI configured (proceed on review
// alone); 'fail'/'pending' block; 'pass' = all green. Live-verified (a file://
// fixture can't run GitHub Actions); the gate exercises the watch via NM_GH_FAKE.
export async function ghPrChecks(cwd: string | undefined, slug: string, number: number): Promise<{ verdict: 'pass' | 'fail' | 'pending' | 'none'; detail: string }> {
  if (process.env['NM_GH_FAKE'] === '1') { ghFakeCalls.push(`pr checks ${slug} ${number}`); return { verdict: 'none', detail: '' }; }
  const r = await ghRaw(['pr', 'checks', String(number), '-R', slug, '--json', 'name,state,bucket'], cwd);
  if (/no checks reported/i.test(r.stderr)) return { verdict: 'none', detail: '' };
  let checks: Array<{ name?: string; bucket?: string }> = [];
  try { checks = JSON.parse(r.stdout) as typeof checks; } catch { return r.ok ? { verdict: 'pass', detail: '' } : { verdict: 'none', detail: r.stderr.slice(0, 120) }; }
  if (!checks.length) return { verdict: 'none', detail: '' };
  const fail = checks.find((c) => c.bucket === 'fail' || c.bucket === 'cancel');
  if (fail) return { verdict: 'fail', detail: fail.name ?? 'a required check' };
  const pending = checks.find((c) => c.bucket === 'pending');
  if (pending) return { verdict: 'pending', detail: pending.name ?? 'a check' };
  return { verdict: 'pass', detail: `${checks.length} check${checks.length === 1 ? '' : 's'} green` };
}

// Settle a PR's CI before the review judges it. CI being still-running ('pending')
// or not-yet-registered ('none' in the first ~minute after a push) is NOT a verdict —
// poll the cheap `gh pr checks` until it truly settles (pass/fail, or a persistent
// 'none' = genuinely no CI on this repo) or a bounded timeout. This makes the host
// the single CI authority so the LLM reviewer never races a half-started pipeline
// (the #1013 loop). No LLM involved; under NM_GH_FAKE it returns at once (gates stay
// deterministic and fast).
export async function waitForCi(slug: string, number: number, onPoll?: (n: number) => void, maxMs = 12 * 60_000, everyMs = 20_000, noneGrace = 4): Promise<{ verdict: 'pass' | 'fail' | 'pending' | 'none'; detail: string }> {
  if (process.env['NM_GH_FAKE'] === '1') return ghPrChecks(undefined, slug, number);
  const started = Date.now();
  let v = await ghPrChecks(undefined, slug, number);
  let n = 0;
  let noneStreak = v.verdict === 'none' ? 1 : 0;
  // keep waiting while CI is running, OR checks haven't registered yet right after a
  // push ('none' for fewer than noneGrace consecutive polls). A settled pass/fail —
  // or 'none' that persists past the grace (no CI configured) — ends the wait.
  while (Date.now() - started < maxMs && (v.verdict === 'pending' || (v.verdict === 'none' && noneStreak < noneGrace))) {
    await new Promise((r) => setTimeout(r, everyMs));
    onPoll?.(++n);
    v = await ghPrChecks(undefined, slug, number);
    noneStreak = v.verdict === 'none' ? noneStreak + 1 : 0;
  }
  return v;
}

// Squash-merge a PR and delete its branch — fired on human accept. The dev's host
// (which opened the PR, holds the creds) performs it; no worktree needed (gh API).
export async function ghPrMerge(slug: string, number: number): Promise<{ ok: boolean; error: string }> {
  if (process.env['NM_GH_FAKE'] === '1') { ghFakeCalls.push(`pr merge ${slug} ${number} --squash --delete-branch`); return { ok: true, error: '' }; }
  const r = await ghRaw(['pr', 'merge', String(number), '-R', slug, '--squash', '--delete-branch']);
  return { ok: r.ok, error: r.ok ? '' : (r.stderr || r.stdout).slice(0, 200) };
}

// The DURABLE "already handled" check for the accept-merge watch. Its in-memory set
// dies with the process, and `gh pr merge` can exit 0 on an already-merged PR (branch
// cleanup still succeeds) — so every app restart re-swept all accepted tasks, re-ran
// the merge, and RE-ANNOUNCED the 🎉 in the thread. The PR's own state is the
// cross-restart, cross-machine truth. Read-only: the fake gate returns a settable
// state without recording a call, so gate assertions on the merge sequence hold.
export async function ghPrState(slug: string, number: number): Promise<'open' | 'merged' | 'closed' | 'unknown'> {
  if (process.env['NM_GH_FAKE'] === '1') return (process.env['NM_GH_FAKE_PR_STATE'] ?? 'open') as 'open' | 'merged' | 'closed';
  const r = await ghRaw(['pr', 'view', String(number), '-R', slug, '--json', 'state']);
  if (!r.ok) return 'unknown';
  try { return (String((JSON.parse(r.stdout) as { state?: string }).state ?? '').toLowerCase() || 'unknown') as 'open' | 'merged' | 'closed' | 'unknown'; } catch { return 'unknown'; }
}

// The squash-merge commit the PR landed as — post-merge verification targets THIS
// sha on the base branch (the pre-merge head sha's checks are the old, already-
// settled PR CI; the release pipelines hang off the merge commit's push event).
export async function ghPrMergeSha(slug: string, number: number): Promise<string> {
  if (process.env['NM_GH_FAKE'] === '1') return 'fakemergesha';
  const r = await ghRaw(['pr', 'view', String(number), '-R', slug, '--json', 'mergeCommit']);
  if (!r.ok) return '';
  try { return String((JSON.parse(r.stdout) as { mergeCommit?: { oid?: string } }).mergeCommit?.oid ?? ''); } catch { return ''; }
}

// One fresh read of every post-merge signal on the merge commit: check runs +
// commit statuses (Vercel-style deploy providers report here) + workflow runs
// the push triggered (release pipelines). Normalization/verdict are pure
// (shipverify.ts); this is only the gh I/O. Fake mode answers from
// NM_GH_FAKE_RELEASE ('green' default | 'red' | 'pending' | 'none') so the
// gate exercises the verifying watch deterministically.
export async function ghReleaseSignals(slug: string, sha: string): Promise<ReleaseSignal[]> {
  if (process.env['NM_GH_FAKE'] === '1') {
    ghFakeCalls.push(`release signals ${slug} ${sha}`);
    const fake = process.env['NM_GH_FAKE_RELEASE'] ?? 'green';
    if (fake === 'none') return [];
    const state = fake === 'red' ? 'failure' as const : fake === 'pending' ? 'pending' as const : 'success' as const;
    return [{ source: 'run', name: 'release', state }];
  }
  const [checks, status, runs] = await Promise.all([
    ghRaw(['api', `repos/${slug}/commits/${sha}/check-runs`]),
    ghRaw(['api', `repos/${slug}/commits/${sha}/status`]),
    ghRaw(['run', 'list', '-R', slug, '--commit', sha, '--json', 'name,status,conclusion']),
  ]);
  const parse = (r: { ok: boolean; stdout: string }): unknown => { if (!r.ok) return null; try { return JSON.parse(r.stdout); } catch { return null; } };
  return [
    ...checkRunSignals(parse(checks)),
    ...commitStatusSignals(parse(status)),
    ...workflowRunSignals(parse(runs)),
  ];
}

// Settle the RELEASE the way waitForCi settles a PR's checks: poll until the
// merge commit's signals stop pending — or a persistent 'none' says this repo
// simply has no post-merge CI (review already gated the code; proceed). Release
// pipelines (sign/notarize/publish) run long, so the window is generous. A
// still-pending timeout returns 'pending' — the caller alerts and re-checks
// later rather than failing a slow-but-healthy pipeline.
export async function waitForRelease(slug: string, sha: string, onPoll?: (n: number) => void, maxMs = 25 * 60_000, everyMs = 30_000, noneGrace = 4): Promise<ReleaseVerdict> {
  if (process.env['NM_GH_FAKE'] === '1') return classifyRelease(await ghReleaseSignals(slug, sha));
  const started = Date.now();
  let v = classifyRelease(await ghReleaseSignals(slug, sha));
  let n = 0;
  let noneStreak = v.verdict === 'none' ? 1 : 0;
  while (Date.now() - started < maxMs && (v.verdict === 'pending' || (v.verdict === 'none' && noneStreak < noneGrace))) {
    await new Promise((r) => setTimeout(r, everyMs));
    onPoll?.(++n);
    v = classifyRelease(await ghReleaseSignals(slug, sha));
    noneStreak = v.verdict === 'none' ? noneStreak + 1 : 0;
  }
  return v;
}

// The PR's own body (deploy-notes source). Fake-mode returns a fixed note so the
// echo gate exercises the deploy-notes path deterministically; failures are ''.
export async function ghPrBody(slug: string, number: number): Promise<{ title: string; body: string }> {
  if (process.env['NM_GH_FAKE'] === '1') { ghFakeCalls.push(`pr view ${slug} ${number}`); return { title: 'fake PR', body: '## Deploy notes\n- [ ] Migration: auto-applies on deploy' }; }
  const r = await ghRaw(['pr', 'view', String(number), '-R', slug, '--json', 'title,body']);
  if (!r.ok) return { title: '', body: '' };
  try { const j = JSON.parse(r.stdout) as { title?: string; body?: string }; return { title: j.title ?? '', body: j.body ?? '' }; } catch { return { title: '', body: '' }; }
}

// The `## Deploy notes` section of a PR body, verbatim ('' when absent).
export function deployNotesSection(body: string): string {
  const m = /##\s*Deploy notes\s*\n([\s\S]*?)(?=\n##\s|$)/i.exec(body);
  return m ? m[1]!.trim() : '';
}
