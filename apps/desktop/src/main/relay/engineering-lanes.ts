// a coding thread's lane (docs/design/gemini-code-lane-2026-10/plan.md). the Cline SDK runs a brain on a
// key, the house brain or a ChatGPT sign-in, and agy runs a Google sign-in. a model change can cross
// between them, so this wrapper owns that swap: the old lane seals the journal and closes with the
// journal still open, and the new lane opens on the same conversation with the messages so far.
// a change that stays on the Cline SDK goes to ClineChannelSession, which switches models itself.
import { engineeringEffort, type ThinkingLevel } from '@neuramesh/shared';
import { isEngineeringCommand, type EngineeringMachineOpenMeta, type EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringConversation } from './engineering-conversation';
import { EngineeringModelRefused, type EngineeringProviderResolution } from './engineering-provider';
import { previewEngineeringFile } from './engineering-file-preview';

/** what the wrapper needs from a lane: ClineChannelSession and AgyChannelSession both fit */
export interface EngineeringLane {
  command(value: unknown): void;
  close(keepJournal?: boolean): Promise<unknown>;
  flush(): Promise<void>;
  readonly busy: boolean;
}

export type LaneKind = 'cline' | 'agy';
export const laneOf = (provider: Pick<EngineeringProviderResolution, 'lane'>): LaneKind => (provider.lane === 'agy' ? 'agy' : 'cline');

interface LanePick { modelId: string | null; brainPack: string | null; agentId: string | null | undefined; effort: ThinkingLevel | null | undefined }

export class EngineeringLanes {
  private swapping = false;

  constructor(
    private lane: EngineeringLane,
    private kind: LaneKind,
    private readonly o: {
      meta: EngineeringMachineOpenMeta;
      cwd?: string;
      /** the lane's provider and pick, kept for an agy model change and for a swap that fails */
      current: { provider: EngineeringProviderResolution; modelId: string | null; brainPack: string | null };
      resolve(modelId: string | null, brainPack: string | null, agentId: string | null | undefined): Promise<EngineeringProviderResolution>;
      open(provider: EngineeringProviderResolution, modelId: string | null, brainPack: string | null, messages: unknown[]): Promise<EngineeringLane>;
      conversation?: EngineeringConversation;
      emit(event: EngineeringRuntimeEvent): void;
      log(line: string): void;
    },
  ) {}

  get busy(): boolean { return this.swapping || this.lane.busy; }
  close(): Promise<void> { return this.lane.close().then(() => {}); }
  flush(): Promise<void> { return this.lane.flush(); }

  command(value: unknown): void {
    if (isEngineeringCommand(value) && value.type === 'preview_file') {
      if (!this.o.cwd) return this.o.emit({ type: 'file_preview', requestId: value.requestId, path: value.path, error: 'The thread’s repository is unavailable.' });
      void previewEngineeringFile(this.o.cwd, value.requestId, value.path).then(this.o.emit);
      return;
    }
    if (this.swapping) return this.o.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'The model is changing. Send the message again in a moment.' });
    if (!isEngineeringCommand(value) || (value.type !== 'configure' && value.type !== 'model' && value.type !== 'brain')) return this.lane.command(value);
    const meta = this.o.meta;
    const next: LanePick = value.type === 'configure' ? { modelId: value.selection.modelId, brainPack: null, agentId: value.selection.agentId, effort: value.selection.reasoningEffort }
      : value.type === 'model' ? { modelId: value.modelId, brainPack: null, agentId: meta.agentId, effort: meta.reasoningEffort }
        : { modelId: null, brainPack: value.brainPack, agentId: meta.agentId, effort: meta.reasoningEffort };
    void this.route(value, next).catch((error: unknown) => this.o.emit({ type: 'error', message: error instanceof Error ? error.message : String(error), recoverable: true }));
  }

  private async route(command: unknown, next: LanePick): Promise<void> {
    let provider: EngineeringProviderResolution;
    try { provider = await this.o.resolve(next.modelId, next.brainPack, next.agentId); } catch (error) {
      // the Cline lane answers a refused pick itself and keeps its model; the agy lane says why here
      if (this.kind === 'cline' && error instanceof EngineeringModelRefused) return this.lane.command(command);
      throw error;
    }
    if (this.kind === 'cline' && laneOf(provider) === 'cline') return this.lane.command(command);
    const meta = this.o.meta;
    const same = this.kind === 'agy' && laneOf(provider) === 'agy' && next.modelId === this.o.current.modelId && next.brainPack === this.o.current.brainPack
      && (next.agentId ?? null) === (meta.agentId ?? null) && engineeringEffort(next.modelId, next.effort) === engineeringEffort(next.modelId, meta.reasoningEffort);
    if (same) return;
    if (this.lane.busy) return this.o.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'The model can be changed after the current turn and approvals finish.' });
    await this.swap(provider, next);
  }

  private async swap(provider: EngineeringProviderResolution, next: LanePick): Promise<void> {
    this.swapping = true;
    this.o.emit({ type: 'status', status: 'running' });
    try {
      await this.lane.close(true);
      const messages = [...(this.o.conversation?.brain.messages() ?? [])];
      const meta = this.o.meta;
      const before = { ...this.o.current };
      try { this.lane = await this.o.open(provider, next.modelId, next.brainPack, messages); } catch (error) {
        // the old lane is closed: open it again, so the thread keeps working on its old model
        this.lane = await this.o.open(before.provider, before.modelId, before.brainPack, messages);
        throw error;
      }
      if (next.agentId !== undefined) meta.agentId = next.agentId;
      meta.reasoningEffort = engineeringEffort(next.modelId, next.effort);
      this.o.conversation?.record('model.change', { from: before.provider.modelId, to: provider.modelId, provider: provider.providerId, lane: laneOf(provider) });
      this.kind = laneOf(provider);
      this.o.current = { provider, modelId: next.modelId, brainPack: next.brainPack };
      this.o.log(`engineering_lane thread=${meta.threadId} lane=${this.kind} model=${provider.modelId}`);
      this.o.emit({ type: 'model_changed', provider: provider.providerId, model: provider.modelId, modelId: next.modelId, brainPack: next.brainPack, agent: provider.agent, reasoningEffort: meta.reasoningEffort });
    } finally {
      this.swapping = false;
      this.o.emit({ type: 'status', status: 'idle' });
    }
  }
}
