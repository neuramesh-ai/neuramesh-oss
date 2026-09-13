// What a chat turn needs around it — who answers by default, what mode a thread is in, the
// recall and skill lookups, the permission gate, and how produced files reach the thread.
//
// The default responder is the LAST agent who spoke, then the orchestrator: a conversation
// continues with whoever was having it, which is why this is a lookup and not a route.
// Split out of host/chatturn.ts.


import { buildPermissionCardBody, permissionQuestion, policyGateOutcome, toolCallToAction, protectedPathsFromRules, rowsToRules, CHAT_WHERE, cleanIntent, intentPrompt, type PolicyRowLite } from '../policygate';
import { defaultBaselineRules, isChatThread, mergePolicies } from '@neuramesh/shared';
import { awaitDecision, imageDataUri, runtimeFor } from '../agents';
import { fileDropBody, isImageFile, pickDeliverables, pickResponder, type ChatFile } from '../chatmode';
import type { HostedAgent, SkillRef } from '../agents';
import type { LogFn } from '../agentlog';
import type { HostCtx } from './ctx';

export function makeChatSupport(ctx: HostCtx & {
  db: import('@powersync/node').PowerSyncDatabase;
  agents: Map<string, HostedAgent>;
  apiGet: (path: string, actor: { kind: string; id: string; role?: string }) => Promise<any>;
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
}) {
const { post, db, agents, discoverSkills } = ctx;

async function defaultResponder(orch: HostedAgent, channelId: string, threadId: string): Promise<HostedAgent> {
  if (!isChatThread(await threadModeFor(threadId))) return orch;
  const rows = await db
    .getAll<{ author_kind: string; author_id: string }>(
      `select author_kind, author_id from messages where thread_id = ? order by created_at desc limit 30`,
      [threadId],
    )
    .catch(() => [] as Array<{ author_kind: string; author_id: string }>);
  const inRoom = [...agents.values()].filter((a) => a.channels.has(channelId));
  return (pickResponder(rows, inRoom, { newestFirst: true }) as HostedAgent | null) ?? orch;
}

/**
 * The conversation's mode, read from the replica (docs/34).
 *
 * Absent row, absent column (a replica that predates 0099), unreadable — all resolve to
 * 'tasks' via threadModeOf. The default has to be the SAFE one: a sync hiccup that turned
 * board threads into chats would silently stop routing everyone's work, while the reverse
 * merely triages a message the human wanted answered.
 */
async function threadModeFor(threadId: string): Promise<string> {
  const rows = await db
    .getAll<{ mode: string | null }>('select mode from threads where id = ? limit 1', [threadId])
    .catch(() => [] as Array<{ mode: string | null }>);
  return rows[0]?.mode ?? 'tasks';
}

// Workspace memory for a chat turn — the same /v1/recall the orchestrator's tool uses, so a
// conversation answers from the team's record instead of the model's guess.
async function recallFor(workspaceId: string, _channelId: string, query: string): Promise<string> {
  const res = await post('/v1/recall', { kind: 'agent', id: 'chat' }, { workspace: workspaceId, query, k: 6 }).catch(() => null);
  if (!res?.ok) return 'recall is unavailable right now';
  const { hits } = (await res.json()) as { hits: Array<{ body: string; channel: string; createdAt: string }> };
  if (!hits.length) return 'no matches in workspace memory';
  return hits.map((h) => `[#${h.channel} ${h.createdAt.slice(0, 10)}] ${h.body.slice(0, 240)}`).join('\n---\n');
}

// …and the skill bodies, resolved through the same discovery the board turn uses.
async function loadSkillBody(channelId: string, workspaceId: string, name: string): Promise<string> {
  const sk = (await discoverSkills(channelId, workspaceId)).find((x) => x.name === name);
  return sk ? `# Skill: ${sk.name}\n${sk.description}\n\n${sk.body}` : `no active skill named "${name}" in this room`;
}

// A produced file's human-readable label for its card header: "competitor-teardown.md" reads
// as "Competitor teardown" without the agent having to name it twice.
function fileLabel(name: string): string {
  const base = (name.split('/').pop() ?? name).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : name;
}

// The human-added "agents can never read X" paths, as a kernel jail rather than a tool block —
// the same read executeFlow does, kept here so a chat is fenced identically to a task.
async function chatProtectedPaths(workspaceId: string): Promise<string[]> {
  return db
    .getAll<PolicyRowLite>('select id, scope, capability, selector, verdict, rationale, locked from policies where workspace_id = ?', [workspaceId])
    .then((rows) => protectedPathsFromRules(mergePolicies(defaultBaselineRules(), rowsToRules(rows))))
    .catch(() => [] as string[]);
}

// The permission card, thread-scoped. Identical policy, identical fail-closed default, identical
// card — only the context line differs ("in this chat" where a board task says "in #1042").
async function chatPermissionGate(
  agent: HostedAgent,
  ch: { id: string; slug: string; workspace_id: string },
  threadId: string,
  token: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<{ decision: 'allow' | 'deny'; reason?: string }> {
  const action = toolCallToAction(toolName, toolInput);
  if (!action) return { decision: 'allow' };
  const rows = await db
    .getAll<PolicyRowLite>('select id, scope, capability, selector, verdict, rationale, locked from policies where workspace_id = ?', [ch.workspace_id])
    .catch(() => [] as PolicyRowLite[]);
  const outcome = policyGateOutcome(action, mergePolicies(defaultBaselineRules(), rowsToRules(rows)));
  if (outcome.decision === 'allow') return { decision: 'allow' };
  if (outcome.decision === 'deny') return { decision: 'deny', reason: outcome.reason };
  // ask → the agent's own words on the card, elicited when the call carries no description
  let summary = typeof toolInput['description'] === 'string' ? (toolInput['description'] as string).trim().slice(0, 200) : '';
  if (!summary) {
    const p = intentPrompt(action, agent.name, CHAT_WHERE, '');
    summary = cleanIntent(
      await Promise.race([
        runtimeFor(agent.runtime).complete(p.system, p.user, token, agent.model, 120),
        new Promise<string>((r) => setTimeout(() => r(''), 8000)),
      ]).catch(() => ''),
    );
  }
  const res = await post('/v1/messages', { kind: 'agent', id: agent.id }, {
    workspace: ch.workspace_id, channel: ch.id, threadId,
    body: buildPermissionCardBody(action, outcome, agent.name, CHAT_WHERE, summary || undefined),
  }).catch(() => null);
  if (!res || !res.ok) return { decision: 'deny', reason: 'could not raise the approval request' };
  const messageId = ((await res.json().catch(() => ({}))) as { message?: { id?: string } }).message?.id;
  if (!messageId) return { decision: 'deny', reason: 'approval request had no id' };
  const answer = await awaitDecision(db, messageId, { threadId }, permissionQuestion(action, agent.name, CHAT_WHERE));
  return answer === 'Approve' ? { decision: 'allow' } : { decision: 'deny', reason: answer == null ? 'approval timed out — denied' : 'a human denied this action' };
}

/**
 * Files the turn produced → channel artifacts + inline cards in the thread.
 *
 * Deliberately a SWEEP rather than a tool the model must remember: "produce the deliverable as
 * real files here" is already how scratch tasks work, and a model that writes the file but
 * forgets to call `deliver_file` would have done the work and shown nothing for it.
 */
async function deliverChatFiles(
  agent: HostedAgent,
  ch: { id: string; slug: string; workspace_id: string },
  threadId: string,
  dir: string,
  since: number,
  log: LogFn,
): Promise<void> {
  const { readdir, readFile, stat } = await import('node:fs/promises');
  const { join, relative } = await import('node:path');
  const found: ChatFile[] = [];
  const walk = async (d: string, depth: number): Promise<void> => {
    if (depth > 4 || found.length > 400) return;
    for (const entry of await readdir(d).catch(() => [] as string[])) {
      const full = join(d, entry);
      const st = await stat(full).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) await walk(full, depth + 1);
      else found.push({ name: relative(dir, full), mtimeMs: st.mtimeMs, sizeBytes: st.size });
    }
  };
  await walk(dir, 0);
  const { take, dropped } = pickDeliverables(found, since);
  if (dropped.length) log({ kind: 'tool', phase: 'result', summary: `not attached: ${dropped.join(', ')}`, level: 'warn' });
  if (!take.length) return;

  const actor = { kind: 'agent', id: agent.id, role: agent.role };
  for (const f of take) {
    const isImg = isImageFile(f.name);
    // a NUL byte means binary — those stay on the machine (storage uploads are phase 2),
    // the same rule collectFiles applies to a scratch task's deliverables
    const content = isImg
      ? imageDataUri(join(dir, f.name))
      : await readFile(join(dir, f.name)).then((buf) => (buf.includes(0) ? null : buf.toString('utf8'))).catch(() => null);
    if (!content) { log({ kind: 'tool', phase: 'result', summary: `not attached: ${f.name} (unreadable or binary)`, level: 'warn' }); continue; }
    const res = await post('/v1/commands', actor, {
      type: 'artifact.create', channel: ch.id, kind: isImg ? 'file' : 'doc', name: f.name,
      inlineContent: content, ...(isImg ? { mime: 'image/png' } : { mime: 'text/markdown' }),
    }).catch(() => null);
    if (!res?.ok) { log({ kind: 'tool', phase: 'error', summary: `artifact ${f.name} failed`, level: 'warn' }); continue; }
    // an image has no readable body — its card is the artifact strip, so only text files
    // get the inline doc-drop message (a data URI pasted into a thread is not a preview)
    if (!isImg) {
      await post('/v1/messages', { kind: 'agent', id: agent.id }, {
        workspace: ch.workspace_id, channel: ch.id, threadId,
        body: fileDropBody(fileLabel(f.name), f.name, content),
      }).catch(() => {});
    }
    log({ kind: 'tool', phase: 'result', summary: `${f.name} delivered to the thread` });
  }
}

  return { defaultResponder, threadModeFor, recallFor, loadSkillBody, fileLabel, chatProtectedPaths, chatPermissionGate, deliverChatFiles };
}
