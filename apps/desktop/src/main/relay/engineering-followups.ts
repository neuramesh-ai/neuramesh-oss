import type { ClineCore, CoreSessionEvent } from '@cline/sdk';
import type { EngineeringAttachmentRef, EngineeringMode } from '@neuramesh/shared';
import { registerFollowupTarget } from '../host/thread-followups';

interface CodingLane {
  core(): ClineCore | null;
  session(): string | null;
  mode(): EngineeringMode;
  busy(): boolean;
  refuse(): string | null;
  resolveFiles(refs: EngineeringAttachmentRef[]): Promise<{userImages: string[]; userFiles: string[]}>;
  releaseFiles(refs: EngineeringAttachmentRef[]): void;
  start(prompt: string, refs: EngineeringAttachmentRef[]): Promise<void>;
  interruptApproval(): void;
  received(id: string, text: string, refs: EngineeringAttachmentRef[], steer: boolean): void;
}

/** Correlate Cline's consumption event with our durable row. core.send resolves as soon as
 * it enqueues, before the agent actually receives the message. */
export class CodingFollowups {
  private release?: () => void;
  private confirmation?: { session: string; text: string; resolve(): void; reject(reason: Error): void };

  listen(thread: string, lane: CodingLane) {
    this.release = registerFollowupTarget(thread, {
      busy: lane.busy,
      apply: async (text, id, steer, refs) => {
        const core = lane.core(), sessionId = lane.session();
        if (!core || this.confirmation) return false;
        const refusal = lane.refuse();
        if (refusal) throw new Error(refusal);
        if (!sessionId) {
          if (lane.busy()) return false;
          await lane.start(text, refs);
          return true;
        }
        const files = await lane.resolveFiles(refs);
        let resolve!: () => void, reject!: (error: Error) => void;
        const receipt = new Promise<void>((yes,no) => { resolve=yes; reject=no; });
        // Capture close or timeout even if the native send itself is still unwinding.
        void receipt.catch(() => {});
        this.confirmation = { session: sessionId, text, resolve, reject };
        const timeout = setTimeout(() => reject(new Error('Cline has not confirmed delivery. Check the task before retrying.')), 120000);
        try {
          await core.send({ sessionId, prompt: text, mode: lane.mode(), delivery: steer ? 'steer' : 'queue', ...files });
          if (steer) lane.interruptApproval();
          await receipt;
          lane.received(id, text, refs, steer);
          lane.releaseFiles(refs);
          return true;
        } finally {
          clearTimeout(timeout);
          this.confirmation = undefined;
        }
      },
    });
  }

  observe(event: CoreSessionEvent) {
    if (event.type !== 'pending_prompt_submitted') return;
    if (this.confirmation?.session === event.payload.sessionId && this.confirmation.text === event.payload.prompt) this.confirmation.resolve();
  }

  close() {
    this.release?.();
    this.confirmation?.reject(new Error('The coding session closed before it confirmed this prompt. Check the conversation before retrying.'));
  }
}
