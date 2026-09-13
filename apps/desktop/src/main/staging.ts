// STAGING — putting the right files in an agent's workspace before it starts.
//
// Six functions split out of agents.ts. They answer one question at six moments: what does this
// agent need on disk to do its job? The human's attachments, the approved design round, the
// prior round it is revising, the brand context, and the read-only planning checkout.
//
// They all write into the task's worktree or scratch dir and none of them decides anything, so
// they are pure plumbing that the flows call — which is why they were always module-level
// functions rather than closures over the host.
export async function loadMessageAttachments(db: AttDbLike, messageId: string): Promise<{ list: AgentAttachment[]; manifest: string }> {
  const rows = await db.getAll<{ id: string; name: string; mime: string | null }>(
    `select id, name, mime from artifacts where message_id = ? order by created_at asc`,
    [messageId],
  );
  if (!rows.length) return { list: [], manifest: '' };
  // The turn's inline budget (2026-08-18 audit: attachments were the largest UNBOUNDED input —
  // unlimited full-size base64 images straight into wakes). Over-budget files still stage to
  // disk (path) and are NAMED in the manifest, so nothing is hidden — just not inlined.
  const IMAGE_INLINE_CAP = 6;
  const TEXT_INLINE_CAP = 8;
  let imagesInlined = 0;
  let textsInlined = 0;
  const list: AgentAttachment[] = [];
  const lines: string[] = [];
  for (const r of rows) {
    const mime = r.mime ?? '';
    const bytes = await readAttachment(r.id);
    if (!bytes) { lines.push(`- ${r.name} — not available on this machine`); continue; }
    const path = attachmentFilePath(r.id); // local file: Codex local_image + the coding-worktree drop
    if (mime.startsWith('image/')) {
      if (imagesInlined < IMAGE_INLINE_CAP) {
        imagesInlined++;
        list.push({ name: r.name, mime, kind: 'image', base64: bytes.toString('base64'), path });
        lines.push(`- ${r.name} (image · ${mime})`);
      } else {
        list.push({ name: r.name, mime, kind: 'image', path });
        lines.push(`- ${r.name} (image · ${mime} — over the ${IMAGE_INLINE_CAP}-image inline budget; staged on disk)`);
      }
    } else if (isTextual(mime, r.name)) {
      if (textsInlined < TEXT_INLINE_CAP) {
        textsInlined++;
        const text = bytes.toString('utf8').slice(0, 8000);
        list.push({ name: r.name, mime: mime || 'text/plain', kind: 'file', text, path });
        lines.push(`- ${r.name} (${bytes.length} bytes):\n\`\`\`\n${text}\n\`\`\``);
      } else {
        list.push({ name: r.name, mime: mime || 'text/plain', kind: 'file', path });
        lines.push(`- ${r.name} (${bytes.length} bytes — over the ${TEXT_INLINE_CAP}-file inline budget; staged on disk)`);
      }
    } else {
      list.push({ name: r.name, mime: mime || 'application/octet-stream', kind: 'file', path });
      lines.push(`- ${r.name} (${bytes.length} bytes, binary — not shown inline)`);
    }
  }
  const manifest = `\n\n[The human attached ${rows.length} file(s) to their latest message — use them as context:]\n${lines.join('\n')}`;
  return { list, manifest };
}

import { BRAND_DOC_NAMES } from '@neuramesh/shared';
import type { LogFn } from './agentlog';
import { attachmentFilePath, readAttachment } from './attachments';
import { cachePath } from './harness/brain';
import { git, localRepoRemote } from './host/gh';
import { type AgentAttachment } from './runtime/adapter';
// type-only + pure helpers that stayed in agents.ts; the edge is erased at compile time
import { STAGING_EXCLUDES, excludeFromGit, isTextual } from './agents';
import type { AttDbLike } from './agents';
// Coding/execution path: copy a task's attachments into the worktree (./.nm-attachments/) and return
// a prompt manifest. This is the universal — EVERY runtime (Claude, Codex, Gemini, agy) can Read the
// files with its own file tools during a build, so an agent implementing a task sees attached mockups
// and specs even where inline image transport isn't available (the agy CLI).
export async function stageTaskAttachments(db: AttDbLike, taskId: string, dir: string, repoBacked: boolean): Promise<string> {
  const rows = await db.getAll<{ id: string; name: string; mime: string | null }>(
    `select id, name, mime from artifacts where task_id = ? and message_id is not null order by created_at asc`,
    [taskId],
  );
  if (!rows.length) return '';
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const sub = join(dir, '.nm-attachments');
  try { await mkdir(sub, { recursive: true }); } catch { return ''; }
  if (repoBacked) await excludeFromGit(dir, STAGING_EXCLUDES);
  const lines: string[] = [];
  for (const r of rows) {
    const bytes = await readAttachment(r.id);
    if (!bytes) continue;
    const safe = (r.name || r.id).replace(/[^\w.-]+/g, '_').slice(0, 120) || r.id;
    try { await writeFile(join(sub, safe), bytes); } catch { continue; }
    lines.push(`- .nm-attachments/${safe}${(r.mime ?? '').startsWith('image/') ? ' (image)' : ''}`);
  }
  if (!lines.length) return '';
  return `\n\n[The human attached ${lines.length} file(s) to this task — saved in ./.nm-attachments/ in your workspace. Read them for context (images included):]\n${lines.join('\n')}`;
}

// Design-gated tasks: materialize the human-APPROVED mockups (the latest round of
// 'design' artifacts, synced with inline content) into the workspace under
// .nm-evidence/design/ — git-excluded, so they inform the build but can never
// reach the commit or PR. Returns a prompt note binding the build to them.
export async function stageApprovedDesigns(db: AttDbLike, taskId: string, dir: string, repoBacked: boolean): Promise<string> {
  const rows = await db.getAll<{ name: string; inline_content: string | null }>(
    `select name, inline_content from artifacts where task_id = ? and kind = 'design' order by name asc`,
    [taskId],
  ).catch(() => [] as Array<{ name: string; inline_content: string | null }>);
  const latest = rows.reduce((m, a) => Math.max(m, Number(/^design-mockup-v(\d+)-/.exec(a.name)?.[1] ?? 0)), 0);
  const picked = rows.filter((a) => a.name.startsWith(`design-mockup-v${latest}-`) && a.inline_content);
  if (!picked.length) return '';
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dest = join(dir, '.nm-evidence', 'design');
  try { await mkdir(dest, { recursive: true }); } catch { return ''; }
  if (repoBacked) await excludeFromGit(dir, STAGING_EXCLUDES);
  const staged: string[] = [];
  for (const a of picked) {
    try { await writeFile(join(dest, a.name), a.inline_content!); staged.push(a.name); } catch { /* skip unreadable */ }
  }
  if (!staged.length) return '';
  return `\n\n[This task has HUMAN-APPROVED design mockups — saved in ./.nm-evidence/design/ (${staged.join(', ')}). Open them first: they are the visual contract, and your implementation must match them (layout, spacing, tokens, both themes). Material deviation from the approved design is a review-blocking defect.]`;
}

/**
 * The architect's STUDY workspace (2026-07-29).
 *
 * The bug this closes: an implementation plan is written against a design and a codebase,
 * and the architect could see neither. `architectFlow` ran a tool-less mixture-of-agents over
 * a text brief that named the approved mockups by FILENAME — the one artifact the whole plan
 * has to match was never opened, and neither was a single file of the repo the plan targets.
 *
 * So: build the developer's workspace, minus the write permission. A shallow read-only clone
 * of the task's repo (never the user's own checkout, discarded when the plan is proposed —
 * nothing to leak), with the approved mockups and any human attachments materialized into it
 * exactly where the developer will later find them. Modeled on the designer's study clone;
 * degrades to a bare directory (or none at all) when the task has no repo or the clone fails.
 */
export async function openPlanningWorkspace(
  db: AttDbLike,
  t: { id: string; number: number; repo_id: string | null; base_ref: string | null },
  log?: LogFn,
): Promise<{ dir: string | null; repoBacked: boolean; note: string; cleanup: () => Promise<void> }> {
  const { join } = await import('node:path');
  const { mkdir, rm } = await import('node:fs/promises');
  const work = cachePath('plan', `nm-${t.number}`);
  const cleanup = () => rm(work, { recursive: true, force: true }).then(() => {}, () => {});
  try {
    await cleanup();
    await mkdir(work, { recursive: true });
  } catch {
    return { dir: null, repoBacked: false, note: '', cleanup: async () => {} };
  }
  let dir = work;
  let repoBacked = false;
  if (t.repo_id) {
    const repo = await db.getAll<{ clone_url: string | null; local_path: string | null; default_branch: string | null }>(
      `select clone_url, local_path, default_branch from repos where id = ?`, [t.repo_id],
    ).then((r) => r[0] ?? null).catch(() => null);
    let cloneUrl = repo?.clone_url ?? null;
    if (!cloneUrl && repo?.local_path) cloneUrl = await localRepoRemote(repo.local_path).catch(() => '');
    const ref = t.base_ref || repo?.default_branch || 'main';
    if (cloneUrl) {
      try {
        await git(['clone', '--depth', '1', '--branch', ref, cloneUrl, join(work, 'repo')]);
        dir = join(work, 'repo');
        repoBacked = true;
      } catch (err) {
        log?.({ kind: 'exec', phase: 'study', summary: `couldn't clone the repo to study (${err instanceof Error ? err.message.slice(0, 120) : 'error'}) — planning from the brief instead`, level: 'warn' });
      }
    }
  }
  // the approved mockups + the human's attachments, in the same paths the developer gets
  const designNote = await stageApprovedDesigns(db, t.id, dir, repoBacked);
  const attNote = await stageTaskAttachments(db, t.id, dir, repoBacked);
  const lines = [
    `\n\n[STUDY WORKSPACE — your working directory is a READ-ONLY copy of everything this plan is written against${repoBacked ? `: the repository checked out at \`${t.base_ref || 'the base branch'}\`` : ''}. Read it before you plan; name real files and real symbols. You cannot write, edit, or run commands.]`,
    designNote,
    attNote,
  ].filter(Boolean);
  if (repoBacked) log?.({ kind: 'exec', phase: 'study', summary: `study clone ready — planning against the real tree${designNote ? ' + the approved mockups' : ''}` });
  else if (designNote) log?.({ kind: 'exec', phase: 'study', summary: 'approved mockups staged — planning against the real design' });
  return { dir, repoBacked, note: lines.join(''), cleanup };
}

/**
 * Rework continuity for a design round (docs/14): hand the designer the PREVIOUS
 * round's mockups on disk so round N+1 is an edit of round N rather than a fresh
 * drawing from a paragraph of feedback.
 *
 * Artifacts are stored as `design-mockup-v{round}-{slug}.html`; the version prefix is
 * stripped on the way out so the designer's own re-emitted file gets versioned once
 * (`design-mockup-v2-01-character-logo.html`), not twice.
 *
 * Same shape as stageApprovedDesigns, different consumer: that one binds the BUILD to
 * an approved design, this one binds the NEXT ROUND to the previous one.
 */
export async function stagePriorDesignRound(
  db: AttDbLike,
  taskId: string,
  dir: string,
): Promise<{ names: string[]; round: number; staged: Map<string, string> }> {
  const rows = await db.getAll<{ name: string; inline_content: string | null }>(
    `select name, inline_content from artifacts where task_id = ? and kind = 'design' order by name asc`,
    [taskId],
  ).catch(() => [] as Array<{ name: string; inline_content: string | null }>);
  const empty = { names: [] as string[], round: 0, staged: new Map<string, string>() };
  const round = rows.reduce((m, a) => Math.max(m, Number(/^design-mockup-v(\d+)-/.exec(a.name)?.[1] ?? 0)), 0);
  if (!round) return empty;
  const picked = rows.filter((a) => a.name.startsWith(`design-mockup-v${round}-`) && a.inline_content);
  if (!picked.length) return empty;
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dest = join(dir, '.nm-evidence', 'design');
  try { await mkdir(dest, { recursive: true }); } catch { return empty; }
  const names: string[] = [];
  const staged = new Map<string, string>();
  for (const a of picked) {
    const bare = a.name.replace(/^design-mockup-v\d+-/, '');
    try {
      await writeFile(join(dest, bare), a.inline_content!);
      names.push(bare);
      staged.set(bare, a.inline_content!);
    } catch { /* skip unwritable */ }
  }
  return names.length ? { names, round, staged } : empty;
}

// A marketing room's marketer should open every content task already fluent in the
// product — its brand docs, connected accounts, focus and goal — none of which the
// generic fan-out injects (marketing-workflow plan §4.4). Modeled on stageApprovedDesigns:
// materialize the brand docs into .nm-evidence/brand/ (git-excluded, never in a commit)
// and return a binding prompt note. Returns '' for non-marketing rooms, so #build fan-out
// stays byte-identical.
export async function stageBrandContext(db: AttDbLike, channelId: string, dir: string): Promise<string> {
  const [ch] = await db.getAll<{ kind: string; marketing: string | null; website: string | null; logo: string | null }>(
    `select c.kind as kind, c.marketing as marketing, p.website as website, p.logo_url as logo
       from channels c left join projects p on p.id = c.project_id where c.id = ?`,
    [channelId],
  ).catch(() => [] as Array<{ kind: string; marketing: string | null; website: string | null; logo: string | null }>);
  if (!ch || ch.kind !== 'marketing') return '';

  const rows = await db.getAll<{ name: string; inline_content: string | null }>(
    `select name, inline_content from artifacts where channel_id = ? and kind = 'doc' order by created_at desc`,
    [channelId],
  ).catch(() => [] as Array<{ name: string; inline_content: string | null }>);
  const picked = new Map<string, string>(); // newest of each named brand doc
  for (const r of rows) if (BRAND_DOC_NAMES.includes(r.name) && r.inline_content && !picked.has(r.name)) picked.set(r.name, r.inline_content);

  // by PROJECT (0106): `channel_id` only records where the OAuth round-trip was started, so a
  // channel-keyed read told the marketer "nothing is connected" in every room but that one.
  const conns = await db.getAll<{ provider: string; handle: string }>(
    `select k.provider, k.handle from connectors k
      where k.status = 'connected'
        and k.workspace_id = (select workspace_id from channels where id = ?)
        and (k.project_id is null or k.project_id = (select project_id from channels where id = ?))
      order by (k.project_id is not null) desc`,
    [channelId, channelId],
  ).catch(() => [] as Array<{ provider: string; handle: string }>);

  let profile: { website?: string; focus?: string[]; goal?: string } = {};
  try { if (ch.marketing) profile = JSON.parse(ch.marketing); } catch { /* leave empty */ }

  const staged: string[] = [];
  if (picked.size) {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const dest = join(dir, '.nm-evidence', 'brand');
    try {
      await mkdir(dest, { recursive: true });
      for (const [name, body] of picked) { try { await writeFile(join(dest, name), body); staged.push(name); } catch { /* skip unreadable */ } }
    } catch { /* dir unavailable */ }
  }

  const lines: string[] = [];
  const product = profile.website || ch.website;
  if (product) lines.push(`Product: ${product}${ch.logo ? ' (logo on file)' : ''}.`);
  if (profile.goal) lines.push(`Growth goal: ${profile.goal}.`);
  if (profile.focus?.length) lines.push(`Focus: ${profile.focus.join(', ')}.`);
  if (conns.length) lines.push(`Connected accounts you may draft for: ${conns.map((c) => `${c.provider}${c.handle ? ` ${c.handle}` : ''}`).join(', ')} — draft only for these unless told otherwise.`);
  else lines.push(`No networks are connected yet — draft the copy anyway; the human connects an account before anything publishes.`);
  if (staged.length) lines.push(`Brand docs saved to ./.nm-evidence/brand/ (${staged.join(', ')}) — READ brand-guidelines.md for voice, palette and what-to-avoid BEFORE drafting, and match it.`);

  if (!lines.length) return '';
  return `\n\n[MARKETING CONTEXT — this content task runs in a marketing room, so you already know the product and brand:\n- ${lines.join('\n- ')}]`;
}

/**
 * What this room is CONNECTED to (docs/design/triage-preflight-2026-08).
 *
 * The gap it closes: a worker could not tell a disconnected account from one nobody had
 * mentioned. Live, that produced a unit reporting "this session did not expose search_x" and
 * writing a Python package that would read X if it ever had a credential — the worker did not
 * know what existed, so it built what it imagined.
 *
 * Prompt text, not a file: this is small, it changes between runs, and it must be true at the
 * moment the turn starts. Silent when the room has no connectors at all — a marketing room
 * mid-setup should not read as a broken one.
 */
export async function stageConnections(db: AttDbLike, channelId: string): Promise<string> {
  const rows = await db.getAll<{ provider: string; status: string; handle: string | null }>(
    `select k.provider, k.status, k.handle from connectors k
       join channels c on c.id = ? and c.project_id = k.project_id order by k.provider`,
    [channelId],
  ).catch(() => [] as Array<{ provider: string; status: string; handle: string | null }>);
  if (!rows.length) return '';
  const live = rows.filter((r) => r.status === 'connected');
  const dead = rows.filter((r) => r.status === 'reauth_required' || r.status === 'revoked');
  const lines = [
    ...live.map((r) => `- ${r.provider}${r.handle ? ` (${r.handle})` : ''} — CONNECTED${r.provider === 'x' ? '; read its conversations with `search_x` (real engagement numbers)' : '; publish-only, no read API — cover it by public web research and never attach engagement numbers you did not measure'}`),
    ...dead.map((r) => `- ${r.provider}${r.handle ? ` (${r.handle})` : ''} — AUTHORIZATION EXPIRED: unusable until a human reconnects it. Do not plan around it; say so.`),
  ];
  if (!lines.length) return '';
  return `\n\n[CONNECTED ACCOUNTS — what this room can actually reach right now:\n${lines.join('\n')}\nUse what is here. If the work needs something that is NOT here, say so plainly in your deliverable and hand back what you could establish — never build a pipeline that would work once somebody connects it, and never invent numbers for a source you could not read.]`;
}

/**
 * A research unit's deliverable is a DOCUMENT (triage-preflight round). `CONTENT_OUTPUT_CONTRACT`
 * has done this job for content tasks since 0115; research had no equivalent, so on a coding
 * flow the coding contract won by default and a unit shipped `reply_radar/radar.py` plus tests
 * instead of the report it was asked for.
 */
export const RESEARCH_OUTPUT_CONTRACT = `\n\n[OUTPUT CONTRACT — this is a RESEARCH task. Your deliverable is the DOCUMENT the brief names, plus whatever your tools post as cards. It is NEVER software: do not create a package, a module, a CLI, a test suite or a JSON pipeline that would produce the answer later — produce the answer. Scripts are fine as your own scratch working, but they are not the deliverable and must not be what you hand back. If a source you need is unavailable, write what you DID establish and name the gap in the document's own "What I couldn't determine" section.]`;
