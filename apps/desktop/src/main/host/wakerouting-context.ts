// Dependencies for makeWakeRouting. No runtime state lives here.
import type { HostedAgent } from '../agents';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import type { ClaimVerdict, MachineCapability, SessionOrigin } from '@neuramesh/shared';
import type { HostGuards } from './guards';
import type { HostQueue } from '../harness/hostqueue';
import type { makeRuns } from './runs';
import type { makeChatTurn } from './chatturn';
import type { makeStaffing } from './staffing';
import type { makeMarketing } from './marketing';
import type { makeSchedules } from './schedules';
import type { makeWake } from './wake';
import type { WakeAt } from './wakefail';

export interface WakeRoutingContext {
  db: ReplicaDatabase;
  /** the credential probe behind the no-compute notice needs the API (2026-09-16) */
  apiUrl: string;
  LEASE_LOST: ReturnType<typeof makeRuns>['LEASE_LOST'];
  SWEEP_LOOKBACK_MS: number;
  agents: Map<string, HostedAgent>;
  claimVerdict: (runtime: string, model: string | null, originUserId: string | null, elapsedMs: number, extra?: { agentId?: string; priorMachineId?: string | null; threadMachineId?: string | null; origin?: SessionOrigin | null; modelFree?: boolean }) => Promise<ClaimVerdict>;
  confirmAddAgent: ReturnType<typeof makeStaffing>['confirmAddAgent'];
  confirmCreateAgent: ReturnType<typeof makeStaffing>['confirmCreateAgent'];
  confirmFailover: ReturnType<typeof makeStaffing>['confirmFailover'];
  defaultResponder: ReturnType<typeof makeChatTurn>['defaultResponder'];
  execQueue: HostQueue;
  offerAddAgents: ReturnType<typeof makeStaffing>['offerAddAgents'];
  ownerActorId: string;
  peerMachines: () => Promise<MachineCapability[]>;
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
  priorMachineFor: (threadId?: string | null, taskId?: string | null) => Promise<string | null>;
  processed: HostGuards["processed"];
  queueWake: (agent: HostedAgent, m: { id: string; channel_id: string; thread_id?: string | null; body: string }) => void;
  runDueSchedules: ReturnType<typeof makeSchedules>['runDueSchedules'];
  runMarketingBootstrap: ReturnType<typeof makeMarketing>['runMarketingBootstrap'];
  /** the runner half — the one edge between the two, and it points this way only */
  wakeThread: ReturnType<typeof makeWake>['wakeThread'];
  /** a thread wake that threw before its turn started says so in its thread (host/wakefail.ts) */
  wakeFailed: (agent: HostedAgent, m: { id: string; body: string }, at: WakeAt, err: unknown) => Promise<unknown>;
  saidNoCompute: HostGuards["saidNoCompute"];
}
