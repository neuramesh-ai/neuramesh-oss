import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { capture } from './flow.mjs';

export async function serve(cwd) {
  const base=await realpath(cwd);
  const server=createServer(async(req,res)=>{
    try {
      const path=decodeURIComponent(new URL(req.url,'http://local').pathname);
      if(path!=='/'&&!/^\/(public|src)\/[\w./-]+$/.test(path)) throw new Error('Not a preview asset');
      const file=await realpath(resolve(base,path==='/'?'public/index.html':path.slice(1)));
      if(!file.startsWith(base+sep)) throw new Error('Outside fixture');
      const type={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(file)];
      if(!type) throw new Error('Not a preview asset');
      res.writeHead(200,{'content-type':type,'cache-control':'no-store'});res.end(await readFile(file));
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {url:`http://127.0.0.1:${server.address().port}/`,close:()=>new Promise(r=>server.close(r))};
}

async function frameContext(p) {
  // Match the actual iframe DOM node, not its URL: retained tabs may point at the same app.
  const object=await p.cdp('Runtime.evaluate',{expression:"document.querySelector('.wtpane.on iframe.bwview')"});
  if(!object.result.objectId) throw new Error('NeuraMesh browser preview frame is missing');
  try {
    const {node}=await p.cdp('DOM.describeNode',{objectId:object.result.objectId});
    if(!node.frameId) throw new Error('Preview frame is not ready');
    return (await p.cdp('Page.createIsolatedWorld',{frameId:node.frameId,worldName:'nm-eval-checks'})).executionContextId;
  } finally {await p.cdp('Runtime.releaseObject',{objectId:object.result.objectId});}
}
async function inspect(p,expression) {
  const r=await p.cdp('Runtime.evaluate',{contextId:await frameContext(p),expression,returnByValue:true});
  if(r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
}

// Give the observed control in the active frame a unique locator. Ego's global locators
// otherwise also match controls in retained iframe tabs. Actions still use real input events;
// this only annotates the DOM and never changes app state or bypasses accessibility checks.
async function target(p,expression) {
  const id=randomUUID();
  const found=await inspect(p,`(()=>{const el=${expression};if(!el)return false;el.setAttribute('data-nm-eval-target',${JSON.stringify(id)});return true;})()`);
  assert.ok(found,`Visible preview control: ${expression}`);
  const selector=`[data-nm-eval-target="${id}"]`;
  // Ego's automatic locator scroll can stop at the iframe boundary. Use real
  // wheel input inside the active preview, without altering application state.
  for(let attempt=0;attempt<8;attempt++) {
    const geometry=await inspect(p,`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el?.getClientRects().length)return null;const r=el.getBoundingClientRect();return {center:r.top+r.height/2,height:innerHeight};})()`);
    assert.ok(geometry,`Rendered preview control: ${expression}`);
    if(geometry.center>=0&&geometry.center<geometry.height) return selector;
    const frame=await p.evaluate(()=>{const r=document.querySelector('.wtpane.on iframe.bwview').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};});
    await p.mouse.move(frame.x,frame.y,{label:'focus app preview'});
    await p.mouse.wheel(0,Math.max(-800,Math.min(800,geometry.center-geometry.height/2)),{label:'show preview control'});
  }
  throw new Error(`Preview control did not scroll into view: ${expression}`);
}
function labelledField(label) {
  const wanted=JSON.stringify(label);
  return `[...document.querySelectorAll('input,textarea,select')].find(e=>e.getAttribute('aria-label')===${wanted}||[...(e.labels??[])].some(l=>l.textContent.trim()===${wanted}))`;
}
export async function field(p,label) { return target(p,labelledField(label)); }
async function hasField(p,label) { return !!await inspect(p,`!!(${labelledField(label)})`); }
export async function button(p,label,partial=false) {
  const wanted=JSON.stringify(label);
  const selector=await target(p,`[...document.querySelectorAll('button')].find(e=>{const copy=e.cloneNode(true);copy.querySelectorAll('[aria-hidden=\"true\"],[hidden]').forEach(n=>n.remove());const labelled=(e.getAttribute('aria-labelledby')??'').split(' ').filter(Boolean).map(id=>document.getElementById(id)?.textContent??'').join(' ');const name=(e.getAttribute('aria-label')??(labelled||copy.textContent)).trim().replace(/\\s+/g,' ');return e.getClientRects().length&&${partial?`name.includes(${wanted})`:`name===${wanted}`};})`);
  await p.click(selector);
}
async function waitHeading(p,heading) {
  const until=Date.now()+15000;
  while(!await inspect(p,`document.querySelector('h1')?.textContent.includes(${JSON.stringify(heading)})`).catch(()=>false)) {
    if(Date.now()>until) throw new Error(`Preview heading ${heading} did not appear in the active frame`);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
}

/** Capture the settled UI, including after reload; a heading can precede entry animations. */
async function settlePreview(p) {
  const until=Date.now()+5000;
  while(await inspect(p,"document.getAnimations().some(a=>a.playState==='running'&&Number.isFinite(a.effect?.getComputedTiming().endTime))")) {
    if(Date.now()>until) throw new Error('Preview entrance animations did not settle');
    await new Promise(resolve=>setTimeout(resolve,100));
  }
}

const visibleAlert = "[...document.querySelectorAll('[role=alert]')].some(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden'&&e.textContent.trim())";

export async function preview(p,spec,cwd,dir,result) {
  const server=await serve(cwd);
  const check=(name,yes)=>{result.checks.push({name,passed:!!yes});assert.ok(yes,name);};
  try {
    await p.click('[aria-label="Browser"]');
    await p.waitForSelector('.wtpane.on .bwurl');
    await p.fill('.wtpane.on .bwurl',server.url);await p.press('.wtpane.on .bwurl','Enter');
    await p.waitForSelector('.wtpane.on iframe.bwview',{timeout:15000});
    const heading=spec.id==='medium'?'TaskGarden':'LedgerDesk';
    await waitHeading(p,heading);
    await settlePreview(p);
    await capture(p,dir,'preview-initial');
    check('solution appears inside NeuraMesh browser',await inspect(p,`document.querySelector('h1')?.textContent.includes(${JSON.stringify(heading)})`));
    if(spec.id==='medium') {
      await p.fill(await field(p,'Task title'),'Buy milk');await button(p,'Add task',true);
      await p.fill(await field(p,'Task title'),'Read book');await button(p,'Add task',true);
      await p.press(await field(p,'Complete Buy milk'),'Space');
      await button(p,'Active');
      check('active filter hides completed tasks',!await hasField(p,'Complete Buy milk')&&await hasField(p,'Complete Read book'));
      await button(p,'Completed');
      check('completed filter shows completed task',await hasField(p,'Complete Buy milk')&&!await hasField(p,'Complete Read book'));
      await button(p,'All');
      await p.fill(await field(p,'Task title'),'  ');await button(p,'Add task',true);
      check('empty task shows validation',await inspect(p,visibleAlert));
    } else {
      await p.fill(await field(p,'Expense title'),'Lunch');await p.fill(await field(p,'Amount'),'12.34');await p.fill(await field(p,'Category'),'Food');await button(p,'Add expense',true);
      check('exact money total shown',await inspect(p,"document.querySelector('[data-testid=total]')?.textContent.includes('12.34')"));
      await p.fill(await field(p,'Import JSON'),'[{"id":"book","title":"Book","amountCents":500,"category":"Study"}]');await button(p,'Import');
      check('import adds to existing total',await inspect(p,"document.querySelector('[data-testid=total]')?.textContent.includes('17.34')"));
      const importField=await field(p,'Import JSON');
      check('successful import clears its input',await inspect(p,`document.querySelector(${JSON.stringify(importField)}).value===''`));
      await button(p,'Export JSON');
      const exportedField=await field(p,'Import JSON');
      check('export includes both existing and imported records',await inspect(p,`(()=>{const rows=JSON.parse(document.querySelector(${JSON.stringify(exportedField)}).value);return rows.length===2&&rows.some(r=>r.title==='Lunch'&&r.amountCents===1234)&&rows.some(r=>r.id==='book'&&r.amountCents===500);})()`));
      const beforeInvalidImport=await inspect(p,"localStorage.getItem('ledgerdesk.state')");
      await p.fill(await field(p,'Import JSON'),'[{"id":"book","title":"Duplicate","amountCents":100,"category":"Study"}]');await button(p,'Import');
      check('invalid import is atomic and visible',await inspect(p,"document.querySelector('[data-testid=total]')?.textContent.includes('17.34')&&"+visibleAlert));
      check('failed import leaves saved data unchanged',await inspect(p,"localStorage.getItem('ledgerdesk.state')")===beforeInvalidImport);
      await p.selectOption(await field(p,'Filter category'),{label:'Study'});
      check('category filter shows only matching entries',await inspect(p,"document.querySelectorAll('[data-expense-id]').length===1&&document.querySelector('[data-expense-id]')?.textContent.includes('Book')"));
      await p.selectOption(await field(p,'Filter category'),{label:'All'});
      await p.click('.wtpane.on .bwbar [aria-label="Reload"]');await waitHeading(p,'LedgerDesk');
      await p.fill(await field(p,'Expense title'),'Invalid expense');await p.fill(await field(p,'Amount'),'-1');await p.fill(await field(p,'Category'),'Food');await button(p,'Add expense',true);
      check('invalid amount shows an error without changing totals',await inspect(p,"document.querySelector('[data-testid=total]')?.textContent.includes('17.34')&&"+visibleAlert));
    }
    await p.click('.wtpane.on .bwbar [aria-label="Reload"]');
    await waitHeading(p,heading);
    check('app data persists across preview reload',await inspect(p,spec.id==='medium'?"document.querySelectorAll('input[type=checkbox]').length===2":"document.querySelector('[data-testid=total]')?.textContent.includes('17.34')"));
    check('preview has no horizontal overflow',await inspect(p,'document.documentElement.scrollWidth<=innerWidth+1'));
    if(spec.id==='complex') {
      // Install old/corrupt data only in this isolated eval origin; exercise the app's real
      // startup path and restore its saved valid state before the final screenshot.
      const stored=await inspect(p,"localStorage.getItem('ledgerdesk.state')");
      const legacy={version:1,items:[{id:'legacy',title:'Legacy trip',amount:6.78,category:'Travel'}]};
      await inspect(p,`localStorage.setItem('ledgerdesk.state',${JSON.stringify(JSON.stringify(legacy))})`);
      await p.click('.wtpane.on .bwbar [aria-label="Reload"]');await waitHeading(p,'LedgerDesk');
      check('preview startup migrates version 1 records',await inspect(p,"document.querySelector('[data-testid=total]')?.textContent.includes('6.78')&&document.querySelector('[data-expense-id=legacy]')?.textContent.includes('Legacy trip')"));
      await capture(p,dir,'preview-migration');
      await inspect(p,"localStorage.setItem('ledgerdesk.state','{broken legacy data')");
      await p.click('.wtpane.on .bwbar [aria-label="Reload"]');await waitHeading(p,'LedgerDesk');
      check('corrupt saved data is reported and preserved',await inspect(p,"localStorage.getItem('ledgerdesk.state')==='{broken legacy data'&&"+visibleAlert));
      await capture(p,dir,'preview-storage-error');
      await inspect(p,`localStorage.setItem('ledgerdesk.state',${JSON.stringify(stored)})`);
      await p.click('.wtpane.on .bwbar [aria-label="Reload"]');await waitHeading(p,'LedgerDesk');
    }
    await settlePreview(p);
    await capture(p,dir,'preview-final');
    result.previewUrl=server.url;
  } finally {await server.close();}
}
