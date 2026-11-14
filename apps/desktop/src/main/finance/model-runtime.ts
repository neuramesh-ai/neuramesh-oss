import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {type ThinkingLevel,providerForModel} from '@neuramesh/shared';
import {decideAuth} from '../runtime/authpolicy';
import {onCloudMachine,providerEnv,claudePathOption} from '../runtime/adapter';
import {machineAuthProbe} from '../relay/engineering-provider';
import {CHATGPT_LOCAL_CREDENTIAL,createChatGPTSubscriptionFetch} from '../relay/engineering-chatgpt';
import {engineeringProviderFetch} from '../relay/engineering-provider-stream';
import {claudeEffort} from '../runtime/thinking';
import {managedAgySettings} from '../runtime/orchmcp';
import {agyArgs,agyModelFor,agyUserLine} from '../relay/engineering-agy-args';
import {AgyEventMapper} from '../relay/engineering-agy-events';
import {ensureCli} from '../runtime/cli';
import {readMemberKey} from '../runtime/memberkey';

export interface FinanceRuntimeTurn {model:string;thinking:ThinkingLevel|null;system:string;messages:Array<{role:'user'|'assistant';text:string}>}
interface Options {apiUrl:string;workspace:string;headers:()=>Promise<Record<string,string>>;signal:AbortSignal;fetch?:typeof fetch}

/** Finance uses the thread auth policy and selected model, with no automatic
 * substitution, tools, workspace files, or NeuraMesh conversation recorder. */
export async function runFinanceModel(turn:FinanceRuntimeTurn,o:Options):Promise<string> {
 const vendor=providerForModel(turn.model),call=o.fetch??fetch;
 // QA forbids paid-key fallbacks before any workspace or local key is read.
 if(process.env.NM_ENGINEERING_SUBSCRIPTION_ONLY==='1'){
  if(!await machineAuthProbe.subActive(vendor))throw new Error('Subscription-only testing requires an active sign-in.');
  if(vendor==='anthropic')return claudeFinance(turn,o.signal);
  if(vendor==='gemini')return agyFinance(turn,o.signal);
  return sdkFinance(turn,o,call,vendor,{authMode:'subscription',token:null});
 }
 const response=await call(`${o.apiUrl}/v1/credentials/resolve?${new URLSearchParams({workspace:o.workspace,provider:vendor})}`,{headers:await o.headers(),signal:o.signal});
 if(!response.ok)throw new Error('The selected model credentials are unavailable.');
 const stored=await response.json() as {token:string|null;authMode:'apikey'|'subscription'|null;autoFailover?:boolean};
 const explicit=stored.authMode==='apikey';
 const memberKey=(()=>{try{const {app}=require('electron') as typeof import('electron');return readMemberKey(app.getPath('userData'),vendor);}catch{return null;}})();
 const auth=decideAuth({provider:vendor,storedAuthMode:stored.authMode,storedToken:stored.token,autoFailover:!!stored.autoFailover,
  memberKey,subActive:explicit?false:await machineAuthProbe.subActive(vendor),loginPresent:explicit?false:await machineAuthProbe.loginPresent(vendor),envKey:machineAuthProbe.envKey(vendor),cloudMachine:onCloudMachine()});
 if(auth.authMode==='none')throw new Error('Reconnect this model or choose NeuraMesh brain.');
 if(auth.authMode==='subscription'&&vendor==='anthropic')return claudeFinance(turn,o.signal);
 if(auth.authMode==='subscription'&&vendor==='gemini')return agyFinance(turn,o.signal);
 return sdkFinance(turn,o,call,vendor,auth);
}
async function sdkFinance(turn:FinanceRuntimeTurn,o:Options,call:typeof fetch,vendor:string,auth:{authMode:string;token?:string|null}) {
 const providerId=vendor==='anthropic'?'anthropic':vendor==='gemini'?'gemini':auth.authMode==='subscription'?'openai-codex':'openai-native';
 const sdk=await import('@cline/sdk');
 const handler=await sdk.Llms.createHandlerAsync({providerId,modelId:turn.model,apiKey:auth.authMode==='subscription'?CHATGPT_LOCAL_CREDENTIAL:auth.token!,
  fetch:engineeringProviderFetch(auth.authMode==='subscription'?createChatGPTSubscriptionFetch():call,()=>{}),reasoningEffort:turn.thinking??'medium',thinking:!!turn.thinking});
 handler.setAbortSignal?.(o.signal);
 let answer='';
 for await(const part of handler.createMessage(turn.system,turn.messages.map(m=>({role:m.role,content:[{type:'text' as const,text:m.text}]})),[])){
  o.signal.throwIfAborted();
  if(part.type==='text')answer+=part.text;
  if(part.type.includes('tool')){handler.abort?.();throw new Error('Finance does not execute model tools.');}
  if(answer.length>30000){handler.abort?.();throw new Error('Finance reply exceeded its limit.');}
 }
 return answer;
}
async function claudeFinance(turn:FinanceRuntimeTurn,signal:AbortSignal) {
 const {query}=await import('@anthropic-ai/claude-agent-sdk');
 const dir=await mkdtemp(join(tmpdir(),'nm-finance-'));
 const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 try{
  const run=query({prompt:JSON.stringify(turn.messages),options:{...claudePathOption(),env:providerEnv('anthropic',''),model:turn.model,...claudeEffort({model:turn.model,thinking:turn.thinking}),
   cwd:dir,systemPrompt:turn.system,tools:[],allowedTools:[],mcpServers:{},settingSources:[],persistSession:false,maxTurns:1,abortController:controller}});
  try{for await(const message of run)if(message.type==='result'&&message.subtype==='success')return message.result;}finally{run.close();}
  throw new Error('The selected Claude model returned no reply.');
 }finally{signal.removeEventListener('abort',abort);await rm(dir,{recursive:true,force:true});}
}
export function financeAgySettings(home?:string):string {
 const settings=JSON.parse(managedAgySettings(home));settings.permissions.allow=[];settings.permissions.deny.push('mcp(nm/*)');return JSON.stringify(settings);
}
async function agyFinance(turn:FinanceRuntimeTurn,signal:AbortSignal) {
 const model=agyModelFor(turn.model,turn.thinking);if(!model)throw new Error('This Gemini model requires an API key. Choose a sign-in model or NeuraMesh brain.');
 const dir=await mkdtemp(join(tmpdir(),'nm-finance-'));const bin=await ensureCli('gemini');
 try{return await new Promise<string>((resolve,reject)=>{
  const child=spawn(bin,['--settings',financeAgySettings(),'--disable-slash-commands','--log-file','/dev/null',...agyArgs({model,mode:null})],{cwd:dir,env:providerEnv('gemini',''),stdio:['pipe','pipe','pipe'],signal});
  const mapper=new AgyEventMapper(new Set());let pending='',result:string|undefined,failed=false;
  child.stdout.on('data',chunk=>{pending+=String(chunk);if(pending.length>512000){child.kill();reject(new Error('Finance runtime output exceeded its limit.'));return;}let at;while((at=pending.indexOf('\n'))>=0){const line=pending.slice(0,at);pending=pending.slice(at+1);try{const value=mapper.map(JSON.parse(line));if(value.result){failed=!value.result.ok;result=value.result.response;child.stdin.end();}}catch{/* incomplete diagnostics contain no actionable result */}}});
  child.stderr.on('data',()=>{});child.once('error',reject);child.once('close',code=>code===0&&!failed&&result?resolve(result):reject(new Error('The selected Gemini model could not reply.')));
  child.stdin.on('error',()=>{});child.stdin.write(agyUserLine(`${turn.system}\n\n${JSON.stringify(turn.messages)}`));
 });}finally{await rm(dir,{recursive:true,force:true});}
}
