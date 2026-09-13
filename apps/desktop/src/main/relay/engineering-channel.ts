import type { ClineCore, CoreSessionEvent, ToolApprovalRequest, ToolExecutors } from '@cline/sdk';
import { ENGINEERING_CLINE_TOOL_POLICIES, engineeringToolCategory, engineeringToolDecision, isEngineeringCommand, type EngineeringCommand, type EngineeringControls, type EngineeringMachineOpenMeta, type EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { PolicyRule } from '@neuramesh/shared';
import { engineeringPolicyVerdict } from './engineering-policy';
import { createEngineeringChangeRefresh } from './engineering-changes';
import { projectEngineeringCoreEvent } from './engineering-events';
import type { EngineeringProviderResolution } from './engineering-provider';
import { engineeringRuntimeInput } from './engineering-runtime-input';
import { EngineeringAttachmentInbox } from './engineering-attachments';
import { EngineeringAttachmentQueue } from './engineering-attachment-queue';

export class ClineChannelSession {
  private controls: EngineeringControls; private provider: EngineeringProviderResolution;
  private modelId: string | null; private brainPack: string | null;
  private core: ClineCore | null = null; private sessionId: string | null = null;
  /** The native tool registry is built at session start, so a mode change resumes in a new session. */
  private sessionMode: EngineeringControls['mode'] | null = null;
  private resumeMessages: Awaited<ReturnType<ClineCore['readMessages']>> | undefined;
  private closed = false; private running = false; private readonly pending = new Map<string, (approved: boolean) => void>();
  private readonly attachments: EngineeringAttachmentInbox; private readonly attachmentQueue = new EngineeringAttachmentQueue();
  private readonly refreshChanges: () => void;

  constructor(
    private readonly meta: EngineeringMachineOpenMeta,
    private readonly cwd: string,
    provider: EngineeringProviderResolution,
    modelId: string | null,
    brainPack: string | null,
    private readonly resolveProvider: (modelId: string | null, brainPack: string | null) => Promise<EngineeringProviderResolution>,
    private readonly policyRules: PolicyRule[],
    private readonly emit: (event: EngineeringRuntimeEvent) => void,
    private readonly createCore: typeof import('@cline/sdk').ClineCore.create,
    private readonly toolExecutors: ToolExecutors | undefined,
    private readonly closeTools: (() => void) | undefined,
    private readonly log: (line: string) => void,
  ) {
    this.provider = provider;
    this.modelId = modelId;
    this.brainPack = brainPack;
    this.controls = { mode: meta.mode, permissions: { ...meta.permissions }, policy: { read: true, edit: true, command: true, web: true, mcp: true } };
    this.attachments = new EngineeringAttachmentInbox(meta.actorId, meta.threadId);
    this.refreshChanges = createEngineeringChangeRefresh(this.cwd, (changes) => this.emit({ type: 'changes', changes }),
      (error) => this.log(`engineering_diff_failed repo=${this.meta.repoId}: ${error instanceof Error ? error.message : String(error)}`));
  }
  async init(): Promise<void> {
    this.core = await this.createRuntimeCore(this.provider);
    const prior = (await this.core.listHistory({ limit: 200, includeManifestFallback: true })).find((record) =>
      record.metadata?.['neurameshThreadId'] === this.meta.threadId
      && record.metadata?.['repoId'] === this.meta.repoId
      && record.metadata?.['actorId'] === this.meta.actorId);
    if (prior) this.resumeMessages = await this.core.readMessages(prior.sessionId).catch(() => undefined);
    this.emit({ type: 'ready', provider: this.provider.providerId, model: this.provider.modelId, cwd: this.cwd, modelId: this.modelId, brainPack: this.brainPack });
  }

  private async createRuntimeCore(provider: EngineeringProviderResolution): Promise<ClineCore> {
    const core = await this.createCore({
      clientName: 'neuramesh-engineering',
      backendMode: 'local',
      ...(provider.runtimeFetch ? { fetch: provider.runtimeFetch } : {}),
      capabilities: {
        ...(this.toolExecutors ? { toolExecutors: this.toolExecutors } : {}),
        requestToolApproval: (request) => this.requestApproval(request),
      },
      toolPolicies: ENGINEERING_CLINE_TOOL_POLICIES,
    });
    core.subscribe((event) => { if (this.core === core) this.forward(event); });
    return core;
  }

  command(value: unknown): void {
    if (!isEngineeringCommand(value)) return this.emit({ type: 'error', code: 'INVALID_COMMAND', message: 'The Engineering command was invalid.' });
    if (value.type === 'attachment_start') { this.queueAttachment(value.id, -1, 256, () => this.attachments.start(value.id, value.name, value.mime, value.size)); return; }
    if (value.type === 'attachment_chunk') { this.queueAttachment(value.id, value.index, Buffer.byteLength(value.data), () => this.attachments.chunk(value.id, value.index, value.data)); return; }
    if (value.type === 'attachment_end') { this.queueAttachment(value.id, -2, 128, () => this.attachments.end(value.id)); return; }
    if (value.type === 'controls') {
      if (this.running || this.pending.size > 0) return this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'Plan/Act and permissions can be changed after the current turn finishes.' });
      this.controls = { mode: value.controls.mode, permissions: { ...value.controls.permissions }, policy: { ...this.controls.policy } };
      return;
    }
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
      resolve(value.approved);
      this.emit({ type: 'approval_resolved', approvalId: value.approvalId, approved: value.approved });
      return;
    }
    if (value.type === 'restore') { void this.restore(value.checkpointRunCount).catch((error: unknown) => this.fail(error)); return; }
    if (value.type === 'abort') { void this.abort(); return; }
    void this.prompt(value).catch((error: unknown) => this.fail(error));
  }

  close(): void {
    if (this.closed) return; this.closed = true;
    for (const resolve of this.pending.values()) resolve(false); this.pending.clear();
    const attachmentsDrained = this.attachmentQueue.close(); void attachmentsDrained.finally(() => this.attachments.close());
    this.closeTools?.(); void this.shutdown();
  }

  private async prompt(command: Extract<EngineeringCommand, { type: 'prompt' }>): Promise<void> {
    if (this.closed || !this.core) return;
    if (this.running || this.pending.size > 0) return this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'Engineering is already working on this thread.' });
    this.running = true;
    this.emit({ type: 'status', status: 'running' });
    let attachmentsResolved = false; try {
      await this.attachmentQueue.wait();
      if (this.closed) return;
      const attached = await this.attachments.resolve(command.attachments);
      attachmentsResolved = true;
      if (this.sessionId && this.sessionMode !== this.controls.mode) {
        const previous = this.sessionId;
        this.resumeMessages = await this.core.readMessages(previous).catch(() => undefined);
        await this.core.stop(previous).catch(() => {});
        this.sessionId = null;
        this.sessionMode = null;
      }
      if (!this.sessionId) {
        const started = await this.core.start(engineeringRuntimeInput({ meta: this.meta, cwd: this.cwd, provider: this.provider, modelId: this.modelId, brainPack: this.brainPack, controls: this.controls, prompt: command.prompt, initialMessages: this.resumeMessages, ...attached }));
        this.sessionId = started.sessionId;
        this.sessionMode = this.controls.mode;
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

  private requestApproval(request: ToolApprovalRequest): Promise<{ approved: boolean; reason?: string }> {
    const category = engineeringToolCategory(request.toolName);
    const sessionDecision = engineeringToolDecision(this.controls, request.toolName);
    const policyVerdict = engineeringPolicyVerdict(this.policyRules, request.toolName, request.input);
    if (!category || policyVerdict === 'deny') {
      return Promise.resolve({ approved: false, reason: 'Blocked by Neuramesh workspace policy' });
    }
    if (sessionDecision === 'blocked') {
      if (this.controls.mode === 'plan' && (category === 'edit' || category === 'command')) {
        this.emit({ type: 'mode_blocked', category, toolName: request.toolName });
        return Promise.resolve({ approved: false, reason: 'Blocked by Neuramesh Plan mode' });
      }
      return Promise.resolve({ approved: false, reason: 'Blocked by Neuramesh workspace policy' });
    }
    if (sessionDecision === 'auto' && policyVerdict === 'allow') return Promise.resolve({ approved: true });
    return new Promise((resolve) => {
      this.pending.set(request.toolCallId, (approved) => resolve({ approved, ...(!approved ? { reason: 'Declined in Neuramesh' } : {}) }));
      this.emit({ type: 'approval', approvalId: request.toolCallId, category, toolName: request.toolName, input: request.input });
    });
  }

  private async switchModel(modelId: string | null, brainPack: string | null): Promise<void> {
    if (this.closed || (modelId === this.modelId && brainPack === this.brainPack)) return;
    if (this.running || this.pending.size > 0) {
      this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'The model can be changed after the current turn and approvals finish.' });
      return;
    }
    this.running = true;
    this.emit({ type: 'status', status: 'running' });
    try {
      const nextProvider = await this.resolveProvider(modelId, brainPack);
      const nextCore = await this.createRuntimeCore(nextProvider);
      const previousCore = this.core;
      const previousSessionId = this.sessionId;
      let messages = this.resumeMessages;
      if (previousCore && previousSessionId) {
        messages = await previousCore.readMessages(previousSessionId).catch(() => messages);
        await previousCore.stop(previousSessionId).catch(() => {});
      }
      this.core = nextCore;
      this.provider = nextProvider;
      this.modelId = modelId;
      this.brainPack = brainPack;
      this.sessionId = null;
      this.sessionMode = null;
      this.resumeMessages = messages;
      if (previousCore && previousCore !== nextCore) await previousCore.dispose('Neuramesh Code model changed').catch(() => {});
      this.emit({ type: 'model_changed', provider: nextProvider.providerId, model: nextProvider.modelId, modelId, brainPack });
    } finally {
      this.running = false;
      if (!this.closed) this.emit({ type: 'status', status: 'idle' });
    }
  }

  private forward(event: CoreSessionEvent): void {
    if (this.sessionId && 'sessionId' in event.payload && event.payload.sessionId !== this.sessionId) return;
    if (event.type === 'agent_event' && event.payload.event.type === 'usage') {
      this.emit({
        type: 'usage', inputTokens: event.payload.event.totalInputTokens,
        outputTokens: event.payload.event.totalOutputTokens,
        ...(typeof event.payload.event.totalCost === 'number' ? { cost: event.payload.event.totalCost } : {}),
      });
    }
    if (event.type === 'ended') { this.running = false; this.emit({ type: 'ended', reason: event.payload.reason }); }
    else if (event.type === 'status') { this.running = event.payload.status !== 'idle'; this.emit({ type: 'status', status: event.payload.status }); }
    else {
      const projected = projectEngineeringCoreEvent(event);
      this.emit({ type: 'agent_event', event: projected });
      const payload = projected['payload'] as Record<string, unknown> | undefined;
      const agentEvent = payload?.['event'] as Record<string, unknown> | undefined;
      const mutationTools = new Set(['editor', 'apply_patch', 'run_commands']);
      if (projected['type'] === 'agent_event' && agentEvent?.['type'] === 'content_end' && agentEvent['contentType'] === 'tool' && mutationTools.has(String(agentEvent['toolName']))) this.refreshChanges();
    }
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
      const previous = this.sessionId;
      const result = await this.core.restore({
        sessionId: previous,
        checkpointRunCount,
        start: engineeringRuntimeInput({ meta: this.meta, cwd: this.cwd, provider: this.provider, modelId: this.modelId, brainPack: this.brainPack, controls: this.controls }),
        cwd: this.cwd,
        restore: { workspace: true, messages: true, omitCheckpointMessageFromSession: false },
      });
      const restoredSessionId = result.startResult?.sessionId ?? result.sessionId;
      if (!restoredSessionId) throw new Error('Engineering restored the checkpoint without starting its resumed session.');
      await this.core.stop(previous).catch(() => {});
      this.resumeMessages = undefined; this.sessionId = restoredSessionId; this.sessionMode = this.controls.mode;
      this.emit({ type: 'restored', checkpointRunCount }); this.refreshChanges();
    } finally {
      this.running = false; if (!this.closed) this.emit({ type: 'status', status: 'idle' });
    }
  }

  private async shutdown(): Promise<void> {
    if (!this.core) return;
    if (this.sessionId) await this.core.stop(this.sessionId).catch(() => {});
    await this.core.dispose('Neuramesh relay channel closed').catch(() => {});
    this.core = null;
  }
}
