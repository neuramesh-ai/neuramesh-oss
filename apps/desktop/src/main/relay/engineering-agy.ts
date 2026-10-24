// the Gemini sign-in lane for a coding thread (docs/design/gemini-code-lane-2026-10/plan.md). agy runs
// each turn with its own read and edit tools, and reaches NeuraMesh's managed shell, gated edits and
// its plan, title and display tools over the loopback MCP bridge. it takes the same commands and emits
// the same events as ClineChannelSession, so the host, the record and every client treat both alike.
// a model change belongs to the lane wrapper (engineering-lanes.ts), which can hand the thread over.
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { engineeringEffort, recoverEngineeringPlanProgress, recoverRecordedEngineeringPlan, type EngineeringAgent, type EngineeringPlanProgress, type PolicyRule } from '@neuramesh/shared';
import { isEngineeringCommand, type EngineeringCommand, type EngineeringControls, type EngineeringMachineOpenMeta, type EngineeringRuntimeEvent } from '../../engineering-protocol';
import { agentBaseEnv } from '../runtime/adapter';
import type { BridgeTool } from '../runtime/orchmcp';
import { agyArgs, agyModeFor, agyModelFor, nmToolsMissed } from './engineering-agy-args';
import { AgyDriver } from './engineering-agy-driver';
import { AgyEventMapper, type AgyInit } from './engineering-agy-events';
import type { AgySpawn } from './engineering-agy-process';
import { agyFirstTurn, agyNextTurn, agyToolRules } from './engineering-agy-prompt';
import { agyBridgeTools, type AgyLaneTool } from './engineering-agy-tools';
import { EngineeringAttachmentQueue } from './engineering-attachment-queue';
import { EngineeringAttachmentInbox } from './engineering-attachments';
import { createEngineeringChangeRefresh } from './engineering-changes';
import type { EngineeringConversation } from './engineering-conversation';
import type { EngineeringDisplayTool } from './engineering-display';
import { engineeringPlanTool, engineeringProgressTool } from './engineering-plan';
import type { EngineeringProviderResolution } from './engineering-provider';
import { engineeringTitleTool } from './engineering-title';
import { EngineeringPromptQueue } from './engineering-turn';

export interface AgyLaneDeps {
  /** the agy binary (runtime/cli.ts ensureCli), with any argv that goes first (a test's fake agy script) */
  bin(): Promise<{ path: string; lead?: string[] }>;
  /** the loopback bridge's URL, with the nm shim present in agy's MCP config */
  bridge(): Promise<string>;
  register(turn: string, secret: string, tools: BridgeTool[]): void;
  unregister(turn: string): void;
  /** Cline's managed shell, web, editor and patch tools over this thread's executors */
  managedTools(nativeEdits: boolean): AgyLaneTool[];
  spawn?: AgySpawn;
}

const TOOLS_BLOCKED = 'Gemini could not reach the NeuraMesh tools on this machine, so it cannot run commands here. On a business Google account, the admin must allow the nm MCP server.';
const PLAN_TOOLS = new Set(['propose_work_plan', 'update_plan_progress']);

export class AgyChannelSession {
  private controls: EngineeringControls;
  private readonly pending = new Map<string, (approved: boolean) => void>();
  private readonly ours = new Set<string>();
  private readonly driver: AgyDriver;
  private readonly promptQueue = new EngineeringPromptQueue();
  private readonly attachments: EngineeringAttachmentInbox;
  private readonly attachmentQueue = new EngineeringAttachmentQueue();
  private readonly refreshChanges: () => void;
  private readonly bridgeTurn = randomUUID();
  private readonly bridgeSecret = randomUUID();
  private messages: unknown[] = [];
  private conversationId: string | null = null;
  private sentRules: string | null = null;
  private running = false; private aborting = false; private closed = false; private warned = false; private nmCalled = false;
  private closing: Promise<unknown[]> | null = null;
  private totals = { inputTokens: 0, outputTokens: 0 };

  constructor(
    private readonly meta: EngineeringMachineOpenMeta,
    private readonly cwd: string,
    readonly provider: EngineeringProviderResolution,
    private readonly modelId: string | null,
    private readonly brainPack: string | null,
    private readonly policyRules: PolicyRule[],
    private readonly emit: (event: EngineeringRuntimeEvent) => void,
    private readonly deps: AgyLaneDeps,
    private readonly log: (line: string) => void,
    private readonly conversation?: EngineeringConversation,
    private readonly setThreadTitle?: (title: string) => Promise<unknown>,
    private readonly displayTools?: (agent?: EngineeringAgent) => EngineeringDisplayTool[],
  ) {
    this.controls = { mode: meta.mode, permissions: { ...meta.permissions }, policy: { read: true, edit: true, command: true, web: true, mcp: true } };
    this.attachments = new EngineeringAttachmentInbox(meta.actorId, meta.threadId);
    this.refreshChanges = createEngineeringChangeRefresh(cwd, (changes) => this.emit({ type: 'changes', changes }),
      (error) => this.log(`engineering_diff_failed repo=${meta.repoId}: ${error instanceof Error ? error.message : String(error)}`));
    this.driver = new AgyDriver({ cwd, mapper: new AgyEventMapper(this.ours), emit: (event) => this.forward(event), onEdited: () => this.refreshChanges(), log, ...(deps.spawn ? { spawn: deps.spawn } : {}) });
  }

  async init(messages?: readonly unknown[]): Promise<void> {
    this.messages = [...(messages ?? [])];
    const saved = this.conversation?.brain.metadata()?.['agyConversation'];
    this.conversationId = typeof saved === 'string' ? saved : null;
    this.emit({ type: 'plan_progress', progress: this.planProgress() });
    this.emit({ type: 'ready', provider: this.provider.providerId, model: this.provider.modelId, cwd: this.cwd, modelId: this.modelId, brainPack: this.brainPack, agent: this.provider.agent, reasoningEffort: engineeringEffort(this.modelId, this.meta.reasoningEffort), ...(this.conversation ? { recordedRevision: this.conversation.brain.revision() } : {}) });
  }

  get busy(): boolean { return !this.closed && (this.running || this.pending.size > 0 || this.promptQueue.queued); }

  command(value: unknown): void {
    if (!isEngineeringCommand(value)) return this.emit({ type: 'error', code: 'INVALID_COMMAND', message: 'The Engineering command was invalid.' });
    if (value.type === 'attachment_start') return this.queueAttachment(value.id, -1, 256, () => this.attachments.start(value.id, value.name, value.mime, value.size));
    if (value.type === 'attachment_chunk') return this.queueAttachment(value.id, value.index, Buffer.byteLength(value.data), () => this.attachments.chunk(value.id, value.index, value.data));
    if (value.type === 'attachment_end') return this.queueAttachment(value.id, -2, 128, () => this.attachments.end(value.id));
    if (value.type === 'controls') {
      if (this.busy) return this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'Plan/Act and permissions can be changed after the current turn finishes.' });
      this.controls = { mode: value.controls.mode, permissions: { ...value.controls.permissions }, policy: { ...this.controls.policy } };
      return;
    }
    if (value.type === 'approval') {
      const resolve = this.pending.get(value.approvalId);
      if (!resolve) return this.emit({ type: 'error', code: 'APPROVAL_GONE', recoverable: true, message: 'That approval is no longer pending.' });
      this.pending.delete(value.approvalId);
      this.conversation?.record('approval.resolved', { approvalId: value.approvalId, approved: value.approved });
      resolve(value.approved);
      return this.emit({ type: 'approval_resolved', approvalId: value.approvalId, approved: value.approved });
    }
    if (value.type === 'abort') { void this.abort(); return; }
    if (value.type === 'restore') return this.emit({ type: 'error', code: 'RESTORE_UNAVAILABLE', recoverable: true, message: 'Checkpoints are not available while Gemini runs on a Google sign-in.' });
    if (value.type === 'configure' || value.type === 'model' || value.type === 'brain') return this.emit({ type: 'error', code: 'MODEL_CHANGE_UNAVAILABLE', recoverable: true, message: 'Reopen this thread to change its model.' });
    if (value.type !== 'prompt' || this.closed) return;
    if (this.busy) return this.emit({ type: 'error', code: 'TURN_RUNNING', recoverable: true, message: 'A turn is already running in this thread.' });
    void this.promptQueue.run(() => this.runPrompt(value)).catch((error: unknown) => this.fail(error));
  }

  /** end the lane: agy exits, the journal seals. `keepJournal` hands the thread to another lane */
  close(keepJournal = false): Promise<unknown[]> {
    if (this.closing) return this.closing;
    this.closed = true;
    for (const resolve of this.pending.values()) resolve(false);
    this.pending.clear();
    void this.attachmentQueue.close().finally(() => this.attachments.close());
    this.deps.unregister(this.bridgeTurn);
    return this.closing = (async () => {
      await this.driver.close();
      await this.checkpoint();
      if (!keepJournal) await this.conversation?.close().catch((error: unknown) => this.log(`brain_close_pending: ${error instanceof Error ? error.message : String(error)}`));
      return this.messages;
    })();
  }

  async flush(): Promise<void> {
    if (this.running) throw new Error('Wait for this turn to finish before its cloud checkpoint.');
    await this.checkpoint();
    await this.conversation?.flush();
  }

  private async runPrompt(command: Extract<EngineeringCommand, { type: 'prompt' }>): Promise<void> {
    if (this.closed) return;
    this.running = true; this.aborting = false;
    this.emit({ type: 'status', status: 'running' });
    let resolved = false;
    try {
      await this.attachmentQueue.wait();
      if (this.closed) return;
      const attached = await this.attachments.resolve(command.attachments);
      resolved = true;
      this.conversation?.record('user.message', { ...this.metadata(), text: command.prompt, attachments: command.attachments ?? [], model: this.provider.modelId, provider: this.provider.providerId });
      const { init, rules } = await this.start();
      const fresh = init.conversationId !== this.conversationId;
      this.conversationId = init.conversationId;
      const files = [...attached.userImages, ...attached.userFiles];
      const text = fresh
        ? agyFirstTurn({ provider: this.provider, rules, history: this.messages, prompt: command.prompt, attachments: files })
        : agyNextTurn({ rules: rules === this.sentRules ? null : rules, prompt: command.prompt, attachments: files });
      this.sentRules = rules;
      let result = await this.driver.run(text);
      // headless agy ends a turn with no reply when a refused step was its last move: ask once more without it
      if (!result.response.trim() && result.denied.length) result = await this.driver.run(`This machine refused your last ${result.denied.join(', ')} call. Do not repeat that call. Finish my last request with the tools that work here, or answer in text.`);
      if (!this.warned && !this.nmCalled && nmToolsMissed(result.denied)) {
        // agy offers MCP tools only through call_mcp_tool, so a refusal with no nm call yet is the first sign they are missing
        this.warned = true;
        this.log(`agy_nm_tools_missed thread=${this.meta.threadId} denied=${result.denied.join(',')}`);
        this.emit({ type: 'agent_event', event: { type: 'agent_event', payload: { sessionId: result.conversationId, event: { type: 'notice', noticeType: 'status', message: TOOLS_BLOCKED, displayRole: 'system' } } } });
      }
      this.totals = { inputTokens: this.totals.inputTokens + result.inputTokens, outputTokens: this.totals.outputTokens + result.outputTokens };
      this.emit({ type: 'usage', ...this.totals });
      this.conversation?.record('assistant.message', { text: result.response, provider: this.provider.providerId, model: this.provider.modelId });
      this.messages.push({ role: 'user', content: [{ type: 'text', text: command.prompt }] }, { role: 'assistant', content: [{ type: 'text', text: result.response.trim() || '[no text reply]' }] });
      this.emit({ type: 'ended', reason: result.ok ? 'completed' : 'error' });
    } catch (error) {
      if (this.aborting) this.emit({ type: 'ended', reason: 'aborted' }); else this.fail(error);
    } finally {
      if (resolved) this.attachments.release(command.attachments);
      this.running = false;
      // the seal runs behind the conversation's own boundary, so the next turn and a flush wait for it
      void this.checkpoint();
      if (!this.closed) this.emit({ type: 'status', status: 'idle' });
    }
  }

  /** the agy process for this turn's mode, with this turn's tools on the bridge */
  private async start(): Promise<{ init: AgyInit; rules: string }> {
    const mode = agyModeFor(this.controls);
    const tools = this.laneTools(mode === 'accept-edits');
    this.ours.clear();
    for (const tool of tools) this.ours.add(tool.name);
    const url = await this.deps.bridge();
    this.deps.register(this.bridgeTurn, this.bridgeSecret, agyBridgeTools({
      tools, threadId: this.meta.threadId, controls: () => this.controls, policyRules: this.policyRules, pending: this.pending, emit: this.emit,
      record: (type, payload) => this.conversation?.record(type, payload), cwd: this.cwd, isActive: () => !this.closed, onCall: () => { this.nmCalled = true; },
      onResult: (name, toolCallId, output) => { if (PLAN_TOOLS.has(name)) this.conversation?.event({ type: 'agent_event', payload: { sessionId: this.meta.threadId, event: { type: 'content_end', contentType: 'tool', toolName: name, toolCallId, output } } } as never); },
    }));
    const bin = await this.deps.bin();
    // agy refuses an --add-dir it cannot find, and a lane swap can race the old inbox's cleanup of this folder
    mkdirSync(this.attachments.folder, { recursive: true });
    const model = agyModelFor(this.modelId ?? this.provider.modelId, this.meta.reasoningEffort);
    const args = [...(bin.lead ?? []), ...agyArgs({ model, mode, conversationId: this.conversationId, addDirs: [this.attachments.folder] })];
    const key = JSON.stringify({ model, mode, tools: [...this.ours].sort() });
    const init = await this.driver.ensure(key, bin.path, args, { ...agentBaseEnv(), NM_ORCH_URL: url, NM_ORCH_TURN: this.bridgeTurn, NM_ORCH_SECRET: this.bridgeSecret });
    return { init, rules: agyToolRules({ mode: this.controls.mode, nativeEdits: mode === 'accept-edits', nmTools: true }) };
  }

  private laneTools(nativeEdits: boolean): AgyLaneTool[] {
    const plan = this.controls.mode === 'plan' ? engineeringPlanTool(this.emit) : engineeringProgressTool(this.emit, async () => this.messages, async () => this.planProgress());
    const own = [...(this.displayTools?.(this.provider.agent) ?? []), ...(this.setThreadTitle ? [engineeringTitleTool(this.setThreadTitle)] : []), plan];
    return [...this.deps.managedTools(nativeEdits), ...own.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema as Record<string, unknown>, execute: async (input: unknown) => tool.execute(input) }))];
  }

  private forward(event: EngineeringRuntimeEvent): void {
    if (this.closed) return;
    if (event.type === 'agent_event') this.conversation?.event(event.event as never);
    this.emit(event);
  }

  private planProgress(): EngineeringPlanProgress | null {
    return this.conversation
      ? recoverRecordedEngineeringPlan({ events: [...this.conversation.brain.events()], runtimeMessages: this.messages as never, metadata: this.conversation.brain.metadata() })
      : recoverEngineeringPlanProgress(this.messages);
  }

  private queueAttachment(id: string, index: number, bytes: number, task: () => void | Promise<void>): void {
    if (this.closed) return;
    const queued = this.attachmentQueue.push(bytes, task, () => this.emit({ type: 'attachment_ack', id, index }), (error) => this.emit({ type: 'error', code: 'INVALID_ATTACHMENT', recoverable: true, message: error instanceof Error ? error.message : 'The attachment was invalid.' }));
    if (!queued) { this.emit({ type: 'error', code: 'ENGINEERING_PROTOCOL_LIMIT', message: 'The Engineering attachment queue exceeded its safe limit.' }); void this.close(); }
  }

  private async abort(): Promise<void> {
    if (!this.running) return;
    this.aborting = true;
    for (const resolve of this.pending.values()) resolve(false);
    this.pending.clear();
    await this.driver.stop();
  }

  private checkpoint(): Promise<void> {
    return this.conversation?.checkpointMessages(this.messages as never, this.metadata())
      .catch((error: unknown) => this.log(`brain_checkpoint_pending: ${error instanceof Error ? error.message : String(error)}`)) ?? Promise.resolve();
  }

  private metadata = (): Record<string, unknown> => ({
    selection: { agentId: this.provider.agent?.id ?? this.meta.agentId ?? null, modelId: this.modelId, reasoningEffort: engineeringEffort(this.modelId, this.meta.reasoningEffort) },
    agent: this.provider.agent, provider: this.provider.providerId, model: this.provider.modelId, repoId: this.meta.repoId, mode: this.controls.mode,
    agyConversation: this.conversationId, completeness: 'agy-turns',
  });

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.log(`agy_failed repo=${this.meta.repoId}: ${message}`);
    this.emit({ type: 'error', message, recoverable: true });
  }
}
