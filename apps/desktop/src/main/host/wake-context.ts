// Dependencies for makeWake. No runtime state lives here.
import type { RunHandle } from './runs';
import type { AgentAttachment, DeltaFn } from '../runtime/adapter';
import type { ReplicaDatabase } from '@neuramesh/client-core/replica';
import type { HostedAgent, SkillRef } from '../agents';
import type { LogFn } from '../agentlog';
import type { SubjectRef } from '../harness/brain';
import type { makeRuns } from './runs';
import type { makeBlock } from './block';
import type { makeChatTurn } from './chatturn';
import type { makeStaffing } from './staffing';
import type { makeEcho } from './echo';
import type { makeContent } from './content';

type OrchestratorTurn = (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, transcript: string, token: string, thread?: { id: string; number: number; title: string; state: string }, log?: LogFn, skills?: SkillRef[], attachments?: AgentAttachment[], convoThreadId?: string | null, run?: RunHandle, onDelta?: DeltaFn, waitForPermission?: import('./permission-deadline').WaitForPermission) => Promise<string>;

export interface WakeContext {
  db: ReplicaDatabase;
  agents: Map<string, HostedAgent>;
  NO_RUN: ReturnType<typeof makeRuns>['NO_RUN'];
  alog: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null, runId?: string | null) => LogFn;
  apiUrl: string;
  arun: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null) => { log: LogFn; runId: string };
  blockFor: ReturnType<typeof makeBlock>['blockFor'];
  brainNotes: (subject: SubjectRef, cap?: number, perNote?: number, since?: number) => string;
  brainResults: (subject: SubjectRef, cap?: number, per?: number, since?: number) => string;
  chatTurn: ReturnType<typeof makeChatTurn>['chatTurn'];
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
  drawOnAsk: ReturnType<typeof makeContent>['drawOnAsk'];
  echoOrchestrate: ReturnType<typeof makeEcho>['echoOrchestrate'];
  echoPlanReview: ReturnType<typeof makeEcho>['echoPlanReview'];
  echoThreadOrchestrate: ReturnType<typeof makeEcho>['echoThreadOrchestrate'];
  handleExhaustion: ReturnType<typeof makeStaffing>['handleExhaustion'];
  openWakeRun: (agent: HostedAgent, where: { workspace: string; channelId: string; threadId?: string | null; taskId?: string | null }, prompt: string, triggerMessageId?: string | null) => Promise<RunHandle>;
  orchestratorTurn: OrchestratorTurn;
  ownerActorId: string;
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
  rearmWake: (messageId: string) => boolean;
  reviseContentDrafts: ReturnType<typeof makeContent>['reviseContentDrafts'];
  seatFor: ReturnType<typeof makeStaffing>['seatFor'];
  setStatus: (agent: HostedAgent, status: 'online' | 'thinking' | 'working') => void;
  threadModeFor: ReturnType<typeof makeChatTurn>['threadModeFor'];
  threadTranscript: ReturnType<typeof makeContent>['threadTranscript'];
  wakeEnded: (chId: string) => void;
  wakeStarted: (chId: string) => void;
}
