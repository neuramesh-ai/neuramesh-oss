// THE CODE SESSION'S SYNCED ROW, KEPT BY THE HOST (0135, the mobile-cloud round — plan D8, S0.2).
//
// A Code session used to exist only in the client that opened it (the desktop renderer's
// localStorage) and in the machine's Cline history. This records it as a synced row — repo,
// branch, mode, state, title, the last line — so every client can list Code work. The host is
// the writer because the host is where the truth happens: the client can lie about the state
// of a turn, the runtime cannot.
//
// It WRAPS the session rather than living inside it (engineering-channel.ts sits at its size
// cap, and recording is a concern beside execution, not part of it): the emit stream is observed
// for state, the command stream for prompts and mode changes. Patches coalesce for a beat so a
// streaming turn is one upsert, not a flood; an approval and a close post at once.
//
// Every post is fire-and-forget through the host's own credential (the machine bearer, or the
// member's headers on the desktop host): a row that failed to write is a list that is one entry
// behind, never a session that failed.
import { codeSessionEndState, codeSessionTitle } from '@neuramesh/shared';
import type { EngineeringMachineOpenMeta, EngineeringRuntimeEvent } from '../../engineering-protocol';
import type { EngineeringMachineSession } from './engineering-host';

export interface CodeSessionRecorder {
  workspaceId: string;
  /** the machine hosting the sessions this recorder writes for — null where the host has no row (a desktop with none yet) */
  machineId: string | null;
  post(cmd: Record<string, unknown>): Promise<void>;
}

export function createCodeSessionRecorder(o: {
  apiUrl: string;
  headers: () => Promise<Record<string, string>>;
  workspaceId: string;
  machineId: string | null;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}): CodeSessionRecorder {
  const f = o.fetchImpl ?? fetch;
  return {
    workspaceId: o.workspaceId,
    machineId: o.machineId,
    async post(cmd) {
      try {
        const res = await f(`${o.apiUrl}/v1/commands`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(await o.headers()) },
          body: JSON.stringify({ workspace: o.workspaceId, ...cmd }),
        });
        if (!res.ok) o.log?.(`code_session_record_failed type=${String(cmd['type'])} status=${res.status}`);
      } catch (error) {
        o.log?.(`code_session_record_failed type=${String(cmd['type'])}: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

const firstLine = (text: string, max = 200): string => {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
};

export class CodeSessionRecord {
  private patch: Record<string, unknown> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private titled = false;
  private done = false;
  private state = 'idle';

  constructor(private readonly rec: CodeSessionRecorder, private readonly meta: EngineeringMachineOpenMeta, private readonly beatMs = 300) {
    // a session created by an older client carries an `eng-` prefixed id, which can never be the
    // uuid row id (0135) — record nothing for it rather than post commands the server must refuse
    this.done = !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meta.threadId);
  }

  /** the row exists from the moment the session is open — before any prompt, so a list can show it */
  opened(): void {
    if (this.done) return;
    void this.rec.post({
      type: 'code_session.upsert', codeSessionId: this.meta.threadId, createdBy: this.meta.actorId,
      projectId: this.meta.projectId ?? null, repoId: this.meta.repoId, repoName: this.meta.repoName, branch: this.meta.branch,
      mode: this.meta.mode, machineId: this.rec.machineId, state: 'idle',
    });
  }

  /** the emit the runtime writes into — observed, then passed down unchanged */
  emit(down: (event: EngineeringRuntimeEvent) => void): (event: EngineeringRuntimeEvent) => void {
    if (this.done) return down;
    return (event) => { this.observe(event); down(event); };
  }

  /** the session the edge holds — its commands are observed, then passed down unchanged */
  wrap(session: EngineeringMachineSession): EngineeringMachineSession {
    return {
      command: (value) => { this.command(value); session.command(value); },
      close: () => { this.closed(); session.close(); },
    };
  }

  private command(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const v = value as { type?: string; prompt?: string; controls?: { mode?: string } };
    if (v.type === 'prompt' && typeof v.prompt === 'string') {
      const patch: Record<string, unknown> = { state: 'streaming', lastLine: firstLine(v.prompt) };
      if (!this.titled) { patch['title'] = codeSessionTitle(v.prompt); this.titled = true; }
      this.queue(patch);
    } else if (v.type === 'controls' && (v.controls?.mode === 'plan' || v.controls?.mode === 'act')) {
      this.queue({ mode: v.controls.mode });
    }
  }

  private observe(event: EngineeringRuntimeEvent): void {
    switch (event.type) {
      case 'status': this.queue({ state: event.status === 'idle' ? 'idle' : 'streaming' }); return;
      case 'approval':
        this.queue({ state: 'awaiting_approval' }); this.flush();
        void this.rec.post({ type: 'code_session.approval_waiting', codeSessionId: this.meta.threadId, approvalId: event.approvalId, category: event.category, toolName: event.toolName });
        return;
      case 'approval_resolved': this.queue({ state: 'streaming' }); return;
      case 'changes': this.queue({ changesCount: event.changes.length }); return;
      case 'agent_event': {
        const text = event.event['type'] === 'done' ? event.event['text'] : undefined;
        if (typeof text === 'string' && text.trim()) this.queue({ lastLine: firstLine(text) });
        return;
      }
      case 'ended': this.queue({ state: codeSessionEndState(event.reason) }); this.flush(); return;
      case 'error': if (event.recoverable === false || event.recoverable === undefined) this.queue({ state: 'error' }); return;
      default: return;
    }
  }

  private queue(patch: Record<string, unknown>): void {
    if (this.done) return;
    Object.assign(this.patch, patch);
    if (typeof patch['state'] === 'string') this.state = patch['state'];
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.beatMs);
  }

  private flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!Object.keys(this.patch).length) return;
    const patch = this.patch; this.patch = {};
    void this.rec.post({ type: 'code_session.upsert', codeSessionId: this.meta.threadId, ...patch });
  }

  /** the client left or the host shut the session: the row rests, resumable unless the turn had settled */
  private closed(): void {
    if (this.done) return;
    this.flush();
    this.done = true;
    const state = this.state === 'completed' || this.state === 'error' ? this.state : 'resumable';
    void this.rec.post({ type: 'code_session.close', codeSessionId: this.meta.threadId, state });
  }
}
