import type { CoreSessionEvent } from '@cline/sdk';
import type { EngineeringRuntimeEvent } from '@neuramesh/shared';

/** A model's final receipt can precede the SDK call settling. Serialize the next prompt behind
 * that call, including its session-id result and checkpoint cleanup. */
export class EngineeringPromptQueue {
  queued = false;
  private completion: Promise<void> = Promise.resolve();

  async wait(): Promise<void> {
    this.queued = true;
    try { await this.completion.catch(() => {}); }
    finally { this.queued = false; }
  }

  async run(prompt: () => Promise<void>): Promise<void> {
    this.queued = true;
    try { await this.completion.catch(() => {}); }
    finally { this.queued = false; }
    this.completion = prompt();
    await this.completion;
  }
}

export function forwardEngineeringUsage(event: CoreSessionEvent, emit: (event: EngineeringRuntimeEvent) => void): void {
  if (event.type !== 'agent_event' || event.payload.event.type !== 'usage') return;
  emit({ type: 'usage', inputTokens: event.payload.event.totalInputTokens, outputTokens: event.payload.event.totalOutputTokens,
    ...(typeof event.payload.event.totalCost === 'number' ? { cost: event.payload.event.totalCost } : {}) });
}
