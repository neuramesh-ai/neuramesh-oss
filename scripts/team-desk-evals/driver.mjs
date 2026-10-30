import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID,createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir,open,rm,writeFile,readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { root,save,localUrl,exec } from '../coding-evals/support.mjs';
import { selectModel } from '../coding-evals/flow.mjs';
import { grade } from './oracle.mjs';

export async function drive(taskSpace,c) {
  localUrl(c.url);localUrl(c.api);localUrl(c.databaseUrl,['postgres:','postgresql:']);
  const require=createRequire(join(root,'packages/control-api/package.json'));
  const sql=require('postgres')(c.databaseUrl,{max:1});
  await mkdir(c.out,{recursive:true});
  const lock=await open(join(c.out,'active-run.json'),'wx');await lock.writeFile(JSON.stringify({space:c.space,page:c.page}));await lock.close();
  const result={id:c.id,status:'running',checks:[],images:[],startedAt:new Date().toISOString()};
  const run={id:c.id,url:c.url,workspace:c.workspace,actor:c.actor,marker:`TD-${c.id.slice(-8)}`,homes:[],prompts:[],projects:[]};
  const task=await taskSpace(c.space),p=task.page(c.page);
  const check=(name,yes)=>{result.checks.push({name,passed:!!yes});assert.ok(yes,name);};
  const request=async(path,body,actor={kind:'human',id:c.actor})=>fetch(c.api+path,{method:body?'POST':'GET',headers:{'content-type':'application/json','x-nm-actor':JSON.stringify(actor)},...(body?{body:JSON.stringify(body)}:{})});
  const api=async(path,body)=>{const r=await request(path,body);const data=await r.json();if(!r.ok)throw Error(`${path}: ${r.status} ${JSON.stringify(data)}`);return data;};
  const persist=()=>save(join(c.out,'run.json'),run);
  const card=name=>`.teamdesk-card:not([hidden])[aria-label="${name} agent thread"]`;
  const shot=async label=>{
    await p.evaluate(()=>{const e=document.querySelector('.teamdesk');if(e)e.scrollTop=0;});
    await p.cdp('Runtime.evaluate',{expression:'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',awaitPromise:true});
    const s=await p.cdp('Page.captureScreenshot',{format:'png'});await writeFile(join(c.out,label+'.png'),Buffer.from(s.data,'base64'));result.images.push(label);
    await writeFile(join(c.out,label+'.txt'),await p.snapshot({scope:'full_page'}));
  };
  const until=async(label,condition,timeout=180000)=>{
    const end=Date.now()+timeout;let progress=Date.now()+15000;
    while(Date.now()<end){
      if(existsSync(join(c.out,'CANCEL')))throw Error('Driver cancelled; inspect provider runs separately.');
      if(await condition())return;
      if(Date.now()>progress){console.log(`Waiting: ${label}`);progress=Date.now()+15000;}
      await new Promise(r=>setTimeout(r,1000));
    }
    throw Error(`Timed out: ${label}`);
  };
  const switchProject=async project=>{
    await p.click('[aria-label="Agent Desk project"]');
    await p.waitForSelector(`.cprojitem:has-text("${project.name}")`,{timeout:30000});
    await p.click(`.cprojitem:has-text("${project.name}")`);
    await p.waitForFunction(name=>document.querySelector('[aria-label="Agent Desk project"]')?.textContent.includes(name),project.name);
  };
  const send=async(home,prompt)=>{run.prompts.push({home:home.id,prompt,at:new Date().toISOString()});await persist();await p.fill(`${card(home.name)} textarea`,prompt);await p.click(`${card(home.name)} button[aria-label="Send reply"]`);};
  const receipts=async()=>{
    const hash=s=>createHash('sha256').update(s).digest('hex');
    const rows=[];
    for(const home of run.homes){
      const file=join(c.brain,'conversations',hash(c.workspace),hash(c.actor),hash(home.id),'events.jsonl');
      const events=(await readFile(file,'utf8').catch(()=>'' )).split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
      for(const call of events.filter(e=>e.type==='tool.call'&&['list_team','read_agent_thread','message_agent','draft_article'].includes(e.payload?.name))){
        const result=events.find(e=>e.type==='tool.result'&&e.payload?.id===call.payload.id);
        rows.push({threadId:home.id,name:call.payload.name,input:call.payload.input,ok:result?.payload?.ok===true});
      }
    }
    return rows;
  };
  const evidence=async()=>({marker:run.marker,otherProjectMarker:run.otherProjectMarker,projectId:run.projects[0].id,homes:run.homes,toolReceipts:await receipts(),
    messages:await sql`select id,thread_id,author_kind,author_id,body,team_source_thread_id,team_depth,created_at from messages where thread_id in ${sql(run.homes.map(h=>h.id))} order by created_at,id`,
    runs:await sql`select id,thread_id,agent_id,state,started_at,ended_at,summary from runs where thread_id in ${sql(run.homes.map(h=>h.id))} order by started_at,id`,
    artifacts:await sql`select id,project_id,created_by,inline_content,created_at from artifacts where project_id=${run.projects[0].id}::uuid`});
  try {
    run.revision=(await exec('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
    run.dirty=!!(await exec('git',['status','--porcelain'],{cwd:root})).stdout.trim();
    for(const suffix of ['Main','Other']){
      const name=`Desk eval ${c.id.slice(-8)} ${suffix}`;
      const made=await api('/v1/commands',{type:'project.create',workspace:c.workspace,name});
      run.projects.push({id:made.projectId,name});await persist();
    }
    const url=new URL(c.url);url.searchParams.set('view','team');await p.goto(url.href);
    await p.cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1000,deviceScaleFactor:1,mobile:false});
    await p.waitForSelector('[aria-label="Agent Desk project"]',{timeout:30000});await switchProject(run.projects[0]);
    for(const seat of ['lead','research','design']){
      const name=`${seat}-${c.id.slice(-8)}`;
      const description=`${seat} specialist for a local startup launch pilot. Collaborate only within the current project.`;
      const instructions=`Keep replies concise. Follow the human's current request. For a teammate's work request, send the substantive result to the requesting home using message_agent, including the exact requested SIGNOFF marker; never send acknowledgement loops. Do not contact external services, publish, create tasks, or run shell commands. Use draft_article only when explicitly requested.`;
      await p.click('.teamdesk-toolbar button:text-is("Add agent")');await p.click('button:text-is("Create custom agent")');
      await p.fill('[aria-label="Agent name"]',name);await p.fill('[aria-label="Agent description"]',description);await p.fill('[aria-label="Agent instructions"]',instructions);
      await p.click('.modal .rselbtn');await p.click(`.modal [role="option"]:has-text("${seat==='lead'?'Developer':seat==='design'?'Designer':'Architect'}")`);
      if(seat==='lead')await shot('custom-agent-form');
      await p.click('.modal button:text-is("Create agent")');
      await p.waitForSelector(`${card(name)} textarea`,{timeout:30000});
      check(`${seat}: custom card is immediately focused and writable`,await p.evaluate(name=>{const e=document.querySelector(`.teamdesk-card:not([hidden])[aria-label="${name} agent thread"] textarea`);return e===document.activeElement&&!e.disabled&&e.placeholder===`Ask ${name} anything`;},name));
      const [a]=await sql`select id,name,description,brief from agents where workspace_id=${c.workspace}::uuid and name=${name}`;
      check(`${seat}: normal creation retains description and instructions`,a?.description===description&&a.brief===instructions);
      const desk=await api(`/v1/team?workspace=${c.workspace}&projectId=${run.projects[0].id}`);
      const h=desk.homes.find(h=>h.home_agent_id===a.id);assert.ok(h,'Created agent has a home');
      run.homes.push({seat,name,id:h.id,agentId:a.id,channelId:h.channel_id});await persist();
      await selectModel(p,card(name),'GPT-5.6 Sol');
    }
    const lead=run.homes[0];
    await p.click(`${card(lead.name)} button[aria-label="Focus ${lead.name}"]`);await p.click(`${card(lead.name)} .cmodel`);await p.keyboard.press('Escape');
    check('model Escape closes menu without leaving the focused card',await p.evaluate(()=>!document.querySelector('.cmodpop')&&!!document.querySelector('.teamdesk-card.is-expanded')));
    await p.click('button[aria-label="Return to Agent Desk"]');
    // Prefill all three before sending: the UI must accept work without waiting for another card.
    for(const h of run.homes){
      const facts=h.seat==='research'?'Customer discovery found 37 founder interviews and a maximum pilot budget of 4800 USD. Recommend prioritizing activation.':h.seat==='design'?'Onboarding must support keyboard-only operation in 3 steps and a minimum text contrast of 4.5:1. Recommend labelled coachmarks.':'The pilot lasts 14 days. You coordinate research and design; do not contact them until I ask.';
      const prompt=`Project brief ${run.marker}. ${facts} Reply with ${run.marker}-${h.seat}-READY followed by three concise recommendations and one risk. For this initial reply, do not use tools or contact teammates. Standing authorization for subsequent work in this project: when ${lead.name} sends a work request, use the project collaboration tools and send your substantive result back to its requesting home with message_agent. No external services, shell, tasks or publishing.`;
      run.prompts.push({home:h.id,prompt});await p.fill(`${card(h.name)} textarea`,prompt);
    }
    await persist();for(const h of run.homes)await p.click(`${card(h.name)} button[aria-label="Send reply"]`);
    await shot('concurrent-start');
    await until('three real initial replies',async()=>{const e=await evidence();return run.homes.every(h=>e.messages.some(m=>m.thread_id===h.id&&m.author_id===h.agentId&&m.body.includes(`${run.marker}-${h.seat}-READY`)))&&e.runs.length>=3&&e.runs.every(r=>r.state!=='running');});
    await shot('three-agent-replies');
    const initial=await evidence();check('initial turns did not fail',initial.runs.every(r=>r.state==='done'));
    // Same identity, different project. A canary in its real second conversation must stay there.
    await p.fill(`${card(lead.name)} textarea`,'Draft stays with the main project');await switchProject(run.projects[1]);
    await p.click('.teamdesk-toolbar button:text-is("Add agent")');await p.click(`.teamdesk-roster button:has-text("${lead.name}")`);
    await p.waitForSelector(`${card(lead.name)} textarea`);
    const other=await api(`/v1/team?workspace=${c.workspace}&projectId=${run.projects[1].id}`);run.otherHome=other.homes.find(h=>h.home_agent_id===lead.agentId);run.otherProjectMarker=`PRIVATE-${randomUUID()}`;await persist();
    check('same agent receives a distinct empty project home',run.otherHome.id!==lead.id&&run.otherHome.msg_count===0);
    await selectModel(p,card(lead.name),'GPT-5.6 Sol');
    await send({...lead,id:run.otherHome.id},`This project's private label is ${run.otherProjectMarker}. Reply once with exactly that label, no tools.`);
    await until('separate project reply',async()=>{const rows=await sql`select body from messages where thread_id=${run.otherHome.id}::uuid and author_id=${lead.agentId}::uuid`;return rows.some(r=>r.body.includes(run.otherProjectMarker));});
    const denied=await request(`/v1/team/history?workspace=${c.workspace}&threadId=${run.otherHome.id}&sourceThreadId=${lead.id}`,undefined,{kind:'agent',id:lead.agentId});
    check('agent cannot read its other project through collaboration history',denied.status===403);
    await switchProject(run.projects[0]);await p.waitForSelector(`${card(lead.name)} textarea`);
    check('switching projects preserves the original draft',await p.evaluate(name=>document.querySelector(`.teamdesk-card:not([hidden])[aria-label="${name} agent thread"] textarea`).value==='Draft stays with the main project',lead.name));
    const peers=run.homes.slice(1);
    await send(lead,`Coordinate the pilot now. First call list_team and read_agent_thread for ${peers.map(h=>h.name).join(' and ')} to read their actual briefs. Then send each exactly one work request with message_agent. Ask each to review its brief and return its recommendation to YOUR home ${lead.id} with marker ${run.marker}-research-SIGNOFF or ${run.marker}-design-SIGNOFF respectively. Include the relevant exact marker in each request. Do not invent their replies. When both signoffs have arrived, use draft_article to deliver one combined report titled "${run.marker} launch decision". Include the facts from both briefs, both exact signoff markers, the pilot duration from your brief, owners, and a decision/risk section. Wait for real responses if needed; a teammate return wakes you. No external tools, shell, tasks, publishing or acknowledgement messages. Deliver the article only after both signoffs.`);
    await shot('collaboration-start');
    await until('returned contributions and combined article',async()=>{const e=await evidence();await save(join(c.out,'evidence.json'),e);return e.artifacts.some(a=>a.inline_content?.includes(run.marker))&&e.runs.every(r=>r.state!=='running');},240000);
    const e=await evidence();await save(join(c.out,'evidence.json'),e);
    const oracle=grade(e);result.checks.push(...oracle.checks);check('independent multi-agent workflow oracle passes',oracle.passed);
    await p.click(`${card(lead.name)} button[aria-label="Focus ${lead.name}"]`);
    await p.click(`${card(lead.name)} button:text-is("Open article")`);
    await p.waitForSelector('.sidedock .wtpane.on[role="tabpanel"]',{state:'visible'});
    check('delivered article opens in the shared right pane',await p.evaluate(marker=>[...document.querySelectorAll('.sidedock .wtpane.on[role="tabpanel"]')].some(e=>e.getBoundingClientRect().width>200&&e.textContent.includes(marker)),run.marker));
    await shot('combined-deliverable');await p.click('[aria-label="Fold the side panel"]');await p.click('[aria-label="Return to Agent Desk"]');
    const ids=run.homes.map(h=>h.id).sort();await p.reload();await p.waitForSelector(`${card(lead.name)} textarea`,{timeout:30000});
    const restored=await api(`/v1/team?workspace=${c.workspace}&projectId=${run.projects[0].id}`);
    const restoredEval=restored.homes.filter(h=>ids.includes(h.id));
    check('reload retains all home IDs and full persisted history',JSON.stringify(restoredEval.map(h=>h.id).sort())===JSON.stringify(ids)&&restoredEval.every(h=>h.msg_count===e.messages.filter(m=>m.thread_id===h.id).length));
    check('fixed owner and model remain after reload',await p.evaluate(homes=>homes.every(h=>{const c=document.querySelector(`.teamdesk-card:not([hidden])[aria-label="${h.name} agent thread"]`);return c?.querySelector('.composer-agent-identity')?.textContent.includes(h.name)&&!c.querySelector('button[aria-label^="Agent:"]')&&c.querySelector('.cmodel')?.textContent.includes('GPT-5.6 Sol');}),run.homes));
    await shot('restored-team');result.status='passed';
  } catch(error) {
    result.status='failed';result.error=error.stack??String(error);await shot('failure').catch(()=>{});if(run.homes.length)await save(join(c.out,'evidence.json'),await evidence()).catch(()=>{});console.error(error);
  } finally {
    result.finishedAt=new Date().toISOString();await save(join(c.out,'result.json'),result);await persist();await sql.end();await rm(join(c.out,'active-run.json'),{force:true});
  }
  return result.status==='passed';
}
