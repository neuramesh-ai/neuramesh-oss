import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineeringSession, defaultBaselineRules, type EngineeringMachineOpenMeta } from '@neuramesh/shared';
import type { ToolApprovalRequest } from '@cline/sdk';
import { requestEngineeringApproval } from '../relay/engineering-approvals';
import {codingTaskProgress, runTaskCoding} from './coding-task-run';

const session = () => createEngineeringSession({id:'repo',name:'fixture',owner:'qa',branch:'main',root:null});

test('legacy tasks with no native coding thread retain their existing executor', async () => {
  const result = await runTaskCoding({
    db:{getAll:async()=>[],get:async()=>{throw new Error('No row found');}},
    task:{id:'legacy'}, engineering:()=>{throw new Error('Must not open a native session');},
  } as unknown as Parameters<typeof runTaskCoding>[0]);
  assert.equal(result,null);
});

test('an approved delegated coding task can edit and test without an attached reviewer', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'nm-task-permissions-'));
  const previousBrain = process.env.NM_BRAIN;
  process.env.NM_BRAIN = dir;
  t.after(() => {
    if (previousBrain === undefined) delete process.env.NM_BRAIN;
    else process.env.NM_BRAIN = previousBrain;
    rmSync(dir, { recursive: true, force: true });
  });
  mkdirSync(join(dir, 'cache/repos/fixture'), { recursive: true });
  const result = await runTaskCoding({
    db: { getAll: async () => [{ id: 'thread', created_by: 'human:owner', repo_name: 'fixture', description: 'Implement and test' }] },
    task: { id: 'task', repo_id: 'fixture', number: 1, title: 'Implement and test' }, agent: { id: 'developer' }, dir, context: '', log: () => {},
    engineering: () => ({ runTask: async (meta: EngineeringMachineOpenMeta) => {
      assert.equal(meta.mode, 'act');
      for (const request of [
        { toolName: 'apply_patch', input: { input: '*** Begin Patch\n*** Add File: hello.txt\n+Hello\n*** End Patch' } },
        { toolName: 'run_commands', input: { commands: ['npm test'] } },
      ]) {
        const decision = await requestEngineeringApproval({ ...request, toolCallId: request.toolName } as ToolApprovalRequest,
          meta, defaultBaselineRules(), new Map(), () => assert.fail('Routine work paused for approval'), () => {}, dir);
        assert.equal(decision.approved, true);
      }
      return 'Done';
    } }),
  } as unknown as Parameters<typeof runTaskCoding>[0]);
  assert.deepEqual(result, { note: 'Done', stopped: false });
});

test('parent progress uses public commentary and gives approval waits precedence', () => {
  const state=session();
  state.messages=[
    {id:'public',role:'assistant',body:'The formatter is implemented. I am checking boundary tests.',createdAt:'now'},
    {id:'internal',role:'reasoning',body:'Private reasoning should never be a parent update.',createdAt:'now'},
  ];
  assert.equal(codingTaskProgress(state),'The formatter is implemented. I am checking boundary tests.');
  state.pendingApproval={id:'approval',title:'Run npm test',category:'command',detail:'Verify the implementation',continuation:'verify'};
  assert.equal(codingTaskProgress(state),'Waiting for approval: Run npm test');
});
