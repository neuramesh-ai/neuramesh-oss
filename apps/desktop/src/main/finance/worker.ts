import {runFinanceModel,type FinanceRuntimeTurn} from './model-runtime';
const workers=new Map<string,{busy:boolean;accepting:boolean;stop:()=>void}>();
export function financeRuntimeBusy(machineId:string):boolean {return [...workers.entries()].some(([key,value])=>key.endsWith('|'+machineId)&&value.busy);}
export function holdFinanceRuntime(machineId:string):void {for(const [key,value] of workers)if(key.endsWith('|'+machineId))value.accepting=false;}
export function stopFinanceRuntime(machineId:string):void {for(const [key,value] of workers)if(key.endsWith('|'+machineId))value.stop();}
export function startFinanceWorker(o:{apiUrl:string;workspace:string;machineId:string;headers:()=>Promise<Record<string,string>>;log?:(line:string)=>void}) {
 const key=`${o.apiUrl}|${o.workspace}|${o.machineId}`;if(workers.has(key))return workers.get(key)!.stop;
 const controller=new AbortController();let active:AbortController|undefined;
 const state={busy:false,accepting:true,stop:()=>{controller.abort();active?.abort();workers.delete(key);}};workers.set(key,state);
 const call=async<T>(action:string,body:Record<string,unknown>={}):Promise<T>=>{
  const response=await fetch(`${o.apiUrl}/v1/finance/runtime/${action}`,{method:'POST',headers:{'content-type':'application/json',...await o.headers()},body:JSON.stringify({workspace:o.workspace,machineId:o.machineId,...body}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)]),redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw new Error(`Finance runtime request failed (${response.status}).`);}return response.json() as Promise<T>;
 };
 void(async()=>{while(!controller.signal.aborted&&state.accepting){
  try{
   const {job}=await call<{job:(FinanceRuntimeTurn&{id:string;lease:string})|null}>('claim');
   if(job){
    state.busy=true;active=new AbortController();const turn=active;
    const validate=setInterval(()=>void call('validate',{id:job.id,lease:job.lease}).catch(()=>turn.abort()),5000);
    const timeout=setTimeout(()=>turn.abort(),240000);validate.unref?.();timeout.unref?.();
    try{const answer=await runFinanceModel(job,{...o,signal:AbortSignal.any([controller.signal,turn.signal])});await call('finish',{id:job.id,lease:job.lease,answer});}
    catch{await call('finish',{id:job.id,lease:job.lease,failed:true}).catch(()=>{});o.log?.('Finance model request ended without a reply.');}
    finally{clearInterval(validate);clearTimeout(timeout);active=undefined;state.busy=false;}
   }
  }catch{/* a disconnect or an older API does not expose cached Finance context */}
  await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,3000);timer.unref?.();controller.signal.addEventListener('abort',done,{once:true});});
 }})();return state.stop;
}
