import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDispatch} from './dispatch';
import type {HostedAgent, PlanTask} from '../agents';

test('plan revisions dispatch only to the selected specialist, including pre-claim offers', () => {
  for (const role of ['developer','marketer','architect'] as const) {
    for (const offered of [false,true]) {
      const owner={id:'owner',role,channels:new Set(['room'])} as HostedAgent;
      const architect={id:'architect',role:'architect',channels:new Set(['room'])} as HostedAgent;
      const calls:string[]=[];
      const ctx={agents:new Map([[architect.id,architect],[owner.id,owner]]),guards:{planned:new Set()},
        execQueue:{run:(_meta:unknown,fn:()=>void)=>fn()},architectFlow:(agent:HostedAgent)=>calls.push(agent.id),
      } as unknown as Parameters<typeof makeDispatch>[0];
      const dispatch=makeDispatch(ctx);
      const task={id:'task',channel_id:'room',assignee_id:offered?null:owner.id,offered_agent_id:owner.id} as PlanTask;
      dispatch.dispatchPlanning(task);dispatch.dispatchPlanning(task);
      assert.deepEqual(calls,['owner']);
    }
  }
});

test('a locally absent owner is not replaced by a channel architect', () => {
  const calls:string[]=[];
  const ctx={agents:new Map([['architect',{id:'architect',role:'architect',channels:new Set(['room'])}]]),guards:{planned:new Set()},execQueue:{run:()=>calls.push('wrong owner')}} as unknown as Parameters<typeof makeDispatch>[0];
  makeDispatch(ctx).dispatchPlanning({id:'task',channel_id:'room',assignee_id:'remote-owner'} as PlanTask);
  assert.deepEqual(calls,[]);
});
