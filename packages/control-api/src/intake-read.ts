// THE INTAKE READ (round 9, live r9-002). The person must see the plan and the title within about two
// seconds of the send. The decision lands in Postgres about one second after the message
// (control-api src/intake.ts), but it reached the open thread in hq only after 7 to 10 s: the browser's
// replica takes the change on its own schedule (a pass, a long-poll that answers at once when anything
// else in the workspace moved, the tab lock), so one row could wait several turns.
//
// So the client that birthed a thread asks for its decision directly, once:
//   GET /v1/threads/:threadId/intake?workspace=…&wait=8
// The server answers at once when the decision is there. Else it holds the request until a commit in
// that workspace wakes it (the same NOTIFY hub as the replica long-poll, local-sync.ts syncWakeFor), and
// reads the one row again, at most every second, until the decision lands or the wait ends. The answer
// carries what the thread needs to draw at once: the decision, the kind, the workspace and the title.
// hq then also asks its replica for a pass, so the synced row follows within one request.
import type { Hono } from 'hono';
import type postgres from 'postgres';
import { intakeOf, threadKindOf, workspaceModeOf, type Actor, type IntakeDecision } from '@neuramesh/shared';
import { actorInWorkspace, sqlOf } from './credits';
import { syncWakeFor } from './local-sync';
import type { Store } from './store';

export interface ThreadIntakeRead {
  threadId: string;
  intake: IntakeDecision | null;
  kind: 'chat' | 'coding';
  workspaceMode: 'repo' | 'scratch' | null;
  title: string;
}

/** the longest a read holds, in seconds: the server's 6 s deadline plus the write */
export const INTAKE_READ_MAX_WAIT_S = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function readThreadIntake(sql: postgres.Sql, workspace: string, threadId: string): Promise<ThreadIntakeRead | null> {
  const [t] = await sql`select intake, kind, workspace_mode, title from threads where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid`;
  if (!t) return null;
  return { threadId, intake: intakeOf(t['intake'] ?? null), kind: threadKindOf(t['kind']), workspaceMode: workspaceModeOf(t['workspace_mode']), title: (t['title'] as string | null) ?? '' };
}

/**
 * Hold until the decision lands, a wake, or the deadline. `wake` resolves on a commit in the workspace
 * (or after its own cap); `sleep` is the fallback when no wake slot is free. Exported for the test.
 */
export async function awaitThreadIntake(o: {
  read: () => Promise<ThreadIntakeRead | null>;
  waitMs: number;
  wake: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<ThreadIntakeRead | null> {
  const now = o.now ?? Date.now;
  const deadline = now() + o.waitMs;
  let row = await o.read();
  // When waitMs > 0, the client just queued the root message in its local outbox and may reach this
  // endpoint a moment before POST /v1/messages commits the thread row. Hold for both the row and intake.
  while (!row?.intake && now() < deadline) {
    await o.wake(Math.min(1_000, Math.max(0, deadline - now())));
    row = await o.read();
  }
  return row;
}

export function intakeReadRoutes(app: Hono<{ Variables: { actor: Actor } }>, store: Store): void {
  app.get('/v1/threads/:threadId/intake', async (c) => {
    const threadId = c.req.param('threadId');
    const workspace = c.req.query('workspace') ?? '';
    if (!UUID.test(threadId) || !UUID.test(workspace)) return c.json({ error: 'name the thread and the workspace', code: 'INVALID_INPUT' }, 400);
    if (!(await actorInWorkspace(store, c.get('actor'), workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'needs postgres', code: 'UNAVAILABLE' }, 503);
    const asked = Number(c.req.query('wait') ?? 0);
    const waitMs = Number.isFinite(asked) && asked > 0 ? Math.min(asked, INTAKE_READ_MAX_WAIT_S) * 1000 : 0;
    const started = Date.now();
    const hub = waitMs ? syncWakeFor(sql) : null;
    const signal = c.req.raw.signal;
    const row = await awaitThreadIntake({
      read: () => readThreadIntake(sql, workspace, threadId),
      waitMs,
      wake: async (ms) => {
        if (signal.aborted) throw new Error('aborted');
        const ticket = hub?.subscribe([workspace]);
        if (!ticket) { await new Promise((r) => setTimeout(r, Math.min(ms, 250))); return; }
        try { await ticket.wait(hub!.healthy ? ms : Math.min(ms, 250), signal); } finally { ticket.cancel(); }
      },
    }).catch(() => null);
    if (signal.aborted) return c.body(null, 204);
    if (!row) return c.json({ error: 'no such thread', code: 'NOT_FOUND' }, 404);
    if (waitMs) console.log(`thread_intake_read thread=${threadId} landed=${!!row.intake} waited_ms=${Date.now() - started}`);
    return c.json(row);
  });
}
