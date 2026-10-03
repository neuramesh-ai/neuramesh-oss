// launching the machine's chromium (models-and-replies round, board C3). one process per profile:
// the person's browser keeps its profile on the machine's state volume, so a sign-in survives the
// next wake, and the agents' browser gets a fresh profile in a temporary folder that dies with it.
// two processes, never two contexts in one, so no agent call can ever open a page in the person's
// cookie jar, and each idles out on its own clock (service.ts).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { cdpOverPipe, type Cdp } from './cdp';

/** the machine image installs Debian's chromium here (infra/images/machine/Dockerfile) */
export const CHROMIUM_DEFAULT = '/usr/bin/chromium';

/** the browser binary, or null where there is none (the desktop app, an image from before C3) */
export function chromiumBin(env: NodeJS.ProcessEnv = process.env): string | null {
  const bin = env['NM_CHROMIUM'] || CHROMIUM_DEFAULT;
  return existsSync(bin) ? bin : null;
}

export interface LaunchOpts { bin: string; profileDir: string; proxyPort: number; width: number; height: number }

/** the flags, as a pure list so a test can read every one */
export function chromiumArgs(o: Omit<LaunchOpts, 'bin'>): string[] {
  return [
    // the image runs as root under gVisor, where Chromium's own sandbox cannot start (it needs user
    // namespaces). the pod and gVisor are the boundary, as they are for the agents' shells
    '--headless=new', '--no-sandbox',
    // a pod's /dev/shm is 64 MB, and renderers crash once it fills
    '--disable-dev-shm-usage',
    // CDP over fds 3 and 4, never a port: a loopback port is one request away from every agent
    // shell on the machine, and the person's browser holds their sign-ins
    '--remote-debugging-pipe',
    `--user-data-dir=${o.profileDir}`,
    // every connection leaves through the egress proxy, loopback too (<-loopback drops Chromium's
    // own bypass for it), and no UDP leaves at all: QUIC and WebRTC would go around the proxy
    `--proxy-server=http://127.0.0.1:${o.proxyPort}`, '--proxy-bypass-list=<-loopback>', '--disable-quic',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    `--window-size=${o.width},${o.height}`,
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-component-update',
    '--password-store=basic', '--mute-audio', '--disable-gpu',
    'about:blank',
  ];
}

export interface Chromium { cdp: Cdp; exited: Promise<void>; close(): Promise<void> }

export async function launchChromium(o: LaunchOpts): Promise<Chromium> {
  mkdirSync(o.profileDir, { recursive: true, mode: 0o700 });
  // a lock left by a browser from an earlier pod names that pod, and Chromium would refuse the
  // profile as in use. this daemon is the profile's only user, so the old lock is stale by definition
  for (const lock of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) rmSync(join(o.profileDir, lock), { force: true });
  const proc = spawn(o.bin, chromiumArgs(o), { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  const tail: string[] = [];
  proc.stderr?.on('data', (d: Buffer) => { tail.push(String(d)); if (tail.length > 30) tail.shift(); });
  const exited = new Promise<void>((resolve) => { proc.once('exit', () => resolve()); proc.once('error', () => resolve()); });
  if (!proc.stdio[3] || !proc.stdio[4]) { proc.kill('SIGKILL'); throw new Error('Chromium did not start: no debugging pipe'); }
  const cdp = cdpOverPipe(proc.stdio[3] as Writable, proc.stdio[4] as Readable);
  void exited.then(() => cdp.close());
  try {
    // the first command proves the pipe answers, or the error says why the browser did not start
    await cdp.send('Browser.getVersion');
  } catch {
    proc.kill('SIGKILL');
    throw new Error(`Chromium did not start: ${tail.join('').trim().split('\n').slice(-3).join(' ').slice(0, 400) || 'no output'}`);
  }
  return {
    cdp,
    exited,
    close: async () => {
      await cdp.send('Browser.close').catch(() => {});
      const kill = setTimeout(() => proc.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(kill);
    },
  };
}
