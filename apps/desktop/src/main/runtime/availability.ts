// Publish login changes while a sign-in terminal is still open. Only runtime names leave
// the machine. Failed probes keep the last report; failed writes retry on the next poll.
export function watchRuntimeAvailability(o: {
  initial: string[];
  probe: () => Promise<string[]>;
  publish: (runtimes: string[]) => Promise<boolean>;
  pollMs?: number;
  /** publish `initial` at once. A desktop says its runtimes in machine.register, so its initial is
   *  already on the row. A Cloud Run machine never registers: its 30 s beat was the first write,
   *  and an epoch that lived less than that (an idle drain parks in about 10 s) left
   *  machines.runtimes at '[]' while the machine logged "runtimes gemini" (r6, 2026-11-02) */
  publishInitial?: boolean;
}) {
  const normalize = (r: string[]) => [...new Set(r)].sort();
  // null = nothing accepted yet, so the next check publishes whatever it reads
  let reported: string[] | null = o.publishInitial ? null : normalize(o.initial);
  let current = normalize(o.initial);
  let stopped = false;
  let pending: Promise<void> | undefined;
  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      const next = normalize(await o.probe());
      if (stopped) return;
      current = next;
      if ((reported === null || next.join(',') !== reported.join(',')) && await o.publish(next)) reported = next;
    })().catch(() => {}).finally(() => { pending = undefined; });
    return pending;
  };
  if (o.publishInitial) {
    // a failed write leaves `reported` null, so the next poll retries it
    const first = current;
    pending = o.publish(first).then((ok) => { if (ok && reported === null) reported = first; })
      .catch(() => {}).finally(() => { pending = undefined; });
  }
  const timer = setInterval(() => void refresh(), o.pollMs ?? 5_000);
  timer.unref();
  return {
    refresh,
    current: () => current,
    stop: () => { stopped = true; clearInterval(timer); },
  };
}
