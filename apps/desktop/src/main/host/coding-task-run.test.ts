import test from 'node:test';
import assert from 'node:assert/strict';
import {createEngineeringSession} from '@neuramesh/shared';
import {codingTaskProgress, runTaskCoding} from './coding-task-run';

const session = () => createEngineeringSession({id:'repo',name:'fixture',owner:'qa',branch:'main',root:null});

test('legacy tasks with no native coding thread retain their existing executor', async () => {
  const result = await runTaskCoding({
    db:{getAll:async()=>[],get:async()=>{throw new Error('No row found');}},
    task:{id:'legacy'}, engineering:()=>{throw new Error('Must not open a native session');},
  } as unknown as Parameters<typeof runTaskCoding>[0]);
  assert.equal(result,null);
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
