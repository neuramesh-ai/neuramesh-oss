import { checkpointEngineering, shutdownEngineering } from './engineering-checkpoint';
import { EngineeringPromptQueue, forwardEngineeringUsage } from './engineering-turn';
import type { ClineCore, CoreSessionEvent, ToolExecutors } from '@cline/sdk';
import { isEngineeringCommand, type EngineeringCommand, type EngineeringControls, type EngineeringMachineOpenMeta, type EngineeringRuntimeEvent } from '../../engineering-protocol';
import { recoverEngineeringPlanProgress, engineeringEffort, type EngineeringSelection, type PolicyRule } from '@neuramesh/shared';
import { requestEngineeringApproval } from './engineering-approvals';
import { createEngineeringChangeRefresh } from './engineering-changes';
import { projectEngineeringCoreEvent } from './engineering-events';
import type { EngineeringProviderResolution } from './engineering-provider';
import { engineeringRuntimeInput, readRuntimeMessages, restoreRuntimeCheckpoint } from './engineering-runtime-input';
import { EngineeringAttachmentInbox } from './engineering-attachments';
import { EngineeringAttachmentQueue } from './engineering-attachment-queue';
import type { EngineeringConversation } from './engineering-conversation';
import { engineeringCoreOptions } from './engineering-core';

export class ClineChannelSession {
  private controls: EngineeringControls; private provider: EngineeringProviderResolution;
  private modelId: string | null; private brainPack: string | null;
  private core: ClineCore | null = null; private sessionId: string | null = null;
  /** The native tool registry is built at session start, so a mode change resumes in a new session. */
  private sessionMode: EngineeringControls['mode'] | null = null;
  private resumeMessages: Awaited<ReturnType<ClineCore['readMessages']>> | undefined;
  private closing: Promise<void> | null = null; private closed = false; private running = false; private readonly pending = new Map<string, (approved: boolean) => void>();
  private readonly retiredSessions = new Set<string>(); private readonly promptQueue = new EngineeringPromptQueue();
  private readonly attachments: EngineeringAttachmentInbox; private readonly attachmentQueue = new EngineeringAttachmentQueue();
  private readonly refreshChanges: () => void;

  constructor(
    private readonly meta: EngineeringMachineOpenMeta,
    private readonly cwd: string,
    provider: EngineeringProviderResolution,
    modelId: string | null,
    brainPack: string | null,
    private readonly resolveProvider: (modelId: string | null, brainPack: string | null, agentId?: string | null) => Promise<EngineeringProviderResolution>,
    private readonly policyRules: PolicyRule[],
    private readonly emit: (event: EngineeringRuntimeEvent) => void,
    private readonly createCore: typeof import('@cline/sdk').ClineCore.create,
    private readonly toolExecutors: ToolExecutors | undefined,
    private readonly closeTools: (() => void) | undefined,
    private readonly log: (line: string) => void,
    private readonly conversation?: EngineeringConversation,
    private readonly setThreadTitle?: (title: string) => Promise<unknown>,
    /** why this machine refused the open model: nothing runs until a new pick replaces it (engineering-host.ts) */
    private refusal: string | null = null,
  ) {
    this.provider = provider;
    this.modelId = modelId;
    this.brainPack = brainPack;
    this.controls = { mode: meta.mode, permissions: { ...meta.permissions }, policy: { read: true, edit: true, command: true, web: true, mcp: true } };
    this.attachments = new EngineeringAttachmentInbox(meta.actorId, meta.threadId);
    this.refreshChanges = createEngineeringChangeRefresh(this.cwd, (changes) => this.emit({ type: 'changes', changes }),
      (error) => this.log(`engineering_diff_failed repo=${this.meta.repoId}: ${error instanceof Error ? error.message : String(error)}`));
  }
  async init(messages?: Awaited<ReturnType<ClineCore['readMessages']>>): Promise<void> {
    this.conversation?.excludeSecret(this.provider.apiKey);
    this.resumeMessages = messages;
    this.core = await this.createRuntimeCore(this.provider);
    const prior = (await this.core.listHistory({ limit: 200, includeManifestFallback: true })).find((record) =>
      record.metadata?.['neurameshThreadId'] === this.meta.threadId
      && record.metadata?.['repoId'] === this.meta.repoId
      && record.metadata?.['actorId'] === this.meta.actorId);
    if (!this.resumeMessages?.length && prior) this.resumeMessages = await this.core.readMessages(prior.sessionId).catch(() => undefined);
    this.emit({ type: 'plan_progress', progress: recoverEngineeringPlanProgress(this.resumeMessages) });
    this.emit({ type: 'ready', provider: this.provider.providerId, model: this.provider.modelId, cwd: this.cwd, modelId: this.modelId, brainPack: this.brainPack, agent: this.provider.agent, reasoningEffort: engineeringEffort(this.modelId, this.meta.reasoningEffort), ...(this.conversation ? { recordedRevision: this.conversation.brain.revision() } : {}) }); if (this.refusal) this.emit({ type: 'error', code: 'MODEL_REFUSED', recoverable: true, message: this.refusal });
  }

  private readPlanMessages = async (): Promise<unknown> => this.core && this.sessionId ? readRuntimeMessages(this.core, this.sessionId) : this.resumeMessages;

  private async createRuntimeCore(provider: EngineeringProviderResolution): Promise<ClineCore> {
    const core = await this.createCore(engineeringCoreOptions(provider, this.meta.threadId,
      { ...(this.toolExecutors ? { toolExecutors: this.toolExecutors } : {}),
        requestToolApproval: (request) => requestEngineeringApproval(request, this.controls, this.policyRules, this.pending, this.emit, (type, payload) => this.conversation?.record(type, payload), this.cwd, () => !this.closed) },
      (type, payload) => this.conversation?.record(type, payload), this.log));
    core.subscribe((event) => { if (this.core === core) this.forward(event); });
    return core;
  }

  command(value: unknown): void {
    if (!isEngineeringCommand(value)) return this.emit({ type: 'error', code: 'INVALID_COMMAND', message: 'The Engineering command was invalid.' });
    if (value.type === 'attachment_start') { this.queueAttachment(value.id, -1, 256, () => this.attachments.start(value.id, value.name, value.mime, value.size)); return; }
    if (value.type === 'attachment_chunk') { this.queueAttachment(value.id, value.index, Buffer.byteLength(value.data), () => this.attachments.chunk(value.id, value.index, value.data)); return; }
    if (value.type === 'attachment_end') { this.queueAttachment(value.id, -2, 128, () => this.attachments.end(value.id)); return; }
    if (value.type === 'controls') {
      if (this.running || this.pending.size > 0 || this.promptQueue.queued) return this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'Plan/Act and permissions can be changed after the current turn finishes.' });
      this.controls = { mode: value.controls.mode, permissions: { ...value.controls.permissions }, policy: { ...this.controls.policy } };
      return;
    }
    if (value.type === 'configure') { void this.switchModel(value.selection.modelId, null, value.selection).catch((error: unknown) => this.fail(error)); return; }
    if (value.type === 'model') {
      void this.switchModel(value.modelId, null).catch((error: unknown) => this.fail(error));
      return;
    }
    if (value.type === 'brain') {
      void this.switchModel(null, value.brainPack).catch((error: unknown) => this.fail(error));
      return;
    }
    if (value.type === 'approval') {
      const resolve = this.pending.get(value.approvalId);
      if (!resolve) return this.emit({ type: 'error', code: 'APPROVAL_GONE', recoverable: true, message: 'That approval is no longer pending.' });
      this.pending.delete(value.approvalId);
      this.conversation?.record('approval.resolved', { approvalId: value.approvalId, approved: value.approved });
      resolve(value.approved);
      this.emit({ type: 'approval_resolved', approvalId: value.approvalId, approved: value.approved });
      return;
    }
    if (value.type === 'restore') { void this.restore(value.checkpointRunCount).catch((error: unknown) => this.fail(error)); return; }
    if (value.type === 'abort') { void this.abort(); return; }
    if (this.closed || !this.core) return;
    if (this.running || this.pending.size > 0 || this.promptQueue.queued) return this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'A turn is already running in this thread.' });
    void this.promptQueue.run(() => this.runPrompt(value)).catch((error: unknown) => this.fail(error));
  }

  get busy(): boolean { return !this.closed && (this.running || this.pending.size > 0 || this.promptQueue.queued); }
  close(): Promise<void> {
    if (this.closing) return this.closing; this.closed = true;
    for (const resolve of this.pending.values()) resolve(false); this.pending.clear();
    const attachmentsDrained = this.attachmentQueue.close(); void attachmentsDrained.finally(() => this.attachments.close());
    this.closeTools?.();
    return this.closing = shutdownEngineering(this.core, this.sessionId, this.conversation, this.runtimeMetadata(), this.log).finally(() => { this.core = null; });
  }

  async flush(): Promise<void> {
    if (this.running) throw new Error('Wait for this turn to finish before its cloud checkpoint.');
    if (this.core && this.sessionId) await this.conversation?.checkpoint(this.core, this.sessionId, this.runtimeMetadata());
    await this.conversation?.flush();
  }

  private async runPrompt(command: Extract<EngineeringCommand, { type: 'prompt' }>): Promise<void> {
    if (this.closed || !this.core) return;
    // a refused model runs nothing: the reason again, and idle, so the thread's row stops at once
    if (this.refusal) { this.emit({ type: 'error', code: 'MODEL_REFUSED', recoverable: true, message: this.refusal }); this.emit({ type: 'status', status: 'idle' }); return; }
    if (this.running || this.pending.size > 0 || this.promptQueue.queued) return this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'Engineering is already working on this thread.' });
    this.running = true;
    this.emit({ type: 'status', status: 'running' });
    let attachmentsResolved = false; try {
      await this.attachmentQueue.wait();
      if (this.closed) return;
      const attached = await this.attachments.resolve(command.attachments);
      attachmentsResolved = true;
      this.conversation?.record('user.message', { ...this.runtimeMetadata(), text: command.prompt, attachments: command.attachments ?? [], model: this.provider.modelId, provider: this.provider.providerId });
      if (this.sessionId && this.sessionMode !== this.controls.mode) {
        const previous = this.sessionId;
        this.resumeMessages = await readRuntimeMessages(this.core, previous).catch(() => undefined);
        this.retiredSessions.add(previous);
        await this.core.stop(previous).catch(() => {});
        this.sessionId = null;
        this.sessionMode = null;
      }
      if (!this.sessionId) {
        const startedMode = this.controls.mode;
        const started = await this.core.start(engineeringRuntimeInput({ setThreadTitle: this.setThreadTitle, emit: this.emit, readPlanMessages: this.readPlanMessages, meta: this.meta, cwd: this.cwd, provider: this.provider, modelId: this.modelId, brainPack: this.brainPack, controls: this.controls, prompt: command.prompt, initialMessages: this.resumeMessages, ...attached }));
        this.sessionId = started.sessionId;
        this.sessionMode = startedMode;
        this.resumeMessages = undefined;
        this.emit({ type: 'session_started', sessionId: started.sessionId });
      } else {
        await this.core.send({
          sessionId: this.sessionId, prompt: command.prompt, mode: this.controls.mode,
          ...(attached.userImages.length ? { userImages: attached.userImages } : {}),
          ...(attached.userFiles.length ? { userFiles: attached.userFiles } : {}),
        });
      }
    } finally { if (attachmentsResolved) this.attachments.release(command.attachments); }
  }

  private queueAttachment(id: string, index: number, bytes: number, task: () => void | Promise<void>): void {
    if (this.closed) return;
    const queued = this.attachmentQueue.push(bytes, task, () => this.emit({ type: 'attachment_ack', id, index }), (error) => this.emit({ type: 'error', code: 'INVALID_ATTACHMENT', recoverable: true, message: error instanceof Error ? error.message : 'The attachment could not be received.' }));
    if (!queued) { this.emit({ type: 'error', code: 'ENGINEERING_PROTOCOL_LIMIT', message: 'The Engineering attachment queue exceeded its safe limit.' }); this.close(); }
  }


  private async switchModel(modelId: string | null, brainPack: string | null, selection?: EngineeringSelection): Promise<void> {
    if (this.closed || (modelId === this.modelId && brainPack === this.brainPack && (!selection || (selection.agentId === (this.meta.agentId ?? null) && selection.reasoningEffort === (this.meta.reasoningEffort ?? null))))) return;
    if (this.running || this.pending.size > 0 || this.promptQueue.queued) {
      this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'The model can be changed after the current turn and approvals finish.' });
      return;
    }
    await this.promptQueue.wait();
    if (this.closed) return;
    this.running = true;
    this.emit({ type: 'status', status: 'running' });
    try {
      const nextProvider = await this.resolveProvider(modelId, brainPack, selection ? selection.agentId : this.meta.agentId);
      const previousCore = this.core;
      const previousSessionId = this.sessionId;
      let messages = this.resumeMessages;
      if (previousCore && previousSessionId) {
        messages = await readRuntimeMessages(previousCore, previousSessionId).catch(() => messages);
        await this.conversation?.checkpoint(previousCore, previousSessionId, this.runtimeMetadata());
      }
      await this.conversation?.flush();
      const nextCore = await this.createRuntimeCore(nextProvider);
      if (previousCore && previousSessionId) { this.retiredSessions.add(previousSessionId); await previousCore.stop(previousSessionId).catch(() => {}); }
      this.conversation?.excludeSecret(nextProvider.apiKey);
      this.conversation?.record('model.change', { from: this.provider.modelId, to: nextProvider.modelId, provider: nextProvider.providerId });
      this.core = nextCore;
      this.provider = nextProvider; this.refusal = null;
      this.modelId = modelId;
      if (selection) { this.meta.agentId = selection.agentId; this.meta.reasoningEffort = engineeringEffort(modelId, selection.reasoningEffort); }
      this.brainPack = brainPack;
      this.sessionId = null;
      this.sessionMode = null;
      this.resumeMessages = messages;
      this.conversation?.brain.setRuntime(messages ?? [], { ...this.conversation.brain.metadata(), ...this.runtimeMetadata() });
      if (previousCore && previousCore !== nextCore) await previousCore.dispose('Neuramesh Code model changed').catch(() => {});
      this.emit({ type: 'model_changed', provider: nextProvider.providerId, model: nextProvider.modelId, modelId, brainPack, agent: nextProvider.agent, reasoningEffort: engineeringEffort(modelId, this.meta.reasoningEffort) });
    } finally {
      this.running = false;
      if (!this.closed) this.emit({ type: 'status', status: 'idle' });
    }
  }

  private forward(event: CoreSessionEvent): void {
    if (this.closed) return;
    if ('sessionId' in event.payload && typeof event.payload.sessionId === 'string' && this.retiredSessions.has(event.payload.sessionId)) return;
    if (this.sessionId && 'sessionId' in event.payload && event.payload.sessionId !== this.sessionId) return;
    this.conversation?.event(event);
    forwardEngineeringUsage(event, this.emit);
    if (event.type === 'ended') { this.running = false; this.checkpoint(event.payload.sessionId); this.emit({ type: 'ended', reason: event.payload.reason }); }
    else if (event.type === 'status') { this.running = event.payload.status !== 'idle'; if (!this.running) this.checkpoint(event.payload.sessionId); this.emit({ type: 'status', status: event.payload.status }); }
    else {
      const projected = projectEngineeringCoreEvent(event);
      this.emit({ type: 'agent_event', event: projected });
      const payload = projected['payload'] as Record<string, unknown> | undefined;
      const agentEvent = payload?.['event'] as Record<string, unknown> | undefined;
      const mutationTools = new Set(['editor', 'apply_patch', 'run_commands']);
      if (projected['type'] === 'agent_event' && agentEvent?.['type'] === 'content_end' && agentEvent['contentType'] === 'tool' && mutationTools.has(String(agentEvent['toolName']))) this.refreshChanges();
      // The SDK's reusable local session can finish a turn without ending the session or
      // emitting idle. Its final agent receipt is authoritative for the next prompt's gate.
      if (event.type === 'agent_event' && event.payload.event.type === 'done') {
        this.running = false;
        this.emit({ type: 'ended', reason: event.payload.event.reason });
        this.checkpoint(event.payload.sessionId);
      }
    }
  }

  private runtimeMetadata = (): Record<string, unknown> => ({ selection: { agentId: this.provider.agent?.id ?? this.meta.agentId ?? null, modelId: this.modelId, reasoningEffort: engineeringEffort(this.modelId, this.meta.reasoningEffort) }, agent: this.provider.agent, provider: this.provider.providerId, model: this.provider.modelId, providerSessionId: this.sessionId, repoId: this.meta.repoId, mode: this.controls.mode, completeness: 'full-runtime-events' });

  private checkpoint(sessionId: string | undefined): void {
    checkpointEngineering(this.core, this.conversation, sessionId, this.runtimeMetadata(), this.log, this.emit, () => this.closed);
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.log(`cline_failed repo=${this.meta.repoId}: ${message}`);
    this.running = false;
    this.emit({ type: 'error', message, recoverable: true });
  }

  private async abort(): Promise<void> {
    if (this.core && this.sessionId) await this.core.abort(this.sessionId, 'Neuramesh user abort').catch(() => {});
    this.running = false;
  }

  private async restore(checkpointRunCount: number): Promise<void> {
    if (!this.core || !this.sessionId || this.running || this.pending.size > 0) {
      this.emit({ type: 'error', code: 'RESTORE_UNAVAILABLE', recoverable: true, message: 'A checkpoint can be restored only while this Engineering thread is idle.' });
      return;
    }
    this.running = true; this.emit({ type: 'status', status: 'running' });
    try {
      const restoredSessionId = await restoreRuntimeCheckpoint(this.core, this.sessionId, checkpointRunCount, this.cwd, engineeringRuntimeInput({ setThreadTitle: this.setThreadTitle, emit: this.emit, readPlanMessages: this.readPlanMessages, meta: this.meta, cwd: this.cwd, provider: this.provider, modelId: this.modelId, brainPack: this.brainPack, controls: this.controls }));
      this.resumeMessages = undefined; this.sessionId = restoredSessionId; this.sessionMode = this.controls.mode;
      this.emit({ type: 'restored', checkpointRunCount });
      this.emit({ type: 'plan_progress', progress: recoverEngineeringPlanProgress(await this.readPlanMessages()) }); this.refreshChanges();
    } finally {
      this.running = false; if (!this.closed) this.emit({ type: 'status', status: 'idle' });
    }
  }

}
