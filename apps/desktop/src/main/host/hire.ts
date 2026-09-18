// Hiring and seats — executing an approved hire, the seat's brain, and the pack a room runs on.
// A hire is human-gated by construction: these EXECUTE a decision already made on a card.
// Split out of host/staffing.ts.
import { apiAuthHeaders } from '../apiauth';
import type { HostedAgent } from '../agents';
import { isCustomPackId, parseBrainOverride, resolvePackRoles, type AgentRole, type BrainOverride, type CustomModelPack } from '@neuramesh/shared';

import { planAgentHire, resolveHireRole } from '../hirecards';
import { hireQuestion } from '../hire';
import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { HostQueue } from '../harness/hostqueue';
import type { makeFlows } from './flows';
import type { HostCtx } from './ctx';

export function makeHire(ctx: HostCtx & {
  agents: Map<string, HostedAgent>;
  apiUrl: string;
  brain: Brain;
  claimed: { has: (id: string) => boolean; add: (id: string) => unknown; delete: (id: string) => boolean };
  db: PowerSyncDatabase;
  execQueue: HostQueue;
  machineId: string;
  ownerActorId: string;
  post: unknown;
  resumeFlow: ReturnType<typeof makeFlows>['resumeFlow'];
  workspace: string;
}) {
const { apiUrl, db, machineId, ownerActorId, post } = ctx;
const { customPackCache  } = ctx.guards;

// ── Capacity failover (docs/22 §9): a usage cap → a human-confirmed re-seat ──────────────
// Detection is deterministic (classifyExecError → composeFailover over the live logins); the human
// is the only actor who can apply it (the card is HUMAN_ONLY to answer). One card per (workspace,
// model); the exhausted task is parked WITHOUT the futile 4s retry on the capped model. NOTE: the
// card's auto-revert toggle is captured in the payload but the reset-detection sweep is a follow-up
// (docs/22 slice 4) — v1 applies the switch and reports; the human reverts in Settings.

// B3 (agent channel scoping): a human tagged a workspace agent that ISN'T in this channel.
// Agents only see the rooms they're added to, so it can't answer — instead the orchestrator
// posts an nmq "add @agent?" card. Clicking "Add @agent" posts "…→ Add @agent" back, which the
// channel watch routes to confirmAddAgent. Membership is host-enforced — no LLM round-trip.

async function customPacksFor(workspaceId: string): Promise<CustomModelPack[]> {
  const hit = customPackCache.get(workspaceId);
  if (hit && Date.now() - hit.at < 60_000) return hit.packs;
  try {
    const r = await fetch(`${apiUrl}/v1/model-packs?workspace=${workspaceId}`, {
      headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: ownerActorId }),
    });
    const packs = r.ok ? ((await r.json()) as { packs?: CustomModelPack[] }).packs ?? [] : [];
    customPackCache.set(workspaceId, { at: Date.now(), packs });
    return packs;
  } catch { return hit?.packs ?? []; }
}

/**
 * The conversation's own brain (docs/10 §15), by thread id or by the task whose thread it is.
 *
 * Read from the local replica on every wake, which is what makes "a running turn finishes on
 * the model it started with" true by construction: the override is looked up when a seat is
 * taken, and a seat is taken once per run.
 */
async function threadBrain(scope: { threadId?: string | null; taskId?: string | null }): Promise<BrainOverride | null> {
  const row = scope.threadId
    ? await db.get<{ brain_override: string | null }>('select brain_override from threads where id = ?', [scope.threadId]).catch(() => null)
    : scope.taskId
      // a task's own thread, else the conversation that OWNS the unit (tasks.origin_thread_id, docs/41):
      // switching that conversation to the Starter brain re-seats the unit's legs too (2026-09-16)
      ? await db.get<{ brain_override: string | null }>('select brain_override from threads where task_id = ? union all select th.brain_override from tasks t join threads th on th.id = t.origin_thread_id where t.id = ? limit 1', [scope.taskId, scope.taskId]).catch(() => null)
      : null;
  return parseBrainOverride(row?.brain_override ?? null);
}

async function activePackRoles(workspaceId: string): Promise<Record<AgentRole, string> | null> {
  const hdrs = { headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: ownerActorId }) };
  try {
    const r = await fetch(`${apiUrl}/v1/workspaces`, hdrs);
    if (!r.ok) return null;
    const j = (await r.json()) as { workspaces?: Array<{ id: string; activeModelPack?: string | null }> };
    const packId = j.workspaces?.find((w) => w.id === workspaceId)?.activeModelPack ?? null;
    let custom: CustomModelPack[] = [];
    if (packId && isCustomPackId(packId)) {
      const pr = await fetch(`${apiUrl}/v1/model-packs?workspace=${workspaceId}`, hdrs);
      custom = pr.ok ? ((await pr.json()) as { packs?: CustomModelPack[] }).packs ?? [] : [];
    }
    return resolvePackRoles(packId, custom);
  } catch {
    return null;
  }
}

// Resolve + execute a hire the human approved: look up the name, run the pure
// decision table, then register / degrade to add-to-channel / refuse. Never
// offers — callers decide (the confirm path auto-offers; the LLM tool chains).
async function executeHire(
  orch: HostedAgent,
  channelId: string,
  input: { name: string; role: string; description?: string | null; brief?: string | null },
): Promise<{ ok: boolean; rehired: boolean; degradedToAdd: boolean; model?: string; runtime?: string; detail: string }> {
  const ch = await db.get<{ workspace_id: string; slug: string }>('select workspace_id, slug from channels where id = ?', [channelId]).catch(() => null);
  if (!ch) return { ok: false, rehired: false, degradedToAdd: false, detail: 'channel not found' };
  const name = input.name.trim().toLowerCase();
  const [existing] = await db.getAll<{ role: string; retired_at: string | null; in_channel: number }>(
    `select a.role, a.retired_at, exists(select 1 from agent_channels ac where ac.agent_id = a.id and ac.channel_id = ?) as in_channel
     from agents a where a.workspace_id = ? and a.name = ? limit 1`,
    [channelId, ch.workspace_id, name],
  ).catch(() => [] as Array<{ role: string; retired_at: string | null; in_channel: number }>);
  const plan = planAgentHire({
    name,
    role: input.role.trim().toLowerCase(),
    description: input.description ?? null,
    brief: input.brief ?? null,
    existing: existing ? { role: existing.role, retired: !!existing.retired_at, inChannel: !!existing.in_channel } : null,
    packRoles: await activePackRoles(ch.workspace_id),
    orchestrator: { model: orch.model, runtime: orch.runtime },
    workspace: ch.workspace_id,
    machineId,
    channelId,
  });
  const actor = { kind: 'agent', id: orch.id, role: 'orchestrator' };
  if (plan.action === 'refuse') return { ok: false, rehired: false, degradedToAdd: false, detail: plan.reason };
  if (plan.action === 'add_to_channel') {
    const r = await post('/v1/commands', actor, { type: 'channel.add_agent', workspace: ch.workspace_id, channel: channelId, agent: name }).catch(() => null);
    return r?.ok
      ? { ok: true, rehired: false, degradedToAdd: true, detail: plan.reason }
      : { ok: false, rehired: false, degradedToAdd: true, detail: `${plan.reason} — but adding them failed (${r ? r.status : 'offline'})` };
  }
  const r = await post('/v1/commands', actor, plan.cmd).catch(() => null);
  if (!r?.ok) return { ok: false, rehired: plan.rehire, degradedToAdd: false, detail: `agent.register failed (${r ? `${r.status}: ${(await r.text().catch(() => '')).slice(0, 140)}` : 'offline'})` };
  return { ok: true, rehired: plan.rehire, degradedToAdd: false, model: plan.model, runtime: plan.runtime, detail: `hired @${name} (${input.role})` };
}

// The human clicked the hire card's accept ("**Hire a new agent for #ch…?** →
// Hire @name (role)"): execute deterministically — no LLM turn — then offer the
// waiting task. The brief rides the CARD's nmq JSON (`hire` field), not the
// answer line, so recover it from the orchestrator's own recent card message;
// unrecoverable → hire proceeds with no brief. `roleText` is the answer line's
// raw parenthesized capture — LLM-authored, so it may be a specialty ("marketing
// strategist") rather than a role: resolve it against the card JSON's machine
// role, falling back to `worker` with the specialty preserved as the brief (the
// #1010 failure: an unmatchable label dropped the human's click entirely).
// Every path posts an outcome — the human clicked a button and must see what happened.
async function confirmCreateAgent(orch: HostedAgent, channelId: string, name: string, roleText: string, taskNumber?: number) {
  const ch = await db.get<{ workspace_id: string; slug: string }>('select workspace_id, slug from channels where id = ?', [channelId]).catch(() => null);
  if (!ch) return;
  const actor = { kind: 'agent', id: orch.id, role: 'orchestrator' };
  const say = (body: string) => post('/v1/messages', actor, { workspace: ch.workspace_id, channel: channelId, body }).catch(() => {});
  let brief: string | null = null;
  let cardRole: string | null = null;
  try {
    const cards = await db.getAll<{ body: string }>(
      `select body from messages where channel_id = ? and author_kind = 'agent' and body like '%\`\`\`nmq%' order by created_at desc limit 12`,
      [channelId],
    );
    const wanted = hireQuestion(ch.slug, taskNumber);
    let found = false;
    for (const c of cards) {
      for (const m of c.body.matchAll(/```nmq\s*\n([\s\S]*?)```/g)) {
        const parsed = JSON.parse(m[1]!) as { question?: string; hire?: { name?: string; role?: string; brief?: string | null } };
        if (parsed.question === wanted && parsed.hire?.name === name) {
          if (typeof parsed.hire.brief === 'string') brief = parsed.hire.brief;
          if (typeof parsed.hire.role === 'string') cardRole = parsed.hire.role;
          found = true;
          break;
        }
      }
      if (found) break;
    }
  } catch { /* structured recovery only — never parse prose */ }
  const { role, fellBack } = resolveHireRole(roleText, cardRole);
  // a drifted label ("marketing strategist") is the specialty, not a role — keep it as
  // the remit so the hire loses nothing (the card's own brief wins when present)
  if (fellBack && !brief) brief = roleText.trim();
  const hired = await executeHire(orch, channelId, { name, role, brief });
  if (!hired.ok) { await say(`Couldn't hire @${name}: ${hired.detail}`); return; }
  const lead = hired.degradedToAdd
    ? `@${name} (${role}) already existed elsewhere in this workspace — added them to #${ch.slug} instead of hiring a duplicate.`
    : `Hired @${name} (${role}) into #${ch.slug}${hired.model ? ` — ${hired.model} via ${hired.runtime}` : ''}.${hired.rehired ? ' (Rehired — their history is intact.)' : ''}`;
  if (!taskNumber) { await say(lead); return; }
  // hand them the waiting task; requirements were resolved at creation, so the
  // stored checklist rides the offer (the offerPlanToWorker idiom)
  const [t] = await db.getAll<{ id: string; requirements: string | null; state: string; kind: string | null }>(
    `select id, requirements, state, kind from tasks where channel_id = ? and number = ?`, [channelId, taskNumber],
  ).catch(() => [] as Array<{ id: string; requirements: string | null; state: string; kind: string | null }>);
  if (!t) { await say(`${lead} #${taskNumber} wasn't found in this room, so nothing was offered.`); return; }
  let checklist: string[] = [];
  try { checklist = JSON.parse(t.requirements ?? '[]') as string[]; } catch { /* none */ }
  const offer = await post('/v1/commands', actor, {
    type: 'task.offer', taskId: t.id, offerTo: name, checklist: checklist.length ? checklist : ['requirements resolved in thread'],
    // routing requires a category (docs/16) and an uncategorized intake refused this offer
    // outright (the hire-gate stall's second leg). The deterministic relay carries the
    // daemon's standard default when triage never set one, same as the other code routes.
    kind: t.kind ?? 'feature',
  }).catch(() => null);
  // a 4xx here means the task moved or the server refused — the hire still stands;
  // name the reason instead of pretending the offer landed
  if (offer?.ok) { await say(`${lead} Offered #${taskNumber} to them.`); return; }
  const why = offer ? ((await offer.text().catch(() => '')).slice(0, 160) || `status ${offer.status}`) : 'the command did not reach the server';
  await say(`${lead} Couldn't offer #${taskNumber}: ${why}`);
}

async function activePackId(ws: string): Promise<string | null> {
  try {
    const r = await fetch(`${apiUrl}/v1/workspaces`, { headers: await apiAuthHeaders(apiUrl, { kind: 'human', id: ownerActorId }) });
    if (!r.ok) return null;
    const j = (await r.json()) as { workspaces?: Array<{ id: string; activeModelPack?: string | null }> };
    return j.workspaces?.find((w) => w.id === ws)?.activeModelPack ?? null;
  } catch { return null; }
}

  return { executeHire, confirmCreateAgent, activePackRoles, activePackId, customPacksFor, threadBrain };
}
