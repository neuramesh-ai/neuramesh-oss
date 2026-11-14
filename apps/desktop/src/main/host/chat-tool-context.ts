import type {DrawOutcome} from './drawdraft';
import type {WhiteboardToolClosures} from '../harness/toolbus';
import type {LibraryReader} from './grounding';
import type {HostedAgent} from '../agents';
import type {LogFn} from '../agentlog';
import type {HostCtx} from './ctx';
import type {DraftRow} from './orchtools';
import type {MessageBoardTools} from './messageboards';
type ReplicaDatabase = import('@neuramesh/client-core/replica').ReplicaDatabase;

export interface ChatToolCtx {
  permissionRunId?: string;
  runCommand?: (command:string) => Promise<string>;
  z: typeof import('zod')['z'];
  tool: typeof import('@anthropic-ai/claude-agent-sdk')['tool'];
  createSdkMcpServer: typeof import('@anthropic-ai/claude-agent-sdk')['createSdkMcpServer'];
  text: (t: string) => { content: Array<{ type: 'text'; text: string }> };
  agent: HostedAgent;
  ch: { id: string; slug: string; workspace_id: string };
  threadId: string;
  log: LogFn;
  // the host services the registry calls — passed, never closed over, so the module is a
  // function of its turn and its dependencies and nothing else
  db: ReplicaDatabase;
  post: HostCtx['post'];
  apiGet: (path: string, actor: { kind: string; id: string; role?: string }) => Promise<any>;
  /** `actor`: the agent that recalls, so the read is scoped as that agent (chatsupport.ts recallFor) */
  recallFor: (workspaceId: string, channelId: string, query: string, actor: { kind: 'agent'; id: string; role?: string }) => Promise<string>;
  loadSkillBody: (channelId: string, workspaceId: string, name: string, pack?: string) => Promise<string>;
  whiteboardClosures: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }, at: { taskId?: string; threadId?: string }) => WhiteboardToolClosures;
  draftsForAnchor: (taskId: string | null, threadId: string | null) => Promise<{ posts: DraftRow[]; msgAnchor: { taskId: string } | { threadId: string } } | null>;
  generateDraftImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, itemId: string) => Promise<DrawOutcome>;
  generateShareImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, brief: string) => Promise<{ thumb?: string; bytes?: Buffer; mime?: string; error?: string }>;
  /** the room's shelf (host/workspace.ts): the conversation had no way to read it before 2026-09-19 */
  libraryDocs: LibraryReader;
  /** Message boards (host/messageboards.ts): this agent's tools when a person gave it access to a board. null or absent = no board tool */
  messageBoards?: MessageBoardTools | null;
}
