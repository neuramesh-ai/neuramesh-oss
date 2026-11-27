import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultBaselineRules, mergePolicies, type PermissionMode, type PolicyRule } from '@neuramesh/shared';
import { makeThreadPermissionGate } from './thread-permission-gate';
import { houseActionReviewer, REVIEW_DEADLINE_MS } from './permission-review';
import { requestEngineeringApproval } from './relay/engineering-approvals';
import type { ToolApprovalRequest } from '@cline/sdk';
import type { EngineeringRuntimeEvent } from '../engineering-protocol';

const policies = defaultBaselineRules();
const all = { read:true,edit:true,command:true,web:true,mcp:true };
const service = {apiUrl:'https://unreachable.invalid',workspace:'fixture',actorId:'fixture'};
const approvedReview = houseActionReviewer(service, async call => {
  assert.equal(call.config.tools, undefined);
  assert.match(JSON.stringify(call.contents), /pnpm test/);
  return { candidates:[{content:{parts:[{text:JSON.stringify({verdict:'allow',reason:'Scoped repository verification.'})}]}}] };
});

async function exercise(mode: PermissionMode, toolName: string, input: unknown, rules = policies, plan = false) {
  const events: EngineeringRuntimeEvent[] = [];
  const pending = new Map<string,(approved:boolean)=>void>();
  const gate = makeThreadPermissionGate(async()=>mode, approvedReview);
  const result = await requestEngineeringApproval({toolCallId:'op',toolName,input} as ToolApprovalRequest,
    {mode:plan?'plan':'act',permissions:all,policy:all}, rules, pending, event => {
      events.push(event);
      if(event.type==='approval') pending.get(event.approvalId)!(false);
    },()=>{},undefined,()=>true,gate);
  return events.some(e=>e.type==='approval') ? 'ask' : result.approved ? 'allow' : 'deny';
}

for (const [mode, expected] of [
  ['request-review',['allow','ask','ask','ask']],['default',['allow','allow','ask','ask']],
  ['auto-review',['allow','allow','allow','ask']],['turbo',['allow','allow','allow','allow']],
] as const) {
  test(mode+' at the coding runtime tool boundary', async()=>{
    assert.deepEqual(await Promise.all([exercise(mode,'read_files',{path:'README.md'}),exercise(mode,'editor',{path:'src/main.ts'}),
      exercise(mode,'run_commands',{command:'pnpm test'}),exercise(mode,'connector__lookup',{})]),expected);
    assert.equal(await exercise(mode,'editor',{path:'a.ts'},policies,true),'deny');
    assert.equal(await exercise(mode,'run_commands',{command:'cat ~/.ssh/id_rsa'}),'deny');
    assert.equal(await exercise(mode,'new_unmapped_tool',{}),'deny');
    // A release action follows the mode (George, 2026-11-18). The reviewer has no
    // vocabulary for it, so Auto Review gives it to the person.
    const release = mode === 'turbo' ? 'allow' : 'ask';
    assert.equal(await exercise(mode,'connector__publish',{}),release);
    assert.equal(await exercise(mode,'run_commands',{command:'gh pr merge 12'}),release);
  });
}
test('Turbo honors locked and administrator-authored restrictions, including relative paths', async()=>{
  const rules = mergePolicies(policies, [
    {id:'custom',scope:'workspace',capability:'fs.read',selector:{kind:'path',glob:'**/private/**'},verdict:'deny'},
    {id:'user-changed-key-rule',scope:'workspace',capability:'fs.read',selector:{kind:'path',glob:'**/.ssh/**'},verdict:'allow'},
    {id:'publish',scope:'workspace',capability:'tool.mcp',selector:{kind:'tool',name:'connector__publish'},verdict:'ask'},
  ] satisfies PolicyRule[]);
  for (const path of ['private/contract','.ssh/id_ed25519']) assert.equal(await exercise('turbo','read_files',{path},rules),'deny');
  assert.equal(await exercise('turbo','connector__publish',{},rules),'ask');
});
test('an unverifiable reviewer response asks, and arbitrary command arguments never leave the machine',async()=>{
  for(const reply of ['yes','{"verdict":"allow","reason":""}','{"verdict":"allow","reason":"x","tools":[]}']) {
    const check=houseActionReviewer(service,async()=>({candidates:[{content:{parts:[{text:reply}]}}]}));
    assert.equal((await check([{capability:'shell.exec',command:'pnpm test'}])).verdict,'ask');
  }
  let calls=0;
  const unavailable=houseActionReviewer(service,async()=>{calls++;throw new Error('offline');});
  assert.equal((await unavailable([{capability:'shell.exec',command:'curl https://example.test/secret'}])).verdict,'ask');
  assert.equal(calls,0);
  assert.equal((await unavailable([{capability:'shell.exec',command:'pnpm test'}])).verdict,'ask');
  assert.equal(calls,1);
});
test('a late allow cannot override a new setting, and a failed authority read closes the gate',async()=>{
  let mode:PermissionMode='auto-review';
  const gate=makeThreadPermissionGate(async()=>mode,async()=>{mode='request-review';return {verdict:'allow',reason:'test'}});
  const actions=[{capability:'shell.exec' as const,command:'pnpm test'}];
  assert.equal((await gate.decide('command',actions,policies))?.verdict,'ask');
  const offline=makeThreadPermissionGate(async()=>{throw new Error('offline')},approvedReview);
  assert.equal((await offline.decide('command',actions,policies))?.verdict,'deny');
});

test('a browser click or form entry follows the mode', async () => {
  for (const [mode, expected] of [['request-review','ask'],['default','ask'],['auto-review','ask'],['turbo','allow']] as const) {
    const gate = makeThreadPermissionGate(async () => mode, approvedReview);
    for (const tool of ['web_click', 'web_type']) {
      assert.equal((await gate.decide('mcp', [{capability:'tool.mcp',tool}], policies))?.verdict, expected, `${tool} in ${mode}`);
    }
  }
});


test('workspace tools skip the reviewer across modes; release actions follow the mode and explicit restrictions still apply', async () => {
  const { chatPermissionAction } = await import('./chat-permission-action');
  for (const mode of ['request-review','default','auto-review','turbo'] as const) {
    const gate = makeThreadPermissionGate(async () => mode, async () => assert.fail('unexpected paid review'));
    for (const name of ['list_workspace','read_workspace_file','list_projects','message_agent','create_whiteboard','create_coding_task','schedule_posts']) {
      const action = chatPermissionAction('mcp__nm__' + name, {})!;
      assert.equal((await gate.decide(action.kind, action.actions, policies))?.verdict, 'allow');
    }
    // Auto Review sends a release action to the reviewer, which gives it to the person.
    const reviewed = makeThreadPermissionGate(async () => mode, async () => ({verdict:'ask',reason:'The action needs a human scope check.'}));
    for (const name of ['publish_post','deploy_site','merge_pr','accept_task','web_click','web_type']) {
      const action = chatPermissionAction('mcp__nm__' + name, {})!;
      assert.equal((await reviewed.decide(action.kind, action.actions, policies))?.verdict, mode === 'turbo' ? 'allow' : 'ask', `${name} in ${mode}`);
      const denied: PolicyRule = {id:'person',scope:'workspace',capability:'tool.mcp',selector:{kind:'tool',name},verdict:'deny'};
      assert.equal((await reviewed.decide(action.kind, action.actions, [...policies, denied]))?.verdict, 'deny', `a person's deny wins for ${name} in ${mode}`);
    }
    const restricted: PolicyRule = {id:'private',scope:'workspace',capability:'tool.mcp',selector:{kind:'tool',name:'list_workspace'},verdict:'deny'};
    assert.equal((await gate.decide('mcp',[{capability:'tool.mcp',tool:'list_workspace'}],[restricted]))?.verdict, 'deny');
  }
  const external = chatPermissionAction('mcp__connector__list_workspace', {})!;
  let reviews = 0;
  const gate = makeThreadPermissionGate(async () => 'auto-review', async () => { reviews++; return {verdict:'ask',reason:'external tool'}; });
  assert.equal((await gate.decide(external.kind, external.actions, policies))?.verdict, 'ask');
  assert.equal(reviews, 1);
});

test('a stalled reviewer yields a human decision within its budget even when the transport ignores abort', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let signal: AbortSignal | undefined;
  let finish!: (value: unknown) => void;
  const reviewer = houseActionReviewer(service, async call => {
    signal = call.signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const pending = reviewer([{capability:'shell.exec',command:'npm test'}]);
  t.mock.timers.tick(REVIEW_DEADLINE_MS);
  assert.equal(signal?.aborted,true);
  assert.match((await pending).reason,/approve or decline now/);
  finish({candidates:[{content:{parts:[{text:'{"verdict":"allow","reason":"Late"}'}]}}]});
  assert.equal((await pending).verdict,'ask');
});

// George, 2026-11-18: spawn and every NeuraMesh tool are safe. The names come from the built
// registries, so a tool that a registry adds tomorrow is in this walk with no edit here.
test('every tool of every nm registry is safe in Default, except the shell and the release actions', async () => {
  const { chatPermissionAction } = await import('./chat-permission-action');
  const { buildStubOrchestratorRegistry } = await import('./promptmeter');
  const { allToolDefs } = await import('./harness/toolbus');
  const { chatTransportTools } = await import('./host/chattools-transport');
  const { isReleaseAction } = await import('@neuramesh/shared');
  const { z } = await import('zod');
  const { tool, createSdkMcpServer } = await import('@anthropic-ai/claude-agent-sdk');
  const chat = { z, tool, createSdkMcpServer, text: (text: string) => ({ content: [{ type: 'text' as const, text }] }),
    agent: { id: 'plume', name: 'plume', role: 'marketer' }, ch: { id: 'room', slug: 'general', workspace_id: 'ws' }, threadId: 'thread', log: () => {},
    db: { getAll: async () => [] }, post: async () => ({ ok: true }), libraryDocs: async () => [], whiteboardClosures: () => ({}), draftsForAnchor: async () => null,
    runCommand: async () => '' } as never;
  const registries: Record<string, string[]> = {
    orchestrator: [...new Set([...(await buildStubOrchestratorRegistry('triage')), ...(await buildStubOrchestratorRegistry('own'))].map(t => t.name))],
    worker: allToolDefs().map(t => t.name),
    chat: chatTransportTools(chat).map(t => t.name),
  };
  assert.ok(registries.orchestrator!.includes('spawn') && registries.worker!.includes('spawn'), 'spawn is in the walk');
  const gate = makeThreadPermissionGate(async () => 'default', async () => assert.fail('a NeuraMesh tool reached the paid reviewer'));
  for (const [registry, names] of Object.entries(registries)) {
    assert.ok(names.length > 5, `${registry} registry built`);
    for (const name of names) {
      const mapped = chatPermissionAction('mcp__nm__' + name, {});
      if (!mapped) continue; // beats bookkeeping: no permission step at all
      const verdict = (await gate.decide(mapped.kind, mapped.actions, policies))?.verdict;
      const asks = name === 'run_command' || mapped.actions.some(isReleaseAction);
      assert.equal(verdict, asks ? 'ask' : 'allow', `${registry} · ${name}`);
    }
  }
});

test('a new nm tool is safe by construction, and other tools keep their rules', async () => {
  const { chatPermissionAction } = await import('./chat-permission-action');
  const gate = makeThreadPermissionGate(async () => 'default', async () => ({ verdict: 'ask', reason: 'reviewer' }));
  const decide = async (name: string, input: Record<string, unknown> = {}) => {
    const mapped = chatPermissionAction(name, input)!;
    return (await gate.decide(mapped.kind, mapped.actions, policies))?.verdict;
  };
  assert.equal(await decide('mcp__nm__spawn'), 'allow');
  assert.equal(await decide('mcp__nm__a_tool_added_tomorrow'), 'allow');
  assert.equal(await decide('mcp__connector__list_files'), 'ask');
  assert.equal(await decide('mcp__claude-design__create_project'), 'ask');
  assert.equal(await decide('Bash', { command: 'pnpm test' }), 'ask');
  assert.equal(await decide('mcp__nm__run_command', { command: 'pnpm test' }), 'ask');
  assert.equal(await decide('Task'), 'deny'); // a CLI's own subagent tool has no mapping
});
