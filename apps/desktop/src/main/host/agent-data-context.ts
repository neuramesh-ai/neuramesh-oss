import {AsyncLocalStorage} from 'node:async_hooks';
import type {QueuedWork} from '../harness/hostqueue';
export interface AgentDataIdentity {apiUrl:string;workspace:string;agentId:string;privateDestination?:'marketing';subject?:QueuedWork['subject']}
export const agentDataIdentity=new AsyncLocalStorage<AgentDataIdentity>();
