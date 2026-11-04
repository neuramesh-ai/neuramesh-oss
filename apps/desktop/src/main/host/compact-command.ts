/** Long histories can take several model calls. Time out a stalled stage,
 * and invalidate its cursor write if the provider returns after the deadline. */
export async function runManualCompaction<T>(work: (signal: AbortSignal, progress: () => void) => Promise<T>, idleMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const stalled = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  const progress = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new Error('Compaction stopped making progress.')), idleMs);
  };
  progress();
  try { return await Promise.race([work(controller.signal, progress), stalled]); }
  finally { clearTimeout(timer!); }
}
