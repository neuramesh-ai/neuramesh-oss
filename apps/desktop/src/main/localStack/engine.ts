// WHICH CONTAINER ENGINE THIS MAC HAS, and whether it is running (review F3).
//
// Three answers, told apart because each gets a different next move: a running engine is used as
// found; a stopped one is started by the app, no button; none at all asks one question — which
// runtime — and installs the pick. Pure around injected probes so the table of PATH and socket
// cases is a unit test, not a laptop.
import { join } from 'node:path';

export type EngineKind = 'docker-desktop' | 'orbstack' | 'colima' | 'other';

export interface EngineProbe {
  engine: EngineKind | null;
  running: boolean;
  /** the docker CLI to drive compose with — null when the engine exists but the CLI does not
   *  (Colima ships without one; the install lane fetches the static build) */
  dockerBin: string | null;
  /** the socket the running engine answered on — DOCKER_HOST for every command we run */
  socket: string | null;
}

/** the sockets the engines listen on, in the order we look (the app's own Colima last of the named) */
export const engineSockets = (home: string): Array<{ path: string; engine: EngineKind }> => [
  { path: join(home, '.docker', 'run', 'docker.sock'), engine: 'docker-desktop' },
  { path: join(home, '.orbstack', 'run', 'docker.sock'), engine: 'orbstack' },
  { path: join(home, '.colima', 'default', 'docker.sock'), engine: 'colima' },
  { path: '/var/run/docker.sock', engine: 'other' },
];

/** the bin dir the install lane fills — looked at before PATH, so the app's own CLI wins. `root` is
 *  brainRoot() (harness/brain.ts): ~/.neuramesh by default, the profile's own root under NM_USERDATA */
export const nmBinDir = (root: string): string => join(root, 'bin');

export interface EngineDeps {
  /** the real home — where the engines put their sockets */
  home: string;
  /** brainRoot() — where OUR binaries live */
  root: string;
  /** resolve a binary on the Finder-launch PATH (runtime/cli.ts which) */
  which: (bin: string) => Promise<string | null>;
  exists: (path: string) => boolean;
  /** `docker info --format '{{.OperatingSystem}}'` against a socket — ok when the daemon answers */
  dockerInfo: (dockerBin: string, socket: string | null) => Promise<{ ok: boolean; os?: string }>;
}

/** what `docker info` calls the engine, mapped onto our four */
export function engineFromOs(os: string | undefined): EngineKind {
  const s = (os ?? '').toLowerCase();
  if (s.includes('docker desktop')) return 'docker-desktop';
  if (s.includes('orbstack')) return 'orbstack';
  if (s.includes('colima') || s.includes('lima')) return 'colima';
  return 'other';
}

/** an installed-but-stopped engine leaves these behind */
function installedEngine(d: EngineDeps): Promise<EngineKind | null> {
  if (d.exists('/Applications/OrbStack.app')) return Promise.resolve('orbstack');
  if (d.exists('/Applications/Docker.app')) return Promise.resolve('docker-desktop');
  if (d.exists(join(nmBinDir(d.root), 'colima'))) return Promise.resolve('colima');
  return d.which('colima').then((p) => (p ? 'colima' : null));
}

export async function detectEngine(d: EngineDeps): Promise<EngineProbe> {
  const own = join(nmBinDir(d.root), 'docker');
  const dockerBin = d.exists(own) ? own : await d.which('docker');
  const present = engineSockets(d.home).filter((s) => d.exists(s.path));
  if (dockerBin) {
    // a socket that ANSWERS is a running engine, whatever left it there
    for (const s of present) {
      const info = await d.dockerInfo(dockerBin, s.path);
      if (info.ok) return { engine: s.engine === 'other' ? engineFromOs(info.os) : s.engine, running: true, dockerBin, socket: s.path };
    }
    // the CLI's own context may point somewhere we did not list
    const info = await d.dockerInfo(dockerBin, null);
    if (info.ok) return { engine: engineFromOs(info.os), running: true, dockerBin, socket: null };
  }
  // nothing answered: installed and stopped, or not installed at all
  const installed = present[0]?.engine ?? await installedEngine(d);
  return { engine: installed, running: false, dockerBin, socket: present[0]?.path ?? null };
}

/** how the app starts a stopped engine — the user is never asked to (review F3, A2) */
export function startCommand(engine: EngineKind, root: string): { bin: string; args: string[] } | null {
  switch (engine) {
    case 'colima': return { bin: join(nmBinDir(root), 'colima'), args: ['start'] };
    case 'orbstack': return { bin: 'open', args: ['-a', 'OrbStack', '--background'] };
    case 'docker-desktop': return { bin: 'open', args: ['-a', 'Docker', '--background'] };
    default: return null;
  }
}

/** the first-run install: the exact arguments Colima is started with (2 CPUs, 4 GB, 20 GB, vz — no password) */
export const COLIMA_START_ARGS = ['start', '--vm-type', 'vz', '--cpu', '2', '--memory', '4', '--disk', '20'] as const;
