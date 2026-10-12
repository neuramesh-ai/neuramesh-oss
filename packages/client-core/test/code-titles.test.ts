import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { CODE_SESSIONS_FOR_WORKSPACE } from '../src/queries';

it('lists canonical titles as replica rows arrive while preserving standalone sessions and workspace scope', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`create table threads (id text primary key, workspace_id text, title text);
      create table code_sessions (id text primary key, thread_id text, project_id text, repo_id text, repo_name text, branch text,
        title text, mode text, state text, machine_id text, created_by text, last_line text, changes_count integer,
        checkpoints_count integer, created_at text, updated_at text, ended_at text, workspace_id text);
      insert into code_sessions (id, workspace_id, title) values ('new','a','A lengthy original prompt'),('legacy','a','Standalone session'),('foreign','b','Other workspace');`);
    const titles = () => db.prepare(CODE_SESSIONS_FOR_WORKSPACE).all('a').map(row => row.title);
    expect(titles()).toEqual(['A lengthy original prompt', 'Standalone session']);
    db.exec("insert into threads values ('new','a','Duration Formatter'),('legacy','b','Wrong workspace title')");
    expect(titles()).toEqual(['Duration Formatter', 'Standalone session']);
    db.exec("update threads set title = 'My chosen title' where id = 'new'; update code_sessions set title = 'Stale prompt' where id = 'new'");
    expect(titles()).toEqual(['My chosen title', 'Standalone session']);
    db.exec("update threads set title = '' where id = 'new'");
    expect(titles()).toEqual(['Stale prompt', 'Standalone session']);
  } finally { db.close(); }
});
