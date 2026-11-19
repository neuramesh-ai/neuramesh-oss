// A RELAY REVISION THAT TRAFFIC LEFT (Cloud Run). The hub works only while a machine and a browser
// meet on one instance. After a deploy, Cloud Run sends every new socket to the new revision but keeps
// the old instance alive for as long as its WebSockets last, up to the request timeout (an hour in the
// sandbox). So a browser attaches on the new instance and hears 4404 for a machine whose socket still
// sits on the old one. This watch lets the old instance see it: it asks the service URL, which only a
// serving revision answers, which revision that is. When the answer is a NEWER revision, the caller
// closes every socket, the machines redial into the new instance (two seconds, machine-edge.ts) and the
// browsers attach there. Revisions compare by Cloud Run's generation number, so only the older side of
// a traffic split ever retires. Nothing runs without a revision name and a URL to ask.
import { shardConfig, shardSelfUrl } from './shard-config.js';

export const ROLLOVER_PERIOD_MS = 30_000;
/** a retired instance's close code: 1012 is the standard "service restart" */
export const RETIRED_CLOSE = 1012;

/** Cloud Run's generated revision names end in -<5-digit generation>-<3-character suffix> */
export function revisionGeneration(name: string | null | undefined): number | null {
  const m = /-(\d{5})-[a-z0-9]{3}$/.exec(name ?? '');
  return m ? Number(m[1]) : null;
}

/** the URL every Cloud Run service also answers on (its deterministic form), from the metadata
 *  server's region path, `projects/<number>/regions/<region>` */
export function deterministicUrl(service: string, regionPath: string): string | null {
  const m = /^projects\/(\d+)\/regions\/([a-z0-9-]+)$/.exec(regionPath.trim());
  return m && /^[a-z0-9-]+$/.test(service) ? `https://${service}-${m[1]}.${m[2]}.run.app` : null;
}

/** the URL to ask: RELAY_SELF_URL when set, else this shard's own entry in RELAY_SHARDS, else on
 *  Cloud Run (K_SERVICE) the deterministic URL. null when none is known: the watch stays off.
 *  EACH SHARD ASKS ITS OWN SERVICE. Every shard is a Cloud Run service with revisions of its own, so
 *  a shard that asked another shard's URL would compare its revision with a stranger's and retire
 *  for no reason, or never */
export async function resolveSelfUrl(env: Record<string, string | undefined>, ask: typeof fetch = fetch): Promise<string | null> {
  const explicit = env['RELAY_SELF_URL']?.trim();
  if (explicit) return explicit;
  const shard = shardConfig(env);
  if (shard && typeof shard !== 'string') {
    const own = shardSelfUrl(shard);
    if (own) return own;
  }
  const service = env['K_SERVICE'];
  if (!service) return null;
  try {
    const res = await ask('http://metadata.google.internal/computeMetadata/v1/instance/region', {
      headers: { 'metadata-flavor': 'Google' },
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok ? deterministicUrl(service, await res.text()) : null;
  } catch {
    return null;
  }
}

export interface RolloverOptions {
  /** this instance's revision (K_REVISION) */
  revision: string;
  /** the relay's own public URL: its GET /revision names the revision that serves traffic */
  selfUrl: string;
  periodMs?: number;
  fetch?: typeof fetch;
  /** Empty relays have nothing to move and must not keep themselves warm with self-requests. */
  active?(): boolean;
  /** called once, with the newer revision's name */
  onRetire(newer: string): void;
  log?(line: string): void;
}

/** Ask every period until a newer revision answers, then call onRetire once. Returns the stop.
 *  It never throws: a failed ask is asked again on the next beat. */
export function watchRollover(o: RolloverOptions): () => void {
  const log = o.log ?? (() => {});
  const mine = revisionGeneration(o.revision);
  if (mine === null) {
    log(`rollover watch off: the revision name ${o.revision} carries no generation`);
    return () => {};
  }
  const ask = o.fetch ?? fetch;
  const url = new URL('/revision', o.selfUrl).toString();
  let done = false;
  let asking = false;
  const beat = async (): Promise<void> => {
    try {
      const res = await ask(url, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return;
      const { revision } = (await res.json()) as { revision?: unknown };
      if (typeof revision !== 'string' || done) return;
      const theirs = revisionGeneration(revision);
      if (theirs === null || theirs <= mine) return;
      done = true;
      clearInterval(timer);
      log(`rollover: ${revision} serves the traffic now, so ${o.revision} retires`);
      o.onRetire(revision);
    } catch {
      /* the next beat asks again */
    }
  };
  const timer = setInterval(() => {
    if (done || asking || o.active?.() === false) return;
    asking = true;
    void beat().finally(() => { asking = false; });
  }, o.periodMs ?? ROLLOVER_PERIOD_MS);
  timer.unref?.();
  return () => { done = true; clearInterval(timer); };
}
