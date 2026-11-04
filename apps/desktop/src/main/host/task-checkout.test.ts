import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { agentGitIdentity, NEURAMESH_BOT } from '@neuramesh/shared';
import { worktreeRun } from '../execution';
import { Brain } from '../harness/brain';
import { makeBerthSweep } from './berthsweep';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import { numberedTaskTerminalDirectory, threadTerminalDirectory } from '../relay/terminal-workspace';

test('a failed task retains edits, open tasks can restore their branch, and publication records the bot author and committer', async () => {
  const root=await mkdtemp(join(tmpdir(),'nm-retain-')), original=process.env.NM_BRAIN;
  process.env.NM_BRAIN=join(root,'brain');
  const git=(dir:string,...args:string[])=>execFileSync('git',args,{cwd:dir,encoding:'utf8',env:{...process.env,...agentGitIdentity()},stdio:['ignore','pipe','pipe']}).trim();
  const src=join(root,'source'),remote=join(root,'remote.git');
  const task={id:'retain-7',number:7,repo_id:'repo',branch:'nm/7',base_ref:'main',channel_id:'room',title:'Add notes'};
  const repo={clone_url:remote,default_branch:'main'};
  const terminal=(number:number,state:string,sha:string|null)=>threadTerminalDirectory({getAll:async()=>[{
    kind:'coding',number,repo_id:'repo',branch:`nm/${number}`,state,submitted_sha:sha,base_ref:'main',clone_url:remote,
  }] as never},'ws','thread','human');
  try {
    await mkdir(src);git(src,'init','-b','main');await writeFile(join(src,'README.md'),'Start');git(src,'add','.');git(src,'commit','-m','start');git(root,'clone','--bare',src,remote);
    const first=await terminal(7,'in_progress',null);
    await assert.rejects(worktreeRun(task,repo,async dir=>{await writeFile(join(dir,'note.txt'),'incomplete');throw Error('verification unavailable');},false),/verification unavailable/);
    assert.equal(await readFile(join(first.cwd,'note.txt'),'utf8'),'incomplete');
    const pushed=await worktreeRun(task,repo,async dir=>{assert.equal(await readFile(join(dir,'note.txt'),'utf8'),'incomplete');},false);
    assert.deepEqual(git(first.cwd,'show','-s','--format=%an%n%ae%n%cn%n%ce',pushed.sha).split('\n'),[NEURAMESH_BOT.name,NEURAMESH_BOT.email,NEURAMESH_BOT.name,NEURAMESH_BOT.email]);
    const clone=join(root,'brain','cache','repos','repo');
    git(clone,'worktree','remove',first.cwd);git(clone,'branch','-D',task.branch);
    const restored=await terminal(7,'blocked',pushed.sha);assert.equal(git(restored.cwd,'rev-parse','HEAD'),pushed.sha);
    assert.equal(git(restored.cwd,'branch','--show-current'),task.branch);
    await rm(restored.cwd,{recursive:true});
    const numbered = await numberedTaskTerminalDirectory({getAll: async()=>[{
      number:7,repo_id:'repo',branch:task.branch,state:'in_progress',submitted_sha:pushed.sha,base_ref:'main',clone_url:remote,
    }] as never},'ws',7);
    assert.equal(git(numbered.cwd,'rev-parse','HEAD'),pushed.sha);
    git(clone,'worktree','remove',numbered.cwd);
    git(clone,'branch','-f',task.branch,'main');
    const caughtUp = await terminal(7,'in_review',pushed.sha);
    assert.equal(git(caughtUp.cwd,'rev-parse','HEAD'),pushed.sha);
    git(clone,'worktree','remove',caughtUp.cwd);
    git(clone,'branch','-f',task.branch,'main');
    git(clone,'switch',task.branch);
    git(clone,'commit','--allow-empty','-m','local work');
    const divergent = git(clone,'rev-parse','HEAD');
    git(clone,'switch','main');
    await assert.rejects(terminal(7,'in_review',pushed.sha),/Could not restore/);
    assert.equal(git(clone,'rev-parse',task.branch),divergent);
    // A genuinely missing submitted branch must never be replaced by an unrelated checkout of main.
    await assert.rejects(terminal(8,'in_review',pushed.sha),/Could not restore/);
  } finally { if(original===undefined)delete process.env.NM_BRAIN;else process.env.NM_BRAIN=original;await rm(root,{recursive:true,force:true}); }
});

test('cache pressure and failed inventory reads preserve open task and PR checkouts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-checkout-sweep-'));
  const oldBrain = process.env.NM_BRAIN, oldCap = process.env.NM_WARM_BERTHS;
  process.env.NM_BRAIN = dir;
  process.env.NM_WARM_BERTHS = '0';
  try {
    for (const number of [4, 5]) {
      const worktree = join(dir, 'cache', 'worktrees', `nm-${number}`);
      await mkdir(worktree, { recursive: true });
      await writeFile(join(worktree, 'work.txt'), 'ongoing work');
    }
    let failInventory = false;
    const db = { getAll: async (_sql: string, params: unknown[] = []) => {
      if (failInventory) throw new Error('inventory unavailable');
      if (!params.length) return [{ repo_id: 'repo', n: 1 }];
      return [{ state: params[0] === 4 ? 'in_review' : 'accepted', repo_id: 'repo', pr_number: params[0] === 5 ? 2 : null }];
    }} as unknown as ReplicaDatabase;
    const { runBerthSweep } = makeBerthSweep({ db, brain: new Brain(dir), withRepoLock: (_key, run) => run(), keepPrCheckout: async number => number === 5 });
    assert.equal((await runBerthSweep()).actions, 0);
    failInventory = true;
    await assert.rejects(runBerthSweep(), /inventory unavailable/);
    for (const number of [4, 5]) assert.equal(await readFile(join(dir, 'cache', 'worktrees', `nm-${number}`, 'work.txt'), 'utf8'), 'ongoing work');
  } finally {
    if (oldBrain === undefined) delete process.env.NM_BRAIN; else process.env.NM_BRAIN = oldBrain;
    if (oldCap === undefined) delete process.env.NM_WARM_BERTHS; else process.env.NM_WARM_BERTHS = oldCap;
    await rm(dir, { recursive: true, force: true });
  }
});
