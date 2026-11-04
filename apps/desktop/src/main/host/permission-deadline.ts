/** A human decision has its own deadline. Only active model/tool work spends the
 * turn's wall budget. Parallel approvals pause that clock until the last one returns. */
export type WaitForPermission = <T>(decision: () => Promise<T>) => Promise<T>;

export async function withPermissionDeadline<T>(work: (wait: WaitForPermission) => Promise<T>, ms: number, message: string): Promise<T> {
  let remaining = ms, started = Date.now(), pending = 0, ended = false;
  let timer: ReturnType<typeof setTimeout>;
  let expire!: (error: Error) => void;
  const timeout = new Promise<never>((_, reject) => { expire = reject; });
  const arm = () => {
    started = Date.now();
    timer = setTimeout(() => { ended = true; expire(new Error(message)); }, remaining);
  };
  const wait: WaitForPermission = async decision => {
    if (ended) throw new Error(message);
    if (pending++ === 0) {
      clearTimeout(timer);
      remaining = Math.max(0, remaining - (Date.now() - started));
    }
    try {
      const result = await decision();
      if (ended) throw new Error(message);
      return result;
    } finally {
      if (--pending === 0 && !ended) arm();
    }
  };
  arm();
  try { return await Promise.race([work(wait), timeout]); }
  finally { ended = true; clearTimeout(timer!); }
}
