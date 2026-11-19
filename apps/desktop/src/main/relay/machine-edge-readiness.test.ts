import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createHub } from '@neuramesh/relay';
import { connectMachineEdge } from './machine-edge';
const wait=async(f:()=>boolean)=>{const until=Date.now()+4000;while(!f()){if(Date.now()>until)throw Error('Readiness wait timed out');await new Promise(r=>setTimeout(r,5));}};
test('a TCP connection is not readiness: only an authenticated installed hello acknowledges it',async()=>{
 let release!:()=>void, validationStarted=false;
 const gate=new Promise<void>(r=>{release=r;});
 const hub=createHub({validateMachine:async()=>{validationStarted=true;await gate;return {machineId:'readiness-fixture',workspaceId:'fixture'};},validateClient:async()=>({allowed:false}),log:()=>{}});
 const server=createServer(),wss=new WebSocketServer({server});wss.on('connection',(s,r)=>hub.handleConnection(s,r));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const seen:boolean[]=[];const edge=connectMachineEdge({relayUrl:`ws://127.0.0.1:${(server.address() as {port:number}).port}`,token:'nmm_fixture',machineId:'readiness-fixture',onRegistered:ready=>seen.push(ready),log:()=>{}});
 try{await wait(()=>validationStarted);assert.equal(seen.length,0);release();await wait(()=>seen.includes(true));assert.ok(hub.stats().machines.includes('readiness-fixture'));
 for(const s of wss.clients)s.terminate();await wait(()=>seen.at(-1)===false);
 }finally{edge.close();for(const s of wss.clients)s.terminate();wss.close();server.close();}
});
