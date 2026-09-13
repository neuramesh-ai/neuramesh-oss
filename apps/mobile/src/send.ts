// EVERY SEND BIRTHS A SESSION (docs/35 §4.2; the mobile-cloud round D8 — the send is a LOCAL insert,
// so it lands in <50 ms and works offline): the client mints the thread id, the message is the
// thread's root (docs/31), and the birth columns ride it — `birth_mode` 'tasks' (docs/34 §14: the
// orchestrator decides), `birth_origin` 'web' (a phone is a web-born client: never "here"),
// `birth_machine` = the chip's explicit pick or nothing (Auto designates nothing; the ladder
// decides live). The uploader forwards them (client-core messageUploadInput) and the server births
// the thread transactionally with the message; the row syncs back down.
import { randomUUID } from 'expo-crypto';
import { getDb } from './system';

export async function sendSession(input: { workspace: string; channelId: string; body: string; authorId: string; machineId: string | null; taskId?: string | null; brain?: string | null }): Promise<string> {
  const threadId = randomUUID();
  const messageId = randomUUID();
  const t0 = Date.now();
  await getDb().execute(
    `insert into messages (id, workspace_id, channel_id, task_id, thread_id, root_message_id, birth_mode, birth_brain, birth_machine, birth_origin, author_kind, author_id, body, created_at, pinned)
     values (?, ?, ?, ?, ?, ?, 'tasks', ?, ?, 'web', 'human', ?, ?, ?, 0)`,
    [messageId, input.workspace, input.channelId, input.taskId ?? null, threadId, messageId, input.brain ?? null, input.machineId, input.authorId, input.body, new Date().toISOString()],
  );
  // the send budget is <50 ms (docs/05 §6) — said out loud in the dev log so a regression is visible
  if (__DEV__) console.log(`[nm] send ${Date.now() - t0}ms · thread ${threadId} · machine ${input.machineId ?? 'auto'}`);
  return threadId;
}

/** a reply INTO an existing session: no birth columns — the server ignores them on an existing thread anyway */
export async function sendReply(input: { workspace: string; channelId: string; threadId: string | null; taskId: string | null; body: string; authorId: string }): Promise<string> {
  const id = randomUUID();
  await getDb().execute(
    'insert into messages (id, workspace_id, channel_id, task_id, thread_id, author_kind, author_id, body, created_at, pinned) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
    [id, input.workspace, input.channelId, input.taskId, input.threadId, 'human', input.authorId, input.body, new Date().toISOString()],
  );
  // the id goes back so an attachment can name the message it belongs to — an artifacts row with a
  // null message_id is dropped by the ps_crud branch, so the picture would simply never arrive
  return id;
}
