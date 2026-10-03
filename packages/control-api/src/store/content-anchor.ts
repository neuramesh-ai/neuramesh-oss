// a draft with no conversation gets one (George, 2026-09-27: Generate image failed on the web and
// the phone with "no conversation to ask in"). the first ask for its picture opens a session in the
// draft's room, and content.anchor moves the draft into it: the card shows there, and the next ask
// finds it. only a draft with no thread and no task moves, and only into a conversation in its own
// room, so an anchored draft never changes home.
//
// leaf helpers of both stores, kept out of pgstore.ts and memory.ts on their ratchets' own terms.
import type postgres from 'postgres';
import { DomainError } from '../errors';

const REFUSED = 'that draft already has a conversation, or the conversation is in another room';

/** the move and its event, in the caller's transaction: `event` receives the draft's workspace */
export async function anchorContentItemSql(sql: postgres.Sql, itemId: string, threadId: string, event: (workspace: string) => Promise<unknown>): Promise<{ id: string }> {
  const [row] = await sql<Array<{ workspace_id: string }>>`update content_items ci set thread_id = t.id
      from threads t
     where ci.id = ${itemId}::uuid and ci.thread_id is null and ci.task_id is null and ci.status in ('draft', 'scheduled')
       and t.id = ${threadId}::uuid and t.channel_id = ci.channel_id and t.workspace_id = ci.workspace_id
    returning ci.workspace_id`;
  if (!row) throw new DomainError('NOT_FOUND', REFUSED);
  await event(row.workspace_id);
  return { id: itemId };
}

type MemItem = { id: string; workspace: string; channelId: string; taskId: string | null; threadId: string | null; status: string };
type MemThread = { id: string; workspace: string; channel: string };

/** the memory twin: the same three conditions, the same refusal */
export function anchorContentItemMem(items: MemItem[], threads: MemThread[], itemId: string, threadId: string): string {
  const it = items.find((x) => x.id === itemId && !x.threadId && !x.taskId && (x.status === 'draft' || x.status === 'scheduled'));
  if (!it || !threads.some((t) => t.id === threadId && t.channel === it.channelId && t.workspace === it.workspace)) throw new DomainError('NOT_FOUND', REFUSED);
  it.threadId = threadId;
  return it.workspace;
}
