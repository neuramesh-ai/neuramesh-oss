import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { projectContext, projectLibrary, projectRepos } from './project-context';
import { brandNote } from './brandnote';
import { resolveEngineeringDisplayContext } from '../relay/engineering-display-context';

test('chat, marketing and coding read the same project shelf and repositories, including legacy files', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    create table projects(id text, workspace_id text, name text, slug text, context_channel_id text, brand_profile text, website text, logo_url text);
    create table channels(id text, workspace_id text, project_id text, slug text);
    create table threads(id text, workspace_id text, channel_id text, project_id text);
    create table tasks(id text, workspace_id text, channel_id text, project_id text);
    create table artifacts(id text, workspace_id text, project_id text, channel_id text, name text, kind text, inline_content text, storage_path text, created_at text);
    create table connectors(workspace_id text, project_id text, provider text, handle text, status text);
    create table repos(id text, workspace_id text, org_name text, name text, default_branch text);
    create table project_repos(project_id text, repo_id text, is_primary integer);
    insert into projects values ('a','ws','Default','default','general',null,null,null),('b','ws','Product B','b','product',null,null,null),('c','other','Private','c','private',null,null,null);
    insert into channels values ('general','ws','a','general'),('product','ws','b','product'),('marketing','ws','b','old-marketing'),('private','other','c','private');
    insert into threads values ('chat','ws','general','b'),('marketing-thread','ws','marketing','b'),('code','ws','product','b');
    insert into artifacts values ('1','ws',null,'marketing','business-profile.md','doc','Product B facts',null,'2026-10-01'),('old','ws','b',null,'business-profile.md','doc','Outdated B facts',null,'2026-09-01'),('2','ws','b',null,'brand-guidelines.md','doc','Product B voice',null,'2026-10-02'),('3','ws','a','general','wrong.md','doc','Wrong project',null,'2026-10-03'),('4','other','b','private','secret.md','doc','Wrong workspace',null,'2026-10-04');
    insert into repos values ('r1','ws','acme','product','main'),('r2','ws','acme','docs','main'),('foreign','other','private','secret','main');
    insert into project_repos values ('b','r1',1),('b','r2',0),('b','foreign',0);
  `);
  const db = { getAll: async <T>(query: string, params: unknown[] = []) => sql.prepare(query).all(...params as Array<string | number | null>) as T[] };
  try {
    for (const [threadId, channel] of [['chat', 'general'], ['marketing-thread', 'marketing'], ['code', 'product']]) {
      const at = { threadId };
      assert.equal((await projectContext(db, channel!, at))?.id, 'b');
      assert.deepEqual((await projectLibrary(db, channel!, 60, 'room', at)).map(row => row.name), ['brand-guidelines.md', 'business-profile.md']);
      assert.deepEqual((await projectRepos(db, channel!, at)).map(row => row.id), ['r1', 'r2']);
      assert.match(await brandNote(db, channel!, at), /business-profile.md/);
    }
    const context = await resolveEngineeringDisplayContext(db, 'http://127.0.0.1', 'ws', { threadId: 'code', actorId: 'user' } as never);
    const tools = context?.projectTools?.() ?? [];
    assert.deepEqual(tools.map(tool => tool.name), ['list_library', 'read_library_doc', 'list_repos', 'read_repo_file', 'list_repo_files', 'list_repo_changes']);
    assert.equal(await tools.find(tool => tool.name === 'read_library_doc')!.execute({ name: 'business-profile.md' }), 'Product B facts');
    const newer = sql.prepare("insert into artifacts values (?, 'ws', 'b', null, ?, 'doc', 'Recent note', null, '2026-10-24')");
    for (let i = 0; i < 310; i++) newer.run(`note-${i}`, `note-${i}.md`);
    const pages = await Promise.all([0, 60, 120, 180, 240, 300].map(offset => projectLibrary(db, 'general', 60, 'project', { threadId: 'chat' }, undefined, offset)));
    assert.equal(new Set(pages.flat().map(row => row.name)).size, 312);
    assert.equal(pages.flat().length, 312);
    assert.equal(await tools.find(tool => tool.name === 'read_library_doc')!.execute({ name: 'BUSINESS-PROFILE.MD' }), 'Product B facts');
    assert.match(await brandNote(db, 'general', { threadId: 'chat' }), /business-profile.md, brand-guidelines.md/);
    assert.deepEqual(await projectLibrary(db, 'general', 1, 'project', { threadId: 'chat' }, 'wrong.md'), []);
    sql.exec("update threads set project_id='c' where id='chat'");
    assert.equal(await projectContext(db, 'general', { threadId: 'chat' }), null);
    assert.deepEqual(await projectLibrary(db, 'general', 60, 'project', { threadId: 'chat' }), []);
  } finally { sql.close(); }
});
