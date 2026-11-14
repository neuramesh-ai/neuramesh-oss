// THE MACHINE'S BROWSER IN THE AGENT BOX (round 6). Chromium runs with --no-sandbox, because gVisor
// gives it no user namespace for its own sandbox. In the supervisor that put every renderer one
// exploit away from the epoch token, the boot credential on /proc/1/environ, the staged keys in the
// secrets dir and the metadata server: the same hole the supervisor terminal was (round 4). In the
// box, a renderer that escapes finds root in a box that holds none of those, the metadata server
// blocked, and no route back into the supervisor but the veth helpers that demand a bearer.
//
// HOW CDP CROSSES. `sandbox exec` carries stdin and stdout only, so no fd 3 or 4 reaches the box.
// The in-box shell maps them: Chromium reads its debugging pipe on fd 3 (`3<&0`, the exec's stdin)
// and writes on fd 4 (`4>&1`, the exec's stdout), and its own stdout goes to /dev/null so nothing
// else lands in the CDP stream. No debugging port exists, in the box or here (measured on Cloud Run
// 2026-10-30: Browser.getVersion answered through exactly this redirect).
//
// WHERE ITS TRAFFIC GOES (the box link, round 6): through the supervisor's egress proxy and its address
// guard, which the box link (boxlink.ts) opens on the box's own loopback, so every non-loopback request
// passes the guard again. When the link is down: straight out of the box, as below.
//
// Before the box link: straight out of the box, with no proxy. The first build put the supervisor's
// egress proxy on the veth IP, but on 2026-11-02 the box reached no supervisor port at all (the proxy,
// the tool bus and the agents' proxy forward all timed out), and the box's own egress reached only the
// public internet: the metadata server, Cloud SQL's private IP, the machine subnet and the veth were all
// closed (browser-lane.mjs, scripts/e2e-cloudrun). So the platform floor is the boundary for the page's
// requests, and the address guard still checks every navigation and every agent call before it goes
// (checkUrl, resolveAllowed). Loopback is the box's own dev servers, which is what a preview is
// (address-guard.ts `setLoopbackPreview`). The supervisor's loopback is never reachable: 127.0.0.1 in
// the box is the box.
//
// PROFILES. The agents' browser and, on a runner, the person's browser use a profile under /tmp in
// the box that goes when the browser stops: a runner's box is shared by every agent and member of the
// workspace, and cookies are credentials. Only a member machine (one owner) keeps the person's profile
// in the box home, which rides the box overlay snapshot across a drain.
import type { ChildProcess } from 'node:child_process';
import { basename } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { cdpOverPipe } from '../browser/cdp';
import { chromiumArgs, type Chromium, type LaunchOpts } from '../browser/chromium';
import { shQuote, type BoxManager } from './box';

/** ephemeral profiles: the agents' browser, and the person's on a runner */
export const BOX_BROWSER_TMP = '/tmp/nm-browser';
/** kept profiles: the person's browser on a member machine (box overlay, so it crosses a drain) */
export const BOX_BROWSER_KEEP = '/root/.nm-browser';
/** where each launch records the browser's pid in the box, so a stuck browser can be killed */
const PID_DIR = '/tmp/nm-browser-pids';

export type BrowserLane = 'box' | 'supervisor' | 'off';
/** what the launcher uses of BoxManager (a test fakes it) */
export type BrowserBox = Pick<BoxManager, 'exec' | 'execWait' | 'signal'>;

/** NM_BROWSER_LANE: `box` (the Cloud Run default), `supervisor` (the GKE behavior, never the default
 *  on Cloud Run) or `off`. Off Cloud Run the browser stays where it was */
export function browserLaneOf(env: NodeJS.ProcessEnv, cloudrun: boolean): BrowserLane {
  const v = (env['NM_BROWSER_LANE'] ?? '').trim();
  if (v === 'box' || v === 'supervisor' || v === 'off') return v;
  if (v) throw new Error(`NM_BROWSER_LANE=${v} must be box, supervisor or off`);
  return cloudrun ? 'box' : 'supervisor';
}

const SAFE = /[^a-zA-Z0-9_-]/g;

/** the box dir for a profile the service named by its host path: the person's (`person-<actor>`) or a
 *  temporary one. Only the person's profile on a member machine is kept */
export function boxProfileDir(hostProfileDir: string, keepPerson: boolean): { dir: string; keep: boolean } {
  const name = basename(hostProfileDir).replace(SAFE, '_').slice(0, 100) || 'profile';
  const keep = keepPerson && name.startsWith('person-');
  return { dir: `${keep ? BOX_BROWSER_KEEP : BOX_BROWSER_TMP}/${name}`, keep };
}

/** the in-box command: clear a stale lock (a profile from an earlier box names a dead host), then
 *  exec Chromium with its debugging pipe mapped onto the exec's stdio. Pure, so a test reads it */
export function boxChromiumCommand(o: Omit<LaunchOpts, 'profileDir'> & { profileDir: string; proxyHost: string; direct?: boolean }): string[] {
  const args = chromiumArgs({ profileDir: o.profileDir, proxyPort: o.proxyPort, proxyHost: o.proxyHost, loopbackDirect: true, direct: o.direct ?? true, width: o.width, height: o.height });
  const dir = shQuote(o.profileDir);
  const script = `mkdir -p ${dir} && chmod 700 ${dir} && rm -f ${dir}/SingletonLock ${dir}/SingletonSocket ${dir}/SingletonCookie && exec ${[o.bin, ...args].map(shQuote).join(' ')} 3<&0 4>&1 >/dev/null`;
  return ['/bin/sh', '-c', script];
}

export interface BoxChromiumOptions {
  box: () => BrowserBox | null;
  /** why the box is down, or null */
  boxDown?: () => string | null;
  /** the veth IP the egress proxy listens on, as the box sees it */
  proxyHost: string;
  /** no proxy (the default): the box's own egress, which reaches only the public internet. false puts
   *  the supervisor's egress proxy back in front, for a box that can reach the veth IP */
  direct?: boolean;
  /** THE BOX LINK (boxlink.ts): opens the supervisor's egress proxy on the box's loopback and answers
   *  the box port. With it the browser goes through the proxy at 127.0.0.1:<box port>; when it answers
   *  null or fails (the link is down) the launch falls back to direct, and says so */
  proxyVia?: (proxyPort: number) => Promise<number | null>;
  /** keep the person's profile across a drain: member machines only */
  keepPersonProfiles: boolean;
  log?: (line: string) => void;
  /** how long a close waits for the browser before it kills it */
  closeWaitMs?: number;
}

let launches = 0;

/** a `launch` for the browser service (service.ts) that starts Chromium in the agent box */
export function createBoxChromiumLauncher(o: BoxChromiumOptions): (lo: LaunchOpts) => Promise<Chromium> {
  const log = o.log ?? (() => {});
  return async (lo) => {
    const box = o.box();
    if (!box) throw new Error(`the agent box is down${o.boxDown?.() ? ` (${o.boxDown()})` : ''}, and the browser runs only there`);
    const { dir, keep } = boxProfileDir(lo.profileDir, o.keepPersonProfiles);
    const pidFile = `${PID_DIR}/b${process.pid}-${++launches}-${Date.now()}.pid`;
    // through the box link when it can open the proxy, else straight out (the floor still holds)
    let route: { direct: boolean; proxyHost: string; proxyPort: number } = { direct: o.direct ?? true, proxyHost: o.proxyHost, proxyPort: lo.proxyPort };
    if (o.proxyVia && lo.proxyPort) {
      const boxPort = await o.proxyVia(lo.proxyPort).catch((e: unknown) => { log(`browser_box_proxy unavailable, direct: ${e instanceof Error ? e.message : String(e)}`); return null; });
      if (boxPort) route = { direct: false, proxyHost: '127.0.0.1', proxyPort: boxPort };
    }
    const child: ChildProcess = box.exec(boxChromiumCommand({ ...lo, profileDir: dir, proxyHost: route.proxyHost, proxyPort: route.proxyPort, direct: route.direct }), { stdin: 'pipe', pidFile, mkdirs: [PID_DIR] });
    const tail: string[] = [];
    child.stderr?.on('data', (d: Buffer) => { tail.push(String(d)); if (tail.length > 30) tail.shift(); });
    const exited = new Promise<void>((resolve) => { child.once('close', () => resolve()); child.once('error', () => resolve()); });
    if (!child.stdin || !child.stdout) { child.kill('SIGKILL'); throw new Error('Chromium did not start in the box: no stdio'); }
    const cdp = cdpOverPipe(child.stdin as Writable, child.stdout as Readable);
    void exited.then(() => cdp.close());
    const cleanup = async (): Promise<void> => {
      const b = o.box();
      if (!b) return;
      await b.signal(pidFile, 'KILL').catch(() => null);
      // an ephemeral profile holds cookies: it goes with its browser
      if (!keep) await b.execWait(['/bin/rm', '-rf', '--', dir]).catch(() => null);
    };
    try {
      await cdp.send('Browser.getVersion');
    } catch {
      child.kill('SIGKILL');
      await cleanup();
      throw new Error(`Chromium did not start in the box: ${tail.join('').trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'no output'}`);
    }
    log(`browser_box_start profile=${keep ? 'kept' : 'ephemeral'} dir=${dir} route=${route.direct ? 'direct' : `proxy ${route.proxyHost}:${route.proxyPort}`}`);
    return {
      cdp,
      exited,
      close: async () => {
        await cdp.send('Browser.close').catch(() => {});
        let timer: ReturnType<typeof setTimeout> | null = null;
        const late = await Promise.race([exited.then(() => false), new Promise<boolean>((r) => { timer = setTimeout(() => r(true), o.closeWaitMs ?? 5_000); })]);
        if (timer) clearTimeout(timer);
        if (late) child.kill('SIGKILL');
        await cleanup();
      },
    };
  };
}
