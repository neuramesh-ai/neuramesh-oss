import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { allowedCommand, allowedPath, approvalCommands } from './support.mjs';

export const state = p => p.evaluate(()=>({
  url:location.href, text:document.querySelector('.codingthread')?.innerText??'',
  busy:document.querySelector('.codingthread .cagent')?.disabled??false,
  agent:document.querySelector('.codingthread .cagent')?.textContent,
  model:document.querySelector('.codingthread .cmodel')?.textContent,
  replies:[...document.querySelectorAll('.codingthread .msg:not(.human)')].map(e=>e.innerText),
  progress:(()=>{const p=document.querySelector('[data-plan-progress]');return p?{done:Number(p.dataset.completed),total:Number(p.dataset.total)}:null;})(),
  plan:!!document.querySelector('[data-work-plan="inline"]'),
  handoff:!!document.querySelector('[aria-label="Continue in Act mode"]'),
  cards:[...document.querySelectorAll('[data-change-review]')].map(e=>({id:e.dataset.changeReview,status:e.dataset.status,files:[...e.querySelectorAll('button[aria-label^="Review "]')].map(b=>b.getAttribute('aria-label').replace(/^Review /,'').replace(/ in this change set$/,''))})),
  approval:document.querySelector('.engapproval')?{commands:[...document.querySelectorAll('.engapproval code')].map(e=>e.textContent),title:document.querySelector('.engapprovaltop')?.textContent}:null,
}));

export async function capture(p,dir,label) {
  await mkdir(dir,{recursive:true});
  // Streaming text or a model handoff can invalidate an accessibility snapshot.
  // Retry observation only; never replay a click, prompt or approval.
  for(let attempt=0;;attempt++) {
    try {
      await p.screenshot({path:join(dir,label+'.png')});
      await writeFile(join(dir,label+'.txt'),await p.snapshot({scope:'full_page'}));
      break;
    } catch(error) {
      if(attempt>=2||!String(error.message).includes('Page changed during snapshot')) throw error;
    }
  }
}

export async function selectModel(p,scope,name,level='Medium') {
  await p.click(`${scope} .cmodel`);
  await p.click(`button[aria-label="Thinking for ${name}"]`);
  await p.click(`.cmodlv button >> nth=${['Low','Medium','High'].indexOf(level)}`);
  await p.waitForFunction(()=>!document.querySelector('.cmodpop'),undefined,{timeout:15000});
}

/** Exercise approvals even when a new cloud session allows edits and commands by default. */
export async function requireApprovals(p) {
  await p.click('.codingthread .engpermtrigger');
  await p.waitForSelector('[aria-label="Permissions for this session"]');
  for(const label of ['Edit files','Execute commands']) {
    const selector=`.cpermrow:has-text("${label}")`;
    const checked=await p.evaluate(name=>[...document.querySelectorAll('.cpermrow')]
      .find(row=>row.querySelector('b')?.textContent===name)?.getAttribute('aria-checked'),label);
    assert.ok(checked==='true'||checked==='false',`${label} permission must be available`);
    if(checked==='true') await p.click(selector);
    await p.waitForSelector(`.cpermrow[aria-checked="false"]:has-text("${label}")`);
  }
  await p.keyboard.press('Escape');
  await p.waitForSelector('.cpermpop',{state:'hidden'});
}

export async function start(p,run,spec) {
  await p.goto(run.url);
  await p.waitForSelector('[aria-label="Agent: rex"]',{timeout:30000});
  await p.click('[aria-label="New session"]');
  await p.click('.stagebox .crepo');
  await p.waitForSelector(`loc=role:menuitemradio[name*="${spec.repoLabel}"]`,{timeout:30000});
  await p.click(`loc=role:menuitemradio[name*="${spec.repoLabel}"]`);
  await selectModel(p,'.stagebox',run.model);
  await p.fill('.stagebox textarea',spec.prompt);
  await p.click('.stagebox button[aria-label="Send"]');
  await p.waitForSelector('.codingthread');
  return (await p.url()).match(/\/c\/([^?]+)/)?.[1];
}

/** A hidden dial is only a candidate for completion; confirmTurn separately requires recorded
 * completed steps and a fresh passing test run, then checks for intervening activity again. */
export const turnSettled = (s, initial) => !s.busy && !s.cards.some(c => c.status === 'proposed') && !s.approval
  && s.replies.length > initial && !s.progress;

/** A quiet UI can occur between provider tools while the previous plan is still complete.
 * Require this turn's recorded verification, then recheck the UI after that async read. */
export async function confirmTurn(p, initial, text, completionCheck) {
  if (!completionCheck || !await completionCheck()) return false;
  const latest = await state(p);
  return turnSettled(latest, initial) && latest.text === text;
}

/** Drives only visible user controls. Approvals remain scoped to the fixture's declared paths/commands. */
export async function turn(p,spec,result,dir,{planning=false,replyCount,cancelFile,completionCheck}={}) {
  const until=Date.now()+spec.timeoutSeconds*1000;
  const seen=new Set(), initial=replyCount??(await state(p)).replies.length;
  let tick=0, stable=0, nextProgress=Date.now()+15000, lastText='', changedAt=Date.now();
  while(Date.now()<until) {
    assert.ok(!cancelFile||!existsSync(cancelFile),'Eval cancelled; inspect the saved thread before restarting');
    const s=await state(p);
    // A ticking reasoning timer is not evidence that a stalled provider made progress.
    const progress=s.text.replace(/\bthought for (?:\d+[smh]\s*)+/g,'thought');
    if(progress!==lastText) {lastText=progress;changedAt=Date.now();}
    if(Date.now()-changedAt>180000) throw new Error('No visible progress for 180s; inspect the retained thread before retrying');
    if(/local brain branch is safe|sync needs a retry|connection is unavailable/i.test(s.text)) throw new Error('Conversation sync or runtime connection failed');
    if(s.progress && !seen.has(`progress-${s.progress.done}`)) {
      // Focus follows the dial when a command approval changes composer height. Hover alone
      // can leave its moving hit target; hover behavior has a separate component check.
      // Completion may remove the dial between observation and focus.
      const present=await p.evaluate(()=>{const dial=document.querySelector('.codeplandial');dial?.focus();return !!dial;});
      if(present) {
        await p.waitForFunction(()=>document.querySelector('[aria-label="Plan execution steps"]')||!document.querySelector('.codeplandial'));
        if(await p.evaluate(()=>!!document.querySelector('[aria-label="Plan execution steps"]'))) {
          await capture(p,dir,`plan-progress-${s.progress.done}-of-${s.progress.total}`);
          result.events.push({type:'plan-progress',...s.progress,at:new Date().toISOString()});
          seen.add(`progress-${s.progress.done}`);
        }
        await p.focus('.codingthread textarea');
      }
    }
    const proposed=s.cards.find(c=>c.status==='proposed');
    if(proposed&&!seen.has(proposed.id)) {
      assert.ok(!planning,'Plan mode must not request edits');
      // Expand before checking every file, including files hidden behind "Show more".
      const selector=`[data-change-review="${proposed.id}"]`;
      if(await p.evaluate(sel=>!!document.querySelector(sel+' button[aria-expanded="false"]'),selector)) await p.click(selector+' button[aria-expanded="false"]');
      const complete=(await state(p)).cards.find(c=>c.id===proposed.id);
      assert.ok(complete.files.length>0&&complete.files.every(allowedPath),'Edit approval must target only fixture files');
      await p.click(selector+' button[aria-label^="Review "] >> nth=0');
      await p.waitForSelector('[aria-label="Code changes"]');
      await p.hover(selector+' .btn.primary');
      await capture(p,dir,`${++tick}-review`);
      result.events.push({type:'review',files:complete.files,at:new Date().toISOString()});
      await p.click(selector+' .btn.primary');
      seen.add(proposed.id);
      console.log(`[${spec.id}] reviewed and approved ${complete.files.length} files`);
    } else if(s.approval?.commands.length && !await p.evaluate(()=>document.querySelector('.engapproval .primary')?.disabled)) {
      assert.ok(!planning,'Plan mode must not request commands');
      const commands=s.approval.commands.flatMap(approvalCommands);
      assert.ok(commands.length&&commands.every(command=>allowedCommand(command,result.cwd)),`Command outside eval policy: ${s.approval.commands.join("\n")}`);
      await capture(p,dir,`${++tick}-command`);
      result.events.push({type:'command',command:commands.join('\n'),at:new Date().toISOString()});
      await p.click('.engapproval .primary');
    }
    if(planning&&s.plan&&s.handoff&&!s.busy) {
      await capture(p,dir,'plan');result.events.push({type:'plan'});return;
    }
    // Screenshots and approval interactions above can take seconds; never finish from their
    // stale pre-action snapshot. Recheck after capture too, because a proposal can arrive then.
    const current = planning ? s : await state(p);
    if(!planning && turnSettled(current, initial)) {
      if(++stable>=2) {
        await capture(p,dir,`${++tick}-response`);
        if(await confirmTurn(p, initial, current.text, completionCheck)) return;
        stable=0;
      }
    } else stable=0;
    if(Date.now()>nextProgress) {await capture(p,dir,`${++tick}-progress`);nextProgress=Date.now()+15000;console.log(`[${spec.id}] ${planning?'planning':'working'} (${s.cards.length} change sets)`);}
    await new Promise(r=>setTimeout(r,800));
  }
  throw new Error(`${spec.id} ${planning?'plan':'turn'} exceeded ${spec.timeoutSeconds}s`);
}
