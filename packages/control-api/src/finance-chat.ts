import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { STARTER_MODEL,FinanceRequestModelSchema,FinanceModelSelectionSchema,FinanceChatSchema, FinanceQuerySchema, FinanceSnapshotSchema, type Actor, type FinanceChat, type FinanceChatMessage } from '@neuramesh/shared';
import type { Store } from './store';
import { activeFinance, FinanceError } from './finance-gateway';
import { completeFinanceChat,financeInstructions, financeModelConfig } from './finance-model';
import {completeFinanceBrain} from './finance-brain';
import {sqlOf,houseBrainServes} from './credits';
import {financeRuntimeRoutes} from './finance-runtime-routes';
import {financeMachine,enqueueFinanceJob,financeSource} from './finance-runtime-store';
const sendSchema = FinanceQuerySchema.pick({month:true,currency:true}).extend({chatId:z.string().uuid(),requestId:z.string().uuid(),text:z.string().trim().min(1).max(6000),model:FinanceRequestModelSchema.optional(),thinking:FinanceModelSelectionSchema.shape.thinking.optional()});
export function financeChatRoutes<E extends { Variables: { actor: Actor; machine?: unknown; memberId?: string } }>(app: Hono<E>, store: Store, options: { fetch?: typeof fetch; modelFetch?: typeof fetch } = {}) {
  financeRuntimeRoutes(app,store,options);
  for (const action of ['chats','chat-get','chat-send'] as const) app.post(`/v1/finance/${action}`,async c => {
    c.header('Cache-Control','no-store');
    try {
      const input = await c.req.json().catch(()=>null);
      const scope = z.object({workspace:z.string().uuid()}).parse(input);
      const identity = {actor:c.get('actor'),machine:c.get('machine'),memberId:c.get('memberId')};
      const ctx = await activeFinance(store,identity,scope.workspace,options.fetch);
      if (!ctx.status.capabilities.includes('transactions:read')) throw new FinanceError('Review Kinshi permissions to use Finance chat.',403,'KINSHI_PERMISSION_REQUIRED');
      const repository = store.finance!;
      if (action === 'chats') {
        const model = houseBrainServes()?{model:STARTER_MODEL}:await financeModelConfig(store,scope.workspace);
        const chats = await repository.listChats(scope.workspace,ctx.link.session); await ctx.recheck();
        return c.json({chats,model:houseBrainServes()?STARTER_MODEL:model?.model ?? null});
      }
      if (action === 'chat-get') {
        const {id} = z.object({id:z.string().uuid()}).parse(input);
        let chat = await repository.getChat(scope.workspace,ctx.link.session,id);
        if (!chat) throw new FinanceError('This Finance conversation is unavailable.',404);
        if (chat.messages.some(m=>m.state==='pending') && Date.now()-Date.parse(chat.updatedAt)>300_000) {
          const next = {...chat,revision:chat.revision+1,updatedAt:new Date().toISOString(),messages:chat.messages.map(m=>m.state==='pending'?{...m,state:'failed' as const,text:'The reply was interrupted. Send your question again to retry.'}:m)};
          if (await repository.putChat(scope.workspace,ctx.link.session,next,chat.revision)) chat=next;
        }
        await ctx.recheck();return c.json(FinanceChatSchema.parse(chat));
      }
      if (identity.actor.kind !== 'human' || identity.machine) throw new FinanceError('Finance questions are sent by a signed-in member.',403);
      const send = sendSchema.parse(input);
      if (!send.model&&!await financeModelConfig(store,scope.workspace)) throw new FinanceError('Choose a connected model to enable Finance chat.',503,'MODEL_UNAVAILABLE');
      const previous = await repository.getChat(scope.workspace,ctx.link.session,send.chatId);
      if (previous?.messages.some(m=>m.id===send.requestId)) return c.json(previous);
      if (previous?.messages.some(m=>m.state==='pending')) throw new FinanceError('This conversation already has a reply in progress.',409);
      if ((previous?.messages.length ?? 0)>196) throw new FinanceError('Start a new Finance conversation to continue.',409);
      const now = new Date().toISOString(), assistantId = randomUUID();
      const selection=send.model?{model:send.model,thinking:send.thinking??null}:undefined;
      const messages: FinanceChatMessage[] = [...(previous?.messages ?? []),{id:send.requestId,role:'user',text:send.text,at:now,state:'complete',selection,author:{id:identity.actor.id,name:ctx.access.people.find(p=>p.id===identity.actor.id&&p.kind==='human')?.name??'Workspace member'}},{id:assistantId,role:'assistant',text:'',at:now,state:'pending',selection}];
      const pending: FinanceChat = {id:send.chatId,title:previous?.title ?? send.text.slice(0,90),revision:(previous?.revision ?? -1)+1,messages,updatedAt:now};
      if (!await repository.putChat(scope.workspace,ctx.link.session,pending,previous?.revision ?? null)) throw new FinanceError('This conversation changed. Refresh and retry.',409);
      try {
        const snapshot = FinanceSnapshotSchema.parse(await ctx.partner(`/${ctx.link.session}/overview`,{month:send.month,currency:send.currency,limit:40}));
        if(selection&&selection.model!==STARTER_MODEL){
          const sql=sqlOf(store);if(!sql)throw new FinanceError('Selected models need an updated workspace runtime.',503,'MODEL_UNAVAILABLE');
          const machineId=await financeMachine(sql,scope.workspace,identity.actor.id,selection.model);await ctx.recheck();
          await enqueueFinanceJob(sql,{id:assistantId,workspace:scope.workspace,session:ctx.link.session,chatId:pending.id,requester:identity.actor.id,machineId,input:{...selection,messages,system:financeInstructions(snapshot),source:financeSource(snapshot),consentRevision:ctx.status.consentRevision??0}});
          return c.json(pending);
        }
        const reply = selection?await completeFinanceBrain(store,scope.workspace,messages,snapshot,c.req.raw.signal,{fetch:options.modelFetch}):await completeFinanceChat(store,scope.workspace,messages,snapshot,options.modelFetch,c.req.raw.signal);
        await ctx.recheck();
        const source = {month:snapshot.scope.month,currency:snapshot.scope.currency,accountCount:snapshot.scope.accountCount,transactionsAt:snapshot.freshness.transactionsAt};
        const finished: FinanceChat = {...pending,revision:pending.revision+1,updatedAt:new Date().toISOString(),messages:messages.map(m=>m.id===assistantId?{...m,text:reply.answer,state:'complete',source,...(reply.budgetDraft?{budgetDraft:reply.budgetDraft}:{})}:m)};
        if (!await repository.putChat(scope.workspace,ctx.link.session,finished,pending.revision)) throw new FinanceError('The conversation changed while answering. Reload it.',409);
        return c.json(finished);
      } catch (error) {
        const failed: FinanceChat = {...pending,revision:pending.revision+1,updatedAt:new Date().toISOString(),messages:messages.map(m=>m.id===assistantId?{...m,state:'failed',text:error instanceof FinanceError?error.message:'Finance could not reply. Your question was saved; try again.'}:m)};
        await repository.putChat(scope.workspace,ctx.link.session,failed,pending.revision);
        throw error;
      }
    } catch (error) {
      if (error instanceof FinanceError) return c.json({error:error.message,code:error.code},error.status);
      if (error instanceof z.ZodError) return c.json({error:'Invalid Finance chat request.',code:'INVALID_INPUT'},400);
      console.error('finance_chat_failed',{action,kind:error instanceof Error?error.name:'unknown'});
      return c.json({error:'Finance chat is temporarily unavailable. Try again.'},502);
    }
  });
}
