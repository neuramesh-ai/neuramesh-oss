import { engineeringDisplayTools, type EngineeringDisplayContext } from './engineering-display';
import { engineeringThreadNamer } from './engineering-title';
import { EngineeringSessionRegistry } from './engineering-session-registry';
import { defaultBaselineRules, isEngineeringSelection, type PolicyRule } from '@neuramesh/shared';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringBrainResolution } from './engineering-brain';
import { ClineChannelSession } from './engineering-channel';
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
  log?(line: string): void;
}

export function createClineEngineeringHost(opts: ClineEngineeringHostOptions): EngineeringMachineHost {
  const log = opts.log ?? ((line) => console.log(`[engineering] ${line}`));
  const registry = new EngineeringSessionRegistry<EngineeringMachineSession>();
  return {
    async open(meta, emit) {
      return registry.open(JSON.stringify([opts.workspaceId, meta.actorId, meta.threadId]), async () => {
      const record = opts.recorder ? new CodeSessionRecord(opts.recorder, meta) : null;
      const emitTo = record ? record.emit(emit) : emit;
      const [where, policyRules] = await Promise.all([
        opts.resolveCwd(meta), opts.resolvePolicyRules?.(meta) ?? defaultBaselineRules(),
      ]);
      // the shell checks the worktree's git pointer against the clone it came from, a twin's included
      const { cwd, repoRoot, privateRepoRoot } = typeof where === 'string' ? { cwd: where, repoRoot: engineeringRepoRoot(meta.repoId), privateRepoRoot: undefined } : where;
      const validId = (id: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
      const conversation = opts.brainSync !== false && validId(opts.workspaceId) && validId(meta.threadId)
        ? new EngineeringConversation({ workspace: opts.workspaceId, actorId: meta.actorId, threadId: meta.threadId, apiUrl: opts.apiUrl, headers: () => engineeringAuthHeaders(opts), root: opts.brainRoot, fetchImpl: opts.fetchImpl, log }, cwd)
        : undefined;
      try {
      const messages = await conversation?.hydrate();
      const saved = conversation?.brain.metadata()?.['selection'];
      if (isEngineeringSelection(saved)) meta = { ...meta, ...saved };
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
      const session = new ClineChannelSession(meta, cwd, provider, meta.modelId ?? null, meta.brainPack ?? null, resolveProvider, policyRules, emitTo, createCore, managedTools?.executors, managedTools?.close, log, conversation, engineeringThreadNamer({ apiUrl: opts.apiUrl, workspaceId: opts.workspaceId, threadId: meta.threadId, headers: () => engineeringAuthHeaders(opts), fetchImpl: opts.fetchImpl }), refused, agent => engineeringDisplayTools({ apiUrl: opts.apiUrl, threadId: meta.threadId, cwd, context: displayContext, conversation, headers: () => engineeringAuthHeaders(opts), fetchImpl: opts.fetchImpl }, agent));
      try { await session.init(messages); } catch (error) { managedTools?.close(); throw error; }
      record?.opened();
      return record ? record.wrap(session) : session;
      } catch (error) { await conversation?.close().catch(() => {}); throw error; }
      });
    },
  };
}
