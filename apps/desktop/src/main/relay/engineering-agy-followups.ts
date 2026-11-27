import type { EngineeringAttachmentRef } from '../../engineering-protocol';
import { withChatSteering, registerFollowupTarget } from '../host/thread-followups';
import type { AgyDriver } from './engineering-agy-driver';
import type { EngineeringAttachmentInbox } from './engineering-attachments';
import type { EngineeringAttachmentQueue } from './engineering-attachment-queue';
import { agyNextTurn } from './engineering-agy-prompt';

export async function runSteerableAgy(o: {
  threadId: string; text: string; driver: AgyDriver; restart: () => Promise<unknown>;
  attachments: EngineeringAttachmentInbox; queue: EngineeringAttachmentQueue;
  interruptApprovals(): void;
  received(id: string, body: string, refs: EngineeringAttachmentRef[]): void;
}) {
  const updates: {role: 'user'; content: {type: 'text'; text: string}[]}[] = [];
  const files: EngineeringAttachmentRef[] = [];
  const result = await withChatSteering(o.threadId, '', async (continuation, controller) => {
    const stop = () => { void o.driver.stop(); };
    controller.signal.addEventListener('abort', stop, {once:true});
    try {
      if (continuation) await o.restart();
      return await o.driver.run(continuation ? agyNextTurn({rules:null, prompt:continuation, attachments:[]}) : o.text);
    } finally { controller.signal.removeEventListener('abort', stop); }
  }, async (body, id, refs) => {
    await o.queue.wait();
    const attached = await o.attachments.resolve(refs);
    o.interruptApprovals();
    files.push(...refs);
    updates.push({role:'user',content:[{type:'text',text:body}]});
    o.received(id,body,refs);
    return refs.length ? agyNextTurn({rules:null,prompt:body,attachments:[...attached.userImages,...attached.userFiles]}) : body;
  }).finally(() => o.attachments.release(files));
  return {result, updates};
}

export function registerIdleAgy(threadId:string, busy:()=>boolean, start:(body:string,id:string,files:EngineeringAttachmentRef[])=>Promise<void>) {
  return registerFollowupTarget(threadId,{ busy, apply: async (body,id,_steer,files)=>{
    if (busy()) return false;
    await start(body,id,files);
    return true;
  }});
}
