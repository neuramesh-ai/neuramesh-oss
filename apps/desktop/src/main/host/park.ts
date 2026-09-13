// Park (docs/harness/05 §3.8) — extracted from agents.ts (track B2).
//
// A turn that ends without the WORK ending: the agent parks on a condition (a CI result, a
// duration), the run stays open, and a later tick resumes it. settleOrphanedRuns is the
// other half — a run whose host died leaves a row nobody will ever step again.
//
// resumeFlow arrives as a thunk rather than a ctx field: it is a role flow defined far
// below this in startAgentHost, and a module cannot close over something declared after
// it. The thunk defers the lookup to call time, which is when it actually happens.
import { planPark, resumeNote, type ParkBook, type WakeCondition } from '../harness/park';
import { ghPrChecks, repoSlugFor } from './gh';
import type { PowerSyncDatabase } from '@powersync/node';
import type { HostQueue } from '../harness/hostqueue';
import type { HostedAgent, ExecTask } from '../agents';
import type { ToolHost } from '../harness/toolbus';
import type { HostCtx } from './ctx';

export interface ParkWiring {
  /** the claim facade — ephemeral by design, so a crashed host's work can be resumed */
  claimed: { has: (id: string) => boolean; add: (id: string) => unknown; delete: (id: string) => boolean };
  db: PowerSyncDatabase;
  parkBook: ParkBook;
  execQueue: HostQueue;
  agents: Map<string, HostedAgent>;
  /** deferred: the resume flow is declared after this service is built */
  resumeFlow: (agent: HostedAgent, t: ExecTask & { requirements_confirmed: number }) => Promise<void>;
}

export function makePark({ post, guards }: HostCtx, { db, parkBook, execQueue, agents, claimed, resumeFlow }: ParkWiring) {
  // the park bookkeeping lives in the guard registry (host/guards.ts)
  const { parkRequests, parkResumeNotes } = guards;
function parkFor(agent: HostedAgent, t: ExecTask, ch: { id: string }): NonNullable<ToolHost['park']> {
  return async (i) => {
    const condition: WakeCondition = i.until === 'ci' && i.prNumber
      ? { on: 'ci', prNumber: i.prNumber }
      : { on: 'duration', afterMs: (i.afterMinutes ?? 5) * 60_000 };
    const planned = planPark(
      { turnId: t.id, kind: 'work', agentId: agent.id, subject: { taskId: t.id, channelId: ch.id }, condition, prompt: i.note },
      Date.now(),
    );
    if (!planned.ok) return { ok: false, error: planned.reason };
    parkRequests.set(t.id, planned.record);
    return { ok: true };
  };
}

/**
 * The sweep's park pass: wake what is due, re-admit it, and let the watchdog see the rest.
 *
 * Rides the existing tick rather than adding a timer — a park is a wait, and a wait wants the
 * cadence the stall watchdog already runs on.
 */
async function runDueParks(): Promise<void> {
  const parked = parkBook.all();
  if (!parked.length) return;
  // CI verdicts for every PR anything is parked on, fetched once per sweep
  const ci: Record<number, 'pass' | 'fail' | 'pending' | 'none'> = {};
  for (const rec of parked) {
    if (rec.condition.on !== 'ci') continue;
    const row = await db.get<{ pr_number: number; org_name: string; name: string; clone_url: string | null; local_path: string | null }>(
      `select t.pr_number, r.org_name, r.name, r.clone_url, r.local_path from tasks t join repos r on r.id = t.repo_id where t.id = ?`,
      [rec.subject.taskId],
    ).catch(() => null);
    if (!row?.pr_number) { ci[rec.condition.prNumber] = 'none'; continue; } // no PR → nothing to wait for
    const slug = await repoSlugFor(row).catch(() => `${row.org_name}/${row.name}`);
    ci[rec.condition.prNumber] = (await ghPrChecks(undefined, slug, row.pr_number).catch(() => ({ verdict: 'pending' as const }))).verdict;
  }
  for (const { record, why } of parkBook.due({ ci }, Date.now())) {
    parkBook.release(record.turnId);
    const t = await db.get<ExecTask & { assignee_id: string }>(
      `select id, number, title, channel_id, kind, assignee_id, repo_id, base_ref, branch, requirements from tasks where id = ?`,
      [record.turnId],
    ).catch(() => null);
    const agent = t ? agents.get(t.assignee_id) : undefined;
    if (!t || !agent) continue; // the task moved on, or its agent is no longer hosted here
    console.log(`agent_park task=${t.number} waking (${why})`);
    // the resume note carries WHY, so the agent continues rather than restarting
    parkResumeNotes.set(t.id, resumeNote(record, why));
    claimed.delete(t.id); // release the in-flight guard so the queue admits it again
    execQueue.run(
      { key: t.id, kind: 'work', cause: 'park', agentId: agent.id, subject: { kind: 'task', number: t.number } },
      () => resumeFlow(agent, { ...t, requirements_confirmed: 1 }),
    );
  }
}

async function settleOrphanedRuns(agent: HostedAgent): Promise<void> {
  const rows = await db.getAll<{ id: string; title: string }>(
    `select id, title from runs where agent_id = ? and state = 'running'`, [agent.id],
  ).catch(() => [] as Array<{ id: string; title: string }>);
  if (!rows.length) return;
  const actor = { kind: 'agent', id: agent.id, role: agent.role };
  for (const r of rows) {
    await post('/v1/commands', actor, {
      type: 'run.settle', runId: r.id, state: 'stopped',
      summary: 'stopped — the host restarted while this was running',
    }).catch(() => {});
  }
  console.log(`run_recover agent=${agent.name} settled=${rows.length} (orphaned by a host restart)`);
}

  return { parkFor, runDueParks, settleOrphanedRuns };
}
