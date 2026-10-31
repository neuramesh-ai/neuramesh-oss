import { EngineeringTaskSession } from './engineering-task-session';
import { engineeringDisplayTools, type EngineeringDisplayContext } from './engineering-display';
import { engineeringThreadNamer } from './engineering-title';
import { EngineeringSessionRegistry } from './engineering-session-registry';
import { defaultBaselineRules, isEngineeringSelection, type EngineeringAgent, type PolicyRule } from '@neuramesh/shared';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringBrainResolution } from './engineering-brain';
import { ClineChannelSession } from './engineering-channel';
import { AgyChannelSession, type AgyLaneDeps } from './engineering-agy';
import { agyLaneDeps } from './engineering-agy-deps';
import { EngineeringLanes, laneOf, type EngineeringLane } from './engineering-lanes';
import { EngineeringModelRefused, engineeringAuthHeaders, resolveEngineeringProvider, type EngineeringProviderResolution, type MachineAuthProbe } from './engineering-provider';
import { EngineeringConversation } from './engineering-conversation';
import { createEngineeringToolExecutors } from './engineering-tools';
import { engineeringRepoRoot, type EngineeringWorkspace } from './engineering-workspace';
import { CodeSessionRecord, type CodeSessionRecorder } from './engineering-record';

export { resolveEngineeringProvider } from './engineering-provider';

export interface EngineeringMachineSession {
  command(value: unknown): void;
  close(): void | Promise<void>;
  readonly busy?: boolean;
  /** Await a verified cloud checkpoint before a device handoff. */
  flush?(): Promise<void>;
}

export interface EngineeringMachineHost {
  /** Trusted task dispatcher only; never accepted from a browser open frame. */
  runTask?(meta: EngineeringMachineOpenMeta, workspace: EngineeringWorkspace, prompt: string, stopped: () => boolean, progress?: (state: import('@neuramesh/shared').EngineeringSession) => void): Promise<string>;
  open(meta: EngineeringMachineOpenMeta, emit: (event: EngineeringRuntimeEvent) => void): Promise<EngineeringMachineSession>;
}

export interface ClineEngineeringHostOptions {
  apiUrl: string;
  machineToken: string;
  /** the member's headers instead of the machine's bearer — the desktop app hosting Code for its own user */
  authHeaders?: () => Promise<Record<string, string>>;
  workspaceId: string;
  /** the thread's worktree with the clone it came from (engineering-workspace.ts). A bare path is a
   *  worktree of the session repository's own cache clone. */
  resolveCwd(meta: EngineeringMachineOpenMeta): Promise<string | EngineeringWorkspace>;
  resolveDisplayContext?(meta: EngineeringMachineOpenMeta): Promise<EngineeringDisplayContext | null>;
  /** Task execution belongs to the dispatcher; inactive task panes only inspect history/files. */
  isTaskThread?(meta: EngineeringMachineOpenMeta): Promise<boolean | 'planning' | 'in_progress'>;
  resolveBrain(meta: EngineeringMachineOpenMeta): Promise<EngineeringBrainResolution>;
  /** Machine-owned policy rules. Browser controls can only narrow session behavior. */
  resolvePolicyRules?(meta: EngineeringMachineOpenMeta): Promise<PolicyRule[]>;
  fetchImpl?: typeof fetch;
  /** An explicit local profile for pristine-device restore tests and headless hosts. */
  brainRoot?: string;
  brainSync?: boolean;
  /** keeps each session's synced row (0135) — absent on a host that has no credential to write with */
  recorder?: CodeSessionRecorder;
  createCore?: typeof import('@cline/sdk').ClineCore.create;
  createDefaultExecutors?: typeof import('@cline/sdk').createDefaultExecutors;
  /** this machine's sign-ins and keys (engineering-provider.ts): a test hands in its own */
  authProbe?: MachineAuthProbe;
  /** the agy lane's binary, bridge and managed tools (engineering-agy-deps.ts): a test hands in a fake agy */
  agyDeps?: (cwd: string) => AgyLaneDeps;
  log?(line: string): void;
}

export function createClineEngineeringHost(opts: ClineEngineeringHostOptions): EngineeringMachineHost {
  const log = opts.log ?? ((line) => console.log(`[engineering] ${line}`));
  const registry = new EngineeringSessionRegistry<EngineeringMachineSession>();
  const tasks = new Map<string, { task: EngineeringTaskSession; opened: Promise<void> }>();
  const keyOf = (meta: EngineeringMachineOpenMeta) => JSON.stringify([opts.workspaceId, meta.actorId, meta.threadId]);
  const create = (meta: EngineeringMachineOpenMeta, emit: (event: EngineeringRuntimeEvent) => void, whereOverride?: EngineeringWorkspace, task?: EngineeringTaskSession) =>
      registry.open(keyOf(meta), async () => {
      const record = opts.recorder ? new CodeSessionRecord(opts.recorder, meta) : null;
      const recordedEmit = record ? record.emit(emit) : emit;
      const emitTo = (event: EngineeringRuntimeEvent) => recordedEmit(event.type === 'ready' ? { ...event, filePreview: true } : event);
      const [where, policyRules] = await Promise.all([
        whereOverride ?? opts.resolveCwd(meta), opts.resolvePolicyRules?.(meta) ?? defaultBaselineRules(),
      ]);
      // the shell checks the worktree's git pointer against the clone it came from, a twin's included
      const { cwd, repoRoot, privateRepoRoot } = typeof where === 'string' ? { cwd: where, repoRoot: engineeringRepoRoot(meta.repoId), privateRepoRoot: undefined } : where;
      const validId = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const conversation = opts.brainSync !== false && validId(opts.workspaceId) && validId(meta.threadId)
        ? new EngineeringConversation({ workspace: opts.workspaceId, actorId: meta.actorId, threadId: meta.threadId, apiUrl: opts.apiUrl, headers: () => engineeringAuthHeaders(opts), root: opts.brainRoot, fetchImpl: opts.fetchImpl, log }, cwd)
        : undefined;
      try {
      const messages = await conversation?.hydrate();
      if (conversation && task) task.restore({ workspace:opts.workspaceId, threadId:meta.threadId, revision:conversation.brain.revision(), events:[...conversation.brain.events()], runtimeMessages:conversation.brain.messages(), metadata:conversation.brain.metadata() });
      const saved = conversation?.brain.metadata()?.['selection'];
      if (!task && isEngineeringSelection(saved)) meta = { ...meta, ...saved };
      const brain = await opts.resolveBrain(meta);
      const displayContext = await opts.resolveDisplayContext?.(meta);
      // a model this machine refuses still opens the thread: it reads, says why once, and a new pick replaces the model.
      // The stand-in has no credential, and the channel starts nothing on it (engineering-channel.ts runPrompt)
      let refused: string | null = null;
      let resolved: EngineeringProviderResolution;
      try { resolved = await resolveEngineeringProvider(opts, brain, undefined, opts.authProbe); } catch (error) {
        if (!(error instanceof EngineeringModelRefused)) throw error;
        refused = error.message;
        resolved = { providerId: 'none', modelId: brain.modelId };
      }
      const provider = { ...resolved, agent: brain.agent, instructions: brain.instructions };
      // The desktop package is CommonJS while the coding runtime is import-only ESM. This must
      // remain dynamic or machined's tsx boot resolves Node's require condition and exits early.
      const runtimeModule = opts.createCore ? null : await import('@cline/sdk');
      const createCore = opts.createCore ?? runtimeModule!.ClineCore.create.bind(runtimeModule!.ClineCore);
      const createDefaultExecutors = opts.createDefaultExecutors ?? runtimeModule?.createDefaultExecutors;
      const managedTools = createDefaultExecutors
        ? await createEngineeringToolExecutors(cwd, createDefaultExecutors, policyRules, repoRoot, privateRepoRoot)
        : undefined;
      const resolveProvider = async (modelId: string | null, brainPack: string | null, agentId = meta.agentId) => {
        const selected = await opts.resolveBrain({ ...meta, modelId, brainPack, ...(agentId !== undefined ? { agentId } : {}) });
        return { ...await resolveEngineeringProvider(opts, selected, undefined, opts.authProbe), agent: selected.agent, instructions: selected.instructions };
      };
      const namer = task ? async () => ({unchanged:true,message:'This task already has its approved title.'}) : engineeringThreadNamer({ apiUrl: opts.apiUrl, workspaceId: opts.workspaceId, threadId: meta.threadId, headers: () => engineeringAuthHeaders(opts), fetchImpl: opts.fetchImpl });
      const display = (agent?: EngineeringAgent) => engineeringDisplayTools({ apiUrl: opts.apiUrl, threadId: meta.threadId, cwd, context: displayContext, conversation, headers: () => engineeringAuthHeaders(opts), fetchImpl: opts.fetchImpl }, agent);
      const agyDeps = opts.agyDeps?.(cwd) ?? agyLaneDeps({ cwd, ...(managedTools ? { executors: managedTools.executors } : {}), ...(runtimeModule ? { createDefaultTools: runtimeModule.createDefaultTools } : {}) });
      // a Google sign-in runs on agy, every other brain on the Cline SDK; a model change can cross lanes (engineering-lanes.ts)
      const open = async (next: EngineeringProviderResolution, modelId: string | null, brainPack: string | null, history: unknown, refusal: string | null = null): Promise<EngineeringLane> => {
        if (laneOf(next) === 'agy') {
          const agy = new AgyChannelSession(meta, cwd, next, modelId, brainPack, policyRules, emitTo, agyDeps, log, conversation, namer, display);
          await agy.init(Array.isArray(history) ? history : []);
          return agy;
        }
        const cline = new ClineChannelSession(meta, cwd, next, modelId, brainPack, resolveProvider, policyRules, emitTo, createCore, managedTools?.executors, managedTools?.close, log, conversation, namer, refusal, display);
        await cline.init(history as Parameters<ClineChannelSession['init']>[0]);
        return cline;
      };
      let first: EngineeringLane;
      try { first = await open(provider, meta.modelId ?? null, meta.brainPack ?? null, messages, refused); } catch (error) { managedTools?.close(); throw error; }
      const session = new EngineeringLanes(first, laneOf(provider), { meta, cwd, current: { provider, modelId: meta.modelId ?? null, brainPack: meta.brainPack ?? null }, resolve: resolveProvider, open: (next, modelId, brainPack, history) => open(next, modelId, brainPack, history), conversation, emit: emitTo, log });
      record?.opened();
      return record ? record.wrap(session) : session;
      } catch (error) { await conversation?.close().catch(() => {}); throw error; }
      });
  return {
    async open(meta, emit) {
      let taskThread = await opts.isTaskThread?.(meta);
      // The board can sync a phase change before its dispatcher opens the runtime.
      // Attach to that run instead of opening a competing history session.
      const until = Date.now() + 30_000;
      while ((taskThread === 'planning' || taskThread === 'in_progress') && !tasks.has(keyOf(meta)) && Date.now() < until) {
        await new Promise(resolve => setTimeout(resolve, 200));
        taskThread = await opts.isTaskThread?.(meta);
      }
      const active = tasks.get(keyOf(meta));
      if (active) { await active.opened; log(`coding_task_attach thread=${meta.threadId}`); return active.task.attach(emit); }
      const session = await create(meta, emit);
      if (!taskThread) return session;
      return { ...session, command(value: unknown) {
        const type = (value as {type?:string})?.type;
        if (type === 'preview_file') session.command(value);
        else emit({type:'error',recoverable:true,message:'This implementation is managed by the task. Approve its plan or request changes on the task to start the next pass.'});
      }};
    },
    async runTask(meta, workspace, prompt, stopped, progress) {
      const key = keyOf(meta);
      if (tasks.has(key)) throw new Error('This coding task is already executing.');
      const task = new EngineeringTaskSession(meta, progress);
      const opened = create(meta, task.emit, workspace, task).then(session => task.bind(session));
      tasks.set(key, {task,opened});
      try { await opened; return await task.run(prompt, stopped); }
      finally { try { await task.close(); } finally { tasks.delete(key); } }
    },
  };
}
