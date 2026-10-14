import assert from 'node:assert/strict';
import { join } from 'node:path';
import { capture } from './flow.mjs';
import { save } from './support.mjs';

/** Rendering checks only: no messages, model credits, or persisted theme changes. */
export async function layout(p,url,out,repo) {
  const checks=[], measurements=[];
  const check=(name,value)=>{checks.push({name,passed:!!value});assert.ok(value,name);};
  await p.goto(url);await p.waitForSelector('[aria-label="Agent: rex"]');
  await p.click('[aria-label="New session"]');
  if(await p.evaluate(()=>!!document.querySelector('[aria-label="Fold the side panel"]')?.getBoundingClientRect().height)) await p.click('[aria-label="Fold the side panel"]');
  await p.click('.stagebox .crepo');
  await p.click('loc=role:menuitemradio[name*="None"]');
  const original=await p.evaluate(()=>document.documentElement.dataset.theme);
  try {
    for(const mode of repo?['chat','coding']:['chat']) {
      if(mode==='coding') {
        await p.click('.stagebox .crepo');
        await p.click(`loc=role:menuitemradio[name*="${repo}"]`);
      }
      for(const theme of ['dark','light']) for(const width of [1440,1000]) {
        await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
        await p.evaluate(value=>{document.documentElement.dataset.theme=value;},theme);
        const facts=await p.evaluate(()=>{
          const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right};};
          const controls=[...document.querySelectorAll('.stagebox .hrow button')].map(e=>({label:e.getAttribute('aria-label')??e.textContent.trim(),rect:e.getBoundingClientRect().toJSON()})).filter(e=>e.rect.width>0&&e.rect.height>0);
          return {box:rect('.stagebox'),input:rect('.stagebox textarea'),row:rect('.stagebox .hrow'),agent:rect('.stagebox .cagent'),model:rect('.stagebox .cmodel'),send:rect('.stagebox .hsend'),controls,overflow:document.documentElement.scrollWidth>innerWidth};
        });
        const label=`${mode}/${theme}/${width}px`;
        measurements.push({label,...facts});
        check(`${label}: writing area has breathing room`,facts.input.height>=96);
        check(`${label}: composer fits its column`,facts.box.right<=width&&!facts.overflow);
        check(`${label}: controls do not overlap`,facts.controls.every((a,i)=>facts.controls.slice(i+1).every(b=>a.rect.right<=b.rect.left+1||b.rect.right<=a.rect.left+1||a.rect.bottom<=b.rect.top+1||b.rect.bottom<=a.rect.top+1)));
        if(width===1440) {
          check(`${label}: desktop composer uses the wider measure`,facts.box.width===820);
          check(`${label}: agent and model share the row`,Math.abs(facts.agent.y-facts.model.y)<4);
          check(`${label}: send and model share the row`,Math.abs(facts.send.y-facts.model.y)<5);
        }
        await capture(p,out,`composer-${mode}-${theme}-${width}`);
      }
    }
  } finally {
    await p.evaluate(value=>{document.documentElement.dataset.theme=value;},original);
    await p.cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1050,deviceScaleFactor:1,mobile:false});
    await save(join(out,'layout-checks.json'),{checks,measurements});
  }
  return checks;
}

/** Check an existing idle thread without creating messages or changing stored preferences. */
export async function threadLayout(p,url,out) {
 await p.goto(url);await p.waitForSelector('.codingthread .cagent');
 if(await p.evaluate(()=>!!document.querySelector('[aria-label="Fold the side panel"]')?.getBoundingClientRect().height))await p.click('[aria-label="Fold the side panel"]');
 const original=await p.evaluate(()=>document.documentElement.dataset.theme),checks=[],measurements=[];
 try {
  for(const theme of ['dark','light'])for(const width of [1440,1000]) {
   await p.cdp('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await p.evaluate(value=>document.documentElement.dataset.theme=value,theme);
   const m=await p.evaluate(()=>({input:document.querySelector('.codingthread textarea').getBoundingClientRect().toJSON(),box:document.querySelector('.codingbox').getBoundingClientRect().toJSON(),transcript:document.querySelector('.codingthread .thread-overview-transcript').getBoundingClientRect().toJSON(),controls:[...document.querySelectorAll('.codingbox .trow button')].map(b=>b.getBoundingClientRect().toJSON()).filter(r=>r.width&&r.height)}));
   const values={'thread composer centers on transcript':Math.abs((m.box.left+m.box.right)-(m.transcript.left+m.transcript.right))<=2,'thread writing space':m.input.height>=48,'thread composer fits':m.box.right<=width+1&&m.box.bottom<=1000+1,'thread controls do not overlap':m.controls.every((a,i)=>m.controls.slice(i+1).every(b=>a.right<=b.left+1||b.right<=a.left+1||a.bottom<=b.top+1||b.bottom<=a.top+1))};
   for(const [name,passed]of Object.entries(values)){checks.push({name:`${theme}/${width}: ${name}`,passed});assert.ok(passed,name);}
   measurements.push({theme,width,...m});await capture(p,out,`thread-${theme}-${width}`);
  }
 } finally {await p.evaluate(value=>document.documentElement.dataset.theme=value,original);await p.cdp('Emulation.setDeviceMetricsOverride',{width:1600,height:1050,deviceScaleFactor:1,mobile:false});await save(join(out,'thread-layout-checks.json'),{checks,measurements});}
 return checks;
}
