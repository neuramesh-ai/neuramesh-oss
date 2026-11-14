import { execFileSync } from 'node:child_process';
import { gitChildEnv } from '../harness/workspaces';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LazyWork } from './lazy-work';
import { coldPaths, fingerprint, parseManifest } from './lazy-format';
import { EpochFencedError, Snapshots, type SnapshotSigner } from './snapshot';

async function fixture(t: { after(fn: () => unknown): void }) {
  const objects = new Map<string, Buffer>(), gets: string[] = [];
  let fenced = false, delay = 0;
  const server = createServer(async (req, res) => {
    const key = decodeURIComponent(req.url!.slice(1));
    if (req.method === 'POST') { res.writeHead(201, { location: `http://127.0.0.1:${(server.address() as {port:number}).port}/${encodeURIComponent(key)}` }); res.end(); }
    else if (req.method === 'PUT') {
      const parts: Buffer[] = []; for await (const b of req) parts.push(b);
      objects.set(key, Buffer.concat([objects.get(key) ?? Buffer.alloc(0), ...parts]));
      res.writeHead(req.headers['content-range']?.endsWith('/*') ? 308 : 200); res.end();
    } else {
      gets.push(key); if (delay) await new Promise(r => setTimeout(r, delay));
      const data = objects.get(key); res.writeHead(data ? 200 : 404); res.end(data);
    }
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const root = mkdtempSync(join(tmpdir(), 'nm-lazy-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const signer: SnapshotSigner = { sign: async (_kind, key, op) => {
    if (fenced) throw new EpochFencedError('old epoch');
    if (op === 'exists') return { exists: objects.has(key) };
    if (op === 'download' && !objects.has(key)) return null;
    if (op === 'upload') objects.delete(key);
    return { url: `http://127.0.0.1:${(server.address() as {port:number}).port}/${encodeURIComponent(key)}` };
  } };
  const snapshots = new Snapshots({ signer });
  const machine = (epoch: number) => { const location=join(root,`e${epoch}`);mkdirSync(location,{recursive:true});return {root:location,lazy:new LazyWork({root:location,work:'work',epoch,snapshots,valid:()=>!fenced,log:()=>{}})}; };
  const write = (base:string,path:string,body:string)=>{const f=join(base,path);mkdirSync(join(f,'..'),{recursive:true});writeFileSync(f,body);};
  return {objects,gets,snapshots,machine,write,fence:()=>{fenced=true;},slow:(ms:number)=>{delay=ms;}};
}
const subject='work/brain/subjects/thread-retained/workspace', repo='work/brain/cache/repos/example';
const contents=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?contents(join(dir,e.name)):[readFileSync(join(dir,e.name),'utf8')]);

test('core opens without cold bytes; requested files retain content, symlinks, hard links, modes and ownership',async t=>{
  const f=await fixture(t),a=f.machine(1);
  f.write(a.root,'work/brain/state/outbox','pending write');f.write(a.root,`${subject}/article.md`,'retained article');
  chmodSync(join(a.root,subject,'article.md'),0o700);
  linkSync(join(a.root,subject,'article.md'),join(a.root,subject,'same-inode'));
  symlinkSync('article.md',join(a.root,subject,'relative-link'));
  const before=await fingerprint(join(a.root,subject));await a.lazy.save();
  const b=f.machine(2);await b.lazy.restore('manifest-e1');
  assert.equal(readFileSync(join(b.root,'work/brain/state/outbox'),'utf8'),'pending write');
  assert.equal(existsSync(join(b.root,subject,'article.md')),false);assert.deepEqual(f.gets,['manifest-e1','core-e1']);
  await b.lazy.ensure(join(b.root,subject));assert.equal(await fingerprint(join(b.root,subject)),before);
  assert.equal(readlinkSync(join(b.root,subject,'relative-link')),'article.md');
  assert.equal(lstatSync(join(b.root,subject,'article.md')).ino,lstatSync(join(b.root,subject,'same-inode')).ino);
});
test('sleep before hydration carries original data forward and saves new overlay writes without replacing either version',async t=>{
  const f=await fixture(t),a=f.machine(1);f.write(a.root,`${subject}/old.md`,'original');f.write(a.root,`${repo}/README`,'unopened repo');await a.lazy.save();
  const b=f.machine(2);await b.lazy.restore('manifest-e1');f.write(b.root,`${subject}/old.md`,'new local edit');f.write(b.root,`${subject}/new.md`,'new file');await b.lazy.save();
  assert.equal(f.gets.some(k=>k.startsWith('chunk-')),false);
  const c=f.machine(3);await c.lazy.restore('manifest-e2');await c.lazy.ensure(join(c.root,subject));
  assert.equal(readFileSync(join(c.root,subject,'old.md'),'utf8'),'new local edit');assert.equal(readFileSync(join(c.root,subject,'new.md'),'utf8'),'new file');
  assert.ok(contents(join(c.root,'work/.restore-conflicts')).includes('original'));
  await c.lazy.ensure(join(c.root,repo));assert.equal(readFileSync(join(c.root,repo,'README'),'utf8'),'unopened repo');
});
test('sleep cancels a real HTTP transfer and the next wake can restore it',async t=>{
  const f=await fixture(t),a=f.machine(1);f.write(a.root,`${subject}/old`,'durable');await a.lazy.save();
  const b=f.machine(2);await b.lazy.restore('manifest-e1');f.slow(250);const pending=b.lazy.ensure(join(b.root,subject));const rejected=assert.rejects(pending);
  while(!f.gets.some(k=>k.startsWith('chunk-'))) await new Promise(r=>setTimeout(r,5));
  await b.lazy.pause();await rejected;f.slow(0);await b.lazy.save();
  const c=f.machine(3);await c.lazy.restore('manifest-e2');await c.lazy.ensure(join(c.root,subject));assert.equal(readFileSync(join(c.root,subject,'old'),'utf8'),'durable');
});
test('missing and corrupt chunks stay pending; old epochs cannot snapshot',async t=>{
  const f=await fixture(t),a=f.machine(1);f.write(a.root,`${subject}/old`,'durable');await a.lazy.save();
  const b=f.machine(2);await b.lazy.restore('manifest-e1');const key=[...f.objects.keys()].find(k=>k.startsWith('chunk-'))!,original=f.objects.get(key)!;
  f.objects.delete(key);await assert.rejects(b.lazy.ensure(join(b.root,subject)),/unavailable/);assert.equal(b.lazy.pending(join(b.root,subject)),true);
  f.objects.set(key,Buffer.from('bad zstd'));await assert.rejects(b.lazy.ensure(join(b.root,subject)));assert.equal(existsSync(join(b.root,subject,'old')),false);
  f.objects.set(key,original);await b.lazy.ensure(join(b.root,subject));f.fence();await assert.rejects(b.lazy.save(),EpochFencedError);
});
test('new local symlinks cannot redirect saved files outside the workspace',async t=>{
  const f=await fixture(t),a=f.machine(1);f.write(a.root,`${subject}/nested/old`,'durable');await a.lazy.save();
  const b=f.machine(2);await b.lazy.restore('manifest-e1');const outside=join(b.root,'outside');mkdirSync(outside);symlinkSync(outside,join(b.root,subject,'nested'));
  await b.lazy.ensure(join(b.root,subject));assert.equal(existsSync(join(outside,'old')),false);assert.equal(readlinkSync(join(b.root,subject,'nested')),outside);
  assert.ok(contents(join(b.root,'work/.restore-conflicts')).includes('durable'));
});
test('hard links crossing cold boundaries stay core; malformed manifests are rejected',async t=>{
  const f=await fixture(t),a=f.machine(1);f.write(a.root,`${subject}/linked`,'durable');linkSync(join(a.root,subject,'linked'),join(a.root,'work/core-link'));
  assert.equal(coldPaths(a.root,'work').includes(subject),false);
  assert.throws(()=>parseManifest({format:'nm-lazy-work',version:1,epoch:1,work:'work',core:'core-e1',segments:[{path:'work/../escape'}]},'work'),/Invalid/);
});

test('a retained Git worktree hydrates its common clone before opening, with dirty and untracked work intact',async t=>{
 const f=await fixture(t),a=f.machine(1),worktree='work/brain/cache/worktrees/engineering-owner-example-thread';
 f.write(a.root,`${repo}/README`,'initial');
 const git=(args:string[],cwd:string)=>execFileSync('git',args,{cwd,env:gitChildEnv(),stdio:'pipe'}).toString();
 git(['init','-b','main'],join(a.root,repo));git(['add','.'],join(a.root,repo));git(['-c','user.name=QA','-c','user.email=qa@example.invalid','commit','-m','fixture'],join(a.root,repo));
 mkdirSync(join(a.root,worktree,'..'),{recursive:true});git(['worktree','add','-b','retained',join(a.root,worktree)],join(a.root,repo));
 writeFileSync(join(a.root,worktree,'.git'),'gitdir: ../../repos/example/.git/worktrees/engineering-owner-example-thread\n');
 f.write(a.root,`${worktree}/README`,'dirty edit');f.write(a.root,`${worktree}/untracked`,'private local content');
 const original=await fingerprint(join(a.root,worktree));
 await a.lazy.save();const b=f.machine(2);await b.lazy.restore('manifest-e1');await b.lazy.ensure(join(b.root,worktree));
 assert.equal(await fingerprint(join(b.root,worktree)),original);
 assert.equal(b.lazy.pending(join(b.root,repo)),false);
 assert.match(git(['status','--porcelain'],join(b.root,worktree)),/M README/);
 assert.equal(readFileSync(join(b.root,worktree,'untracked'),'utf8'),'private local content');
 assert.equal(git(['branch','--show-current'],join(b.root,worktree)).trim(),'retained');
});

test('a valid tar with changed core bytes fails its manifest checksum before the machine can open',async t=>{
 const f=await fixture(t),a=f.machine(1);f.write(a.root,'work/brain/state/pending','durable');await a.lazy.save();
 f.write(a.root,'work/brain/state/pending','changed behind the saved manifest');await f.snapshots.save('snapshot','core-e1',a.root,['work']);
 const b=f.machine(2);await assert.rejects(b.lazy.restore('manifest-e1'),/core checksum/);
});

test('recovery mode eagerly restores every manifest segment before boot completes',async t=>{
 const f=await fixture(t),a=f.machine(1);f.write(a.root,`${subject}/saved`,'durable');await a.lazy.save();
 const {CloudRunLifecycle}=await import('./lifecycle-machine');
 const {useHydration}=await import('../harness/hydration');
 const b=f.machine(2);
 const lc=new CloudRunLifecycle({cfg:{root:b.root,work:'work',workDir:join(b.root,'work'),brainDir:join(b.root,'work/brain'),secretsDir:join(b.root,'secrets'),guardPct:90,graceMs:0,zstdLevel:3,lazyRestoreEager:true},snapshots:f.snapshots,box:null,control:{read:async()=>({epoch:2}),report:async()=>{}},resources:{memory:()=>({usedBytes:0,limitBytes:4096,usedMiB:0,limitMiB:4,memPct:0,cgroup:2}),cpu:()=>({limitCores:1,cpuPct:0,throttleRatio:0})},log:()=>{}});
 try{await lc.boot({epoch:2,snapshot:{work:'manifest-e1'}});assert.equal(readFileSync(join(b.root,subject,'saved'),'utf8'),'durable');assert.equal(lc.status().interactiveReady,false);}finally{lc.stop();useHydration(null);}
});
