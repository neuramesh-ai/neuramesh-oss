import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdir, writeFile, rename, access, readdir, cp, open, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec, root, save, readJson, statusOf, safeEnv, localUrl } from './support.mjs';
import { start, state, turn, capture, selectModel, requireApprovals } from './flow.mjs';
import { preview } from './preview.mjs';
import { verifyRecording } from './recording.mjs';

async function fullPlanProgress(p) {
  await p.click('.codingthread [aria-label="Open plan"] >> nth=-1');
  await p.waitForSelector('[data-work-plan="pane"]');
  return p.evaluate(() => {
    const items = [...document.querySelectorAll('[data-work-plan="pane"] [aria-label="Work plan steps"] li')];
    return { total: items.length, done: items.filter(item => item.classList.contains('complete')).length };
  });
}

export async function drive(taskSpace,config) {
  const run=await readJson(join(config.out,'run.json'));
  localUrl(run.url);
  const task=await taskSpace(config.space??'NeuraMesh coding evaluations');
  console.log(`EVAL_SPACE_ID=${task.spaceId}`);
  const lockPath=join(config.out,'active-run.json');
  const lock=await open(lockPath,'wx').catch(()=>{throw new Error('An eval is active in this directory. Use --cancel --resume PATH and wait for its result before retrying.');});
  await lock.writeFile(JSON.stringify({space:task.spaceId,page:config.page??'p1',startedAt:new Date().toISOString()}));await lock.close();
  const cancelFile=join(config.out,'CANCEL');
  let failed=false;
  try {
    const p=task.page(config.page??'p1');
    await p.cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1050,deviceScaleFactor:1,mobile:false});
    for(const spec of run.cases.filter(c=>!config.case||c.id===config.case)) {
      assert.ok(!existsSync(cancelFile),'Eval cancelled');
      const dir=join(config.out,spec.id);
      const continuing=config.verifyOnly||!!config.feedback;
      if(!continuing&&await access(join(dir,'result.json')).then(()=>true,()=>false)) await rename(dir,`${dir}-attempt-${Date.now()}`);
      await mkdir(dir,{recursive:true});
      const result=continuing?await readJson(join(dir,'result.json')):{id:spec.id,title:spec.title,startedAt:new Date().toISOString(),checks:[],events:[],model:run.model};
      if(continuing) {
        const assessment=join(dir,'assessments',String(Date.now()));
        await mkdir(assessment,{recursive:true});
        for(const file of await readdir(dir)) if(file!=='assessments') await cp(join(dir,file),join(assessment,file),{recursive:true});
        delete result.error;
        result.checks=result.checks.filter(c=>c.name==='plan card and implementation gate are visible'||c.name==='planning left repository unchanged');
        result.reassessedAt=new Date().toISOString();
      }
      const check=(name,yes)=>{result.checks.push({name,passed:!!yes});assert.ok(yes,name);};
      let beforeFeedback;
      try {
        if(continuing) {
          await p.goto(result.url);await p.waitForSelector('.codingthread .cagent');
          // Existing threads restore their recorded history before accepting another turn.
          await p.waitForFunction(()=>!document.querySelector('.codingthread .cagent')?.disabled,undefined,{timeout:30000});
          const current=await state(p);assert.ok(!current.busy&&!current.approval,'Finish the turn before re-evaluating');
          if(config.feedback) {
            beforeFeedback=await verifyRecording(run,result,dir,'before-feedback');
            result.feedbacks??=[];
            result.feedbacks.push({prompt:config.feedback,at:new Date().toISOString()});
            await p.fill('.codingthread textarea',config.feedback);await p.click('.codingthread button[aria-label="Send"]');
            await turn(p,spec,result,join(dir,`feedback-${result.feedbacks.length}`),{replyCount:current.replies.length,cancelFile,completionCheck:async()=>(await verifyRecording(run,result,dir,'feedback',beforeFeedback.index)).passed});
          }
        } else {
        console.log(`[${spec.id}] starting real UI task`);
        result.threadId=await start(p,run,spec);
        assert.ok(result.threadId,'thread URL must contain its ID');
        result.url=await p.url();
        result.cwd=join(run.cache,'worktrees',`engineering-${run.actor}-${spec.repoId}-${result.threadId}`);
        await save(join(dir,'result.json'),result);
        await turn(p,spec,result,dir,{planning:true,cancelFile});
        check('plan card and implementation gate are visible',true);
        const planned = (await state(p)).progress;
        check('unfinished new plan shows zero completed steps',planned?.total>0&&planned.done===0);
        check('planning left repository unchanged',!(await exec('git',['status','--porcelain'],{cwd:result.cwd})).stdout.trim());
        await requireApprovals(p);
        result.events.push({type:'permissions',edit:'ask',command:'ask'});
        const beforeAct=(await state(p)).replies.length;
        await p.click('[aria-label="Continue in Act mode"] .primary');
        await turn(p,spec,result,join(dir,'implementation'),{replyCount:beforeAct,cancelFile,completionCheck:async()=>(await verifyRecording(run,result,dir,'implementation')).passed});
        result.implementationVerification=await verifyRecording(run,result,dir,'implementation');
        check('agent tests passed inside the coding sandbox',result.implementationVerification.passed);
        const execution=await fullPlanProgress(p);
        check('plan steps explicitly complete after execution',execution?.total>0&&execution.done===execution.total);
        check('completed plan hides composer progress',!(await state(p)).progress);
        if(spec.followup) {
          assert.ok(!existsSync(cancelFile),'Eval cancelled');
          await selectModel(p,'.codingthread',run.handoffModel);
          await p.waitForFunction(()=>!document.querySelector('.codingthread .cagent')?.disabled,undefined,{timeout:30000});
          await capture(p,dir,'model-handoff');
          result.events.push({type:'model-handoff',to:run.handoffModel});
          const beforeFollowup=(await state(p)).replies.length;
          await p.fill('.codingthread textarea',spec.followup);await p.click('.codingthread button[aria-label="Send"]');
          await turn(p,spec,result,join(dir,'followup'),{replyCount:beforeFollowup,cancelFile,completionCheck:async()=>(await verifyRecording(run,result,dir,'followup')).passed});
        }
        }
        if(continuing) check('agent tests passed inside the coding sandbox',(await verifyRecording(run,result,dir,'reassessment',beforeFeedback?.index??-1)).passed);
        // Reassessment after an interrupted handoff must prove it too; the first attempt
        // may have failed before any of these assertions were saved.
        if(spec.followup) {
          check('followup ran on the selected model',(await state(p)).model.includes(run.handoffModel));
          result.followupVerification=await verifyRecording(run,result,dir,'followup');
          check('handoff agent tests passed inside the coding sandbox',result.followupVerification.passed);
          check('recorded provider model changed for the followup',result.followupVerification.model&&result.implementationVerification?.model&&result.followupVerification.model!==result.implementationVerification.model);
          check('handoff performed a new test run',result.followupVerification.index>result.implementationVerification?.index);
        }
        let s=await state(p);
        const finalProgress=await fullPlanProgress(p);
        check('final plan steps are complete',finalProgress.total>0&&finalProgress.done===finalProgress.total);
        check('final composer progress is hidden',!s.progress);
        if(config.feedback) {
          check('feedback performed a fresh recorded test run',beforeFeedback?.index!==undefined);
          check('feedback finished every plan step',finalProgress.total>0&&finalProgress.done===finalProgress.total);
        }
        check('file review approvals occurred',result.events.some(e=>e.type==='review'));
        check('agent requested test execution',result.events.some(e=>e.type==='command'&&/test/.test(e.command)));
        check('applied change cards remain in transcript',s.cards.some(c=>c.status==='applied'));
        const suiteResult=await exec('npm',['test'],{cwd:result.cwd,env:safeEnv(),timeout:30000,maxBuffer:2e6});
        await writeFile(join(dir,'agent-tests.log'),suiteResult.stdout+suiteResult.stderr);
        check('generated project tests pass independently',true);
        const oracle=await exec(config.node,[resolve(root,'scripts/coding-evals/oracle.mjs'),spec.id,result.cwd],{env:safeEnv(),timeout:30000,maxBuffer:2e6});
        result.oracle=JSON.parse(oracle.stdout.trim());
        check('independent acceptance oracle passes',result.oracle.passed);
        const diff=await exec('git',['diff','--stat'],{cwd:result.cwd});await writeFile(join(dir,'diff-stat.txt'),diff.stdout);
        // A reload must retain the review history and session selection before preview testing.
        const priorProgress=finalProgress;
        const authors=s.replies.filter(t=>/rex|patch/.test(t));
        await p.reload();await p.waitForSelector('.codingthread .cagent');
        await p.waitForFunction(()=>!document.querySelector('.codingthread .cagent')?.disabled,undefined,{timeout:30000});
        s=await state(p);
        check('reload retains plan progress',JSON.stringify(await fullPlanProgress(p))===JSON.stringify(priorProgress));
        check('reload keeps completed composer progress hidden',!s.progress);
        check('reload retains applied review history',s.cards.some(c=>c.status==='applied'));
        check('reload retains agent and model',s.agent.includes('rex')&&s.model.includes(spec.followup?run.handoffModel:run.model));
        check('thread has real assistant responses',authors.length>1);
        await capture(p,dir,'solution');
        if(spec.preview) await preview(p,spec,result.cwd,dir,result);
      } catch(error) {
        failed=true;
        result.error=error.message;
        if(error.stdout||error.stderr) await writeFile(join(dir,'failure-output.log'),String(error.stdout??'')+String(error.stderr??''));
        await capture(p,dir,'failure').catch(()=>{});
        console.error(`[${spec.id}] FAIL: ${error.message}`);
      } finally {
        result.finishedAt=new Date().toISOString();result.durationMs=Date.parse(result.finishedAt)-Date.parse(result.startedAt);result.status=statusOf(result.checks,result.error);
        await save(join(dir,'result.json'),result);
        console.log(`[${spec.id}] ${result.status}: ${result.checks.filter(c=>c.passed).length} checks`);
      }
      // An active failed run is kept for inspection; never start another task over a pending turn.
      if(failed) break;
    }
  } catch(error) { failed=true; throw error; }
  finally {await rm(lockPath,{force:true});if(!config.space&&!failed) await task.finish({keep:[]});}
  return !failed;
}
