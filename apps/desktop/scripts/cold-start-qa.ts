/** Local-only cold-start qualification. Uses the real API, lifecycle, tar/zstd,
 * relay and shell; emulates object storage and the fleet's container scheduling.
 * Never accepts a hosted API/database or a directory containing another run. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { CloudRunLifecycle } from '../src/main/cloudrun/lifecycle';
import { Snapshots, EpochFencedError, type SnapshotSigner } from '../src/main/cloudrun/snapshot';
import { connectMachineEdge, type MachineEdge } from '../src/main/relay/machine-edge';
import { createCloudMachine } from '../../../packages/control-api/src/fleet';
import { applyMachineStatus, machineControl } from '../../../packages/control-api/src/fleet-cloudrun';
import { mintBootCredential } from '../../../packages/control-api/src/fleet-cloudrun-boot';
import { mintMachineToken } from '../../../packages/control-api/src/machine-auth';
import { grantCredits } from '../../../packages/control-api/src/credits';
import { fingerprint } from '../src/main/cloudrun/lazy-format';
import { hydratePath } from '../src/main/harness/hydration';
import { execFileSync } from 'node:child_process';
import { gitChildEnv } from '../src/main/harness/workspaces';
import { repoTerminalDirectory } from '../src/main/relay/terminal-workspace';

async function main() {
const input=JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const databaseUrl=input.api.env.DATABASE_URL,u=new URL(databaseUrl);
assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'56435');assert.equal(u.pathname,'/nm_cloudrun_20261107');
assert.equal(input.api.env.PORT,'8927');assert.equal(input.relay.env.PORT,'8928');
const root=resolve(process.argv[3]!);assert.ok(/^\/private\/tmp\/nm-(?:startup-implementation-20261110|terminal-routing-20261111)\//.test(root));
const repositoryTerminal=process.argv.includes('--repo-terminal');
assert.ok(!existsSync(root),'Use a fresh fixture run; no reset is permitted.');mkdirSync(root,{recursive:true,mode:0o700});
const require=createRequire(resolve(process.cwd(),'package.json')),sql=require('../../packages/control-api/node_modules/postgres')(databaseUrl,{max:2});
const actor='00000000-0000-0000-0000-000000000001',api='http://127.0.0.1:8927';
const human={'content-type':'application/json','x-nm-actor':JSON.stringify({kind:'human',id:actor})};
async function call(path:string, body?:unknown, token?:string):Promise<any>{const r=await fetch(api+path,{headers:token?{'content-type':'application/json',authorization:`Bearer ${token}`}:human,...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});if(!r.ok)throw Error(`Local API ${path}: ${r.status} ${await r.text()}`);return r.json();}
const slug='cold-qa-'+randomUUID().slice(0,8);
const made=await call('/v1/commands',{type:'workspace.create',name:'Cold startup QA '+root.split('/').at(-1),slug});
const workspace=made.workspaceId;assert.match(workspace,/^[a-f0-9-]{36}$/);
await sql`update workspaces set plan='cloud' where id=${workspace}::uuid`;
await grantCredits(sql,workspace,10000,'manual','local cold startup fixture');
const machine=(await createCloudMachine(sql,{workspaceId:workspace,kind:'runner',ownerUserId:actor,name:'Cold startup QA machine',tokenHash:mintMachineToken().hash,substrate:'cloudrun'})).id;
const [project]=await sql`select id from projects where workspace_id=${workspace}::uuid and is_default=true`;
const repoId=randomUUID(),cloudRepoId=randomUUID();
if(repositoryTerminal){
 await sql`insert into repos(id,workspace_id,provider,org_name,name,default_branch,local_path,clone_url) values
 (${repoId}::uuid,${workspace}::uuid,'local','local','cold-project','main','/Volumes/example/appdot/cold-project',null),
 (${cloudRepoId}::uuid,${workspace}::uuid,'github','qa','cold-project','main',null,'https://github.com/qa/cold-project.git')`;
 await sql`insert into project_repos(project_id,repo_id,is_primary) values(${project.id}::uuid,${repoId}::uuid,true),(${project.id}::uuid,${cloudRepoId}::uuid,false)`;
}
// The product queries its SQLite replica (integer booleans); this fixture reads the same
// committed metadata from PostgreSQL without starting another replica feed.
const replica={async get<T>(query:string,params:unknown[]=[]):Promise<T|undefined>{let n=0;const pg=query.replace(/coalesce\((\w+\.is_primary), 0\)/g,'(case when $1 then 1 else 0 end)').replace(/\?/g,()=>`$${++n}`);return (await sql.unsafe(pg,params))[0] as T|undefined;}};
await sql`insert into agents(workspace_id,machine_id,name) values(${workspace}::uuid,${machine}::uuid,'cold-qa-rex')`;
const credential=(await mintBootCredential(sql,machine))!.credential;
const work=join(root,'machine/work'),brain=join(work,'brain'),objects=join(root,'objects');mkdirSync(objects);
process.env.NM_BRAIN=brain;
process.env.FLEET_CLOUDRUN='1';
let lifecycle:CloudRunLifecycle|null=null,edge:MachineEdge|null=null,token='',epoch=0,busy=false,expected='',legacyDelay=95_000;
let nextLegacyRelayDelay=0;
const events:Array<Record<string,unknown>>=[];
const log=(event:string,fields:Record<string,unknown>={})=>{events.push({at:new Date().toISOString(),event,...fields});writeFileSync(join(root,'events.json'),JSON.stringify(events,null,2));};
const storage=createServer(async(req,res)=>{
 try{const key=decodeURIComponent(req.url!.slice(1));assert.match(key,/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);const file=join(objects,key);
if(req.method==='POST'){writeFileSync(file,'');res.writeHead(201,{location:`${storageUrl}/${key}`});res.end();}
 else if(req.method==='PUT'){await pipeline(req,createWriteStream(file,{flags:'a'}));res.writeHead(req.headers['content-range']?.endsWith('/*')?308:200);res.end();}
 else if(existsSync(file)){log('object-download',{key});if(key.startsWith('work-e')&&legacyDelay)await new Promise(r=>setTimeout(r,legacyDelay));if(res.destroyed)return;await pipeline(createReadStream(file),res);}
 else{res.writeHead(404);res.end();}
 }catch{if(!res.headersSent)res.writeHead(500);res.end();}
});
await new Promise<void>(r=>storage.listen(0,'127.0.0.1',r));
const storageUrl=`http://127.0.0.1:${(storage.address() as {port:number}).port}`;
const signer:SnapshotSigner={sign:async(_kind,key,op)=>{const [m]=await sql`select epoch from machines where id=${machine}::uuid`;if(Number(m.epoch)!==epoch)throw new EpochFencedError('Stale local fixture epoch');if(op==='exists')return {exists:existsSync(join(objects,key))};if(op==='download'&&!existsSync(join(objects,key)))return null;return {url:`${storageUrl}/${key}`};}};
const snapshots=new Snapshots({signer});
async function boot(lazy:boolean){
 busy=true;try{
  const delayedLegacy=nextLegacyRelayDelay;nextLegacyRelayDelay=0;
  if(existsSync(work))renameSync(work,join(root,`preserved-work-before-e${epoch+1}`));
  log('container-scheduling');await new Promise(r=>setTimeout(r,6000));
  const grant=await call('/v1/machines/boot',{...(!delayedLegacy?{readinessProtocol:1}:{}),snapshotFormats:['nm-lazy-work-v1']},credential);token=grant.token;epoch=grant.epoch;
  log('boot-granted',{epoch,lazy});
  lifecycle=new CloudRunLifecycle({cfg:{root:join(root,'machine'),work:'work',workDir:work,brainDir:brain,secretsDir:join(root,'secrets'),lazySnapshots:lazy,guardPct:90,graceMs:0,zstdLevel:3},snapshots,box:null,
   control:{read:()=>machineControl(sql,machine),report:s=>{const {interactiveReady,...legacy}=s;return applyMachineStatus(sql,machine,delayedLegacy?legacy:s).then(()=>{});}},
   resources:{memory:()=>({usedBytes:0,limitBytes:4*1024**3,usedMiB:0,limitMiB:4096,memPct:0,cgroup:2}),cpu:()=>({limitCores:1,cpuPct:0,throttleRatio:0})},log});
  await lifecycle.boot(grant);
  if(delayedLegacy){log('legacy-relay-delay',{ms:delayedLegacy});await new Promise(r=>setTimeout(r,delayedLegacy));}
  edge=connectMachineEdge({relayUrl:'ws://127.0.0.1:8928',token,machineId:machine,repoTerminalDirectory:(id,p)=>repoTerminalDirectory(replica,workspace,id,p),onRegistered:r=>{void lifecycle?.setInteractiveReady(r);log('relay-registered',{ready:r,epoch});},log:line=>log('edge',{line})});
  lifecycle.attach({holdTurns(){edge?.hold();},turnsInFlight:()=>0,parkTurns:async()=>{edge?.close();},flushBrains:async()=>{},drainWrites:async()=>{}});lifecycle.start();
  log('core-boot-complete',{epoch});
 }finally{busy=false;}
}
async function sleep(){
 assert.ok(lifecycle);busy=true;
 try{await sql`update machines set drain_state='requested',drain_reason='idle',drain_deadline=now()+interval '10 minutes' where id=${machine}::uuid`;
 await lifecycle.drain('controller');assert.equal(lifecycle.state,'drained');lifecycle.stop();edge?.close();edge=null;
 log('sleep-saved',{epoch});
 }finally{busy=false;}
}
// Seed one fully saved legacy machine. No agent or model ever runs in this fixture.
await boot(false);
mkdirSync(join(brain,'state'),{recursive:true});writeFileSync(join(brain,'state','pending-write'),'durable pending write');
const cold=join(brain,'cache/repos',repositoryTerminal?cloudRepoId:'cold-retained');mkdirSync(cold,{recursive:true});
const block=randomBytes(8*1024*1024),out=createWriteStream(join(cold,'retained-private-fixture.bin'));
for(let i=0;i<32;i++)if(!out.write(block))await new Promise(r=>out.once('drain',r));out.end();await new Promise(r=>out.once('close',r));
if(repositoryTerminal){
 const git=(args:string[])=>execFileSync('git',args,{cwd:cold,env:gitChildEnv(),stdio:'ignore'});
 git(['init','-b','main']);git(['config','user.name','QA']);git(['config','user.email','qa@example.invalid']);
 writeFileSync(join(cold,'tracked.txt'),'committed baseline\n');git(['add','tracked.txt']);git(['commit','-m','fixture']);
 writeFileSync(join(cold,'tracked.txt'),'retained dirty edit\n');writeFileSync(join(cold,'untracked.txt'),'retained untracked work\n');
}
expected=await fingerprint(cold);writeFileSync(join(root,'expected-fingerprint'),expected);await sleep();
let timer:ReturnType<typeof setTimeout>;
const tick=async()=>{try{if(!busy&&lifecycle?.state==='drained'){const [r]=await sql`select desired_replicas from machines where id=${machine}::uuid`;if(r.desired_replicas>0)await boot(true);}}catch(e){log('fixture-error',{message:e instanceof Error?e.message:String(e)});}finally{timer=setTimeout(()=>void tick(),250);}};
void tick();
const control=createServer(async(req,res)=>{
 try{
  if(req.method==='POST'&&req.url==='/sleep')await sleep();
  else if(req.method==='POST'&&req.url==='/hydrate'){await hydratePath(cold);assert.equal(await fingerprint(cold),expected);log('all-bytes-verified',{epoch});}
  else if(req.method==='POST'&&req.url==='/fast-legacy')legacyDelay=0;
  else if(req.method==='POST'&&req.url==='/legacy-relay-delay')nextLegacyRelayDelay=95_000;
  else if(req.url!=='/health'){res.writeHead(404);res.end();return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify({workspace,slug,machine,epoch,state:lifecycle?.state,busy,events:events.slice(-8)}));
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e instanceof Error?e.message:String(e)}));}
});
await new Promise<void>(r=>control.listen(0,'127.0.0.1',r));
writeFileSync(join(root,'fixture.json'),JSON.stringify({workspace,slug,machine,root,...(repositoryTerminal?{repoId,cloudRepoId,projectId:project.id}:{}),webUrl:`http://127.0.0.1:5327/${slug}?db=nm-cold-${slug}`,control:`http://127.0.0.1:${(control.address() as {port:number}).port}`,storage:storageUrl},null,2));
console.log(JSON.stringify({fixture:join(root,'fixture.json'),ready:true,modelsUsed:false}));
process.on('SIGTERM',()=>{clearTimeout(timer);lifecycle?.stop();edge?.close();control.close();storage.close();void sql.end().then(()=>process.exit(0));});

}
void main().catch(e=>{console.error(e);process.exit(1);});
