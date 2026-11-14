import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { skillBody, workspaceSkills } from './workspace-skills';
import { resolveEngineeringDisplayContext } from '../relay/engineering-display-context';
import { requestEngineeringApproval } from '../relay/engineering-approvals';
import { defaultBaselineRules } from '@neuramesh/shared';
import type { ToolApprovalRequest } from '@cline/sdk';

test('workspace skill discovery and coding load cross rooms, deduplicate packs, and respect disabled/private skills', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`
    create table skills(id text, name text, description text, body text, version integer, updated_at text, channel_id text, workspace_id text, pack_id text, enabled integer, status text);
    create table skill_packs(id text, name text, workspace_id text, enabled integer);
    create table channels(id text, slug text, workspace_id text);
    create table threads(id text, channel_id text);
    insert into channels values ('here','here','ws');
    insert into threads values ('code','here');
    insert into skill_packs values ('old','team','ws',1),('new','team','ws',1),('off','disabled','ws',0),('foreign','private','private',1);
    insert into skills values
      ('1','procedure','','old',1,'2026-10-01','here','ws','old',1,'active'),
      ('2','procedure','','new',2,'2026-10-02','other-room','ws','new',1,'active'),
      ('3','disabled','','no',1,'2026-10-01',null,'ws',null,0,'active'),
      ('4','disabled-pack','','no',1,'2026-10-01','here','ws','off',1,'active'),
      ('5','draft','','no',1,'2026-10-01','here','ws',null,1,'draft'),
      ('6','secret','','no',1,'2026-10-01','here','private',null,1,'active'),
      ('7','bad-pack','','no',1,'2026-10-01','here','ws','foreign',1,'active');
  `);
  const db = { getAll: async <T>(query: string, params: unknown[] = []) => sql.prepare(query).all(...params as Array<string | number | null>) as T[] };
  try {
    const rows = await workspaceSkills(db, 'ws');
    assert.deepEqual(rows.map(row => row.name), ['procedure']);
    assert.match(skillBody(rows, 'procedure', 'team'), /new$/);
    assert.match(skillBody(rows, 'procedure', 'other'), /No enabled/);
    const context = await resolveEngineeringDisplayContext(db, 'http://127.0.0.1', 'ws', { threadId: 'code', actorId: 'user' } as never);
    const tool = context!.projectTools!().find(tool => tool.name === 'load_skill')!;
    assert.match(String(await tool.execute({ name: 'procedure', pack: 'team' })), /new$/);
    sql.exec("update skill_packs set enabled=0 where id='new'");
    assert.match(String(await tool.execute({ name: 'procedure', pack: 'team' })), /old$/);
    sql.exec("update skill_packs set enabled=0 where id='old'");
    assert.match(String(await tool.execute({ name: 'procedure' })), /No enabled/);
    assert.equal(await resolveEngineeringDisplayContext(db, 'http://127.0.0.1', 'private', { threadId: 'code', actorId: 'user' } as never), null);
  } finally { sql.close(); }
});

test('coding skill loads pass the real read approval gate and respect locked read restrictions', async () => {
  const controls = { mode: 'plan' as const, permissions: { read: true, edit: false, command: false, web: false, mcp: false }, policy: { read: true, edit: true, command: true, web: true, mcp: true } };
  const request = { toolCallId: 'skill-read', toolName: 'load_skill', input: { name: 'task-handoff' } } as ToolApprovalRequest;
  const pending = new Map<string, (approved: boolean) => void>();
  const noApproval = () => assert.fail('an enabled workspace skill is an automatic read');
  const approve = (rules = defaultBaselineRules()) => requestEngineeringApproval(request, controls, rules, pending, noApproval, () => {});
  assert.deepEqual(await approve(), { approved: true });
  assert.equal((await approve([{ id: 'no-reads', scope: 'workspace', capability: 'fs.read', selector: { kind: 'any' }, verdict: 'deny', locked: true }])).approved, false);
  assert.equal(pending.size, 0);
});
