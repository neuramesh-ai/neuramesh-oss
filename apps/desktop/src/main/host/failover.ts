// Capacity failover — what happens when a model runs out mid-flight. The card is the human's;
// this parks the work and proposes the re-seat. Split out of host/staffing.ts.
import type { ExecTask, HostedAgent } from '../agents';
import { PACKS, buildFailoverCard, composeFailover, manualPinnedOnModel, planFailoverAgentUpdates, resolvePackRoles, runtimeForModel as runtimeForModelId, type AgentRole } from '@neuramesh/shared';
import { detectProviders } from '../runtime/detect';

import type { PowerSyncDatabase } from '@powersync/node';
import type { Brain } from '../harness/brain';
import type { HostQueue } from '../harness/hostqueue';
import type { makeFlows } from './flows';
import { FO_SEAT_SQL, foLabel, type FoSeat } from './staffing';
import type { HostCtx } from './ctx';

export function makeFailover(ctx: HostCtx & {
  activePackId: (ws: string) => Promise<string | null>;
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
const { agents, claimed, db, execQueue, post, resumeFlow , activePackId } = ctx;
const { exhaustedModels, failoverCarded, pendingFailover } = ctx.guards;

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

// `t` is null for a CHAT/THREAD wake: there is no claimed task to park or resume —
// the turn simply couldn't be answered — but the human still needs the card.
async function handleExhaustion(agent: HostedAgent, t: ExecTask | null, ch: { id: string; slug: string; workspace_id: string }): Promise<void> {
  const ws = ch.workspace_id;
  const model = agent.model;
  const seen = exhaustedModels.get(ws) ?? new Set<string>();
  seen.add(model); exhaustedModels.set(ws, seen);
  if (t) claimed.delete(t.id); // park — retrying the capped model is futile, so never re-enter resumeFlow here
  const key = `${ws}:${model}`;
  const existing = pendingFailover.get(ws);
  if (failoverCarded.has(key) && existing) {
    if (t) existing.parked.push({ agent, task: t }); // one card for this model already up — attach + stay quiet
    console.warn(`failover ${t ? `parked #${t.number}` : `on ${agent.name}'s reply`} — ${foLabel(model)} exhausted (card already up)`);
    return;
  }
  failoverCarded.add(key);
  const seats = await db.getAll<FoSeat>(FO_SEAT_SQL, [ws]).catch(() => [] as FoSeat[]);
  const activeRoles = {} as Record<AgentRole, string>;
  for (const s of seats) if ((s.model_source ?? 'pack') === 'pack') activeRoles[s.role as AgentRole] = s.model;
  const avail = await detectProviders().catch(() => null);
  if (!avail) { console.error('failover: provider detect failed'); return; }
  const currentPack = (await activePackId(ws)) ?? 'custom';
  const rec = composeFailover({ exhaustedModel: model, activeRoles, exhausted: [...seen], avail });
  const card = buildFailoverCard(rec, { exhaustedModel: model, avail, currentPack, revert: true }, foLabel);
  pendingFailover.set(ws, { rec, exhaustedModel: model, currentPack, channelId: ch.id, parked: t ? [{ agent, task: t }] : [] });
  const orch = [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(ch.id));
  const cardActor = { kind: 'agent', id: orch?.id ?? agent.id, role: orch ? 'orchestrator' : agent.role };
  await post('/v1/messages', cardActor, { workspace: ws, channel: ch.id, body: card.body }).catch(() => {});
  console.warn(`failover: ${foLabel(model)} usage-exhausted — card posted (${rec.kind}) for ${ws.slice(0, 8)}`);
}

async function confirmFailover(orch: HostedAgent, channelId: string, rawLabel: string): Promise<void> {
  const ch = await db.get<{ workspace_id: string }>('select workspace_id from channels where id = ?', [channelId]).catch(() => null);
  if (!ch) return;
  const ws = ch.workspace_id;
  const pending = pendingFailover.get(ws);
  if (!pending) return;
  const actor = { kind: 'agent', id: orch.id, role: 'orchestrator' };
  const say = (body: string) => post('/v1/messages', actor, { workspace: ws, channel: channelId, body }).catch(() => {});
  const label = rawLabel.trim();
  if (!/^switch to /i.test(label)) {
    pendingFailover.delete(ws);
    failoverCarded.delete(`${ws}:${pending.exhaustedModel}`);
    await say(`Holding — no switch. The parked work waits for ${foLabel(pending.exhaustedModel)} to recover; @mention me to re-check.`);
    return;
  }
  const rec = pending.rec;
  const seats = await db.getAll<FoSeat>(FO_SEAT_SQL, [ws]).catch(() => [] as FoSeat[]);
  let applied = 0; let summary = '';
  if (rec.kind === 'fall_forward') {
    for (const u of planFailoverAgentUpdates(rec, seats)) {
      const r = await post('/v1/commands', actor, { type: 'agent.update', agent: u.id, model: u.model, runtime: u.runtime, modelSource: 'pack' }).catch(() => null);
      if (r?.ok) applied++;
    }
    summary = `${rec.roles.join(' + ')} → ${foLabel(rec.to)}`;
  } else if (rec.kind === 'switch_pack') {
    const roles = resolvePackRoles(rec.packId, []); // switch targets a builtin -core pack — no custom lookup
    if (roles) {
      for (const s of seats.filter((a) => (a.model_source ?? 'pack') === 'pack' && (a.kind ?? 'local') !== 'remote')) {
        const m = roles[s.role as AgentRole] ?? roles.developer;
        const r = await post('/v1/commands', actor, { type: 'agent.update', agent: s.id, model: m, runtime: runtimeForModelId(m), modelSource: 'pack' }).catch(() => null);
        if (r?.ok) applied++;
      }
      // never swallow this: if the pointer doesn't move, the workspace disagrees with
      // the seats we just re-pointed and the next pack apply silently reverts them
      const ptr = await post('/v1/commands', actor, { type: 'workspace.update', workspace: ws, activeModelPack: rec.packId }).catch(() => null);
      if (!ptr?.ok) console.error(`failover: re-seated ${applied} agents but the workspace pack pointer did NOT move (${ptr?.status ?? 'network'}) — settings still read ${pending.currentPack}`);
    }
    summary = `workspace → ${PACKS[rec.packId]?.name ?? rec.packId}`;
  }
  const pinned = manualPinnedOnModel(pending.exhaustedModel, seats);
  const pinNote = pinned.length
    ? ` Heads up: ${pinned.map((p) => `@${agents.get(p.id)?.name ?? p.id}`).join(', ')} ${pinned.length === 1 ? 'is' : 'are'} pinned to ${foLabel(pending.exhaustedModel)} — a pack switch can't move ${pinned.length === 1 ? 'it' : 'them'}, so switch ${pinned.length === 1 ? 'it' : 'them'} by hand or they'll keep stalling.`
    : '';
  await say(`Done — re-seated ${applied} agent${applied === 1 ? '' : 's'} (${summary}). Picking the parked work back up on the new brain.${pinNote}`);
  const parked = pending.parked;
  pendingFailover.delete(ws);
  failoverCarded.delete(`${ws}:${pending.exhaustedModel}`);
  // resume after the reseat replicates to the agents map (so the turn runs on the new model)
  setTimeout(() => {
    for (const p of parked) {
      if (claimed.has(p.task.id)) continue;
      claimed.add(p.task.id);
      execQueue.run({ key: p.task.id, kind: 'work', cause: 'board', agentId: p.agent.id, subject: { kind: 'task', number: p.task.number } }, () => resumeFlow(p.agent, { ...p.task, requirements_confirmed: 1 }));
    }
  }, 3500);
}

  return { handleExhaustion, confirmFailover };
}
