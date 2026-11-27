/** A human decision has its own deadline. Only active model/tool work spends the
 * turn's idle budget. Parallel approvals pause that clock until the last one returns. */
export type WaitForPermission = <T>(decision: () => Promise<T>) => Promise<T>;

/** A reply has no limit on total time (2026-11-25): research takes as long as it takes, the way a
 *  coding thread's turn does (relay/engineering-provider-stream.ts). It stops only when nothing new
 *  arrives for this long. The step cap and credits bound a loop. */
export const REPLY_IDLE_MS = 2 * 60_000;
/** One tool call rests the idle clock and runs on its own limit, so a slow fetch is not silence. */
export const TOOL_CALL_MS = 10 * 60_000;

export const replyStopped = (idleMs = REPLY_IDLE_MS): string =>
  `The reply stopped because nothing new came for ${Math.round(idleMs / 60_000)} minutes.`;

export interface ReplyLiveness {
  /** something new arrived: text, a thought, a stream event, a tool result, a subagent's step */
  pulse(): void;
  /** a tool call: the idle clock rests while it runs. `own` is for a call whose work has its own
   *  idle limit (a subagent), so it gets no call limit either */
  tool<T>(call: () => Promise<T>, opts?: { own?: boolean }): Promise<T>;
  wait: WaitForPermission;
  /** aborts when the idle limit fires, so the model call stops instead of writing to nobody */
  signal: AbortSignal;
}

/** Calls nothing back: for a caller with no liveness to report into. */
export const NO_LIVENESS: ReplyLiveness = { pulse() {}, tool: call => call(), wait: decision => decision(), signal: new AbortController().signal };

export async function withIdleDeadline<T>(work: (live: ReplyLiveness) => Promise<T>, opts: { idleMs?: number; toolMs?: number } = {}): Promise<T> {
  const idleMs = opts.idleMs ?? REPLY_IDLE_MS, toolMs = opts.toolMs ?? TOOL_CALL_MS;
  const message = replyStopped(idleMs);
  const controller = new AbortController();
  let holds = 0, ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expire!: (error: Error) => void;
  const timeout = new Promise<never>((_, reject) => { expire = reject; });
  const arm = () => {
    clearTimeout(timer);
    if (ended || holds) return;
    timer = setTimeout(() => {
      ended = true;
      const error = new Error(message);
      controller.abort(error);
      expire(error);
    }, idleMs);
  };
  const hold = async <R>(run: () => Promise<R>): Promise<R> => {
    if (ended) throw new Error(message);
    holds++;
    clearTimeout(timer);
    try { return await run(); }
    finally { holds--; arm(); }
  };
  const live: ReplyLiveness = {
    pulse: arm,
    tool: (call, o) => hold(() => o?.own ? call() : new Promise((resolve, reject) => {
      const limit = setTimeout(() => reject(new Error(`The tool call ran for more than ${Math.round(toolMs / 60_000)} minutes.`)), toolMs);
      call().then(resolve, reject).finally(() => clearTimeout(limit));
    })),
    wait: decision => hold(async () => {
      const result = await decision();
      if (ended) throw new Error(message);
      return result;
    }),
    signal: controller.signal,
  };
  arm();
  try { return await Promise.race([work(live), timeout]); }
  finally { ended = true; clearTimeout(timer); }
}

/** The controller a transport takes, aborted too when the reply's idle clock fires. */
export function stoppedBy(signal: AbortSignal | undefined, controller: AbortController): AbortController {
  if (!signal) return controller;
  if (signal.aborted) controller.abort(signal.reason);
  else signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  return controller;
}
