import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { feedMessagesQuery, sweepMessagesQuery } from './chat-message-queries';

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`create table messages (id text, workspace_id text, channel_id text, task_id text, thread_id text, author_kind text, author_id text, body text, created_at text);
    create table threads (id text, workspace_id text, kind text);`);
  const message = (id: string, thread: string | null, task: string | null = null) => db.prepare('insert into messages values (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'workspace', 'general', task, thread, 'human', 'owner', '@rex please help', '2026-10-12T01:00:00Z');
  const ids = (query: string) => db.prepare(query).all('2026-10-12T00:00:00Z').map(row => row['id']).sort();
  return { db, message, ids };
}

for (const [name, query] of [['live watch', feedMessagesQuery], ['recovery sweep', sweepMessagesQuery]] as const) {
  test(`${name} waits for the thread row and never routes a coding birth to chat`, () => {
    const { db, message, ids } = fixture();
    try {
      message('coding-root', 'code');
      message('chat-root', 'chat');
      assert.deepEqual(ids(query), []);
      db.exec("insert into threads values ('code', 'workspace', 'coding'), ('chat', 'workspace', 'chat')");
      assert.deepEqual(ids(query), ['chat-root']);
      message('coding-followup', 'code');
      assert.deepEqual(ids(query), ['chat-root']);
      db.exec("update threads set kind = 'coding' where id = 'chat'");
      assert.deepEqual(ids(query), []);
    } finally { db.close(); }
  });

  test(`${name} preserves feed and legacy chats and rejects a mismatched workspace thread`, () => {
    const { db, message, ids } = fixture();
    try {
      message('feed', null);
      message('legacy', 'old');
      message('foreign', 'foreign');
      db.exec("insert into threads values ('old', 'workspace', null), ('foreign', 'another', 'chat')");
      assert.deepEqual(ids(query), ['feed', 'legacy']);
      message('task', null, 'task');
      assert.deepEqual(ids(query), name === 'recovery sweep' ? ['feed', 'legacy', 'task'] : ['feed', 'legacy']);
    } finally { db.close(); }
  });
}
