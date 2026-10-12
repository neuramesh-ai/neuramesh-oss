#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, writeFile, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { prepare } from './prepare.mjs';
import { report } from './report.mjs';
import { root, suite, localUrl } from './support.mjs';
const args=process.argv.slice(2).filter(a=>a!=='--');
const arg=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
if(args.includes('--list')||args.includes('--help')||!args.length) {
  console.log('NeuraMesh coding UI evals v1\n'+suite.cases.map(c=>`${c.id}: ${c.title} (${c.timeoutSeconds}s per turn)`).join('\n'));
  console.log('\nRun: pnpm eval:coding --run --url http://127.0.0.1:5302/acme?db=brain-device-a --database-url postgresql://postgres:nm@127.0.0.1:56435/nm --cache /tmp/nm-brain-gcs-e2e/device-a/brain/cache\nOptions: --case simple|medium|complex --model "GPT-5.6 Sol" --handoff-model "Claude Haiku 4.5" --out PATH --resume PATH --space ID\nLayout only: --layout --url URL [--repo org/repo] (no model calls).\nRegrade completed thread: --run --resume PATH --case NAME --verify-only.\nRebuild report: --report --resume PATH. Optional brain root: --brain PATH.\nRequires a running local real-provider stack; uses model credits. Reports go to .nm-evidence/coding/. See evals/coding/README.md.');
  process.exit(0);
}
if(!args.includes('--run')&&!args.includes('--report')&&!args.includes('--layout')&&!args.includes('--cancel')) throw new Error('Use --run, --layout, or --report --resume PATH.');
if(arg('case')&&!suite.cases.some(c=>c.id===arg('case'))) throw new Error('Unknown case');
const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
const out=resolve(arg('resume',arg('out',join(root,'.nm-evidence/coding',id))));
if(args.includes('--cancel')) {if(!arg('resume')) throw new Error('--cancel requires --resume PATH');await writeFile(join(out,'CANCEL'),'cancel requested\n');console.log('Cancellation requested. Wait for active-run.json to disappear; the provider thread remains available for inspection.');process.exit(0);}
if(args.includes('--report')) {console.log(await report(out));process.exit(0);}
if(args.includes('--layout')) {
  const url=localUrl(arg('url')).href;
  const program=`const t=await taskSpace(${arg('space')?Number(arg('space')):JSON.stringify('NeuraMesh composer layout')});let passed=false;try{const {layout,threadLayout}=await import(${JSON.stringify(pathToFileURL(resolve(root,'scripts/coding-evals/layout.mjs')).href)});console.log(await layout(t.page(${JSON.stringify(arg('page','p1'))}),${JSON.stringify(url)},${JSON.stringify(out)},${JSON.stringify(arg('repo'))}));${arg('thread-url')?`console.log(await threadLayout(t.page(${JSON.stringify(arg('page','p1'))}),${JSON.stringify(localUrl(arg('thread-url')).href)},${JSON.stringify(out)}));`:''}passed=true;}finally{${arg('space')?'':'if(passed) await t.finish({keep:[]});'}}`;
  const child=spawn('ego-browser',['nodejs','-e',program],{stdio:'inherit',env:process.env});
  process.exit(await new Promise((r,j)=>{child.once('error',j);child.once('exit',r);})??1);
}
if(args.includes('--verify-only')&&(!arg('resume')||!arg('case'))) throw new Error('--verify-only requires --resume and --case for a completed thread.');
if(arg('feedback-file')&&(!arg('resume')||!arg('case')||args.includes('--verify-only'))) throw new Error('--feedback-file requires --resume and --case; it cannot be combined with --verify-only.');
if(!arg('resume')) {
  if(!arg('url')||!arg('database-url')||!arg('cache')) throw new Error('Set --url, --database-url and --cache for the local stack.');
  await prepare({id,out,url:localUrl(arg('url')).href,databaseUrl:arg('database-url'),cache:resolve(arg('cache')),brain:arg('brain')?resolve(arg('brain')):undefined,fixtures:join('/tmp/nm-coding-evals',id),workspace:arg('workspace','a0000000-0000-0000-0000-00000000000a'),actor:arg('actor','00000000-0000-0000-0000-000000000001'),model:arg('model','GPT-5.6 Sol'),handoffModel:arg('handoff-model','Claude Haiku 4.5')});
}
console.log(`EVAL_OUTPUT=${out}`);
if(await access(join(out,'active-run.json')).then(()=>true,()=>false)) throw new Error('An eval is already active in this directory; cancel it and wait before retrying.');
await rm(join(out,'CANCEL'),{force:true});
const feedback=arg('feedback-file')?(await readFile(resolve(arg('feedback-file')),'utf8')).trim():undefined;
if(arg('feedback-file')&&!feedback) throw new Error('Feedback must not be empty.');
const config={out,page:arg('page'),case:arg('case'),space:arg('space')?Number(arg('space')):undefined,node:process.execPath,verifyOnly:args.includes('--verify-only'),feedback};
const program=`const {drive}=await import(${JSON.stringify(pathToFileURL(resolve(root,'scripts/coding-evals/driver.mjs')).href)});if(!await drive(taskSpace,${JSON.stringify(config)}))process.exitCode=1;`;
const child=spawn('ego-browser',['nodejs','-e',program],{stdio:'inherit',env:process.env});
const code=await new Promise((r,j)=>{child.once('error',j);child.once('exit',r);});
const summary=await report(out);
console.log(`REPORT=${join(out,'report.html')}\nSUITE=${summary.status}`);
process.exit(code??1);
