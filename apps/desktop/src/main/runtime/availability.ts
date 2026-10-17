// Publish login changes while a sign-in terminal is still open. Only runtime names leave
// the machine. Failed probes keep the last report; failed writes retry on the next poll.
export function watchRuntimeAvailability(o: {
  initial: string[];
  probe: () => Promise<string[]>;
  publish: (runtimes: string[]) => Promise<boolean>;
  pollMs?: number;
}) {
  const normalize = (r: string[]) => [...new Set(r)].sort();
  let reported = normalize(o.initial);
  let current = reported;
  let stopped = false;
  let pending: Promise<void> | undefined;
  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (pending) return pending;
    pending = (async () => {
      const next = normalize(await o.probe());
      if (stopped) return;
      current = next;
      if (next.join(',') !== reported.join(',') && await o.publish(next)) reported = next;
    })().catch(() => {}).finally(() => { pending = undefined; });
    return pending;
  };
  const timer = setInterval(() => void refresh(), o.pollMs ?? 5_000);
  timer.unref();
  return {
    refresh,
    current: () => current,
    stop: () => { stopped = true; clearInterval(timer); },
  };
}
