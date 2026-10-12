// THE MERGE WORD, READ (2026-10-05). accept_task applies the person's word on a done unit, and since every
// reply there wakes the orchestrator (shared threadwake.ts), a question, a "not yet" or a card's click
// reaches the turn that holds the tool. the server proves only that a person typed in the thread after the
// verdict (control-api handler.ts), so the tool reads the words: the person's newest typed message in the
// task's thread must tell it to merge or accept (shared isAcceptWord). a word it misses costs the person
// one more message, and a word it invents costs a merge that nobody can undo.
import { isAcceptWord, isCardOrMarker } from '@neuramesh/shared';

interface ReadDb { getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]> }

/** the person's newest typed message in the task's thread (a card's answer and a marker are no typing),
 *  or null when they typed none */
export async function newestTypedWord(db: ReadDb, taskId: string): Promise<string | null> {
  const rows = await db.getAll<{ body: string }>(
    `select body from messages where author_kind = 'human'
       and (task_id = ? or thread_id in (select id from threads where task_id = ?))
     order by created_at desc limit 20`,
    [taskId, taskId],
  ).catch(() => [] as Array<{ body: string }>);
  return rows.find((r) => !isCardOrMarker(r.body))?.body ?? null;
}

/** null when the person told the agent to merge or accept, else the tool's answer to the model */
export async function acceptRefusal(db: ReadDb, task: { id: string; number: number }): Promise<string | null> {
  const word = await newestTypedWord(db, task.id);
  if (word !== null && isAcceptWord(word)) return null;
  const said = word === null ? 'they typed nothing there' : `they wrote "${word.replace(/\s+/g, ' ').slice(0, 100)}"`;
  return `refused: the newest message the person typed in the #${task.number} thread does not tell you to merge or accept (${said}). Answer what they said. Nothing merges until they tell you to, in their own words.`;
}
