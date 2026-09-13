// Skill-pack import — the curator walking a pack's markdown into the room's skills.
// Split out of host/flows.ts.

import type { ExecTask, HostedAgent, OfferedTask, SkillRef, ImportPack } from '../agents';


import { parseSkillFiles, type ClaimVerdict } from '@neuramesh/shared';





import { type SubjectRef } from '../harness/brain';



import { git } from './gh';








import { type LogFn } from '../agentlog';


import type { HostCtx } from './ctx';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { AgentAttachment } from '../runtime/adapter';
import type { HostQueue } from '../harness/hostqueue';
import type { ParkBook } from '../harness/park';
import type { WhiteboardToolClosures } from '../harness/toolbus';
import type { makeRuns, RunHandle } from './runs';
import type { makeBeats } from './beats';
import type { makePark } from './park';

export function makeSkillImport(ctx: HostCtx & {
  db: PowerSyncDatabase;
  apiUrl: string;
  workspace: string;
  ownerActorId: string;
  agents: Map<string, HostedAgent>;
  brain: Brain;
  parkBook: ParkBook;
  execQueue: HostQueue;
  /** the claim registry — `delete` also re-arms the queue slot, which is why it is not a bare Set */
  claimed: { has: (id: string) => boolean; add: (id: string) => unknown; delete: (id: string) => boolean };
  // ── services other makers already built: their types are INFERRED, never restated ──────────
  NO_RUN: ReturnType<typeof makeRuns>['NO_RUN'];
  openRun: ReturnType<typeof makeRuns>['openRun'];
  narrate: ReturnType<typeof makeRuns>['narrate'];
  declareBeats: ReturnType<typeof makeBeats>['declareBeats'];
  advanceBeat: ReturnType<typeof makeBeats>['advanceBeat'];
  beatCursor: ReturnType<typeof makeBeats>['beatCursor'];
  parkFor: ReturnType<typeof makePark>['parkFor'];
  // ── the host's own helpers ────────────────────────────────────────────────────────────────
  alog: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null, runId?: string | null) => LogFn;
  arun: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null) => { log: LogFn; runId: string };
  brainNotes: (subject: SubjectRef, cap?: number, perNote?: number) => string;
  brainNotesFor: (task: ExecTask, cap?: number, perNote?: number) => string;
  brainResults: (subject: SubjectRef, cap?: number, per?: number) => string;
  channelLessons: (workspaceId: string, channelId: string) => Promise<string>;
  claimVerdict: (runtime: string, model: string | null, originUserId: string | null, elapsedMs: number, extra?: { agentId?: string; priorMachineId?: string | null }) => Promise<ClaimVerdict>;
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
  handleExhaustion: (agent: HostedAgent, t: ExecTask | null, ch: { id: string; slug: string; workspace_id: string }) => Promise<void>;
  legSummary: (out: string) => string;
  mineLessons: (reviewer: HostedAgent, t: { id: string; number: number; title: string }, ch: { id: string; slug: string; workspace_id: string }, token: string, live: boolean, log?: LogFn) => Promise<void>;
  orchestratorTurn: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, transcript: string, token: string, thread?: { id: string; number: number; title: string; state: string }, log?: LogFn, skills?: SkillRef[], attachments?: AgentAttachment[], convoThreadId?: string | null, run?: RunHandle, onDelta?: (t: string) => void) => Promise<string>;
  originOf: (t: OfferedTask) => string | null;
  priorMachineFor: (threadId?: string | null, taskId?: string | null) => Promise<string | null>;
  readOnlyStudy: (agent: HostedAgent, dir: string, token: string, log?: LogFn) => ((system: string, user: string) => Promise<string>) | null;
  seatFor: (agent: HostedAgent, channelId: string, scope?: { threadId?: string | null; taskId?: string | null }) => Promise<HostedAgent>;
  setStatus: (agent: HostedAgent, status: 'online' | 'thinking' | 'working') => void;
  sinceFirstSeen: (key: string) => number;
  spawnLegFor: (parent: HostedAgent, where: { workspace: string; channelId: string; taskId?: string | null; threadId?: string | null }, dir: string, task: ExecTask, budget: { wallMs: number; contextTokens: number }, log: LogFn | undefined, _depth: number) => (i: { role: string; prompt: string; label?: string }) => Promise<{ ok: boolean; summary?: string; error?: string }>;
  taskRecallNote: (workspaceId: string, query: string, lessonsNote: string) => Promise<string>;
  whiteboardClosures: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }, at: { taskId?: string; threadId?: string }) => WhiteboardToolClosures;
}) {
const { db, workspace, post, 
        
        arun, 
        
        setStatus } = ctx;
// The guard registry's fields keep their short names, exactly as they read inside startAgentHost.
const { importing,
        
 } = ctx.guards;

// recursively collect every SKILL.md under a cloned repo (skip .git/node_modules)
async function walkSkillMd(root: string): Promise<Array<{ path: string; content: string }>> {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join, relative } = await import('node:path');
  const out: Array<{ path: string; content: string }> = [];
  const recurse = async (dir: string): Promise<void> => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      if (ent.name === '.git' || ent.name === 'node_modules') continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) await recurse(full);
      else if (ent.name === 'SKILL.md') out.push({ path: relative(root, full), content: await readFile(full, 'utf8') });
    }
  };
  await recurse(root);
  return out;
}

// Curator import: clone → scan → parse → commit, posting progress on the synced
// pack row at each step. The same shared parser powers the bundled seed, so an
// imported pack is indistinguishable from a default once committed.
const IMPORT_BODY_CAP = 32_000; // match the seed cap; keeps per-member sync light

async function curatorImport(cur: HostedAgent, p: ImportPack): Promise<void> {
  const actor = { kind: 'agent', id: cur.id, role: 'curator' };
  const ch = await db.get<{ slug: string }>('select slug from channels where id = ?', [p.channel_id]).catch(() => null);
  const { log } = arun(cur, null, ch?.slug ?? null);
  const update = (body: Record<string, unknown>) => post('/v1/commands', actor, { type: 'skillpack.update', packId: p.id, ...body });
  let dir = '';
  try {
    setStatus(cur, 'working');
    log({ kind: 'lifecycle', phase: 'import', summary: `importing skill pack "${p.name}" from ${p.source_url}` });
    const url = p.source_url.trim();
    // public GitHub repos for users; file:// allowed for the e2e fixture only
    const ok = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?\/?$/.test(url) || url.startsWith('file://');
    if (!ok) throw new Error('only public GitHub repository URLs are supported');
    const { mkdtemp } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    dir = await mkdtemp(path.join(os.tmpdir(), 'nm-skillpack-'));

    await update({ step: 'Cloning repository…', progress: 15 });
    const args = ['clone', '--depth', '1'];
    if (p.source_ref && p.source_ref !== 'main') args.push('--branch', p.source_ref);
    args.push(url, dir);
    await git(args);
    const sha = await git(['-C', dir, 'rev-parse', 'HEAD']).catch(() => p.source_ref || 'imported');

    await update({ step: 'Scanning for skills…', progress: 45 });
    const parsed = parseSkillFiles(await walkSkillMd(dir));
    if (!parsed.length) throw new Error('no SKILL.md skills found in this repository');
    const skills = parsed.slice(0, 300).map((s) => ({
      name: s.name,
      description: s.description,
      body: s.body.length > IMPORT_BODY_CAP ? `${s.body.slice(0, IMPORT_BODY_CAP)}\n\n…(truncated — full skill at ${url})` : s.body,
    }));

    await update({ step: `Saving ${skills.length} skill${skills.length === 1 ? '' : 's'}…`, progress: 80 });
    const res = await post('/v1/commands', actor, { type: 'skillpack.commit', packId: p.id, version: sha.slice(0, 40), skills });
    if (!res.ok) throw new Error(`commit ${res.status}: ${(await res.text()).slice(0, 160)}`); // commit sets status='ready'
    log({ kind: 'lifecycle', phase: 'imported', summary: `imported "${p.name}" — ${skills.length} skills @ ${sha.slice(0, 10)}` });
    console.log(`curator_import pack=${p.name} skills=${skills.length} sha=${sha.slice(0, 10)} ok`);
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 300) : 'import failed';
    await update({ status: 'error', step: 'Import failed', error: msg }).catch(() => {});
    log({ kind: 'lifecycle', phase: 'error', summary: `import "${p.name}" failed: ${msg}`, level: 'error' });
    console.error(`curator_import pack=${p.name} failed:`, err);
  } finally {
    importing.delete(p.id); // freed so a retry (re-post status='importing') re-fires
    setStatus(cur, 'online');
    if (dir) { const { rm } = await import('node:fs/promises'); await rm(dir, { recursive: true, force: true }).catch(() => {}); }
  }
}

  return { walkSkillMd, curatorImport };
}
