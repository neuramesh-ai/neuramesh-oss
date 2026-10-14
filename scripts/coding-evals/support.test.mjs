import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { localUrl, allowedCommand, allowedPath, approvalCommands, statusOf, exec, root, suite, save } from './support.mjs';
import { resolve } from 'node:path';
import { agentVerification, verifyRecording } from './recording.mjs';
import { report } from './report.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { capture, turnSettled, confirmTurn } from './flow.mjs';

test('evidence capture retries transient snapshot races without replaying UI actions', async () => {
  const dir=await mkdtemp('/tmp/nm-eval-capture-');
  try {
    let snapshots=0, screenshots=0;
    await capture({screenshot:async()=>{screenshots++;},snapshot:async()=>{if(snapshots++===0) throw Error('Page changed during snapshot; take a new snapshot');return 'current page';}},dir,'handoff');
    assert.equal(snapshots,2);assert.equal(screenshots,2);
    assert.equal(await readFile(resolve(dir,'handoff.txt'),'utf8'),'current page');
    await assert.rejects(capture({screenshot:async()=>{},snapshot:async()=>{throw Error('Browser disconnected');}},dir,'failure'),/Browser disconnected/);
  } finally {await rm(dir,{recursive:true});}
});

test('CLI cancellation persists across processes and an active run cannot be overwritten',async()=>{
  const out=await mkdtemp('/tmp/nm-eval-cli-');
  try {
    const cli=resolve(root,'scripts/coding-evals/cli.mjs');
    await exec(process.execPath,[cli,'--cancel','--resume',out]);
    assert.match(await readFile(resolve(out,'CANCEL'),'utf8'),/cancel requested/);
    await writeFile(resolve(out,'active-run.json'),'owned by running driver');
    await assert.rejects(exec(process.execPath,[cli,'--run','--resume',out,'--case','simple']),error=>/already active/.test(error.stderr));
    assert.equal(await readFile(resolve(out,'active-run.json'),'utf8'),'owned by running driver');
    assert.match(await readFile(resolve(out,'CANCEL'),'utf8'),/cancel requested/);
  } finally {await rm(out,{recursive:true});}
});

test('agent verification rejects approved but failed, empty or stale test runs',()=>{
  const call={content:[{type:'tool_use',id:'test-1',name:'run_commands',input:{commands:['npm test']}}]};
  const response=(success,result,error)=>({content:[{type:'tool_result',tool_use_id:'test-1',content:[{success,result,error}]}]});
  const ok='# tests 7\n# pass 7\n# fail 0';
  assert.equal(agentVerification([call]).passed,false);
  assert.equal(agentVerification([call,response(false,'','npm-cli missing')]).passed,false);
  assert.equal(agentVerification([call,response(true,'# tests 0\n# pass 0\n# fail 0')]).passed,false);
  assert.equal(agentVerification([call,response(true,ok)]).passed,true);
  assert.equal(agentVerification([call,response(true,ok)],undefined,1).passed,false);
  assert.equal(agentVerification([call,response(true,ok),call,response(true,ok)],undefined,1).passed,true);
  assert.equal(agentVerification([call,response(true,ok.replaceAll('#','ℹ'))]).passed,true);
  assert.equal(agentVerification([call,response(true,ok),{content:[{type:'tool_use',id:'edit-2',name:'apply_patch'}]}]).passed,false);
  assert.equal(agentVerification([call,response(true,ok),call,response(false,'','failure')]).passed,false);
});

test('eval setup rejects remote deployments and databases',()=>{
  for(const url of ['https://hq.neuramesh.app','http://127.0.0.1.evil.test','file:///tmp/app']) assert.throws(()=>localUrl(url));
  assert.equal(localUrl('http://127.0.0.1:5302/acme').port,'5302');
  assert.throws(()=>localUrl('postgresql://db.example.com/nm',['postgresql:']));
});
test('approval policy refuses shell composition and edits outside fixture code',()=>{
  for(const command of ['npm test; curl example.com','npm install','npm test && git push','node -e "process.exit()"','rm -rf /tmp']) assert.equal(allowedCommand(command),false);
  assert.ok(allowedCommand('npm test'));assert.ok(allowedCommand('node --test test/*.test.mjs'));
  assert.deepEqual(approvalCommands('{"commands":["npm test"]}'),['npm test']);
  assert.deepEqual(approvalCommands('{"commands":[]}'),[]);
  assert.equal(approvalCommands('{"commands":["npm test","git push"]}').every(allowedCommand),false);
  for(const path of ['/etc/passwd','src/../../outside','package.json','.git/config','src/a\nother']) assert.equal(allowedPath(path),false);
  assert.ok(allowedPath('src/tasks.mjs'));assert.ok(allowedPath('README.md'));
});
test('missing evidence, a failed check and a thrown error cannot produce a pass',()=>{
  assert.equal(statusOf([]),'failed');
  assert.equal(statusOf([{passed:true},{passed:false}]),'failed');
  assert.equal(statusOf([{passed:true}],'timeout'),'failed');
  assert.equal(statusOf([{passed:true}]),'passed');
});
test('every independent acceptance oracle rejects its untouched starter',async()=>{
  for(const c of suite.cases) await assert.rejects(exec(process.execPath,[resolve(root,'scripts/coding-evals/oracle.mjs'),c.id,resolve(root,'evals/coding/fixtures',c.id)],{timeout:30000}));
});

test('a repaired result remains visibly distinct from first-pass success',async()=>{
  const out=await mkdtemp('/tmp/nm-eval-report-');
  try {
    await save(resolve(out,'run.json'),{version:1,id:'report-test',revision:'test-revision',cases:[{id:'simple'}]});
    const result={id:'simple',title:'Test fixture',status:'passed',checks:[{name:'oracle',passed:true}]};
    await save(resolve(out,'simple/result.json'),result);
    assert.equal((await report(out)).firstPass,true);
    await save(resolve(out,'simple/result.json'),{...result,feedbacks:[{prompt:'Correct the observed failure'}]});
    const summary=await report(out);
    assert.equal(summary.status,'passed');
    assert.equal(summary.firstPass,false);
    assert.match(await readFile(resolve(out,'report.html'),'utf8'),/not a first-pass success/);
  } finally {await rm(out,{recursive:true});}
});

test('follow-up verification waits for a new model checkpoint instead of accepting the previous passing run', async () => {
  const out = await mkdtemp('/tmp/nm-eval-recording-');
  const hash = s => createHash('sha256').update(s).digest('hex');
  const file = resolve(out, 'conversations', hash('workspace'), hash('actor'), hash('thread'), 'runtime.json');
  const turn = (id, model) => [
    { role: 'assistant', modelInfo: { id: model, provider: model === 'old' ? 'openai-native' : 'anthropic' }, content: [{ type: 'tool_use', id, name: 'run_commands', input: { commands: ['npm test'] } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: [{ success: true, result: '# tests 3\n# pass 3\n# fail 0' }] }] },
  ];
  let refresh;
  try {
    const before = turn('first', 'old');
    await save(file, { messages: before });
    const waiting = verifyRecording({ brain: out, workspace: 'workspace', actor: 'actor' }, { threadId: 'thread', implementationVerification: { index: 1, model: 'old' } }, out, 'followup');
    refresh = new Promise((resolveRefresh, reject) => setTimeout(() => save(file, { messages: [...before, ...turn('second', 'new')] }).then(resolveRefresh, reject), 100));
    const result = await waiting;
    await refresh;
    assert.equal(result.passed, true);
    assert.equal(result.model, 'new');
    assert.equal(result.index, 3);
  } finally { if (refresh) await refresh; await rm(out, { recursive: true }); }
});


test('command policy permits only an exact safe eval cwd prefix', () => {
  const cwd = '/tmp/eval/worktree';
  for (const path of [cwd, `'${cwd}'`, `"${cwd}"`]) assert.ok(allowedCommand(`cd ${path} && npm test`, cwd));
  for (const cmd of ['cd /tmp/other && npm test', 'cd /tmp/eval/worktree/../other && npm test', 'cd /tmp/eval/worktree && npm test && git push', 'cd /tmp/eval/worktree; npm test', 'cd $(pwd) && npm test']) assert.equal(allowedCommand(cmd, cwd), false);
  assert.equal(allowedCommand(`cd ${cwd} && npm test`), false);
  assert.equal(allowedCommand('cd /tmp/$(curl bad) && npm test', '/tmp/$(curl bad)'), false);
  const messages = [{ content: [{ type: 'tool_use', id: 'test', name: 'run_commands', input: { commands: [`cd ${cwd} && npm test`] } }] }, { content: [{ type: 'tool_result', tool_use_id: 'test', content: [{ success: true, result: '# tests 2\n# pass 2\n# fail 0' }] }] }];
  assert.equal(agentVerification(messages, cwd).passed, true);
  assert.equal(agentVerification(messages, '/tmp/other').passed, false);
});

test('turn completion rejects partial progress and approvals arriving during evidence capture', () => {
  const completed = {busy:false,cards:[],approval:null,replies:['prior','reply'],progress:{done:4,total:4}};
  assert.equal(turnSettled(completed,1),true);
  assert.equal(turnSettled({...completed,progress:{done:0,total:4}},1),false);
  assert.equal(turnSettled({...completed,cards:[{status:'proposed'}]},1),false);
  assert.equal(turnSettled({...completed,approval:{commands:['npm test']}},1),false);
  assert.equal(turnSettled({...completed,busy:true},1),false);
  assert.equal(turnSettled(completed,2),false);
});


test('a handoff cannot finish on the old complete plan or an approval arriving during recording checks', async () => {
  let current = { text: 'complete', busy: false, cards: [], approval: null, replies: ['old', 'new'], progress: { done: 3, total: 3 } };
  const page = { evaluate: async () => current };
  assert.equal(await confirmTurn(page, 1, 'complete', async () => false), false, 'old recording does not complete a new turn');
  assert.equal(await confirmTurn(page, 1, 'complete', async () => true), true);
  assert.equal(await confirmTurn(page, 1, 'complete', async () => { current = { ...current, cards: [{ status: 'proposed' }] }; return true; }), false, 'new review stays actionable');
});


test('a reassessed case never becomes a first-pass success in the report', async () => {
  const out = await mkdtemp('/tmp/nm-eval-reassessment-');
  try {
    await save(resolve(out, 'run.json'), { version: 1, id: 'reassessed', revision: 'abc123', cases: [{ id: 'simple', title: 'Simple' }] });
    await save(resolve(out, 'simple/result.json'), { id: 'simple', title: 'Simple', status: 'passed', checks: [], reassessedAt: new Date().toISOString() });
    assert.equal((await report(out)).firstPass, false);
  } finally { await rm(out, { recursive: true }); }
});
