// The install lane with the downloads mocked: pins for both arches, a wrong checksum refuses and
// deletes, the archive steps, and the PATH the runtime runs with.
//   pnpm exec tsx --test src/main/localStack/install.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ChecksumMismatch, PINS, archOf, downloadAsset, installPlan, runtimePath, sha256Hex, unpackCommands, type DownloadFs, type InstallItem } from './install';

const ROOT = '/home/dana/.neuramesh';
const hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function memFs(seed: Record<string, Uint8Array> = {}): DownloadFs & { files: Map<string, Uint8Array>; modes: Map<string, number>; removed: string[] } {
  const files = new Map(Object.entries(seed));
  const modes = new Map<string, number>();
  const removed: string[] = [];
  return {
    files, modes, removed,
    mkdirp: () => {},
    writeFile: (p, b, mode) => { files.set(p, b); if (mode) modes.set(p, mode); },
    remove: (p) => { files.delete(p); removed.push(p); },
    exists: (p) => files.has(p),
    readFile: (p) => files.get(p)!,
  };
}

const streamOf = (bytes: Uint8Array, chunk = 3) => new ReadableStream<Uint8Array>({
  start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk)); c.close(); },
});
const fetchBytes = (bytes: Uint8Array, status = 200): typeof fetch => (async () => new Response(streamOf(bytes), { status })) as typeof fetch;

test('every pin names both architectures with a 64-hex sha256, a https url and a size', () => {
  for (const [name, pin] of Object.entries(PINS)) {
    assert.ok(pin.version, `${name} has a version`);
    for (const arch of ['arm64', 'x64'] as const) {
      const a = pin[arch];
      assert.match(a.sha256, /^[0-9a-f]{64}$/, `${name} ${arch} sha256`);
      assert.ok(a.url.startsWith('https://'), `${name} ${arch} url`);
      assert.ok(a.url.includes(pin.version), `${name} ${arch} url names the pinned version`);
      assert.ok(a.bytes > 1_000_000, `${name} ${arch} size`);
    }
    assert.notEqual(pin.arm64.sha256, pin.x64.sha256, `${name}: two arches, two files`);
  }
  assert.equal(archOf('arm64'), 'arm64');
  assert.equal(archOf('x64'), 'x64');
});

test('the Colima plan is Colima + Lima + the Docker CLI + compose, into ~/.neuramesh; the DMG runtimes are one download each', () => {
  const colima = installPlan('colima', ROOT, 'arm64');
  assert.deepEqual(colima.map((i) => i.name), ['Colima', 'Lima', 'Docker CLI', 'Compose']);
  assert.equal(colima[0]!.dest, `${ROOT}/bin/colima`);
  assert.equal(colima[3]!.dest, `${ROOT}/bin/docker-compose`);
  assert.equal(colima[0]!.asset.url, PINS.colima.arm64.url);
  assert.equal(installPlan('colima', ROOT, 'x64')[2]!.asset.url, PINS.dockerCli.x64.url);
  assert.deepEqual(installPlan('orbstack', ROOT, 'arm64').map((i) => [i.name, i.unpack]), [['OrbStack', 'dmg']]);
  assert.deepEqual(installPlan('docker-desktop', ROOT, 'x64').map((i) => [i.name, i.asset.url]), [['Docker Desktop', PINS.dockerDesktop.x64.url]]);
});

test('a download that matches its checksum lands executable, with bytes and totals reported along the way', async () => {
  const body = new TextEncoder().encode('colima-binary-bytes');
  const item: InstallItem = { name: 'Colima', asset: { url: 'https://x/colima', sha256: hex(body), bytes: body.length }, dest: `${ROOT}/bin/colima`, unpack: 'binary' };
  const fs = memFs();
  const seen: Array<[number, number]> = [];
  await downloadAsset(item, { fs, fetchImpl: fetchBytes(body), onProgress: (b, t) => seen.push([b, t]) });
  assert.ok(Buffer.from(fs.files.get(item.dest)!).equals(body));
  assert.equal(fs.modes.get(item.dest), 0o755);
  assert.ok(seen.length >= 2);
  assert.deepEqual(seen.at(-1), [body.length, body.length]);
  assert.ok(seen.every(([b, t]) => b <= t && t === body.length), 'every tick carries the pinned total');
});

test('a wrong checksum REFUSES and leaves no file behind', async () => {
  const body = new TextEncoder().encode('tampered');
  const item: InstallItem = { name: 'Lima', asset: { url: 'https://x/lima.tgz', sha256: 'ab'.repeat(32), bytes: body.length }, dest: `${ROOT}/downloads/lima.tar.gz`, unpack: 'tar-into-root' };
  const fs = memFs();
  await assert.rejects(downloadAsset(item, { fs, fetchImpl: fetchBytes(body), onProgress: () => {} }), (e: unknown) => e instanceof ChecksumMismatch && /deleted/.test(e.message));
  assert.equal(fs.files.size, 0, 'nothing was written');
});

test('a file already present is reused when it hashes right, and deleted then re-fetched when it does not', async () => {
  const good = new TextEncoder().encode('good');
  const dest = `${ROOT}/bin/docker-compose`;
  const item: InstallItem = { name: 'Compose', asset: { url: 'https://x/compose', sha256: hex(good), bytes: good.length }, dest, unpack: 'binary' };
  let fetched = 0;
  const counting: typeof fetch = (async () => { fetched++; return new Response(streamOf(good)); }) as typeof fetch;
  const fs = memFs({ [dest]: good });
  await downloadAsset(item, { fs, fetchImpl: counting, onProgress: () => {} });
  assert.equal(fetched, 0, 'a verified file is not downloaded again');
  const stale = memFs({ [dest]: new TextEncoder().encode('stale') });
  await downloadAsset(item, { fs: stale, fetchImpl: counting, onProgress: () => {} });
  assert.equal(fetched, 1);
  assert.deepEqual(stale.removed, [dest]);
  assert.ok(Buffer.from(stale.files.get(dest)!).equals(good));
});

test('a failed fetch is named, not swallowed', async () => {
  const item: InstallItem = { name: 'Colima', asset: { url: 'https://x/colima', sha256: 'a'.repeat(64), bytes: 10 }, dest: '/d', unpack: 'binary' };
  await assert.rejects(downloadAsset(item, { fs: memFs(), fetchImpl: fetchBytes(new Uint8Array(), 404), onProgress: () => {} }), /Colima: download failed \(404\)/);
});

test('the archive steps: lima into ~/.neuramesh, the CLI stripped into bin, a DMG opened, a binary nothing', () => {
  const [colima, lima, cli] = installPlan('colima', ROOT, 'arm64');
  assert.deepEqual(unpackCommands(colima!, ROOT), []);
  assert.deepEqual(unpackCommands(lima!, ROOT), [{ bin: 'tar', args: ['-xzf', lima!.dest, '-C', `${ROOT}`] }]);
  assert.deepEqual(unpackCommands(cli!, ROOT), [{ bin: 'tar', args: ['-xzf', cli!.dest, '-C', `${ROOT}/bin`, '--strip-components', '1', 'docker/docker'] }]);
  const [orb] = installPlan('orbstack', ROOT, 'arm64');
  assert.deepEqual(unpackCommands(orb!, ROOT), [{ bin: 'open', args: [orb!.dest] }]);
});

test('the runtime PATH puts the app\'s bin first so colima finds OUR limactl and docker', () => {
  assert.equal(runtimePath(ROOT, '/usr/bin:/bin'), `${ROOT}/bin:/usr/bin:/bin`);
  assert.equal(runtimePath(ROOT, undefined), `${ROOT}/bin`);
  assert.equal(sha256Hex(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
