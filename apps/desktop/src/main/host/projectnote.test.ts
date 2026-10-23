import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { projectNote } from './projectnote';

test('conversation project context respects direct ownership, legacy fallback and workspace boundaries', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    create table projects(id text, workspace_id text, name text, slug text);
    create table channels(id text, workspace_id text, project_id text);
    create table threads(id text, channel_id text, project_id text);
    create table tasks(id text, channel_id text, project_id text);
    insert into projects values ('a','ws','Default','default'), ('b','ws','Product B','product-b'), ('c','other','Private','private');
    insert into channels values ('general','ws','a'), ('other','other','c');
    insert into threads values ('chat','general','b'), ('legacy','general',null), ('foreign','other','c');
    insert into tasks values ('work','general','b');
  `);
  const db = { getAll: async <T>(query: string, params: unknown[] = []) => sql.prepare(query).all(...params as Array<string | null>) as T[] };
  try {
    assert.match(await projectNote(db, 'general', { threadId: 'chat' }), /project “Product B” \(slug: product-b\)/);
    assert.match(await projectNote(db, 'general', { taskId: 'work' }), /project “Product B”/);
    assert.match(await projectNote(db, 'general', { threadId: 'legacy' }), /project “Default”/);
    assert.match(await projectNote(db, 'general', { threadId: 'foreign' }), /project “Default”/);
    assert.equal(await projectNote(db, 'missing'), '');
    sql.exec("update threads set project_id = 'c' where id = 'chat'");
    assert.equal(await projectNote(db, 'general', { threadId: 'chat' }), '');
  } finally { sql.close(); }
});
