import { CodingFollowups } from './engineering-followups';
import type { EngineeringDisplayTool } from './engineering-display';
import { checkpointEngineering, shutdownEngineering } from './engineering-checkpoint';
import { EngineeringPromptQueue, forwardEngineeringUsage, currentCodingPlan } from './engineering-turn';
import type { ClineCore, CoreSessionEvent, ToolExecutors } from '@cline/sdk';
import { isEngineeringCommand, type EngineeringCommand, type EngineeringControls, type EngineeringMachineOpenMeta, type EngineeringRuntimeEvent } from '../../engineering-protocol';
import { engineeringEffort, type EngineeringAgent, type EngineeringSelection, type PolicyRule } from '@neuramesh/shared';
import { requestEngineeringApproval } from './engineering-approvals';
import { createEngineeringChangeRefresh } from './engineering-changes';
import { forwardCodingEvent } from './engineering-events';
import type { EngineeringProviderResolution } from './engineering-provider';
import { engineeringRuntimeInput, readRuntimeMessages } from './engineering-runtime-input';
import { restoreEngineeringSession } from './engineering-restore';
import { EngineeringAttachmentInbox } from './engineering-attachments';
import { EngineeringAttachmentQueue, queueEngineeringAttachment } from './engineering-attachment-queue';
import type { EngineeringConversation } from './engineering-conversation';
import { engineeringCoreOptions } from './engineering-core';
import { previewEngineeringChanges } from './engineering-preview';
import { parks, type Park, type ParkResolution } from '../cloudrun/parks';
import { codeParkFor, codeParkResumePrompt, offeredApproval } from './engineering-park-resume';
import { manualEngineeringCompact, portableEngineeringCompaction, restoreEngineeringHistory } from './engineering-compaction';

export class ClineChannelSession {
  private controls: EngineeringControls; private provider: EngineeringProviderResolution;
  private modelId: string | null; private brainPack: string | null;
  private core: ClineCore | null = null; private sessionId: string | null = null;
  /** The native tool registry is built at session start, so a mode change resumes in a new session. */
  private sessionMode: EngineeringControls['mode'] | null = null;
  private resumeMessages: Awaited<ReturnType<ClineCore['readMessages']>> | undefined;
  private compactionState: unknown;
  private closing: Promise<void> | null = null; private closed = false; private running = false; private readonly pending = new Map<string, (approved: boolean) => void>();
  private readonly retiredSessions = new Set<string>(); private readonly promptQueue = new EngineeringPromptQueue();
  private readonly attachments: EngineeringAttachmentInbox; private readonly attachmentQueue = new EngineeringAttachmentQueue();
  private readonly refreshChanges: () => void;
  /** CLOUD RUN (engineering-park-resume.ts): open parks of this thread shown again as approval cards,
   *  the parks a continuation turn already took, and what runs when that turn settles */
  private readonly offers = new Map<string, Park>(); private readonly continued = new Set<string>();
  private settleHooks: Array<() => void> = [];

  private readonly followups = new CodingFollowups();
  private liveCoreId?: string;

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
    private readonly displayTools?: (agent?: EngineeringAgent) => EngineeringDisplayTool[] | Promise<EngineeringDisplayTool[]>,
    private readonly permissionGate?: import('../thread-permission-gate').ThreadPermissionGate,
  ) {
    this.provider = provider;
    this.modelId = modelId;
    this.brainPack = brainPack;
    this.controls = { mode: meta.mode, permissions: { ...meta.permissions }, policy: { read: true, edit: true, command: true, web: true, mcp: true } };
    this.attachments = new EngineeringAttachmentInbox(meta.actorId, meta.threadId);
    this.refreshChanges = createEngineeringChangeRefresh(this.cwd, (changes) => this.emit({ type: 'changes', changes }),
      (error) => this.log(`engineering_diff_failed repo=${this.meta.repoId}: ${error instanceof Error ? error.message : String(error)}`));
  }
  async init(messages?: Awaited<ReturnType<ClineCore['readMessages']>>, allowFollowups = true): Promise<void> {
    this.conversation?.excludeSecret(this.provider.apiKey);
    this.core = await this.createRuntimeCore(this.provider);
    const restored = await restoreEngineeringHistory(this.core, this.meta, messages, this.conversation?.brain.metadata()?.['compactionState']);
    if (allowFollowups) this.followups.listen(this.meta.threadId, {
      core: () => this.closed ? null : this.core,
      busy: () => this.busy, refuse: () => this.refusal, mode: () => this.controls.mode,
      session: () => this.sessionId ?? this.liveCoreId ?? null,
      resolveFiles: async refs => { await this.attachmentQueue.wait(); return this.attachments.resolve(refs); },
      releaseFiles: refs => this.attachments.release(refs),
      start: (prompt, attachments) => this.promptQueue.run(() => this.runPrompt({type:'prompt', prompt, attachments})),
      interruptApproval: () => this.pending.forEach((_, approvalId) => this.command({type:'approval', approvalId, approved:false})),
      received: (id, text, attachments, steer) => {
        this.conversation?.record('user.message', {text, attachments, permissions:this.controls.permissions, ...this.runtimeMetadata(), followupId:id, delivery:steer ? 'steer' : 'queue'});
        this.emit({type:'followup_received', id, text, attachments});
      },
    });
    this.resumeMessages = restored.messages; this.compactionState = restored.state;
    this.emit({ type: 'plan_progress', progress: await this.readPlanProgress() });
    this.emit({ type: 'ready', provider: this.provider.providerId, model: this.provider.modelId, cwd: this.cwd, modelId: this.modelId, brainPack: this.brainPack, agent: this.provider.agent, reasoningEffort: engineeringEffort(this.modelId, this.meta.reasoningEffort), ...(this.conversation ? { recordedRevision: this.conversation.brain.revision() } : {}) }); if (this.refusal) this.emit({ type: 'error', code: 'MODEL_REFUSED', recoverable: true, message: this.refusal });
    void this.offerParked().catch((error: unknown) => this.log(`engineering_park_offer_failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  private readPlanMessages = async (): Promise<unknown> => this.core && this.sessionId ? readRuntimeMessages(this.core, this.sessionId) : this.resumeMessages;
  private readPlanProgress = async () => currentCodingPlan(await this.readPlanMessages(), this.conversation);

  private async createRuntimeCore(provider: EngineeringProviderResolution): Promise<ClineCore> {
    const core = await this.createCore(engineeringCoreOptions(provider, this.meta.threadId,
      { ...(this.toolExecutors ? { toolExecutors: this.toolExecutors } : {}),
        requestToolApproval: (request) => requestEngineeringApproval(request, this.controls, this.policyRules, this.pending, this.emit, (type, payload) => this.conversation?.record(type, payload), this.cwd, () => !this.closed, this.permissionGate, { threadId: this.meta.threadId, repoId: this.meta.repoId, actorId: this.meta.actorId, openMeta: { ...this.meta, mode: this.controls.mode, permissions: { ...this.controls.permissions } } }) },
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
    if (value.type === 'model') { void this.switchModel(value.modelId, null).catch((error: unknown) => this.fail(error)); return; }
    if (value.type === 'brain') { void this.switchModel(null, value.brainPack).catch((error: unknown) => this.fail(error)); return; }
    if (value.type === 'approval') {
      const offered = this.offers.get(value.approvalId);
      if (offered) { this.offers.delete(value.approvalId); void this.answerOffered(offered, value.approvalId, value.approved).catch((error: unknown) => this.fail(error)); return; }
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
    if (value.type !== 'prompt' || this.closed || !this.core) return;
    if (this.running || this.pending.size > 0 || this.promptQueue.queued) return this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'A turn is already running in this thread.' });
    void this.promptQueue.run(() => this.runPrompt(value)).catch((error: unknown) => this.fail(error));
  }

  get busy(): boolean { return !this.closed && (this.running || this.pending.size > 0 || this.promptQueue.queued); }
  /** a turn is running and waits on nobody: work for the activity meter. A turn held on an approval is
   *  not, because on Cloud Run that approval is a durable park and must not keep the machine awake */
  get working(): boolean { return !this.closed && (this.running || this.promptQueue.queued) && this.pending.size === 0; }

  /** CLOUD RUN (engineering-park-resume.ts): a parked approval of this thread was answered, and this epoch
   *  holds the claim. One continuation turn tells the model the outcome. An approval's re-issued call finds
   *  the claim (engineering-approvals.ts) and runs without a second card. A denial is done at once. When
   *  the turn settles the park is done, so no later epoch replays it. A close before that (a drain) leaves
   *  the claim, and the next epoch claims it again. false = this session cannot take it now. */
  continueParked(park: Park, onSettled?: () => void): boolean {
    const reg = parks();
    if (!reg || !park.resolution || this.closed || !this.core || this.busy) return false;
    if (this.continued.has(park.id)) return true;
    this.continued.add(park.id);
    const resolution = park.resolution;
    for (const [id, offered] of this.offers) {
      if (offered.id !== park.id) continue;
      this.offers.delete(id);
      this.emit({ type: 'approval_resolved', approvalId: id, approved: resolution.approved });
    }
    const consume = (): void => { const held = reg.held(park.key); if (held) void reg.consume(held).catch(() => {}); };
    if (!resolution.approved) consume();
    this.conversation?.record('approval.parked_answer', { parkId: park.id, toolName: park.request['toolName'] ?? null, approved: resolution.approved, reason: resolution.reason ?? null });
    this.settleHooks.push(() => { consume(); onSettled?.(); });
    this.command({ type: 'prompt', prompt: codeParkResumePrompt(park) });
    return true;
  }

  /** CLOUD RUN: an approval this thread parked (a closed tab, a drain) shows again as its card, so the
   *  person can answer it in the tab. One at a time, the newest first. */
  private async offerParked(): Promise<void> {
    const reg = parks();
    if (!reg || this.closed) return;
    await reg.refreshOpen().catch(() => {});
    const offeredIds = new Set([...this.offers.values()].map((p) => p.id));
    const park = reg.openList().find((p) => codeParkFor(p, this.meta) && !this.continued.has(p.id) && !offeredIds.has(p.id));
    if (!park || this.closed) return;
    const card = offeredApproval(park);
    const changes = card.category === 'edit' && card.input && typeof card.input === 'object'
      ? await previewEngineeringChanges(this.cwd, card.toolName, card.input).catch(() => []) : [];
    if (this.closed) return;
    this.offers.set(card.approvalId, park);
    this.emit({ type: 'approval', ...card, ...(changes.length ? { changes } : {}) });
  }

  /** the person answered an offered park in the tab: resolve it through the machine route (no wake, this
   *  machine is awake), claim it for this epoch, and continue */
  private async answerOffered(park: Park, approvalId: string, approved: boolean): Promise<void> {
    const reg = parks();
    if (!reg) return;
    const resolution: ParkResolution = { answer: approved ? 'Approve' : 'Deny', approved, source: 'machine' };
    this.conversation?.record('approval.resolved', { approvalId, approved, source: 'park', parkId: park.id });
    this.emit({ type: 'approval_resolved', approvalId, approved });
    // an answer that already came another way (POST /v1/parks/:id/resolve) wins: the claim below reads it
    await reg.relay(park, resolution).catch(() => {});
    const prior = await reg.prior(park.key);
    if (!prior || !('resolution' in prior)) {
      this.emit({ type: 'error', code: 'APPROVAL_GONE', recoverable: true, message: 'That approval was already settled.' });
      return;
    }
    const claimed = prior.park;
    if (!this.continueParked(claimed)) {
      // a turn the person started meanwhile: the answer is claimed, and it continues once that turn settles
      this.settleHooks.push(() => { const t = setTimeout(() => { this.continueParked(claimed); }, 0); t.unref?.(); });
      this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'The answer is saved. It applies when the current turn finishes.' });
    }
    void this.offerParked().catch(() => {});
  }

  /** the turn a continuation started has settled (or failed): its hooks run once */
  private settle(): void { for (const hook of this.settleHooks.splice(0)) { try { hook(); } catch { /* a hook never breaks the session */ } } }

  close(keepJournal = false): Promise<void> {
    if (this.closing) return this.closing; this.closed = true; this.followups.close();
    // a turn cut by a close did not settle: its park stays claimed, and the next epoch takes it again
    this.settleHooks = [];
    for (const resolve of this.pending.values()) resolve(false); this.pending.clear();
    const attachmentsDrained = this.attachmentQueue.close(); void attachmentsDrained.finally(() => this.attachments.close());
    this.closeTools?.();
    return this.closing = shutdownEngineering(this.core, this.sessionId, this.conversation, this.runtimeMetadata(), this.log, keepJournal).finally(() => { this.core = null; });
  }

  async flush(): Promise<void> {
    if (this.running) throw new Error('Wait for this turn to finish before its cloud checkpoint.');
    if (this.core && this.sessionId) await this.conversation?.checkpoint(this.core, this.sessionId, this.runtimeMetadata());
    await this.conversation?.flush();
  }

  private async runPrompt(command: Extract<EngineeringCommand, { type: 'prompt' }>): Promise<void> {
    if (this.closed || !this.core) return;
    // a refused model runs nothing: the reason again, and idle, so the thread's row stops at once
    if (this.refusal) { this.emit({ type: 'error', code: 'MODEL_REFUSED', recoverable: true, message: this.refusal }); this.emit({ type: 'status', status: 'idle' }); this.settle(); return; }
    if (this.running || this.pending.size > 0 || this.promptQueue.queued) return this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'Engineering is already working on this thread.' });
    if (command.prompt.trim() === '/compact') return manualEngineeringCompact({ command, threadId: this.meta.threadId, provider: this.provider.providerId, model: this.provider.modelId,
      conversation: this.conversation, metadata: this.runtimeMetadata, emit: this.emit, running: value => { this.running = value; },
      read: async () => ({ messages: this.sessionId ? await readRuntimeMessages(this.core!, this.sessionId) : this.resumeMessages ?? [], state: this.sessionId ? await this.core!.readSessionCompactionState?.(this.sessionId) : this.compactionState }),
      replace: async (messages, state) => {
        if (this.sessionId) { this.retiredSessions.add(this.sessionId); await this.core!.stop(this.sessionId); }
        this.sessionId = null; this.liveCoreId = undefined; this.sessionMode = null; this.compactionState = state; this.resumeMessages = messages;
      },
    });
    this.running = true;
    this.emit({ type: 'status', status: 'running' });
    let attachmentsResolved = false; try {
      await this.attachmentQueue.wait();
      if (this.closed) return;
      const attached = await this.attachments.resolve(command.attachments);
      attachmentsResolved = true;
      this.conversation?.record('user.message', { permissions: { ...this.controls.permissions }, ...this.runtimeMetadata(), text: command.prompt, attachments: command.attachments ?? [], model: this.provider.modelId, provider: this.provider.providerId });
      if (this.sessionId && this.sessionMode !== this.controls.mode) {
        const previous = this.sessionId;
        this.resumeMessages = await readRuntimeMessages(this.core, previous).catch(() => undefined);
        this.compactionState = await this.core.readSessionCompactionState?.(previous);
        this.retiredSessions.add(previous);
        await this.core.stop(previous).catch(() => {});
        this.sessionId = null;
        this.sessionMode = null;
      }
      if (!this.sessionId) {
        const startedMode = this.controls.mode;
        const initialCompactionState = await portableEngineeringCompaction(this.resumeMessages ?? [], this.compactionState, this.provider.providerId, this.provider.modelId);
        const started = await this.core.start(engineeringRuntimeInput({ displayTools: await this.displayTools?.(this.provider.agent), setThreadTitle: this.setThreadTitle, emit: this.emit, readPlanMessages: this.readPlanMessages, readPlanProgress: this.readPlanProgress, meta: this.meta, cwd: this.cwd, provider: this.provider, modelId: this.modelId, brainPack: this.brainPack, controls: this.controls, prompt: command.prompt, initialMessages: this.resumeMessages, initialCompactionState, ...attached }));
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
    if (!this.closed) queueEngineeringAttachment(this.attachmentQueue, { id, index, bytes, task, emit: this.emit, close: () => { void this.close(); } });
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
        this.compactionState = await previousCore.readSessionCompactionState?.(previousSessionId);
        await this.conversation?.checkpoint(previousCore, previousSessionId, this.runtimeMetadata());
      }
      await this.conversation?.flush();
      const nextCore = await this.createRuntimeCore(nextProvider);
      if (previousCore && previousSessionId) { this.retiredSessions.add(previousSessionId); await previousCore.stop(previousSessionId).catch(() => {}); }
      this.conversation?.excludeSecret(nextProvider.apiKey);
      this.conversation?.record('model.change', { from: this.provider.modelId, to: nextProvider.modelId, provider: nextProvider.providerId });
      this.core = nextCore;
      this.provider = nextProvider; this.refusal = null;
      this.modelId = modelId; this.brainPack = brainPack;
      if (selection) { this.meta.agentId = selection.agentId; this.meta.reasoningEffort = engineeringEffort(modelId, selection.reasoningEffort); }
      this.sessionId = null; this.liveCoreId = undefined; this.sessionMode = null; this.resumeMessages = messages;
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
    if ('sessionId' in event.payload && typeof event.payload.sessionId === 'string') this.liveCoreId = event.payload.sessionId;
    this.followups.observe(event);
    this.conversation?.event(event);
    forwardEngineeringUsage(event, this.emit);
    forwardCodingEvent(event, this.emit, value => { this.running=value; }, id => this.checkpoint(id), this.refreshChanges);
    // a turn that ended runs its continuation hooks (continueParked) once, after its `ended` or idle went out
    const settled = event.type === 'ended' || event.type === 'status' || (event.type === 'agent_event' && event.payload.event.type === 'done');
    if (settled && !this.running) this.settle();
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
    this.settle();
  }

  private async abort(): Promise<void> {
    if (this.core && this.sessionId) await this.core.abort(this.sessionId, 'Neuramesh user abort').catch(() => {});
    this.running = false;
  }

  private async restore(checkpointRunCount: number): Promise<void> {
    return restoreEngineeringSession({ core: this.core, sessionId: this.sessionId, busy: this.running || this.pending.size > 0, checkpointRunCount, cwd: this.cwd,
      start: engineeringRuntimeInput({ displayTools: await this.displayTools?.(this.provider.agent), setThreadTitle: this.setThreadTitle, emit: this.emit, readPlanMessages: this.readPlanMessages, readPlanProgress: this.readPlanProgress, meta: this.meta, cwd: this.cwd, provider: this.provider, modelId: this.modelId, brainPack: this.brainPack, controls: this.controls }),
      conversation: this.conversation, metadata: this.runtimeMetadata, running: value => { this.running = value; }, emit: this.emit, refresh: this.refreshChanges, closed: () => this.closed,
      apply: sessionId => { this.resumeMessages = undefined; this.compactionState = undefined; this.sessionId = sessionId; this.sessionMode = this.controls.mode; },
    });
  }

}
