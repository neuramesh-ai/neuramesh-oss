// Replica lookups the host does constantly — extracted from agents.ts (track B2).
//
// Small reads several flows need and none owns: which task a thread carries, which
// workspace a task belongs to, the seat's display label, and the run a task's legs hang
// off. Here rather than inlined per caller so "what does the host consider a task's
// workspace" has exactly one answer.
//
// resolveSeat deliberately stayed behind: it calls seatFor, which is declared thousands of
// lines further down startAgentHost, and a lookup module is the wrong place to invert that.
import type { PowerSyncDatabase } from '@powersync/node';
import type { HostCtx } from './ctx';
import type { HostedAgent } from '../agents';

/** who is answering, and whose configuration they inherited (null = the plain role) */
export interface Seat { agent: HostedAgent; from: { id: string; name: string } | null }

export interface LookupWiring {
  db: PowerSyncDatabase;
}

export function makeLookups({ guards }: HostCtx, { db }: LookupWiring) {
  const { taskRunIds } = guards;
async function taskOf(threadId: string | null): Promise<string | null> {
  if (!threadId) return null;
  const row = await db.get<{ task_id: string | null }>('select task_id from threads where id = ?', [threadId]).catch(() => null);
  return row?.task_id ?? null;
}

const seatLabel = (s: Seat): string => `${s.agent.role}·${s.agent.model}${s.from ? `·@${s.from.name}` : ''}`;

async function workspaceOf(channelId: string): Promise<string> {
  const ch = await db.get<{ workspace_id: string }>('select workspace_id from channels where id = ?', [channelId]);
  return ch?.workspace_id ?? '';
}

const parentRunOf = (taskId: string): string | null => taskRunIds.get(taskId) ?? null;

  return { taskOf, seatLabel, workspaceOf, parentRunOf };
}
