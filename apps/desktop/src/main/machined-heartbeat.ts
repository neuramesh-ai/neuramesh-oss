import {heartbeatBody,type MachinedConfig} from './machined-config';
/** Serialize reports so delayed activity receipts cannot overtake newer ones.
 * Read the token for each request; Cloud Run renews it without restarting. */
export function heartbeatSender(cfg:MachinedConfig,options:{busy:()=>boolean;imageSha:string|null;ready?:()=>boolean;fetch?:typeof fetch}) {
 let posting=Promise.resolve(false);
 return (runtimes:string[],activity=0):Promise<boolean>=>posting=posting.catch(()=>false).then(async()=>{
  if(options.ready&&!options.ready())return false;
  const response=await(options.fetch??fetch)(`${cfg.apiUrl}/v1/commands`,{
   method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${cfg.machineToken}`},
   body:JSON.stringify(heartbeatBody(cfg.machineId,{activeSeconds:activity,busy:options.busy(),runtimes,imageSha:options.imageSha})),signal:AbortSignal.timeout(10000),
  });
  await response.body?.cancel();return response.ok;
 });
}
