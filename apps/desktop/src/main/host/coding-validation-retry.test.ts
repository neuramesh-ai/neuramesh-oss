import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worktreeRun } from '../execution';
import { CodingEvidenceBlocked } from './coding-validation-files';

test('missing visual proof blocks publication and the next attempt reuses the original changes', async () => {
  const root=await mkdtemp(join(tmpdir(),'nm-pending-capture-'));
  const originalBrain=process.env.NM_BRAIN;
  process.env.NM_BRAIN=join(root,'brain');
  const source=join(root,'source'), remote=join(root,'origin.git');
  const task={id:'checked-task',number:2,title:'Fixture change',channel_id:'room',repo_id:'repo',branch:'nm/fixture',base_ref:'main'};
  const repo={clone_url:remote,default_branch:'main'};
  const git=(cwd:string,...args:string[])=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    await mkdir(source);git(source,'init','-b','main');await writeFile(join(source,'index.txt'),'before');
    git(source,'add','.');git(source,'-c','user.name=QA','-c','user.email=qa@example.test','commit','-m','baseline');
    git(root,'clone','--bare',source,remote);
    await assert.rejects(worktreeRun(task,repo,async cwd=>{
      git(cwd,'config','user.name','QA');git(cwd,'config','user.email','qa@example.test');
      await writeFile(join(cwd,'index.txt'),'changed');
      git(cwd,'add','index.txt');git(cwd,'commit','-m','retained local implementation');
      throw new CodingEvidenceBlocked('The preview could not be captured.');
    },false),/could not be captured/);
    assert.equal(git(remote,'branch','--list',task.branch),'');
    const retained = join(root, 'brain', 'cache', 'worktrees', 'nm-2');
    const savedHead = git(retained, 'rev-parse', 'HEAD');
    git(retained, 'commit', '--allow-empty', '-m', 'changed after validation paused');
    await assert.rejects(worktreeRun(task, repo, async () => assert.fail('must not run a changed checkout'), false), /saved validation checkout changed/);
    assert.notEqual(git(retained, 'rev-parse', 'HEAD'), savedHead);
    git(retained, 'reset', '--keep', savedHead);
    const result=await worktreeRun(task,repo,async cwd=>{assert.equal(await readFile(join(cwd,'index.txt'),'utf8'),'changed');},false);
    assert.equal(git(remote,'show',result.sha+':index.txt'),'changed');
  } finally {
    if(originalBrain===undefined)delete process.env.NM_BRAIN;else process.env.NM_BRAIN=originalBrain;
    await rm(root,{recursive:true,force:true});
  }
});
