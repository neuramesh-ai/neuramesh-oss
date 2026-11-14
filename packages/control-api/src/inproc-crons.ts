// VERCEL'S CRONS, IN PROCESS (scripts/e2e-cloudrun/README.md). On Vercel, vercel.json's `crons` GET
// the /internal/* sweeps with `Bearer $CRON_SECRET`. A long-running server (a Cloud Run service with
// CPU always allocated and one minimum instance) can run the same requests itself:
//
//   NM_INPROC_CRONS="/internal/machine-sweep@300,/internal/routines-due@300"
//
// Each entry is a path and a period in seconds. The request goes through the app's own router with
// the same header Vercel sends, so the route, its auth check and its logs are the production ones.
// Unset (every deploy so far) starts nothing. Cloud Scheduler hitting the same paths is the other way
// to get them; do not run both against one database, or the meter counts each pass twice.
export interface CronEntry { path: string; everyMs: number }

/** strict: a malformed entry stops the boot rather than silently never running */
export function parseInprocCrons(raw: string | undefined): CronEntry[] {
  if (!raw?.trim()) return [];
  return raw.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const m = /^(\/internal\/[A-Za-z0-9/_-]+)@(\d+)$/.exec(part);
    if (!m) throw new Error(`NM_INPROC_CRONS: "${part}" is not /internal/<path>@<seconds>`);
    const seconds = Number(m[2]);
    if (seconds < 10) throw new Error(`NM_INPROC_CRONS: ${m[1]} every ${seconds}s is faster than 10s`);
    return { path: m[1]!, everyMs: seconds * 1000 };
  });
}

type Requester = (path: string, init: RequestInit) => Response | Promise<Response>;

/** start one timer per entry; returns the stop. Never overlaps a pass with itself */
export function startInprocCrons(entries: CronEntry[], request: Requester, secret = process.env['CRON_SECRET']): () => void {
  if (!entries.length) return () => {};
  if (!secret) throw new Error('NM_INPROC_CRONS needs CRON_SECRET: the cron routes refuse a request without it');
  const timers = entries.map(({ path, everyMs }) => {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void Promise.resolve(request(path, { headers: { authorization: `Bearer ${secret}` } }))
        .then(async (res) => { if (!res.ok) console.error(`[cron] ${path} answered ${res.status}: ${(await res.text()).slice(0, 200)}`); })
        .catch((e: unknown) => console.error(`[cron] ${path} failed: ${e instanceof Error ? e.message : String(e)}`))
        .finally(() => { running = false; });
    }, everyMs);
    timer.unref?.();
    return timer;
  });
  console.log(`[cron] in-process: ${entries.map((e) => `${e.path} every ${e.everyMs / 1000}s`).join(', ')}`);
  return () => { for (const t of timers) clearInterval(t); };
}
