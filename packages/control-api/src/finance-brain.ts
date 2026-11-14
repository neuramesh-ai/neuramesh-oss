import {STARTER_MODEL,type FinanceChatMessage,type FinanceSnapshot} from '@neuramesh/shared';
import {chargeStarterCall,houseBrainServes,ledgerFor,STARTER_MODEL_URL,starterRequest,type Ledger,type GeminiUsage} from './credits';
import type {Store} from './store';
import {FinanceError} from './finance-gateway';
import {financeInstructions,parseFinanceReply} from './finance-model';

/** The same house key, credit guard and actual vendor-usage charge as threads.
 * No vendor key is sent to a client or a workspace machine. */
export async function completeFinanceBrain(store:Store,workspace:string,messages:FinanceChatMessage[],snapshot:FinanceSnapshot,signal?:AbortSignal,
  options:{fetch?:typeof fetch;ledger?:Ledger|null;key?:string}={}) {
 const ledger=options.ledger===undefined?ledgerFor(store):options.ledger;
 if(!ledger)throw new FinanceError('Finance credits are unavailable.',503,'MODEL_UNAVAILABLE');
 if((await ledger.balance(workspace)).remainingMicros<=0)throw new FinanceError('Add NeuraMesh credits, or choose a connected model.',402,'NO_CREDITS');
 const key=options.key??(houseBrainServes()?process.env.STARTER_GOOGLE_API_KEY:undefined);
 if(!key)throw new FinanceError('The NeuraMesh brain is unavailable. Choose a connected model.',503,'MODEL_UNAVAILABLE');
 const request=starterRequest({workspace,system:financeInstructions(snapshot),contents:messages.filter(m=>m.state==='complete').slice(-24).map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.text}]}))});
 request.generationConfig={...(request.generationConfig as object),maxOutputTokens:4000,responseMimeType:'application/json'};
 const response=await(options.fetch??fetch)(`${STARTER_MODEL_URL}:generateContent`,{method:'POST',redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])]),headers:{'content-type':'application/json','x-goog-api-key':key},body:JSON.stringify(request)});
 if(!response.ok){await response.body?.cancel();throw new FinanceError('The NeuraMesh brain could not reply. Try again.',502,'MODEL_UNAVAILABLE');}
 const body=await response.json() as {candidates?:Array<{content?:{parts?:Array<{text?:string;thought?:boolean}>}}> ;usageMetadata?:GeminiUsage};
 await chargeStarterCall(ledger,workspace,body.usageMetadata);
 const text=(body.candidates?.[0]?.content?.parts??[]).filter(part=>!part.thought).map(part=>part.text??'').join('');
 return {...parseFinanceReply(text),model:STARTER_MODEL};
}
