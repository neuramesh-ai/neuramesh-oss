#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve,join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root,localUrl,save } from '../coding-evals/support.mjs';
import { report } from './report.mjs';
const args=process.argv.slice(2).filter(a=>a!=='--');
const arg=(name,fallback)=>{const i=args.indexOf('--'+name);return i<0?fallback:args[i+1];};
if(!args.length||args.includes('--help')){console.log('Agent Desk real UI eval: --run --url LOOPBACK_APP --api-url LOOPBACK_API --database-url LOOPBACK_PG --brain LOCAL_BRAIN --workspace UUID --actor UUID --space ID [--page p1] [--out PATH]\nFresh projects and custom agents per run. Requires real provider access. --report --out PATH rebuilds evidence. --cancel --out PATH stops the driver, not agent runs. See evals/team-desk/README.md.');process.exit(0);}
const id=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);
const out=resolve(arg('out',join(root,'.nm-evidence/team-desk-evals',id)));
if(args.includes('--report')){console.log(await report(out));process.exit(0);}
if(args.includes('--cancel')){await save(join(out,'CANCEL'),{at:new Date().toISOString()});process.exit(0);}
if(!args.includes('--run')||!arg('workspace')||!arg('actor')||!arg('space'))throw Error('Use --run with workspace, actor and the owned Ego task space.');
if(!arg('brain'))throw Error('Supply --brain with the local recording directory.');
const config={id,out,url:localUrl(arg('url')).href,api:localUrl(arg('api-url')).origin,databaseUrl:localUrl(arg('database-url'),['postgres:','postgresql:']).href,brain:resolve(arg('brain')),workspace:arg('workspace'),actor:arg('actor'),space:Number(arg('space')),page:arg('page','p1')};
const program=`const {drive}=await import(${JSON.stringify(pathToFileURL(join(root,'scripts/team-desk-evals/driver.mjs')).href)});if(!await drive(taskSpace,${JSON.stringify(config)}))process.exitCode=1;`;
const child=spawn('ego-browser',['nodejs','-e',program],{stdio:'inherit'});
const code=await new Promise((r,j)=>{child.once('error',j);child.once('exit',r);});
console.log(await report(out));process.exit(code??1);
