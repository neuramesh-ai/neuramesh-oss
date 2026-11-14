// nm-api calls for the live checks (Node 24, no dependencies): the e2e doors with the fleet secret, and
// the actor-header lane (x-nm-actor plus x-nm-actor-secret) that stands in for a signed-in person.
// The same lanes run.mjs uses. Nothing here logs a secret.
//
//   import { Api } from './lib/api.mjs';
//   const api = new Api({ url, fleetSecret, actorSecret });
//   const { userId } = await api.door('POST', '/internal/e2e/users', { email });
//   const ws = await api.as(userId).cmd({ type: 'workspace.create', name, slug });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Api {
  constructor({ url, fleetSecret, actorSecret = '', actor = null }) {
    this.url = url.replace(/\/+$/, '');
    Object.assign(this, { fleetSecret, actorSecret, actor });
  }
  /** the same client, acting as the human `userId` */
  as(userId) { return new Api({ url: this.url, fleetSecret: this.fleetSecret, actorSecret: this.actorSecret, actor: userId }); }

  async call(method, path, { body, fleet = false, ok = true } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (fleet) headers.authorization = `Bearer ${this.fleetSecret}`;
    else if (this.actor) {
      headers['x-nm-actor'] = JSON.stringify({ kind: 'human', id: this.actor });
      if (this.actorSecret) headers['x-nm-actor-secret'] = this.actorSecret;
    }
    const res = await fetch(`${this.url}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    if (ok && !res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`), { status: res.status, json });
    return ok ? json : { status: res.status, json, text };
  }
  door(method, path, body) { return this.call(method, path, { body, fleet: true }); }
  get(path) { return this.call('GET', path); }
  post(path, body) { return this.call('POST', path, { body }); }
  cmd(c) { return this.post('/v1/commands', c); }

  machine(id) { return this.door('GET', `/internal/e2e/machines/${id}`); }

  /** a fresh e2e person with a fresh workspace (born with its runner), funded, as run.mjs sets one up */
  async freshWorkspace(tag, { plan = 'cloud', credits = 3000 } = {}) {
    const { userId } = await this.door('POST', '/internal/e2e/users', { email: `${tag}@e2e.invalid` });
    const me = this.as(userId);
    const made = await me.cmd({ type: 'workspace.create', name: `R6 ${tag}`, slug: tag });
    const usage = await me.get(`/v1/machines/usage?workspace=${made.workspaceId}`);
    let machineId = usage?.machines?.find((m) => m.kind === 'runner')?.id;
    if (!machineId) machineId = (await this.door('POST', '/internal/machines', { workspaceId: made.workspaceId, kind: 'runner', ownerUserId: userId, name: 'runner' })).machineId;
    await this.door('POST', `/internal/e2e/workspaces/${made.workspaceId}/fund`, { plan, credits });
    return { userId, workspaceId: made.workspaceId, channelId: made.channelId, machineId, api: me };
  }

  /** wait until the machine row reports this epoch alive: last_seen_at moves twice while `pred` holds */
  async running(id, pred = (m) => m.epoch >= 1 && m.drain_state === null && m.desired_replicas === 1, ms = 300_000) {
    const deadline = Date.now() + ms;
    let prev = null; let moves = 0;
    for (;;) {
      const m = await this.machine(id).catch(() => null);
      if (m) {
        const moved = prev !== null && !!m.last_seen_at && m.last_seen_at !== prev;
        prev = m.last_seen_at ?? '';
        moves = pred(m) ? (moved ? moves + 1 : moves) : 0;
        if (moves >= 2) return m;
      }
      if (Date.now() > deadline) throw new Error(`machine ${id} did not report running in ${Math.round(ms / 1000)} s: ${JSON.stringify(m ?? {}).slice(0, 300)}`);
      await sleep(2_500);
    }
  }

  /** idle-drain (unless it sleeps already) and wait for silence: desired 0, no drain, no beat for 20 s */
  async park(id, ms = 300_000) {
    const now = await this.machine(id);
    // a drain already under way (a roll, the idle sweep) answers 409 NOT_RUNNING: wait for it instead
    if (!(now.desired_replicas === 0 && now.drain_state === null)) {
      await this.call('POST', `/internal/machines/${id}/idle-drain`, { body: {}, fleet: true, ok: false });
    }
    const deadline = Date.now() + ms;
    let quiet = null; let seen = null;
    for (;;) {
      const m = await this.machine(id).catch(() => null);
      if (m && m.desired_replicas === 0 && m.drain_state === null) {
        if (m.last_seen_at !== seen) { seen = m.last_seen_at; quiet = Date.now(); } else if (Date.now() - quiet >= 20_000) return m;
      } else quiet = null;
      if (Date.now() > deadline) throw new Error(`machine ${id} did not park in ${Math.round(ms / 1000)} s`);
      await sleep(2_500);
    }
  }

  /** the last drain's work snapshot: { key, tar } (zstd-decompressed) */
  async workSnapshot(id) {
    const { zstdDecompressSync } = await import('node:zlib');
    const { url, key } = await this.door('GET', `/internal/e2e/machines/${id}/snapshot`);
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`snapshot download ${res.status}`);
    return { key, tar: zstdDecompressSync(Buffer.from(await res.arrayBuffer())) };
  }
}

/** the regular files in a tar whose names pass `pred`: [{ name, data }] (ustar and GNU long names) */
export function tarEntries(buf, pred = () => true) {
  const out = [];
  let longName = null;
  for (let off = 0; off + 512 <= buf.length;) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const name = longName ?? (str(345, 500) ? `${str(345, 500)}/${str(0, 100)}` : str(0, 100));
    const data = buf.subarray(off + 512, off + 512 + size);
    longName = type === 'L' ? data.toString('utf8').replace(/\0.*$/s, '') : null;
    if ((type === '0' || type === '\0') && pred(name)) out.push({ name, data });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
