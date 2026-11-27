import {agentReplicaRoutes} from './agent-replica';
import type {Actor} from '@neuramesh/shared';
import type {Hono} from 'hono';
import {cors} from 'hono/cors';
import type {Store} from './store';
import {destinationRoutes} from './destinations';
import {salesRoutes} from './sales-routes';
import {financeRoutes,financeWorkspaceRoutes,financeChatRoutes} from './private-finance';
export function destinationCors<E extends {Variables:{actor:Actor}}>(app:Hono<E>,origin:(value:string)=>string|null) {
 for(const path of ['/v1/destinations/*','/v1/finance/*'])app.use(path,cors({origin:value=>value==='https://hq.neuramesh.app'?value:origin(value),allowMethods:['POST','OPTIONS'],allowHeaders:['authorization','content-type','x-nm-actor']}));
}
export function workspaceDestinationRoutes<E extends {Variables:{actor:Actor;machine?:unknown;memberId?:string}}>(app:Hono<E>,store:Store){
 agentReplicaRoutes(app,store);destinationRoutes(app,store);salesRoutes(app,store);financeRoutes(app,store);financeWorkspaceRoutes(app,store);financeChatRoutes(app,store);
}
