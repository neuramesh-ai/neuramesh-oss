// EXECUTION PLUMBING — where an agent's work happens and what comes back off the disk.
//
// Three functions split out of agents.ts: `worktreeRun` prepares the task's git worktree and
// commits/pushes whatever the agent left in it, `runCoding` dispatches the turn to the resolved
// runtime, and `collectFiles` reads the deliverables back out of the workspace.
//
// One unit because they are one sequence, and the sequence is the product's whole claim: local
// compute, cloud truth. Git stays HOST-owned throughout — the agent never commits, so a stopped
// or crashed run still yields whatever reached the disk.
// Cached clone per repo + a worktree per task; the branch is pushed before
// submit so review/acceptance never depends on this machine (docs/03 §9).
// v1 intentionally uses the machine's own git credentials (BYO git).
import type { LogFn } from './agentlog';
import { EVIDENCE_IMAGE_BUDGET, IMAGE_EXT, planEvidenceBudget, sweepEvidenceImages } from './evidence';
import { cachePath } from './harness/brain';
import { hydrateFromDonor, stashDonor } from './harness/donors';
import { ghPrCreate, git, repoSlug } from './host/gh';
import { emitProcChange } from './procbus';
import type { BeatsFn, PermissionGate, RuntimeAdapter, TurnOpts } from './runtime/adapter';
import { formatSecretFindings, scanDiffForSecrets } from './sandbox/secrets';
// still in agents.ts — a type-and-helper edge, erased or resolved at call time
import { STAGING_EXCLUDES, excludeFromGit, executing, imageDataUri, withRepoLock } from './agents';
import type { ExecTask, HostedAgent, SkillRef } from './agents';

export async function worktreeRun(
  t: ExecTask & { repo_id: string },
  repo: { clone_url: string; default_branch: string },
  work: (dir: string) => Promise<void>,
  autoOpenPr = true,
): Promise<{ sha: string; branch: string; diff: string; prUrl?: string; prNumber?: number; prNote?: string }> {
  const { existsSync, mkdirSync, rmSync } = await import('node:fs');


  const base = t.base_ref ?? repo.default_branch;
  const branch = t.branch ?? `nm/${t.number}`;
  const cloneDir = cachePath('repos', t.repo_id);
  const wtDir = cachePath('worktrees', `nm-${t.number}`);

  const baseSha = await withRepoLock(t.repo_id, async () => {
    if (!existsSync(cloneDir)) {
      mkdirSync(cachePath('repos'), { recursive: true });
      await git(['clone', repo.clone_url, cloneDir]);
    } else {
      // --prune: stale remote-tracking refs poison --force-with-lease pushes
      // (lease checks against a branch the remote no longer has)
      await git(['fetch', 'origin', '--prune'], cloneDir);
    }
    rmSync(wtDir, { recursive: true, force: true }); // crashed-run leftovers
    await git(['worktree', 'prune'], cloneDir);
    // A REWORK continues from the prior attempt's pushed branch — the submitted work IS the
    // starting point and review feedback edits it forward (rework.ts's stated contract, which
    // this line silently broke by always resetting to base: prior commits survived only on the
    // remote until the next force-push erased them). Only a first attempt starts from base.
    const priorWork = await git(['rev-parse', '--verify', '--quiet', `origin/${branch}`], cloneDir).catch(() => '');
    await git(['worktree', 'add', '--force', wtDir, '-B', branch, priorWork ? `origin/${branch}` : `origin/${base}`], cloneDir);
    // structural: staging dirs (.nm-evidence/, .nm-attachments/) can never reach the
    // commit below — excluded before any agent writes a file (the #1004 class)
    await excludeFromGit(wtDir, STAGING_EXCLUDES);
    // donors: CoW-hydrate dependencies before the agent ever types `install` — keyed by
    // lockfile hash, honest skip when the filesystem can't CoW (docs/design/worktree-berths)
    const hyd = await hydrateFromDonor(wtDir, cachePath('donors', t.repo_id)).catch(() => null);
    if (hyd?.action === 'hydrated') console.log(`donor_hydrate nm-${t.number}: ${hyd.relPaths.length} tree(s) in ${hyd.ms}ms`);
    else if (hyd?.action === 'skipped' && hyd.reason === 'not-ignored') console.log(`donor_hydrate nm-${t.number}: undone — repo does not gitignore node_modules`);
    return git(['rev-parse', 'HEAD'], wtDir);
  });
  try {
    await work(wtDir);
    if (await git(['status', '--porcelain'], wtDir)) {
      await git(['add', '-A'], wtDir);
      await git(['commit', '-m', `nm #${t.number}: ${t.title}`], wtDir);
    }
    const sha = await git(['rev-parse', 'HEAD'], wtDir);
    if (sha === baseSha) throw new Error('no work product — nothing changed in the worktree');
    // review renders from this artifact — cross-machine and offline (docs/02)
    let diff = await git(['diff', baseSha, sha], wtDir);
    // Containment L2: scan the diff for credentials BEFORE anything leaves the machine. A key in a
    // pushed commit is irreversible — rotation is the only remedy — so a hit blocks the submit rather
    // than pushing and then apologizing. The message is redacted; the agent removes it and resubmits.
    const secretHits = scanDiffForSecrets(diff);
    if (secretHits.length) throw new Error(`secret-scan blocked the submit — ${formatSecretFindings(secretHits)}. Never commit credentials: read them from an env var, or keep the file under .nm-evidence/ (git-excluded). Remove the secret and resubmit.`);
    await git(['push', '--force-with-lease', 'origin', branch], wtDir);
    // the pushed run's installed deps become (or refresh) this repo's donor — clonefile-cheap,
    // serialized with clone-dir ops, and never allowed to fail the submit it rides on
    const stash = await withRepoLock(t.repo_id, () => stashDonor(wtDir, cachePath('donors', t.repo_id))).catch(() => null);
    if (stash?.action === 'stashed') console.log(`donor_stash nm-${t.number}: ${stash.relPaths.length} tree(s), ${Math.round(stash.apparentBytes / 1e6)}MB apparent, ${stash.ms}ms`);
    const CAP = 200_000;
    if (diff.length > CAP) diff = `${diff.slice(0, CAP)}\n… diff truncated at 200KB — fetch ${branch} for the rest`;
    // open (or reuse) a PULL REQUEST for the branch — the change is merged on the
    // human's accept, never committed straight to main. Uses the machine's own gh
    // creds; if gh is absent/unauthed we fall back to push-only (clear thread note).
    const slug = repoSlug(repo.clone_url);
    const pr = slug && autoOpenPr
      ? await ghPrCreate(wtDir, slug, base, branch, `#${t.number} ${t.title}`, `NeuraMesh task #${t.number}. Review is pinned to ${sha.slice(0, 10)}; merged on acceptance.`)
      : null;
    const prNote = !autoOpenPr
      ? `Pushed \`${branch}\` — auto-open-PR is off for this project. Review proceeds on the diff; open a PR manually to enable the CI gate + merge-on-accept.`
      : slug
      ? (pr ? `Opened PR [#${pr.number}](${pr.url}) → \`${base}\` — merges on acceptance.` : `Pushed \`${branch}\` but could not open a PR (is \`gh\` installed and authed? \`gh auth login\`). Review proceeds on the diff; open a PR to enable the CI gate + merge-on-accept.`)
      : '';
    return { sha, branch, diff, ...(pr ? { prUrl: pr.url, prNumber: pr.number } : {}), prNote };
  } catch (err) {
    // a failed run leaves nothing useful to review — reclaim it
    await withRepoLock(t.repo_id, () => git(['worktree', 'remove', '--force', wtDir], cloneDir)).catch(() => {});
    throw err;
  }
  // success path keeps the worktree for the reviewer's terminal (retention
  // watch removes it on accept/close)
}

export async function runCoding(
  adapter: RuntimeAdapter,
  agent: HostedAgent,
  t: ExecTask,
  dir: string,
  token: string,
  channelBlock: string | null | undefined,
  repoBacked: boolean,
  log?: LogFn,
  skills?: SkillRef[],
  proposeSkill?: (input: { name: string; description: string; scope: 'channel' | 'global'; body: string }) => Promise<{ ok: boolean; error?: string }>,
  reworkNotes?: string,
  attachmentsNote?: string,
  recordLesson?: (input: { lesson: string }) => Promise<{ ok: boolean; error?: string }>,
  lessonsNote?: string,
  addBacklogItem?: (input: { title: string; description?: string; parent?: boolean }) => Promise<{ ok: boolean; number?: number; error?: string }>,
  beats?: BeatsFn,
  permissionGate?: PermissionGate,
  protectedPaths?: string[],
  turnOpts?: TurnOpts,
): Promise<{ note: string; stopped: boolean }> {
  const ac = new AbortController();
  executing.set(t.id, ac); // discoverable by the cancel watch → stop aborts it
  emitProcChange();
  const started = Date.now();
  console.log(`agent_exec agent=${agent.name} task=${t.number} runtime=${agent.runtime} mode=${repoBacked ? 'worktree' : 'scratch'} started`);
  log?.({ kind: 'exec', phase: 'started', summary: `execution started — ${agent.runtime} · ${repoBacked ? 'worktree' : 'scratch'} workspace` });
  try {
    const note = await adapter.runQuery(agent, t, dir, token, channelBlock, repoBacked, ac, log, skills, proposeSkill, reworkNotes, attachmentsNote, recordLesson, lessonsNote, undefined, addBacklogItem, beats, permissionGate, protectedPaths, turnOpts);
    console.log(`agent_exec agent=${agent.name} task=${t.number} finished_ms=${Date.now() - started}`);
    return { note, stopped: false };
  } catch (err) {
    // The ONLY abort left is a human Stop (stopExecuting) — no timer touches this signal.
    if (ac.signal.aborted) {
      console.warn(`agent_exec agent=${agent.name} task=${t.number} STOPPED after ${Math.round((Date.now() - started) / 1000)}s`);
      log?.({ kind: 'exec', phase: 'stopped', summary: 'stopped by a human — leaving the workspace as it stands', level: 'warn' });
      return { note: '', stopped: true };
    }
    log?.({ kind: 'exec', phase: 'error', summary: `execution error: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`, level: 'error' });
    throw err;
  } finally {
    executing.delete(t.id);
    emitProcChange();
  }
}

export async function collectFiles(dir: string): Promise<{ files: Array<{ kind: 'file' | 'screenshot'; name: string; content: string }>; droppedImages: string[] }> {
  const { readdir, readFile, stat } = await import('node:fs/promises');
  const { join, relative } = await import('node:path');
  const out: Array<{ kind: 'file' | 'screenshot'; name: string; content: string }> = [];
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d)) {
      // .nm-evidence/ is the agent's scratch/working dir — its files are NOT deliverables.
      // Evidence images in it attach via the recursive sweep below, on their own budget.
      if (entry === '.nm-evidence' && d === dir) continue;
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const full = join(d, entry);
      const st = await stat(full);
      if (st.isDirectory()) {
        await walk(full);
      } else if (out.length >= 12) {
        continue;
      } else if (IMAGE_EXT.test(entry)) {
        // screenshots/diagnostic images the agent produced — preview-able
        const uri = imageDataUri(full);
        if (uri) out.push({ kind: 'screenshot', name: relative(dir, full), content: uri });
      } else if (st.size <= 300_000) {
        const buf = await readFile(full);
        if (buf.includes(0)) continue; // other binary — storage uploads are phase 2
        out.push({ kind: 'file', name: relative(dir, full), content: buf.toString('utf8') });
      }
    }
  };
  await walk(dir);
  // Evidence images: recursive (subfolders are normal), newest-first, own budget — and any
  // drop is RETURNED so the submit note can name it (silent truncation is the #1015 loop).
  const droppedImages: string[] = [];
  const { take, dropped } = planEvidenceBudget(await sweepEvidenceImages(join(dir, '.nm-evidence')), EVIDENCE_IMAGE_BUDGET);
  droppedImages.push(...dropped);
  for (const rel of take) {
    const uri = imageDataUri(join(dir, '.nm-evidence', rel));
    if (uri) out.push({ kind: 'screenshot', name: rel, content: uri });
    else droppedImages.push(`${rel} (unreadable/oversize)`);
  }
  return { files: out, droppedImages };
}
