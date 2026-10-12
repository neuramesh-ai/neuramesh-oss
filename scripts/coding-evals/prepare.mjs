import { cp, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { root, exec, suite, localUrl, save } from './support.mjs';

export async function prepare(config) {
  localUrl(config.url); localUrl(config.databaseUrl,['postgres:','postgresql:']);
  const require = createRequire(resolve(root,'packages/control-api/package.json'));
  const sql = require('postgres')(config.databaseUrl,{max:1});
  const run = {version:suite.version, id:config.id, createdAt:new Date().toISOString(), url:config.url, workspace:config.workspace, actor:config.actor, cache:config.cache, brain:config.brain, model:config.model, handoffModel:config.handoffModel, cases:[]};
  try {
    const [project] = await sql`select id from projects where workspace_id=${config.workspace} and is_default=true limit 1`;
    if (!project) throw new Error('The local eval workspace needs a default project. Start the development stack first.');
    for (const spec of suite.cases) {
      const id=randomUUID(), dir=join(config.fixtures,spec.id), remote=dir+'.git';
      await mkdir(config.fixtures,{recursive:true});
      await cp(resolve(root,'evals/coding/fixtures',spec.id),dir,{recursive:true,errorOnExist:true,force:false});
      await exec('git',['init','-q','-b','main'],{cwd:dir});
      await exec('git',['-c','user.name=NeuraMesh Evals','-c','user.email=evals@neuramesh.local','add','.'],{cwd:dir});
      await exec('git',['-c','user.name=NeuraMesh Evals','-c','user.email=evals@neuramesh.local','commit','-qm','coding eval v1 starter'],{cwd:dir});
      await exec('git',['clone','--bare','--quiet',dir,remote]);
      const name=`eval-${spec.id}-${config.id.slice(-8)}`;
      await sql`insert into repos(id,workspace_id,provider,org_name,name,default_branch,clone_url) values(${id},${config.workspace},'github','coding-evals',${name},'main',${'file://'+remote})`;
      await sql`insert into project_repos(project_id,repo_id,is_primary) values(${project.id},${id},false)`;
      const baseline=await exec(process.execPath,[resolve(root,'scripts/coding-evals/oracle.mjs'),spec.id,dir],{timeout:30000}).then(()=>true,()=>false);
      if (baseline) throw new Error(`${spec.id}: acceptance oracle incorrectly passes the unimplemented starter.`);
      run.cases.push({...spec,repoId:id,repoLabel:`coding-evals/${name}`,fixture:dir,baselineFailed:true});
    }
    run.revision=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
    run.dirty=!!(await exec('git',['status','--porcelain'],{cwd:root})).stdout.trim();
    await save(join(config.out,'run.json'),run);
    return run;
  } finally { await sql.end(); }
}
