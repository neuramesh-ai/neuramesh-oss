// A local message can arrive before its server-born thread. Watch both tables so
// routing waits for that thread, then wakes only the runtime that owns its kind.
// The same boundary applies to the boot/recovery sweep, including explicit mentions.
const conversationalThread = `left join threads t on t.id = m.thread_id and t.workspace_id = m.workspace_id
  where (m.thread_id is null or t.id is not null) and coalesce(t.kind, 'chat') <> 'coding'`;

export const feedMessagesQuery = `select m.id, m.channel_id, m.thread_id, m.author_kind, m.author_id, m.body
  from messages m ${conversationalThread}
  and m.task_id is null and m.created_at > ? order by m.created_at desc limit 30`;

export const sweepMessagesQuery = `select m.id, m.channel_id, m.task_id, m.thread_id, m.author_kind, m.author_id, m.body, m.created_at
  from messages m ${conversationalThread}
  and m.author_kind = 'human' and m.created_at > ? order by m.created_at asc limit 40`;
