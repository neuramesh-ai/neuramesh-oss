import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { test } from 'vitest';
import { marketingThreadIds } from './marketing-activity';
test('marketing asks survive retitles and later replies without crossing workspaces', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('create table messages(workspace_id text,thread_id text,author_kind text,body text)');
  const add = db.prepare('insert into messages values (?,?,?,?)');
  add.run('one','chat','human','Run the hook batch playbook.');
  add.run('one','chat','agent','Here are your new hooks.');
  add.run('one','chat','human','Run the hook batch playbook.');
  add.run('one','plain','human','Run the tests and review our onboarding playbook');
  add.run('one','suggestion','agent','Run the hook batch playbook.');
  add.run('two','foreign','human','Run the hook batch playbook.');
  try {
    const adapter = { getAll: async <T>(sql: string, params: unknown[]) => db.prepare(sql).all(...params as string[]) as T[] };
    assert.deepEqual(await marketingThreadIds(adapter, 'one'), ['chat']);
  } finally { db.close(); }
});
