// Engine detection over a table of PATH and socket cases (review F3): a running engine is used as
// found, a stopped one is started, none at all asks which to install.
//   pnpm exec tsx --test src/main/localStack/engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLIMA_START_ARGS, detectEngine, engineFromOs, engineSockets, startCommand, type EngineDeps } from './engine';

const HOME = '/home/dana';
const ROOT = `${HOME}/.neuramesh`;
const SOCK = {
  dd: `${HOME}/.docker/run/docker.sock`,
  orb: `${HOME}/.orbstack/run/docker.sock`,
  colima: `${HOME}/.colima/default/docker.sock`,
  system: '/var/run/docker.sock',
};

/** a laptop: which files exist, what `which` finds, which sockets answer `docker info` */
function laptop(o: { files?: string[]; path?: Record<string, string>; answers?: Record<string, string>; contextOs?: string }): EngineDeps & { infoCalls: Array<string | null> } {
  const files = new Set(o.files ?? []);
  const infoCalls: Array<string | null> = [];
  return {
    home: HOME,
    root: ROOT,
    infoCalls,
    which: async (bin) => o.path?.[bin] ?? null,
    exists: (p) => files.has(p),
    dockerInfo: async (_bin, socket) => {
      infoCalls.push(socket);
      if (socket === null) return o.contextOs ? { ok: true, os: o.contextOs } : { ok: false };
      const os = o.answers?.[socket];
      return os ? { ok: true, os } : { ok: false };
    },
  };
}

const cases: Array<{ name: string; laptop: ReturnType<typeof laptop>; want: Awaited<ReturnType<typeof detectEngine>> }> = [
  {
    name: 'Docker Desktop running: its socket answers, the CLI is on PATH',
    laptop: laptop({ files: [SOCK.dd], path: { docker: '/usr/local/bin/docker' }, answers: { [SOCK.dd]: 'Docker Desktop' } }),
    want: { engine: 'docker-desktop', running: true, dockerBin: '/usr/local/bin/docker', socket: SOCK.dd },
  },
  {
    name: 'OrbStack running beside a stale Docker Desktop socket: the one that answers wins',
    laptop: laptop({ files: [SOCK.dd, SOCK.orb], path: { docker: '/usr/local/bin/docker' }, answers: { [SOCK.orb]: 'OrbStack' } }),
    want: { engine: 'orbstack', running: true, dockerBin: '/usr/local/bin/docker', socket: SOCK.orb },
  },
  {
    name: 'Colima running with the app\'s own CLI: ~/.neuramesh/bin/docker beats PATH',
    laptop: laptop({ files: [SOCK.colima, `${ROOT}/bin/docker`], path: { docker: '/opt/homebrew/bin/docker' }, answers: { [SOCK.colima]: 'Ubuntu (colima)' } }),
    want: { engine: 'colima', running: true, dockerBin: `${ROOT}/bin/docker`, socket: SOCK.colima },
  },
  {
    name: 'a system socket names its engine from docker info',
    laptop: laptop({ files: [SOCK.system], path: { docker: '/usr/local/bin/docker' }, answers: { [SOCK.system]: 'OrbStack' } }),
    want: { engine: 'orbstack', running: true, dockerBin: '/usr/local/bin/docker', socket: SOCK.system },
  },
  {
    name: 'no listed socket, but the CLI\'s own context answers (a remote or custom DOCKER_HOST)',
    laptop: laptop({ path: { docker: '/usr/local/bin/docker' }, contextOs: 'Docker Desktop' }),
    want: { engine: 'docker-desktop', running: true, dockerBin: '/usr/local/bin/docker', socket: null },
  },
  {
    name: 'Docker Desktop installed and stopped: the app bundle is there, no socket answers',
    laptop: laptop({ files: ['/Applications/Docker.app'], path: { docker: '/usr/local/bin/docker' } }),
    want: { engine: 'docker-desktop', running: false, dockerBin: '/usr/local/bin/docker', socket: null },
  },
  {
    name: 'a stopped engine that left its socket file behind is still stopped, and still named',
    laptop: laptop({ files: [SOCK.orb], path: { docker: '/usr/local/bin/docker' } }),
    want: { engine: 'orbstack', running: false, dockerBin: '/usr/local/bin/docker', socket: SOCK.orb },
  },
  {
    name: 'Colima installed by us, stopped, and no docker CLI anywhere: engine known, CLI absent',
    laptop: laptop({ files: [`${ROOT}/bin/colima`] }),
    want: { engine: 'colima', running: false, dockerBin: null, socket: null },
  },
  {
    name: 'Colima from Homebrew, stopped',
    laptop: laptop({ path: { colima: '/opt/homebrew/bin/colima', docker: '/opt/homebrew/bin/docker' } }),
    want: { engine: 'colima', running: false, dockerBin: '/opt/homebrew/bin/docker', socket: null },
  },
  {
    name: 'a bare Mac: nothing on PATH, no sockets, no apps — the picker',
    laptop: laptop({}),
    want: { engine: null, running: false, dockerBin: null, socket: null },
  },
  {
    name: 'a Finder-launch PATH that lost docker: sockets alone cannot say "running"',
    laptop: laptop({ files: [SOCK.dd], answers: { [SOCK.dd]: 'Docker Desktop' } }),
    want: { engine: 'docker-desktop', running: false, dockerBin: null, socket: SOCK.dd },
  },
];

for (const c of cases) {
  test(`detectEngine: ${c.name}`, async () => {
    assert.deepEqual(await detectEngine(c.laptop), c.want);
  });
}

test('detectEngine never asks docker info without a CLI to ask with', async () => {
  const l = laptop({ files: [SOCK.dd] });
  await detectEngine(l);
  assert.deepEqual(l.infoCalls, []);
});

test('the socket table is in the order we look, the app\'s own Colima socket among the named', () => {
  assert.deepEqual(engineSockets(HOME).map((s) => [s.engine, s.path]), [
    ['docker-desktop', SOCK.dd], ['orbstack', SOCK.orb], ['colima', SOCK.colima], ['other', SOCK.system],
  ]);
});

test('engineFromOs maps what docker info calls the daemon', () => {
  assert.equal(engineFromOs('Docker Desktop'), 'docker-desktop');
  assert.equal(engineFromOs('OrbStack'), 'orbstack');
  assert.equal(engineFromOs('Ubuntu 24.04 LTS (colima)'), 'colima');
  assert.equal(engineFromOs('Ubuntu 24.04 LTS'), 'other');
  assert.equal(engineFromOs(undefined), 'other');
});

test('a stopped engine is started by the app, never by the person (A2 has no button)', () => {
  assert.deepEqual(startCommand('colima', ROOT), { bin: `${ROOT}/bin/colima`, args: ['start'] });
  assert.deepEqual(startCommand('orbstack', ROOT), { bin: 'open', args: ['-a', 'OrbStack', '--background'] });
  assert.deepEqual(startCommand('docker-desktop', ROOT), { bin: 'open', args: ['-a', 'Docker', '--background'] });
  assert.equal(startCommand('other', ROOT), null);
});

test('the first Colima start is exactly vz, 2 CPUs, 4 GB, 20 GB — no flag that asks for a password', () => {
  assert.deepEqual([...COLIMA_START_ARGS], ['start', '--vm-type', 'vz', '--cpu', '2', '--memory', '4', '--disk', '20']);
  assert.ok(!COLIMA_START_ARGS.some((a) => a.includes('network-address')), 'the bridged network flag needs sudo');
});
