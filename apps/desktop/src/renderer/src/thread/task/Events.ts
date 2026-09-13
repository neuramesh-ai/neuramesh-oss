// What the events log says about this task — who did each thing, the review verdicts, how many
// work attempts there were, and which provider drew the designs (the Claude Design deep link
// comes from the events, not from a guess at the URL). Split out of thread/TaskThread.tsx.
import { claudeDesignUrlFromText, designProviderFromEvents } from '@neuramesh/shared';
import type { AgentRow, MemberRow } from '../../bridge/rows-crew';
import type { MessageRow } from '../../bridge/rows-rooms';
import type { TaskRow } from '../../bridge/rows-board';

export function useTaskEvents(d: {
  detail: { events: Array<{ id: string; type: string; source: string; ts?: string; created_at?: string; occurred_at?: string; payload?: Record<string, unknown> }> } | null;
  agents: AgentRow[];
  members: MemberRow[];
  rows: MessageRow[];
  task: TaskRow;
}) {
  const { detail, agents, members, rows, task } = d;
// acceptance-contract + review-loop data — the header toks' drawers read from here
const who = (source: string): string => { const [kind, id] = source.split(':'); return kind === 'agent' ? `@${agents.find((a) => a.id === id)?.name ?? 'agent'}` : (members.find((m) => m.user_id === id)?.display_name ?? 'you'); };
const reviewT = (ts?: string) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
const events = detail?.events ?? [];
const designProvider = designProviderFromEvents(events.map((e) => ({ ...e, payload: e.payload ?? {} })));
const claudeDesignUrl = designProvider === 'claude-design'
  ? [...rows]
      .reverse()
      .filter((r) => r.author_kind === 'agent' && /Claude Design project ready|Keep editing the source in \[Claude Design\]/.test(r.body))
      .map((r) => claudeDesignUrlFromText(r.body))
      .find((url): url is string => !!url) ?? null
  : null;
const reviews = events.filter((e) => e.type === 'task.approved' || e.type === 'task.changes_requested');
const workAttempts = events.filter((e) => e.type === 'task.submitted').length;
let checks: string[] = [];
try { checks = task.requirements ? (JSON.parse(task.requirements) as string[]) : []; } catch { /* legacy rows */ }
  return { who, reviewT, events, designProvider, claudeDesignUrl, reviews, workAttempts, checks };
}
