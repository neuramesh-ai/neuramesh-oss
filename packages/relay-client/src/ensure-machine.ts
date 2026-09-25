// ONE SEAM FOR "THIS NEEDS A MACHINE" (docs/design/machine-autowake-2026-08).
//
// The terminal used to handle `asleep` itself: print a refusal, exit. Every other machine-backed
// lane — the machine's filesystem, git, live logs, footprint — would grow the same branch and
// forget the same wake, which is how one bug ships four more times. So no lane sees a raw
// status: they call this, and it never hands back `asleep`. It either delivers a machine, or a
// reason a person can act on.
//
// PURE AND INJECTED, so the whole state machine is testable without a browser, a socket or a
// cluster. The only thing this file knows how to do is decide.
import type { MachineStatus } from '@neuramesh/shared';

/** the two states a person can actually tell apart (the mockup round cut the rest) */
export type EnsurePhase = 'starting' | 'connecting';

export interface EnsureDeps {
  /** the workspace's runner id, or null when the read failed / none exists */
  machineId(): Promise<string | null>;
  /** the runner's current status, derived from the same machineState() every surface uses */
  status(): Promise<MachineStatus | null>;
  /** POST /v1/machines/wake — capped is a verdict, not an error */
  wake(): Promise<{ ok: boolean; capped?: boolean }>;
  wait(ms: number): Promise<void>;
  now(): number;
  /** a person navigating away cancels their WAIT, never the machine */
  cancelled?(): boolean;
  /** THE SHELL'S ASK, first (docs/design/agent-sandbox-2026-09 §4.2, D2). A runner that adopted a
   *  warm spare holds nothing at rest, and the only reason a person shells into a runner is to
   *  sign something in — which would die with the pod at its next stop. So the shell asks for a
   *  disk before it opens: `machine.promote`. `restarting: true` means the machine is about to
   *  come back on a volume, and the beat the dying pod left must not count as "online".
   *  Absent on lanes that are not a shell (Code), where a claim pod serves fine. */
  promote?(): Promise<{ restarting: boolean }>;
  /** the last heartbeat instant, ms — required beside `promote`, it is what "back" is measured by */
  lastSeenAt?(): Promise<number | null>;
}

export type EnsureResult =
  | { ok: true; machineId: string }
  | { ok: false; reason: 'capped' | 'unavailable' | 'cancelled'; detail: string };

/** how long to keep waiting. A cold start measures ~146s; past five minutes something is wrong
 *  and saying so beats spinning forever next to a counter that keeps climbing. */
export const ENSURE_TIMEOUT_MS = 5 * 60_000;
const POLL_MS = 4_000;

const CAPPED_DETAIL =
  "Today's free machine hours are used up, so the machine cannot start yet.";
const GONE_DETAIL =
  'This workspace has no cloud machine yet. Send a message to start one.';

export async function ensureMachine(
  deps: EnsureDeps,
  onPhase: (p: EnsurePhase) => void = () => {},
): Promise<EnsureResult> {
  const bail = (): boolean => deps.cancelled?.() ?? false;
  const started = deps.now();

  // a promotion restarts the machine on a volume: wait for a beat NEWER than the ask, because the
  // claim pod's last beat keeps reading as "online" for a minute after the pod is gone
  if (deps.promote && deps.lastSeenAt) {
    const { restarting } = await deps.promote();
    if (restarting) {
      onPhase('starting');
      for (;;) {
        if (bail()) return { ok: false, reason: 'cancelled', detail: '' };
        if (deps.now() - started > ENSURE_TIMEOUT_MS) {
          return { ok: false, reason: 'unavailable', detail: 'The machine takes longer than usual. It can still start. Try again soon.' };
        }
        await deps.wait(POLL_MS);
        if (bail()) return { ok: false, reason: 'cancelled', detail: '' };
        const seen = await deps.lastSeenAt();
        const id = await deps.machineId();
        if (seen !== null && seen > started && id) {
          onPhase('connecting');
          return { ok: true, machineId: id };
        }
      }
    }
  }

  let id = await deps.machineId();
  let status = await deps.status();

  // ALREADY UP is the common case and must cost nothing: no wake, no poll, no boot screen for a
  // machine that was never asleep.
  if (status === 'online' && id) {
    onPhase('connecting');
    return { ok: true, machineId: id };
  }
  if (status === 'capped') return { ok: false, reason: 'capped', detail: CAPPED_DETAIL };
  if (status === 'stopped') return { ok: false, reason: 'unavailable', detail: GONE_DETAIL };

  onPhase('starting');

  // `waking` means somebody already asked — a second wake would only reset the idle clock, and
  // the person is waiting on the same boot either way.
  if (status !== 'waking') {
    const woken = await deps.wake();
    if (woken.capped) return { ok: false, reason: 'capped', detail: CAPPED_DETAIL };
    if (!woken.ok) return { ok: false, reason: 'unavailable', detail: 'The machine did not start.' };
  }

  for (;;) {
    if (bail()) return { ok: false, reason: 'cancelled', detail: '' };
    if (deps.now() - started > ENSURE_TIMEOUT_MS) {
      return {
        ok: false,
        reason: 'unavailable',
        // the machine may well still arrive. This is the WAIT that gives up, and the copy says so
        detail: 'The machine takes longer than usual. It can still start. Try again soon.',
      };
    }
    await deps.wait(POLL_MS);
    if (bail()) return { ok: false, reason: 'cancelled', detail: '' };

    status = await deps.status();
    // the id appears once the row exists; re-read it while waiting rather than failing early on
    // a workspace whose first machine is only now being created
    if (!id) id = await deps.machineId();

    if (status === 'capped') return { ok: false, reason: 'capped', detail: CAPPED_DETAIL };
    if (status === 'online' && id) {
      onPhase('connecting');
      return { ok: true, machineId: id };
    }
    // 'unreachable' is NOT terminal: a machine mid-boot has no heartbeat yet and reads exactly
    // like one that has died. Treating it as failure would abort almost every cold start.
  }
}
