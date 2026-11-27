
import type { EngineeringAttachmentRef } from '@neuramesh/shared';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';

type Pending = { id:string; thread_id:string; author_id:string; body:string; attachments:EngineeringAttachmentRef[]; requested_steer:boolean; kind:string; task_id:string|null; busy:boolean };
export type FollowupTarget = { busy(): boolean; apply(body:string, id:string, steer:boolean, attachments:EngineeringAttachmentRef[]): Promise<boolean> };
const targets = new Map<string, FollowupTarget[]>();
class FollowupServiceError extends Error {
  constructor(readonly status: number) { super('Follow-up service HTTP '+status); }
}

export const getFollowupTarget = (threadId: string) => targets.get(threadId)?.at(-1);

export function registerFollowupTarget(thread: string, target: FollowupTarget): () => void {
  const group=targets.get(thread) ?? [];
  group.push(target);
  targets.set(thread,group);
  return () => {
    const index=group.indexOf(target);
    if(index>=0) group.splice(index,1);
    if(!group.length && targets.get(thread)===group) targets.delete(thread);
  };
}

/** CLI chat providers cannot all append to an open request. Stop that provider request,
 * wait for it to unwind, then resume the same logical wake with its goal, public progress
 * and the new human input. The per-thread target never starts two providers concurrently. */
export async function withChatSteering<T>(threadId: string, initial: string, run: (transcript:string, controller:AbortController, progress:(text:string)=>void)=>Promise<T>, prepare?: (body:string,id:string,files:EngineeringAttachmentRef[])=>Promise<string>): Promise<T> {
  let live = true;
  let controller = new AbortController();
  let transcript = initial, visible = '';
  let pending: { body:string; accepted:(ok:boolean)=>void } | undefined;
  const unregister = registerFollowupTarget(threadId,{
    busy:()=>true,
    async apply(body,id,_steer,files) {
      if (prepare) body=await prepare(body,id,files);
      else if (files.length) throw new Error('This conversation cannot read those files. Resend them in the coding thread.');
      if (!live || pending) return false;
      return new Promise<boolean>(accepted => {
        pending={body,accepted};
        controller.abort(new Error('The person redirected this turn.'));
      });
    },
  });
  try {
    for (;;) {
      try {
        const answer = await run(transcript,controller,text=>{visible=text;});
        if (!pending) return answer;
      } catch (error) {
        if (!pending) throw error;
      }
      const update = pending!;
      pending=undefined;
      transcript += `\n\nThe person steered the work already in progress. Continue the original task with this update. Inspect the current work before repeating tool actions.` +
        (visible.trim() ? `\nProgress already shown:\n${visible.slice(-6000)}` : '') + `\nHuman update:\n${update.body}`;
      controller=new AbortController();
      visible='';
      update.accepted(true);
    }
  } finally { live=false; unregister(); pending?.accepted(false); }
}

export function startThreadFollowups(o: {db: ReplicaDatabase; apiUrl:string; workspace:string; machineToken:string; log:(line:string)=>void}) {
  const stopped = new AbortController();
  let pendingThreads=false, wake: (()=>void) | undefined;
  o.db.watch('select id,followup_count from threads where workspace_id=? and followup_count>0',[o.workspace],{
    onResult(result) { pendingThreads=!!result.rows?.length; wake?.(); },
    onError(error) { o.log('Could not watch queued prompts: '+error.message); },
  },{signal:stopped.signal});
  const sent = new Map<string,{result:string;reason?:string}>();
  const call = async <T>(path:string, body?:Record<string,unknown>):Promise<T> => {
    const url = new URL('/v1/thread-followups/'+path,o.apiUrl);
    if (!body) url.searchParams.set('workspace',o.workspace);
    const r=await fetch(url,{method:body?'POST':'GET',headers:{authorization:'Bearer '+o.machineToken,'content-type':'application/json'},
      ...(body?{body:JSON.stringify({workspace:o.workspace,...body})}:{}),signal:AbortSignal.timeout(10000)});
    if (!r.ok) throw new FollowupServiceError(r.status);
    return r.json() as Promise<T>;
  };
  const active=new Map<string,string>();
  let lastRenew=0;
  const finish = async (id:string,result:{result:string;reason?:string}) => {
    sent.set(id,result);await call('finish',{id,...result});sent.delete(id);
  };
  const dispatch = async (p:Pending) => {
    const target=getFollowupTarget(p.thread_id);
    if (!p.requested_steer && (p.busy || target?.busy())) return;
    if (p.requested_steer && p.busy && !target) return; // wait for the owning runtime
    if (p.kind==='coding' && !p.task_id && !target) return;
    const {claimed}=await call<{claimed:boolean}>('claim',{id:p.id,steer:p.requested_steer});
    if (!claimed) return;
    let result = 'publish', reason:string|undefined;
    try {
      if (getFollowupTarget(p.thread_id)!==target) result='retry';
      else if (target) result=await target.apply(p.body,p.id,p.requested_steer,p.attachments)?'applied':'retry';
    } catch (error) {
      result='failed';reason=error instanceof Error?error.message.slice(0,360):'Delivery failed. Check the conversation and retry.';
    }
    await finish(p.id,{result,reason});
  };
  const pump=async()=>{
    let lastError='';
    while(!stopped.signal.aborted) {
      try {
        if(active.size && Date.now()-lastRenew>15000) {
          await call('renew',{ids:[...active.values()]});lastRenew=Date.now();
        }
        for (const [id,receipt] of sent) {
          try { await finish(id,receipt); }
          catch (error) {
            // The response may have been lost after a retry, cancel or expired claim.
            // Leave the server's decision intact and continue serving the other threads.
            if (error instanceof FollowupServiceError && error.status===409) sent.delete(id);
            else throw error;
          }
        }
        const batch=pendingThreads || active.size ? await call<Pending[]>('pending') : [];
        for(const p of batch) {
          if(active.has(p.thread_id)) continue;
          active.set(p.thread_id,p.id);
          void dispatch(p).catch(e=>o.log(String(e))).finally(()=>active.delete(p.thread_id));
        }
        lastError='';
      } catch (e) { if(lastError!==String(e)) o.log(lastError=String(e)); }
      await new Promise<void>(resolve=>{
        const timer=setTimeout(resolve,pendingThreads || active.size ? 650 : 300000);
        timer.unref(); wake=()=>{clearTimeout(timer);resolve();};
      });
      wake=undefined;
    }
  };
  void pump();return ()=>{stopped.abort();wake?.();};
}
