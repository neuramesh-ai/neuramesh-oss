import { defaultBaselineRules, type PolicyRule } from '@neuramesh/shared';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringBrainResolution } from './engineering-brain';
import { ClineChannelSession } from './engineering-channel';
import { resolveEngineeringProvider } from './engineering-provider';
import { createEngineeringToolExecutors } from './engineering-tools';
import { engineeringRepoRoot } from './engineering-workspace';
import { CodeSessionRecord, type CodeSessionRecorder } from './engineering-record';

export { resolveEngineeringProvider } from './engineering-provider';

export interface EngineeringMachineSession {
  command(value: unknown): void;
  close(): void;
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
  resolveCwd(meta: EngineeringMachineOpenMeta): Promise<string>;
  resolveBrain(meta: EngineeringMachineOpenMeta): Promise<EngineeringBrainResolution>;
  /** Machine-owned policy rules. Browser controls can only narrow session behavior. */
  resolvePolicyRules?(meta: EngineeringMachineOpenMeta): Promise<PolicyRule[]>;
  fetchImpl?: typeof fetch;
  /** keeps each session's synced row (0135) — absent on a host that has no credential to write with */
  recorder?: CodeSessionRecorder;
  createCore?: typeof import('@cline/sdk').ClineCore.create;
  createDefaultExecutors?: typeof import('@cline/sdk').createDefaultExecutors;
  log?(line: string): void;
}

export function createClineEngineeringHost(opts: ClineEngineeringHostOptions): EngineeringMachineHost {
  const log = opts.log ?? ((line) => console.log(`[engineering] ${line}`));
  return {
    async open(meta, emit) {
      const record = opts.recorder ? new CodeSessionRecord(opts.recorder, meta) : null;
      const emitTo = record ? record.emit(emit) : emit;
      const [cwd, brain, policyRules] = await Promise.all([
        opts.resolveCwd(meta), opts.resolveBrain(meta), opts.resolvePolicyRules?.(meta) ?? defaultBaselineRules(),
      ]);
      const provider = await resolveEngineeringProvider(opts, brain);
      // The desktop package is CommonJS while the coding runtime is import-only ESM. This must
      // remain dynamic or machined's tsx boot resolves Node's require condition and exits early.
      const runtimeModule = opts.createCore ? null : await import('@cline/sdk');
      const createCore = opts.createCore ?? runtimeModule!.ClineCore.create.bind(runtimeModule!.ClineCore);
      const createDefaultExecutors = opts.createDefaultExecutors ?? runtimeModule?.createDefaultExecutors;
      const managedTools = createDefaultExecutors
        ? await createEngineeringToolExecutors(cwd, createDefaultExecutors, policyRules, engineeringRepoRoot(meta.repoId))
        : undefined;
      const resolveProvider = async (modelId: string | null, brainPack: string | null) => resolveEngineeringProvider(
        opts,
        await opts.resolveBrain({ ...meta, modelId, brainPack }),
      );
      const session = new ClineChannelSession(meta, cwd, provider, meta.modelId ?? null, meta.brainPack ?? null, resolveProvider, policyRules, emitTo, createCore, managedTools?.executors, managedTools?.close, log);
      try { await session.init(); } catch (error) { managedTools?.close(); throw error; }
      record?.opened();
      return record ? record.wrap(session) : session;
    },
  };
}
