// the rollover watch (rollover.ts): an older relay revision retires once a NEWER one answers on the
// service URL, and never on an equal, older or unreadable answer, nor on a failed ask.
import { describe, expect, it } from 'vitest';
import { deterministicUrl, resolveSelfUrl, revisionGeneration, watchRollover } from './rollover.js';

const until = async (cond: () => boolean, what: string, ms = 2000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** a service URL that answers each ask with the next scripted reply (the last one repeats) */
function service(replies: Array<{ status?: number; revision?: unknown } | Error>) {
  const asked: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    asked.push(String(url));
    const next = replies[Math.min(asked.length - 1, replies.length - 1)]!;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify({ revision: next.revision }), { status: next.status ?? 200 });
  }) as typeof fetch;
  return { asked, fetchImpl };
}

describe('revisionGeneration', () => {
  it('reads the generation from a Cloud Run revision name, and nothing from any other name', () => {
    expect(revisionGeneration('nm-e2e-relay-00012-x7k')).toBe(12);
    expect(revisionGeneration('nm-e2e-relay-00003-abc')).toBe(3);
    expect(revisionGeneration('nm-e2e-relay-blue')).toBeNull();
    expect(revisionGeneration('')).toBeNull();
    expect(revisionGeneration(null)).toBeNull();
  });
});

describe('watchRollover', () => {
  it('makes no self-requests while empty, watches while connected, then goes quiet again', async () => {
    const svc = service([{ revision: 'nm-e2e-relay-00004-aaa' }]);
    let active = false;
    const stop = watchRollover({ revision: 'nm-e2e-relay-00004-aaa', selfUrl: 'https://relay.example', periodMs: 10,
      active: () => active, fetch: svc.fetchImpl, onRetire: () => {} });
    try {
      await sleep(60);
      expect(svc.asked).toEqual([]);
      active = true;
      await until(() => svc.asked.length > 0, 'an active revision check');
      active = false;
      const asks = svc.asked.length;
      await sleep(60);
      expect(svc.asked).toHaveLength(asks);
    } finally { stop(); }
  });

  it('retires once, when a newer revision answers, and asks the service URL\'s /revision', async () => {
    const svc = service([{ revision: 'nm-e2e-relay-00004-aaa' }, { revision: 'nm-e2e-relay-00005-bbb' }]);
    const retired: string[] = [];
    const stop = watchRollover({ revision: 'nm-e2e-relay-00004-aaa', selfUrl: 'https://nm-e2e-relay-123.us-east4.run.app', periodMs: 10, fetch: svc.fetchImpl, onRetire: (r) => retired.push(r) });
    try {
      await until(() => retired.length > 0, 'the retirement');
      expect(retired).toEqual(['nm-e2e-relay-00005-bbb']);
      expect(svc.asked[0]).toBe('https://nm-e2e-relay-123.us-east4.run.app/revision');
      const asks = svc.asked.length;
      await sleep(60);
      expect(svc.asked.length).toBe(asks); // it stops asking once retired
      expect(retired).toHaveLength(1);
    } finally { stop(); }
  });

  it('never retires on its own revision, an older one, an unreadable answer or a failed ask', async () => {
    const svc = service([
      { revision: 'nm-e2e-relay-00004-aaa' }, { revision: 'nm-e2e-relay-00003-zzz' }, { revision: 'nm-e2e-relay-blue' },
      { revision: 42 }, { status: 503, revision: 'nm-e2e-relay-00009-ccc' }, new Error('ECONNRESET'), { revision: 'nm-e2e-relay-00004-aaa' },
    ]);
    const retired: string[] = [];
    const stop = watchRollover({ revision: 'nm-e2e-relay-00004-aaa', selfUrl: 'https://relay.example', periodMs: 10, fetch: svc.fetchImpl, onRetire: (r) => retired.push(r) });
    try {
      await until(() => svc.asked.length >= 9, 'every scripted answer');
      expect(retired).toEqual([]);
    } finally { stop(); }
  });

  it('stays off for a revision name with no generation (a custom suffix, or not Cloud Run)', async () => {
    const svc = service([{ revision: 'nm-e2e-relay-00009-ccc' }]);
    const lines: string[] = [];
    const stop = watchRollover({ revision: 'nm-e2e-relay-blue', selfUrl: 'https://relay.example', periodMs: 10, fetch: svc.fetchImpl, onRetire: () => {}, log: (l) => lines.push(l) });
    await sleep(50);
    stop();
    expect(svc.asked).toEqual([]);
    expect(lines.join(' ')).toMatch(/rollover watch off/);
  });
});

describe('the URL the watch asks', () => {
  it('builds the deterministic Cloud Run URL from the metadata region path', () => {
    expect(deterministicUrl('nm-e2e-relay', 'projects/583059172033/regions/us-east4\n')).toBe('https://nm-e2e-relay-583059172033.us-east4.run.app');
    expect(deterministicUrl('nm-e2e-relay', 'us-east4')).toBeNull();
    expect(deterministicUrl('Not A Service', 'projects/1/regions/us-east4')).toBeNull();
  });

  it('takes RELAY_SELF_URL first, then the metadata server on Cloud Run, else nothing', async () => {
    const metadata = (async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('http://metadata.google.internal/computeMetadata/v1/instance/region');
      expect(new Headers(init?.headers).get('metadata-flavor')).toBe('Google');
      return new Response('projects/42/regions/us-east4');
    }) as typeof fetch;
    const down = (async () => { throw new Error('no metadata server'); }) as typeof fetch;
    expect(await resolveSelfUrl({ RELAY_SELF_URL: 'https://relay.example', K_SERVICE: 'nm-e2e-relay' }, metadata)).toBe('https://relay.example');
    expect(await resolveSelfUrl({ K_SERVICE: 'nm-e2e-relay' }, metadata)).toBe('https://nm-e2e-relay-42.us-east4.run.app');
    expect(await resolveSelfUrl({ K_SERVICE: 'nm-e2e-relay' }, down)).toBeNull();
    expect(await resolveSelfUrl({}, metadata)).toBeNull();
  });

  it('a shard asks its own service: its entry in RELAY_SHARDS, never another shard\'s', async () => {
    const never = (async () => { throw new Error('the metadata server is not asked'); }) as typeof fetch;
    const shards = 'wss://nm-e2e-relay-0-42.us-east4.run.app,wss://nm-e2e-relay-1-42.us-east4.run.app';
    expect(await resolveSelfUrl({ RELAY_SHARDS: shards, RELAY_SHARD_INDEX: '1', K_SERVICE: 'nm-e2e-relay-1' }, never)).toBe('https://nm-e2e-relay-1-42.us-east4.run.app');
    expect(await resolveSelfUrl({ RELAY_SHARDS: shards, RELAY_SHARD_INDEX: '0' }, never)).toBe('https://nm-e2e-relay-0-42.us-east4.run.app');
    // RELAY_SELF_URL still wins, and a list of one is no shard list (Cloud Run's own URL then)
    expect(await resolveSelfUrl({ RELAY_SELF_URL: 'https://own.example', RELAY_SHARDS: shards, RELAY_SHARD_INDEX: '1' }, never)).toBe('https://own.example');
    const metadata = (async () => new Response('projects/42/regions/us-east4')) as typeof fetch;
    expect(await resolveSelfUrl({ RELAY_SHARDS: 'wss://one', RELAY_SHARD_INDEX: '0', K_SERVICE: 'nm-e2e-relay' }, metadata)).toBe('https://nm-e2e-relay-42.us-east4.run.app');
  });
});
