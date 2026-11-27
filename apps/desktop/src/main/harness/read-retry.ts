// A READ THE FIRST TURN DEPENDS ON (2026-11-17). A cloud machine that just woke answers the message
// it slept through in its busiest seconds: the dead-letter sweep queues the wake as the roster loads,
// and that turn's first reads are the heaviest ones it makes (the agent's full replica bootstrap, the
// thread's cloud brain). One slow answer from the API in that window ended the turn with Node's own
// words, "The operation was aborted due to timeout", posted into the thread as the reason (George,
// 2026-11-17). A slow or dropped read is tried again, and a read that stays slow says so in a
// sentence a person can read.
//
// What is retried: a timeout, a network error and a 5xx. A 4xx is the server's answer, never retried.
// The last 5xx response goes back to the caller, which already says what a refusal means.

export interface ReadRetryOpts {
  /** the limit for ONE attempt */
  timeoutMs: number;
  /** the waits between attempts: their count is the retry count */
  backoffMs?: number[];
  /** the reason a person reads when every attempt was slow or dropped */
  slowText: string;
  sleep?: (ms: number) => Promise<void>;
}

const isAbort = (e: unknown): boolean => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');

export async function readWithRetry(read: (signal: AbortSignal) => Promise<Response>, o: ReadRetryOpts): Promise<Response> {
  const backoff = o.backoffMs ?? [1_000, 3_000];
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.()));
  for (let i = 0; ; i++) {
    const last = i >= backoff.length;
    try {
      const res = await read(AbortSignal.timeout(o.timeoutMs));
      if (res.status < 500 || last) return res;
      await res.body?.cancel();
    } catch (e) {
      // a network error is a TypeError from fetch; anything else is the caller's own throw
      if (!isAbort(e) && !(e instanceof TypeError)) throw e;
      if (last) throw new Error(o.slowText, { cause: e });
    }
    await sleep(backoff[i]!);
  }
}
