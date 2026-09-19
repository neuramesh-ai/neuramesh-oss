// THE BOOT'S CHECKS (the first-run round, 2026-09-18): what the driver asks Docker BEFORE it makes a
// container (are our two ports free, is a container wedged) and WHILE the containers come up (each
// one's status, exit code and restart count, every poll), so the card draws the boot order and a
// failure arrives as a cause, the container's own last line, and a remedy — in seconds, never as
// a 90-second "not healthy". The story behind every check: a first start failed on a taken port
// (the dev stack held 127.0.0.1:58081), Docker Desktop then dropped the container's network, and
// every later start "succeeded" with no network, so PowerSync died at its first query forever.
// Compose kept the container because its config had not changed, so Try again could never fix it.
import { PROJECT_NAME, SERVICES } from './compose';
import type { ServiceStatus, StackEvent } from './driver';
import { portFree as realPortFree, run, waitFor, type SpawnFn } from './proc';

/**
 * An error the card can explain: `message` is the cause in plain words, `detail` the container's
 * own last line or the port and who holds it, `remedy` what Try again does. `failed` names the
 * services the next `up` recreates first.
 */
export class StackError extends Error {
  detail?: string;
  remedy?: string;
  failed?: string[];
  constructor(message: string, o: { detail?: string; remedy?: string; failed?: string[] } = {}) {
    super(message);
    this.detail = o.detail;
    this.remedy = o.remedy;
    this.failed = o.failed;
  }
}

/** what the checks need from the driver: how to spawn docker, and where the card's events go */
export interface HealthCtx {
  spawn: SpawnFn;
  dockerBin: string;
  dockerEnv: NodeJS.ProcessEnv;
  env: NodeJS.ProcessEnv;
  emit: (ev: StackEvent) => void;
  log: (line: string) => void;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => number;
  portFree?: (port: number) => Promise<boolean>;
}

/** one `docker inspect` line per service: status · exit code · restarts · health · how many networks */
export const INSPECT_FORMAT = '{{.State.Status}}|{{.State.ExitCode}}|{{.RestartCount}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{len .NetworkSettings.Networks}}';
export interface Inspected { status: string; exitCode: number; restarts: number; health: string; networks: number }
export function parseInspect(out: string): Inspected | null {
  const m = /^([a-z]+)\|(-?\d+)\|(\d+)\|([a-z]+)\|(\d+)\s*$/.exec(out.trim());
  return m ? { status: m[1]!, exitCode: Number(m[2]), restarts: Number(m[3]), health: m[4]!, networks: Number(m[5]) } : null;
}

/** the last line of a container's log a person can act on: an error-level JSON line's message
 *  (PowerSync, the control API) over the last non-empty line, cut to one card row */
export function pickLastLine(log: string): string | null {
  const lines = log.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.startsWith('{') || !/"level"\s*:\s*"error"/.test(line)) continue;
    try { const j = JSON.parse(line) as { message?: unknown }; if (typeof j.message === 'string' && j.message.trim()) return j.message.trim().slice(0, 200); } catch { /* not JSON after all */ }
  }
  const last = lines[lines.length - 1];
  return last ? last.slice(0, 200) : null;
}

/** how many times a service may be seen dead, or die, before the wait ends with its last line */
export const STRIKES = 3;
export const DEATHS = 2;

export const label = (service: string): string => SERVICES.find((s) => s.service === service)?.label ?? service;
const container = (service: string) => `${PROJECT_NAME}-${service}-1`;

export async function inspectService(c: HealthCtx, service: string): Promise<Inspected | null> {
  const r = await run(c.spawn, c.dockerBin, ['inspect', '--format', INSPECT_FORMAT, container(service)], { env: c.dockerEnv, timeoutMs: 10_000 });
  return r.code === 0 ? parseInspect(r.out) : null;
}

/** a container with NO network is wedged (above): compose never makes one, so zero networks can only
 *  be the endpoint Docker dropped after a failed start. Named, and `up` removes it first. */
export async function wedgedServices(c: HealthCtx): Promise<string[]> {
  const out: string[] = [];
  for (const { service } of SERVICES) {
    const st = await inspectService(c, service);
    if (st && st.networks === 0) { out.push(service); c.log(`${service} has no network (status=${st.status} restarts=${st.restarts}): it is recreated`); }
  }
  return out;
}

/**
 * The two loopback ports, before a container is made. A port another container or program holds
 * fails the start in Docker's words and wedges the container; said up front it is one sentence and
 * one fix. Our own container from a previous session is fine: Docker holds the port for us, so
 * `docker ps` names it and the OS probe is skipped.
 */
export async function preflightPorts(c: HealthCtx, ports: { api: number; powersync: number }): Promise<void> {
  for (const { port, service } of [{ port: ports.api, service: 'control-api' }, { port: ports.powersync, service: 'powersync' }]) {
    const r = await run(c.spawn, c.dockerBin, ['ps', '--filter', `publish=${port}`, '--format', '{{.Names}}'], { env: c.dockerEnv, timeoutMs: 10_000 });
    const names = r.code === 0 ? r.out.split('\n').map((l) => l.trim()).filter(Boolean) : [];
    if (names.includes(container(service))) continue;
    const holder = names[0] ? `${names[0]} (Docker)` : (await (c.portFree ?? realPortFree)(port)) ? null : await portHolder(c, port);
    if (holder) throw new StackError(`Port ${port} is in use by another program.`, { detail: `127.0.0.1:${port} · held by ${holder}`, remedy: 'Stop that program, then try again.' });
  }
}

/** who listens on a port outside Docker, when lsof can say: `node (pid 11819)` */
async function portHolder(c: HealthCtx, port: number): Promise<string> {
  const r = await run(c.spawn, 'lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'], { env: c.env, timeoutMs: 3000 });
  const pid = /^p(\d+)$/m.exec(r.out)?.[1];
  const cmd = /^c(.+)$/m.exec(r.out)?.[1]?.trim();
  return cmd ? `${cmd}${pid ? ` (pid ${pid})` : ''}` : 'a program outside Docker';
}

/**
 * Each container's own healthcheck, polled for `budgetMs` once the images exist. Every poll also
 * reads the container's status, so the card draws the boot order (queued → starting → ready) and a
 * crash loop ends the wait in seconds with the container's own last line: a service seen dead
 * STRIKES times, or that died DEATHS times since first sight.
 */
export async function awaitHealth(c: HealthCtx, budgetMs: number): Promise<void> {
  const pending = new Set(SERVICES.map((s) => s.service));
  const seen = new Map<string, { status: ServiceStatus; strikes: number; firstRestarts: number }>();
  const fail: { at: { svc: string; deaths: number } | null } = { at: null };
  const ok = await waitFor(async () => {
    for (const svc of [...pending]) {
      const st = await inspectService(c, svc);
      if (!st) continue;
      // `up` drew every service queued, so the first status a poll emits is the first change
      const prev = seen.get(svc) ?? { status: 'queued' as ServiceStatus, strikes: 0, firstRestarts: st.restarts };
      if (st.health === 'healthy') { pending.delete(svc); c.emit({ type: 'service', service: label(svc), status: 'ready', restarts: st.restarts }); continue; }
      const dead = st.status === 'restarting' || st.status === 'exited' || st.status === 'dead';
      const status: ServiceStatus = dead ? 'stopped' : st.status === 'running' ? 'starting' : 'queued';
      const next = { status, strikes: prev.strikes + (dead ? 1 : 0), firstRestarts: prev.firstRestarts };
      seen.set(svc, next);
      if (status !== prev.status) c.emit({ type: 'service', service: label(svc), status, restarts: st.restarts });
      const died = st.restarts - next.firstRestarts;
      if (next.strikes >= STRIKES || died >= DEATHS) { fail.at = { svc, deaths: Math.max(next.strikes, died, st.restarts, 1) }; return true; }
    }
    return pending.size === 0;
  }, { everyMs: 2000, budgetMs, sleepImpl: c.sleepImpl, now: c.now });
  if (fail.at) {
    const { svc, deaths } = fail.at;
    const times = `${deaths} ${deaths === 1 ? 'time' : 'times'}`;
    const logs = await run(c.spawn, c.dockerBin, ['logs', '--tail', '40', container(svc)], { env: c.dockerEnv, timeoutMs: 10_000 });
    const line = pickLastLine(`${logs.out}\n${logs.err}`);
    throw new StackError(`${label(svc)} stopped ${times}.`, { detail: line ?? `${label(svc)} exited and restarted ${times}.`, remedy: `Try again starts a fresh ${label(svc)} container.`, failed: [svc] });
  }
  if (!ok) throw new StackError(`The local stack did not start in ${Math.round(budgetMs / 1000)} seconds.`, { detail: `${[...pending].map(label).join(', ')} not healthy`, remedy: 'Try again starts fresh containers.', failed: [...pending] });
}

/** a failed `compose up`, read: the containers it names are recreated next (all when it names none),
 *  and a taken port in Docker's words becomes the port card */
export function composeFailure(text: string): StackError {
  const named = [...new Set([...text.matchAll(new RegExp(`${PROJECT_NAME}-([a-z-]+)-1`, 'g'))].map((m) => m[1]!))].filter((s) => SERVICES.some((x) => x.service === s));
  const failed = named.length ? named : SERVICES.map((s) => s.service);
  const port = /Bind for 127\.0\.0\.1:(\d+) failed: port is already allocated/.exec(text);
  if (port) return new StackError(`Port ${port[1]} is in use by another program.`, { detail: text.slice(-240), remedy: 'Stop that program, then try again.', failed });
  return new StackError('The local stack did not start.', { detail: text.slice(-240), remedy: 'Try again starts fresh containers.', failed });
}
