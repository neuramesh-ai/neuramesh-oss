// CODE APPROVALS THAT OUTLIVE THEIR SESSION (Cloud Run only, cloudrun/parks.ts).
//
// A Code session's tool approval parks in Postgres the moment it is asked (engineering-approvals.ts).
// When the tab closes, or a drain closes every session (machined.ts parkTurns), the in-memory wait
// ends but the park stays open. The person answers it later: in a reopened tab (the session offers
// the open park as its approval card again), or through POST /v1/parks/:id/resolve, which wakes a
// sleeping machine with no message.
//
// WHY A CONTINUATION TURN AND NOT A RESUME. The Cline core runs in this process, and a paused turn is
// a promise inside its agent loop: nothing can serialize it. So the strongest honest replay is the
// brain checkpoint (the conversation up to the asked call, saved at every close) plus one new turn
// that tells the model the answer. An approval asks the model to re-issue the exact call, and the
// gate finds the claimed park under the same key (thread, tool, exact input) and allows it without a
// second card. A denial or a timeout is applied by telling the model, and the park is done at once.
//
// This file holds the pure parts (the checkpoint's meta, the prompt, the offered card) and the
// resumer machined installs on the registry: every park the boot claim (or the 30 s loop) takes is
// handed to the engineering host, which continues the live session for that thread or opens one
// with no tab, runs the continuation turn, and closes it.
import { isEngineeringOpenMeta, type EngineeringMachineOpenMeta, type EngineeringPermissionCategory } from '../../engineering-protocol';
import type { Park, ParkResolution, ParkRegistry } from '../cloudrun/parks';

export const CODE_PARK_KIND = 'code-session';
const CATEGORIES = new Set<EngineeringPermissionCategory>(['read', 'edit', 'command', 'web', 'mcp']);

/** is this park a Code session's approval (the checkpoint engineering-approvals.ts writes)? */
export function isCodePark(park: Pick<Park, 'kind' | 'checkpoint'>): boolean {
  return park.kind === 'approval' && park.checkpoint?.['kind'] === CODE_PARK_KIND;
}

/** the session's open meta the park recorded, validated as the edge validates a browser's; null for a
 *  park written before the meta rode along, or one whose meta no longer validates */
export function codeParkMeta(park: Pick<Park, 'kind' | 'checkpoint'>): EngineeringMachineOpenMeta | null {
  if (!isCodePark(park)) return null;
  const meta = park.checkpoint['meta'];
  if (!isEngineeringOpenMeta(meta)) return null;
  const actorId = (meta as unknown as Record<string, unknown>)['actorId'];
  if (typeof actorId !== 'string' || !actorId) return null;
  if (meta.threadId !== park.checkpoint['threadId'] || actorId !== park.checkpoint['actorId']) return null;
  return { ...meta, actorId };
}

/** does this park belong to that session (same thread, same person, same repository)? */
export function codeParkFor(park: Pick<Park, 'kind' | 'checkpoint'>, meta: Pick<EngineeringMachineOpenMeta, 'threadId' | 'actorId' | 'repoId'>): boolean {
  return isCodePark(park) && park.checkpoint['threadId'] === meta.threadId && park.checkpoint['actorId'] === meta.actorId
    && (park.checkpoint['repoId'] ?? null) === (meta.repoId ?? null);
}

const toolNameOf = (park: Pick<Park, 'request'>): string => (typeof park.request['toolName'] === 'string' ? park.request['toolName'] : 'tool');

/** the recorded input (a JSON preview, cut at 4 000 characters) back as a value where it parses */
export function codeParkInput(park: Pick<Park, 'request'>): unknown {
  const raw = park.request['input'];
  if (typeof raw !== 'string') return raw ?? null;
  try { return JSON.parse(raw) as unknown; } catch { return raw; }
}

/** the approval card a reopened session shows for an open park (the protocol's `approval` event) */
export function offeredApproval(park: Pick<Park, 'id' | 'request'>): { approvalId: string; category: EngineeringPermissionCategory; toolName: string; input: unknown } {
  const category = park.request['category'];
  return {
    approvalId: `park-${park.id}`,
    category: typeof category === 'string' && CATEGORIES.has(category as EngineeringPermissionCategory) ? category as EngineeringPermissionCategory : 'command',
    toolName: toolNameOf(park),
    input: codeParkInput(park),
  };
}

/** the continuation turn's prompt: the outcome in plain words, and what to do with it */
export function codeParkResumePrompt(park: Pick<Park, 'request' | 'resolution'>): string {
  const res: ParkResolution = park.resolution ?? { answer: null, approved: false, reason: 'timeout' };
  const tool = toolNameOf(park);
  const raw = typeof park.request['input'] === 'string' ? park.request['input'] : JSON.stringify(park.request['input'] ?? null);
  const input = raw.length > 1_500 ? `${raw.slice(0, 1_500)}…` : raw;
  const head = `[Neuramesh] Your earlier \`${tool}\` call waited for approval while this session was closed (the machine stopped, or the tab closed), so it did not run then. Its input was: ${input}`;
  if (res.approved) {
    return `${head}\n\nA person APPROVED it. Re-issue that same \`${tool}\` call now with exactly the same input (it runs without asking again), then continue the task from where you stopped. `
      + 'If the work no longer needs it, say so and continue without it.';
  }
  const why = res.reason === 'timeout' ? 'Nobody answered before the approval expired, so it counts as DENIED' : 'A person DENIED it';
  return `${head}\n\n${why}. Do not run it, and do not work around it with another tool. Continue the task without it if you can, or stop and say what you need.`;
}

/** what the engineering host answers for a claimed park (engineering-host.ts `resumeParked`) */
export type CodeParkOutcome = 'continued' | 'opened' | 'busy' | 'held' | 'unusable';
export interface CodeParkHost { resumeParked?(park: Park): Promise<CodeParkOutcome> }

export interface CodeParkResumerOptions {
  /** the engineering host, once machined made it (the boot claim runs before it exists) */
  host: () => CodeParkHost | null;
  log?: (line: string) => void;
  /** a busy thread (a turn running, an approval pending) is asked again after this */
  retryMs?: number;
  maxRetries?: number;
}

/**
 * The registry's resume handler for Code parks. Parks claimed before the host exists wait in a queue
 * until `attach`. A busy thread is asked again a few times; a draining machine leaves the claim as
 * it is, and the next epoch claims it again (a dead epoch's claim is claimable).
 */
export class CodeParkResumer {
  private readonly queue: Park[] = [];
  private readonly inFlight = new Set<string>();
  private attached = false;
  private readonly log: (line: string) => void;

  constructor(private readonly o: CodeParkResumerOptions) {
    this.log = o.log ?? ((line) => console.log(`[engineering] ${line}`));
  }

  /** install on the registry: every claimed Code park comes here */
  install(reg: Pick<ParkRegistry, 'onResume'>): () => void {
    return reg.onResume((park) => this.onPark(park));
  }

  onPark(park: Park): void {
    if (!isCodePark(park) || !park.resolution) return;
    if (!this.attached) { this.queue.push(park); return; }
    void this.resume(park, 0);
  }

  /** the host exists now: run what the boot claim queued */
  attach(): void {
    this.attached = true;
    for (const park of this.queue.splice(0)) void this.resume(park, 0);
  }

  get pending(): number { return this.queue.length + this.inFlight.size; }

  private async resume(park: Park, attempt: number): Promise<void> {
    if (this.inFlight.has(park.id) && attempt === 0) return;
    this.inFlight.add(park.id);
    let outcome: CodeParkOutcome = 'unusable';
    try {
      const host = this.o.host();
      outcome = host?.resumeParked ? await host.resumeParked(park) : 'unusable';
    } catch (e) {
      this.log(`code park ${park.id}: resume failed: ${e instanceof Error ? e.message.slice(0, 160) : 'error'}`);
      outcome = 'held';
    }
    this.log(`code park ${park.id} (${park.resolution?.approved ? 'approved' : park.resolution?.reason === 'timeout' ? 'timed out' : 'denied'}): ${outcome}`);
    if (outcome === 'busy' && attempt < (this.o.maxRetries ?? 10)) {
      const t = setTimeout(() => void this.resume(park, attempt + 1), this.o.retryMs ?? 30_000);
      t.unref?.();
      return;
    }
    this.inFlight.delete(park.id);
  }
}
