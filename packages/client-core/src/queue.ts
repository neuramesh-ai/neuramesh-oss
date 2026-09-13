// THE NEEDS-YOU QUEUE (the mobile-cloud round, S3 — docs/12, docs/32): the two tenants of Home's
// top block merged into one list, newest ask first. Tasks parked on a human gate come through the
// NEEDS_YOU read; open decision cards through OPEN_DECISIONS_FOR_WORKSPACE. The ball rules are the
// SHARED ones (needsyou.ts) — a gate you answered in prose is waiting on an agent, a free-text card
// you replied to is handled — so the phone can never ask for something the desktop knows you did.
import { actionableByHuman, awaitingAgent, decisionHandled } from '@neuramesh/shared';

export interface QueueTask {
  id: string;
  number: number;
  title: string;
  state: string;
  channel_id: string;
  updated_at: string;
  last_human_msg_at: string | null;
  parent_task_id?: string | null;
}

export interface QueueDecision {
  id: string;
  channel_id: string;
  task_id: string | null;
  message_id: string | null;
  asker_id: string;
  question: string;
  /** jsonb on the server → JSON text in the replica: the nmq options, `[{label, description?}]` */
  options: string | null;
  allow_other: number | null;
  created_at: string;
  /** the conversation the card was asked in — the row's door */
  thread_id: string | null;
  human_replied_at: string | null;
}

export type QueueItem =
  | { kind: 'gate'; at: string; task: QueueTask }
  | { kind: 'question'; at: string; decision: QueueDecision; options: string[] };

/** the option labels, whatever shape the card stored them in — a bare string list or nmq objects */
export function decisionOptions(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.map((o) => (typeof o === 'string' ? o : o && typeof o === 'object' && 'label' in o ? String((o as { label: unknown }).label) : '')).filter(Boolean);
  } catch {
    return [];
  }
}

export function queueItems(tasks: readonly QueueTask[], decisions: readonly QueueDecision[]): QueueItem[] {
  const gates: QueueItem[] = tasks
    .filter((t) => actionableByHuman(t) && !awaitingAgent(t))
    .map((t) => ({ kind: 'gate', at: t.updated_at, task: t }));
  const asks: QueueItem[] = decisions
    .filter((d) => !decisionHandled({ status: 'open', created_at: d.created_at, allow_other: d.allow_other, human_replied_at: d.human_replied_at }))
    .map((d) => ({ kind: 'question', at: d.created_at, decision: d, options: decisionOptions(d.options) }));
  return [...gates, ...asks].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
