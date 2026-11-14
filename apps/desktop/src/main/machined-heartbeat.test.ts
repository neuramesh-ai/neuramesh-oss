import assert from 'node:assert/strict';
import {test} from 'node:test';
import {heartbeatSender} from './machined-heartbeat';
import type {MachinedConfig} from './machined-config';
test('heartbeat reports serialize, recover after a failed call, and read renewed credentials',async()=>{
 const cfg={apiUrl:'https://api.example.test',machineId:'machine',machineToken:'first'} as MachinedConfig;
 let release!:()=>void,calls=0;const first=new Promise<void>(resolve=>{release=resolve;});const tokens:string[]=[],activity:number[]=[];
 const send=heartbeatSender(cfg,{busy:()=>true,imageSha:null,fetch:async(_url,init)=>{
  tokens.push(new Headers(init?.headers).get('authorization')!);activity.push(JSON.parse(String(init?.body)).activeSeconds);
  if(calls++===0){await first;throw new Error('offline');}return Response.json({ok:true});
 }});
 const one=send(['codex'],2);const failed=assert.rejects(one,/offline/);const two=send(['codex'],3);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
 cfg.machineToken='renewed';release();await failed;assert.equal(await two,true);assert.deepEqual(tokens,['Bearer first','Bearer renewed']);assert.deepEqual(activity,[2,3]);
});
test('Cloud Run heartbeats wait for relay registration and stop when it is lost',async()=>{
 const cfg={apiUrl:'https://api.example.test',machineId:'machine',machineToken:'token'} as MachinedConfig;
 let ready=false,calls=0;
 const send=heartbeatSender(cfg,{busy:()=>false,imageSha:null,ready:()=>ready,fetch:async()=>{calls++;return Response.json({ok:true});}});
 assert.equal(await send(['codex']),false);assert.equal(calls,0);
 ready=true;assert.equal(await send(['codex']),true);assert.equal(calls,1);
 ready=false;assert.equal(await send(['codex']),false);assert.equal(calls,1);
});
