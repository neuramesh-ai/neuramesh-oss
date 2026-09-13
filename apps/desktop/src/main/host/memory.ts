// MEMORY IN THE LOOP — the lessons a room has learned, the recall a task carries into its
// context packet, and the post-approve mining that turns a review correction into a lesson.
//
// A lesson is a FACT with task provenance, injected into worker and reviewer prompts, so a
// corrected mistake is not repeated. Mining covers the runtimes with no tool to record one.
// Extracted from agents.ts (track B2).
import { apiAuthHeaders } from '../apiauth';
import { runtimeFor } from '../agents';
import type { HostedAgent } from '../agents';
import { formatRecallNote } from '../recallnote';

import { type LogFn } from '../agentlog';
import type { PowerSyncDatabase } from '@powersync/node';













import type { HostCtx } from './ctx';

export function makeMemory(ctx: HostCtx & {
  apiUrl: string;
  db: PowerSyncDatabase;
  ownerActorId: string;
  post: unknown;
  workspace: string;
}) {
const { apiUrl, db, ownerActorId, post } = ctx;

// Lessons the channel already learned from review corrections (kind='lesson'
// facts), formatted for a worker/reviewer prompt. Facts are server-side only
// (never synced), so this reads /v1/memory; '' when none or offline — the loop
// must never depend on memory being reachable.
async function channelLessons(workspaceId: string, channelId: string): Promise<string> {
  try {
    const r = await fetch(`${apiUrl}/v1/memory?workspace=${workspaceId}&channel=${encodeURIComponent(channelId)}`, {
      headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: ownerActorId }),
    });
    if (!r.ok) return '';
    const j = (await r.json()) as { facts?: Array<{ content: string; kind?: string; taskNumber?: number | null; validUntil: string | null }> };
    const lessons = (j.facts ?? []).filter((f) => f.kind === 'lesson' && !f.validUntil).slice(0, 6);
    if (!lessons.length) return '';
    return `\nLessons this team already learned from review corrections — do NOT repeat them:\n${lessons
      .map((l) => `- ${l.content}${l.taskNumber ? ` (from #${l.taskNumber})` : ''}`)
      .join('\n')}\n`;
  } catch {
    return '';
  }
}
// Top-k workspace memory recalled for THIS task at fan-out — the context-packet
// promise in docs/03 §6. One hybrid /v1/recall (FTS + vector when the embedder
// is on) so the worker starts warm instead of spending an in-loop tool turn
// asking; '' on failure or no hits — the loop never depends on memory being
// reachable. Workspace-wide on purpose: decisions land in other rooms.
async function taskRecallNote(workspaceId: string, query: string, lessonsNote: string): Promise<string> {
  if (query.length < 8) return '';
  try {
    const r = await fetch(`${apiUrl}/v1/recall`, {
      method: 'POST',
      headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: ownerActorId }),
      body: JSON.stringify({ workspace: workspaceId, query, k: 8 }),
    });
    if (!r.ok) return '';
    const j = (await r.json()) as { hits?: Array<{ kind: string; body: string; channel: string }> };
    return formatRecallNote(j.hits ?? [], lessonsNote);
  } catch {
    return '';
  }
}
// Post-approve lesson mining: an approved task that carries changes-requested rounds
// was CORRECTED on the way — distill the durable norm out of those corrections into
// channel memory (memory.record_lesson, reviewer actor, task provenance). This is the
// runtime-agnostic seam: it covers codex/agy workers that have no record_lesson tool.
// The write-side reconcile dedupes repeats; echo mode records a deterministic lesson.
async function mineLessons(
  reviewer: HostedAgent,
  t: { id: string; number: number; title: string },
  ch: { id: string; slug: string; workspace_id: string },
  token: string,
  live: boolean,
  log?: LogFn,
): Promise<void> {
  const rows = await db.getAll<{ author_kind: string; body: string }>(
    `select author_kind, body from messages where task_id = ? order by created_at asc limit 60`,
    [t.id],
  ).catch(() => [] as Array<{ author_kind: string; body: string }>);
  const corrections = rows.filter((m) => /changes requested/i.test(m.body));
  if (!corrections.length) return; // clean first-pass approval — nothing was corrected
  let lessons: string[];
  if (live) {
    const guidance = rows.filter((m) => m.author_kind === 'human').map((m) => m.body.slice(0, 400)).join('\n');
    const raw = await runtimeFor(reviewer.runtime).complete(
      'You distill durable team lessons from code-review corrections. A lesson is a one-sentence norm future tasks in this channel must not violate — general, concrete, ≤200 chars (e.g. "mock evidence HTML is review evidence, never committed — renders attach as artifacts"). Output at most 2 lessons, one per line, no bullets, no preamble. If the corrections are purely task-specific (a typo, a missed file) with no durable norm, output NOTHING.',
      `Task #${t.number}: ${t.title}\n\nReview corrections:\n${corrections.map((m) => `- ${m.body.slice(0, 400)}`).join('\n')}\n\nHuman guidance in the thread:\n${guidance || '(none)'}`,
      token, reviewer.model, 300,
    );
    lessons = raw.split('\n').map((s) => s.trim().replace(/^[-•*]\s*/, '')).filter((s) => s.length >= 12 && s.length <= 500).slice(0, 2);
  } else {
    lessons = [`[echo] lesson from #${t.number}: address review corrections before resubmitting`];
  }
  const actor = { kind: 'agent', id: reviewer.id, role: 'reviewer' };
  let recorded = 0;
  for (const content of lessons) {
    const r = await post('/v1/commands', actor, { type: 'memory.record_lesson', workspace: ch.workspace_id, channel: ch.id, content, taskId: t.id }).catch(() => null);
    if (r?.ok) recorded++;
  }
  if (recorded) {
    console.log(`lesson_mined task=${t.number} channel=${ch.slug} n=${recorded} mode=${live ? 'live' : 'echo'}`);
    log?.({ kind: 'tool', phase: 'call', summary: `mined ${recorded} lesson(s) from #${t.number}'s review corrections into channel memory` });
  }
}

  return { channelLessons, mineLessons, taskRecallNote };
}
