// THE CONVERSATION WORKSPACE — where a chat or task thread keeps the files it produces, what
// the agent may read back out of it, and the deep-work fan-out that outlives a wake.
//
// A subject's workspace is scratch that SURVIVES the turn: it is how 'what have we got' is
// answered from disk rather than from a transcript's summary of it. Extracted from agents.ts.

import type { HostedAgent } from '../agents';


import { adoptLegacyDir, planChatAdoption } from '../harness/migrate';

import { chatWorkspaceDir, legacyChatWorkspaceDir } from '../chatmode';


import { existsSync as existsSync_, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as os_ from 'node:os';
import { resolveInWorkspace, type SubjectRef } from '../harness/brain';
import { type LibDoc } from './orchtools';
import { type LogFn } from '../agentlog';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { makeRuns } from './runs';


import type { HostCtx } from './ctx';
import { makeDeepWork } from './deepwork';

export function makeWorkspace(ctx: HostCtx & {
  alog: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null, runId?: string | null) => LogFn;
  brain: Brain;
  claimed: { has: (id: string) => boolean; add: (id: string) => unknown; delete: (id: string) => boolean };
  db: PowerSyncDatabase;
  narrate: ReturnType<typeof makeRuns>['narrate'];
  openRun: ReturnType<typeof makeRuns>['openRun'];
  post: any;
  recordLegResult: (subject: SubjectRef, where: { channelId: string; taskId?: string | null }, leg: { role: string; label: string; turnId: string; out: string }) => void;
  wake: (agent: HostedAgent, m: { id: string; channel_id: string; body: string; thread_id?: string | null }) => Promise<void>;
  workspace: string;
}) {
const { brain, db } = ctx;

  // Split-out neighbours: same ctx, so every call below keeps the name it always used.
  const { deepWorkQuery, stageBrief, startDeepWork, readOnlyStudy } = makeDeepWork({ ...ctx, libraryDocs });

// ── The channel library, read from the local replica ──────────────────────────────────────
// The gap this closes: the orchestrator could route work about a product it could not read
// anything about. Its registry had no way to reach `artifacts` at all, so when a human asked
// "did you check the channel library", the honest answer was no — and rex instead blamed
// memory and a disconnected Drive, which is the worse failure of the two.
//
// Nothing new syncs: `artifacts.inline_content` is already in the replica (client-core
// schema), and the marketing bootstrap already reads a doc out of it by name. This only
// generalizes that read so every orchestrator turn — and every research leg — can do it.
/**
 * The documents an agent may read, by scope.
 *
 * `room` is the default and the ACL: an agent registered to a channel reads that channel's
 * shelf. `project` and `workspace` widen it — the same door whiteboards opened — for the case
 * an agent genuinely needs the team's wider record (brand voice written in #marketing while it
 * works in #build). Widening is opt-in per call rather than a standing grant, and the returned
 * rows always say WHICH room a document came from so the agent can cite it.
 */
async function libraryDocs(channelId: string, limit = 60, scope: 'room' | 'project' | 'workspace' = 'room'): Promise<LibDoc[]> {
  const cols = `a.name, a.kind, a.created_at, a.promoted, a.inline_content, a.mime, c.slug as room, p.name as project`;
  const from = `from artifacts a join channels c on c.id = a.channel_id left join projects p on p.id = c.project_id`;
  const [where, args]: [string, unknown[]] =
    scope === 'room' ? [`a.channel_id = ?`, [channelId]]
      : scope === 'project' ? [`c.project_id = (select project_id from channels where id = ?)`, [channelId]]
        : [`a.workspace_id = (select workspace_id from channels where id = ?)`, [channelId]];
  const rows = await db.getAll<LibDoc>(
    `select ${cols} ${from} where ${where} and a.inline_content is not null
      order by a.created_at desc limit ?`,
    [...args, limit * 3],
  ).catch(() => [] as LibDoc[]);
  // Supersede by name only WITHIN a room. Two projects may each keep a `brand-guidelines.md`,
  // and collapsing those to one would hand the agent another team's document under the name it
  // asked for, so the dedupe key carries the room. (latestByName keys on `name` alone, which is
  // right for its single-room callers; a wider scope needs the wider key.)
  const seen = new Set<string>();
  return rows
    .filter((r) => { const k = `${r.room ?? ''}\u0000${r.name}`; return seen.has(k) ? false : (seen.add(k), true); })
    .slice(0, limit);
}

// ── A subject's brain, as something an agent can actually reach ────────────────────────────
// docs/harness/01 keys the brain on the SUBJECT precisely so every agent that touches a thread
// reads and writes one place. The write side shipped for tasks and the read side shipped as a
// prompt block for workers — but a conversation got neither: its notes were never written, its
// fan-out results were never filed, and the orchestrator that owns the thread had no tool that
// could open the directory at all.

/** The subject a turn belongs to. A task thread is keyed by NUMBER; a conversation by its id. */
function subjectFor(t: { thread?: { number: number } | null; convoThreadId?: string | null }): SubjectRef | null {
  if (t.thread) return { kind: 'task', number: t.thread.number };
  return t.convoThreadId ? { kind: 'thread', id: t.convoThreadId } : null;
}

/**
 * A conversation's workspace, with its pre-merge directory adopted on first use.
 *
 * The adoption is here rather than in `chatWorkspaceDir` because that function is the pure half
 * of chat mode (testable with no disk, no database, no Electron) and a one-time move is neither.
 */
function ensureChatWorkspace(threadId: string): string {
  const dir = chatWorkspaceDir(os_.homedir(), threadId);
  try {
    adoptLegacyDir(legacyChatWorkspaceDir(os_.homedir(), threadId), dir, (line) => console.log(`agent_host ${line}`));
  } catch { /* a failed adoption costs the old files' presence, never the turn */ }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Sweep the rest of the pre-merge conversation directories in.
 *
 * `ensureChatWorkspace` only reaches a conversation somebody reopens, so a room's older threads
 * would keep their old directory forever — harmless, but it means `chats/` never empties and the
 * two-homes shape survives on disk for whoever looks next.
 *
 * It lives HERE rather than in the boot migration because the 12→16 mapping needs the thread ids,
 * and the migration runs before the replica is open (moving a live SQLite file corrupts it). The
 * daemon has both. Runs once per boot, costs one `existsSync` after the directory is gone.
 */
async function sweepLegacyChatDirs(): Promise<void> {
  const root = join(brain.root, 'chats');
  if (!existsSync_(root)) return;
  try {
    const dirs = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    if (!dirs.length) { rmSync(root, { recursive: true, force: true }); return; }
    const rows = await db.getAll<{ id: string }>(`select id from threads`).catch(() => [] as Array<{ id: string }>);
    const { matched, unmatched, ambiguous } = planChatAdoption(dirs, rows.map((r) => r.id));
    for (const m of matched) {
      adoptLegacyDir(join(root, m.dir), chatWorkspaceDir(os_.homedir(), m.threadId), (line) => console.log(`agent_host ${line}`));
    }
    // an unmatched directory is a thread that has not synced yet, or something we did not write.
    // Neither is ours to delete — it is named so it is not a silent leftover, and the next boot
    // retries it once its thread arrives.
    if (unmatched.length) console.log(`agent_host brain: ${unmatched.length} legacy chat dir(s) with no matching thread yet — left in place (${unmatched.slice(0, 5).join(', ')})`);
    if (ambiguous.length) console.warn(`agent_host brain: ${ambiguous.length} legacy chat dir(s) claimed by more than one thread — left in place rather than guessed (${ambiguous.join(', ')})`);
    if (!readdirSync(root).length) rmSync(root, { recursive: true, force: true });
  } catch (err) {
    console.warn(`agent_host brain: legacy chat sweep skipped: ${err instanceof Error ? err.message : 'error'}`);
  }
}

/** Files in a subject's workspace, newest first — what the conversation has actually produced. */
function workspaceListing(subject: SubjectRef, cap = 40): Array<{ name: string; bytes: number; modified: string }> {
  try {
    const dir = brain.open(subject).workspaceDir();
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => {
        const st = statSync(join(dir, e.name));
        return { name: e.name, bytes: st.size, modified: new Date(st.mtimeMs).toISOString() };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified))
      .slice(0, cap);
  } catch { return []; }
}

/**
 * Read one file out of a subject's workspace.
 *
 * The name is DATA — it comes from a model — so it is resolved against the workspace and the
 * result is checked to be INSIDE it. A prefix check on the joined path is what makes `../` and an
 * absolute path both impossible, rather than a blocklist of the spellings we thought of.
 */
function workspaceRead(subject: SubjectRef, name: string, cap = 24_000): { ok: true; body: string } | { ok: false; error: string } {
  try {
    const full = resolveInWorkspace(brain.open(subject).workspaceDir(), name);
    if (!full) return { ok: false, error: 'that path is outside this conversation’s workspace' };
    if (!existsSync_(full) || !statSync(full).isFile()) return { ok: false, error: `no file named "${name}" here — call list_workspace for the names` };
    const body = readFileSync(full, 'utf8');
    return { ok: true, body: body.length > cap ? `${body.slice(0, cap)}\n\n…(truncated — this file is ${body.length} characters)` : body };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 160) : 'could not read that file' };
  }
}


  return { deepWorkQuery, ensureChatWorkspace, libraryDocs, readOnlyStudy, stageBrief, startDeepWork, subjectFor, sweepLegacyChatDirs, workspaceListing, workspaceRead };
}
