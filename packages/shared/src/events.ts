import { monotonicFactory } from 'ulidx';
import { z } from 'zod';
import { isAddress } from './addressing';
import type { TransitionName } from './states';

const ulid = monotonicFactory();

export const EVENT_TYPES = [
  'message.posted',
  'task.created',
  'task.promoted',
  'task.reopened',
  'task.details_updated',
  'task.offered',
  'task.claimed',
  'task.requirements_confirmed',
  'task.plan_approved',
  'task.blocked',
  'task.unblocked',
  'task.submitted',
  'task.review_requested',
  'task.changes_requested',
  'task.approved',
  'task.accepted',
  'task.canceled',
  'task.archived',
  'task.plan_requested',
  'task.plan_proposed',
  'task.plan_revising',
  'task.design_requested',
  'task.design_provider_selected',
  'task.design_proposed',
  'task.design_revising',
  'task.design_approved',
  'task.ship_claimed',
  'task.ship_plan_proposed',
  'task.ship_plan_revising',
  'task.ship_plan_approved',
  'task.ship_item_checked',
  'task.ship_item_added',
  'task.shipped',
  'task.release_confirmed',
  'task.finished',
  'task.dod_set',
  'artifact.attached',
  'artifact.promoted',
  'artifact.deleted',
  'artifact.created',
  'whiteboard.created',
  'whiteboard.updated',
  // a Code session's synced row was born / closed (0135) — updates in between are silent, like heartbeats
  'code_session.created',
  'code_session.closed',
  'agent.registered',
  'agent.updated',
  'agent.retired',
  'agent.channels_synced',
  // a human joined or left a room's people roster (0094) — a roster move, not a grant
  'channel.people_synced',
  'credential.updated',
  'agent.online',
  'agent.offline',
  'machine.registered',
  'member.invited',
  'workspace.created',
  'workspace.updated',
  'workspace.deleted',
  'modelpack.saved',
  'modelpack.removed',
  'memory.block_refreshed',
  'memory.fact_reconciled',
  'memory.lesson_recorded',
  'memory.fact_retired',
  'decision.answered',
  'decision.dismissed',
  'policy.saved',
  'policy.deleted',
  'skill.created',
  'skill.proposed',
  'skill.promoted',
  'skill.updated',
  'skill.deprecated',
  'skill.enabled_set',
  'skillpack.created',
  'skillpack.committed',
  'skillpack.updated',
  'skillpack.enabled_set',
  'skillpack.removed',
  'project.created',
  'project.updated',
  'project.archived',
  'project.deleted',
  'channel.created',
  'channel.renamed',
  'channel.thread_mode_set',
  'channel.kind_set',
  'marketing.setup',
  'setup.step',
  'schedule.created',
  'schedule.updated',
  'schedule.deleted',
  'schedule.run_claimed',
  'schedule.result',
  'content.created',
  'content.approved',
  'content.unscheduled',
  'content.updated',
  'content.deleted',
  'connector.revoked',
  'channel.deleted',
  'repo.linked',
  'agent.connected_remote',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

const addressString = z.string().refine(isAddress, { message: 'invalid address' });

export const EventSchema = z.object({
  id: z.string().min(26).max(26),
  type: z.enum(EVENT_TYPES),
  source: addressString,
  target: addressString,
  workspace: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  in_reply_to: z.string().nullable().default(null),
  ts: z.string().datetime(),
});

export type NMEvent = z.infer<typeof EventSchema>;

export interface CreateEventInput {
  type: EventType;
  source: string;
  target: string;
  workspace: string;
  payload?: Record<string, unknown>;
  inReplyTo?: string;
}

export function createEvent(input: CreateEventInput): NMEvent {
  return EventSchema.parse({
    id: ulid(),
    type: input.type,
    source: input.source,
    target: input.target,
    workspace: input.workspace,
    payload: input.payload ?? {},
    in_reply_to: input.inReplyTo ?? null,
    ts: new Date().toISOString(),
  });
}

export const TRANSITION_EVENT: Record<TransitionName, EventType> = {
  promote: 'task.promoted',
  reopen: 'task.reopened',
  claim: 'task.claimed',
  cancel: 'task.canceled',
  block: 'task.blocked',
  unblock: 'task.unblocked',
  submit: 'task.submitted',
  request_changes: 'task.changes_requested',
  approve: 'task.approved',
  accept: 'task.accepted',
  archive: 'task.archived',
  request_plan: 'task.plan_requested',
  propose_plan: 'task.plan_proposed',
  revise_plan: 'task.plan_revising',
  request_design: 'task.design_requested',
  propose_design: 'task.design_proposed',
  revise_design: 'task.design_revising',
  approve_design: 'task.design_approved',
  claim_ship: 'task.ship_claimed',
  propose_ship_plan: 'task.ship_plan_proposed',
  revise_ship_plan: 'task.ship_plan_revising',
  approve_ship_plan: 'task.ship_plan_approved',
  execute_ship: 'task.shipped',
  confirm_release: 'task.release_confirmed',
  finish: 'task.finished',
};
