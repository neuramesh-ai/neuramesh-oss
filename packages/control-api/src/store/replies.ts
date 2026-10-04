// The reply queue's store (0146, the models-and-replies round): a leaf of both stores, the films
// store's shape. ONE interface, two implementations, carried as one property (`store.replies`).
// A row is one reply a person queued off a reply card: its time, the link its reminder opens, and
// what the person did with it. Synced (the card draws its slots from it); written only here.
import type postgres from 'postgres';
import type { ReminderState } from '@neuramesh/shared';

export interface ReplyRow {
  id: string;
  workspaceId: string;
  threadId: string | null;
  messageId: string;
  letter: string;
  platform: string;
  handle: string;
  draft: string;
  openUrl: string;
  dueAt: string;
  state: ReminderState;
  memberId: string;
  notifiedAt: string | null;
}
export interface ReplyQueueInput {
  workspaceId: string; threadId: string | null; messageId: string; memberId: string;
  rows: Array<{ letter: string; platform: string; handle: string; draft: string; openUrl: string; dueAt: string }>;
}
/** an agent's reply card in a routine session whose routine queues its replies, with no queue yet */
export interface PendingRoutineCard { messageId: string; workspaceId: string; threadId: string; body: string; createdAt: string; memberId: string; gap: number }

export interface ReplyStore {
  /** the reply card a queue hangs off: its workspace, its session and its body (the rows are read from it) */
  cardMessage(messageId: string): Promise<{ workspaceId: string; threadId: string | null; body: string } | null>;
  /** queue rows for one member off one card: a row queued again gets its new time and is owed again */
  queue(input: ReplyQueueInput): Promise<number>;
  /** one member's own row only; false when the row is not theirs */
  mark(id: string, memberId: string, state: ReminderState): Promise<boolean>;
  /** drop a member's owed rows on one card (Clear queue); the done ones stay as the record */
  clear(messageId: string, memberId: string): Promise<number>;
  /** queued rows whose time has come and no reminder went out yet, oldest first */
  due(nowIso: string, limit: number): Promise<ReplyRow[]>;
  /** the reminder went out: the row is due, and the cron never sends it again */
  markNotified(id: string, atIso: string): Promise<void>;
  /** routine cards since `sinceIso` that the server must queue (the routine's Replies part set a gap) */
  pendingRoutineCards(sinceIso: string, limit: number): Promise<PendingRoutineCard[]>;
}

const OWED: ReadonlySet<string> = new Set(['queued', 'due']);

// ── memory ─────────────────────────────────────────────────────────────────────────────────────
export class MemReplyStore implements ReplyStore {
  constructor(private readonly message: (id: string) => { workspace: string; threadId?: string | null; body: string } | undefined = () => undefined) {}
  rows: ReplyRow[] = [];
  async cardMessage(messageId: string): Promise<{ workspaceId: string; threadId: string | null; body: string } | null> {
    const m = this.message(messageId);
    return m ? { workspaceId: m.workspace, threadId: m.threadId ?? null, body: m.body } : null;
  }
  /** the routine cards the memory store would find by joining messages, threads and schedules: tests seed them */
  routineCards: PendingRoutineCard[] = [];
  async queue(input: ReplyQueueInput): Promise<number> {
    for (const r of input.rows) {
      const hit = this.rows.find((x) => x.messageId === input.messageId && x.letter === r.letter && x.memberId === input.memberId);
      if (hit) Object.assign(hit, { ...r, state: 'queued', notifiedAt: null });
      else this.rows.push({ id: crypto.randomUUID(), workspaceId: input.workspaceId, threadId: input.threadId, messageId: input.messageId, memberId: input.memberId, ...r, state: 'queued', notifiedAt: null });
    }
    return input.rows.length;
  }
  async mark(id: string, memberId: string, state: ReminderState): Promise<boolean> {
    const r = this.rows.find((x) => x.id === id && x.memberId === memberId);
    if (!r) return false;
    r.state = state;
    return true;
  }
  async clear(messageId: string, memberId: string): Promise<number> {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => !(r.messageId === messageId && r.memberId === memberId && OWED.has(r.state)));
    return before - this.rows.length;
  }
  async due(nowIso: string, limit: number): Promise<ReplyRow[]> {
    return this.rows.filter((r) => r.state === 'queued' && !r.notifiedAt && r.dueAt <= nowIso).sort((a, b) => a.dueAt.localeCompare(b.dueAt)).slice(0, limit);
  }
  async markNotified(id: string, atIso: string): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, { state: 'due', notifiedAt: atIso });
  }
  async pendingRoutineCards(sinceIso: string, limit: number): Promise<PendingRoutineCard[]> {
    return this.routineCards.filter((c) => c.createdAt >= sinceIso && !this.rows.some((r) => r.messageId === c.messageId)).slice(0, limit);
  }
}

// ── postgres ───────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
const iso = (v: unknown): string => new Date(v as string).toISOString();
const rowOf = (r: Row): ReplyRow => ({
  id: r['id'] as string, workspaceId: r['workspace_id'] as string, threadId: (r['thread_id'] as string | null) ?? null, messageId: r['message_id'] as string,
  letter: r['letter'] as string, platform: r['platform'] as string, handle: r['handle'] as string, draft: r['draft'] as string, openUrl: r['open_url'] as string,
  dueAt: iso(r['due_at']), state: r['state'] as ReminderState, memberId: r['member_id'] as string, notifiedAt: r['notified_at'] ? iso(r['notified_at']) : null,
});

export class PgReplyStore implements ReplyStore {
  constructor(private readonly sql: postgres.Sql) {}
  async cardMessage(messageId: string): Promise<{ workspaceId: string; threadId: string | null; body: string } | null> {
    const [m] = await this.sql`select workspace_id, thread_id, body from messages where id = ${messageId}::uuid`;
    return m ? { workspaceId: m['workspace_id'] as string, threadId: (m['thread_id'] as string | null) ?? null, body: m['body'] as string } : null;
  }
  async queue(input: ReplyQueueInput): Promise<number> {
    for (const r of input.rows) {
      await this.sql`insert into reply_reminders (workspace_id, thread_id, message_id, member_id, letter, platform, handle, draft, open_url, due_at)
        values (${input.workspaceId}::uuid, ${input.threadId}::uuid, ${input.messageId}::uuid, ${input.memberId}::uuid, ${r.letter}, ${r.platform}, ${r.handle}, ${r.draft}, ${r.openUrl}, ${r.dueAt}::timestamptz)
        on conflict (message_id, member_id, letter) do update set draft = excluded.draft, open_url = excluded.open_url, due_at = excluded.due_at,
          state = 'queued', notified_at = null, updated_at = now()`;
    }
    return input.rows.length;
  }
  async mark(id: string, memberId: string, state: ReminderState): Promise<boolean> {
    const rows = await this.sql`update reply_reminders set state = ${state}, updated_at = now() where id = ${id}::uuid and member_id = ${memberId}::uuid returning id`;
    return rows.length > 0;
  }
  async clear(messageId: string, memberId: string): Promise<number> {
    const rows = await this.sql`delete from reply_reminders where message_id = ${messageId}::uuid and member_id = ${memberId}::uuid and state in ('queued', 'due') returning id`;
    return rows.length;
  }
  async due(nowIso: string, limit: number): Promise<ReplyRow[]> {
    const rows = await this.sql`select * from reply_reminders where state = 'queued' and notified_at is null and due_at <= ${nowIso}::timestamptz order by due_at limit ${limit}`;
    return rows.map(rowOf);
  }
  async markNotified(id: string, atIso: string): Promise<void> {
    await this.sql`update reply_reminders set state = 'due', notified_at = ${atIso}::timestamptz, updated_at = now() where id = ${id}::uuid and state = 'queued'`;
  }
  async pendingRoutineCards(sinceIso: string, limit: number): Promise<PendingRoutineCard[]> {
    // the routine owner is a human whose id the schedule keeps as text (0082 created_by)
    const rows = await this.sql`select m.id, m.workspace_id, m.thread_id, m.body, m.created_at, s.created_by, (s.payload->>'replyGap')::int as gap
      from messages m join threads t on t.id = m.thread_id join schedules s on s.id = t.schedule_id
      where m.author_kind = 'agent' and m.created_at >= ${sinceIso}::timestamptz and position('\`\`\`nmreply' in m.body) > 0
        and s.created_by_kind = 'human' and (s.payload->>'replyGap') is not null
        and not exists (select 1 from reply_reminders r where r.message_id = m.id)
      order by m.created_at limit ${limit}`;
    return rows.map((r) => ({ messageId: r['id'] as string, workspaceId: r['workspace_id'] as string, threadId: r['thread_id'] as string, body: r['body'] as string, createdAt: iso(r['created_at']), memberId: r['created_by'] as string, gap: Number(r['gap']) }));
  }
}
