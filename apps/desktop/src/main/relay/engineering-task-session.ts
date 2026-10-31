import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt, createEngineeringSession, restoreEngineeringBrain, type BrainThreadSnapshot, type EngineeringSession } from '@neuramesh/shared';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringMachineSession } from './engineering-host';

/** The task owns execution; a pane only subscribes. Closing it never cancels the task. */
export class EngineeringTaskSession {
  private listeners = new Set<(event: EngineeringRuntimeEvent) => void>();
  private session: EngineeringMachineSession | null = null;
  private ready: Extract<EngineeringRuntimeEvent, {type:'ready'}> | null = null;
  private state: EngineeringSession;
  private failure: Error | null = null;
  private started = false;
  private finished = false;
  private activeMs = 0;
  private activeSince: number | null = null;
  private waiters = new Set<() => void>();

  constructor(readonly meta: EngineeringMachineOpenMeta, private readonly progress: (state: EngineeringSession) => void = () => {}) {
    this.state = { ...createEngineeringSession({id:meta.repoId,name:meta.repoName,owner:'',branch:meta.branch,root:null}),
      id:meta.threadId, mode:meta.mode, permissions:meta.permissions, policy:meta.policy, messages:[],
      modelOverride:meta.modelId ?? null, agentId:meta.agentId ?? null, reasoningEffort:meta.reasoningEffort ?? null };
  }
  restore(snapshot: BrainThreadSnapshot) {
    // History is portable; the dispatcher owns this pass's mode and specialist.
    this.state = { ...restoreEngineeringBrain(this.state, snapshot), mode:this.meta.mode,
      agentId:this.meta.agentId ?? null, modelOverride:this.meta.modelId ?? null,
      reasoningEffort:this.meta.reasoningEffort ?? null, pendingModeHandoff:null };
  }
  bind(session: EngineeringMachineSession) { this.session = session; }
  emit = (event: EngineeringRuntimeEvent) => {
    if (event.type === 'ready') this.ready = event;
    // Human review time is not execution time. Account at event boundaries so even
    // several approval transitions between run-loop polls preserve the same budget.
    if (this.activeSince !== null) this.activeMs += Date.now() - this.activeSince;
    this.state = applyRemoteEngineeringEvent(this.state, event);
    this.activeSince = this.started && !this.finished && !this.state.pendingApproval ? Date.now() : null;
    if (event.type === 'error' && !event.recoverable) this.failure = new Error(event.message);
    this.progress(this.state);
    for (const listener of this.listeners) listener(event);
    for (const wake of this.waiters) wake();
  };
  private command(value: unknown) {
    if (!this.session) throw new Error('The coding task is still opening.');
    const command = value as {type?: string; prompt?: string};
    if (command.type === 'prompt' && this.finished) {
      this.emit({type:'error',recoverable:true,message:'Implementation is being submitted for review. Request changes on the task to start another implementation pass.'}); return;
    }
    if (command.type === 'prompt' && command.prompt) this.state = beginRemoteEngineeringPrompt(this.state, command.prompt);
    this.session.command(value);
  }
  attach(emit: (event: EngineeringRuntimeEvent) => void): EngineeringMachineSession {
    // The live snapshot supersedes the initial cloud restore, including pending approvals.
    // Do not ask restore-connection to race a second cloud read over this snapshot.
    if (this.ready) emit({...this.ready,recordedRevision:undefined});
    emit({type:'task_state',session:this.state});
    this.listeners.add(emit);
    return {command:value=>{
      const command = value as {type?:string;controls?:{mode?:string}};
      if (!['approval','abort','preview_file','controls'].includes(command.type ?? '') || (command.type === 'controls' && command.controls?.mode && command.controls.mode !== this.meta.mode)) {
        emit({type:'error',recoverable:true,message:'This task keeps its assigned agent and approval flow. Approve or revise its plan on the task to start the next pass.'}); return;
      }
      this.command(value);
    },close:()=>{this.listeners.delete(emit);},get busy(){return false;}};
  }
  async run(prompt: string, stopped: () => boolean, timeoutMs = 30 * 60_000): Promise<string> {
    if (this.started) throw new Error('The coding task was already started.');
    this.started = true;
    const previousPlan = this.state.planProgress?.id;
    const previousMessages = new Set(this.state.messages.map(message => message.id));
    this.activeSince = Date.now();
    this.command({type:'prompt',prompt});
    // beginRemoteEngineeringPrompt marks the turn streaming before the async command starts.
    while (true) {
      if (stopped()) { this.session?.command({type:'abort'}); throw new Error('__stopped__'); }
      if (this.failure) throw this.failure;
      if (this.activeMs + (this.activeSince === null ? 0 : Date.now() - this.activeSince) >= timeoutMs) { this.session?.command({type:'abort'}); throw new Error('The coding task exceeded its runtime budget.'); }
      if (!this.session?.busy && !['streaming','awaiting_approval'].includes(this.state.state)) break;
      await new Promise<void>(resolve => {
        const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
        const timer = setTimeout(wake, 250); this.waiters.add(wake);
      });
    }
    this.finished = true;
    if (this.state.state === 'error') throw new Error(this.state.messages.at(-1)?.body ?? 'Coding implementation failed.');
    await this.session?.flush?.();
    if (this.meta.mode === 'plan') {
      if (!this.state.workPlan?.trim() || !this.state.planProgress || this.state.planProgress.id === previousPlan) throw new Error('The coding runtime did not record a revised implementation plan.');
      return this.state.workPlan;
    }
    const summary = [...this.state.messages].reverse().find(m=>!previousMessages.has(m.id) && m.role==='assistant' && !m.kind && m.body.trim())?.body;
    if (!summary) throw new Error('The coding runtime finished without an implementation summary.');
    return summary;
  }
  async close() { await this.session?.close(); }
}
