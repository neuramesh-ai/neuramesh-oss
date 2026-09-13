// THE INSTALL LANE (review F3, D17): the app installs the container runtime itself. Never a
// compose command in the UI, never a password prompt on the default path.
//
// Colima by default — free for every company — from pinned, checksummed release assets: Colima,
// Lima (its VM driver), the Docker CLI static build and the standalone compose binary, into
// ~/.neuramesh/bin. Every byte is verified against the sha256 in the table below BEFORE anything
// runs; a mismatch deletes the file and refuses. OrbStack and Docker Desktop install through their
// own DMGs, which the app downloads (verified too), opens, and then waits for the socket. Every
// folder here hangs off brainRoot() (harness/brain.ts) — ~/.neuramesh by default — so a profile
// under NM_USERDATA keeps its own runtime too.
//
// Pure around an injected fetch and filesystem, so the pins, the refusal and the start arguments
// are unit tests. Progress carries bytes and totals: the card draws bars, never a clock.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { nmBinDir } from './engine';

export type Arch = 'arm64' | 'x64';
export type Runtime = 'colima' | 'orbstack' | 'docker-desktop';

export interface Asset { url: string; sha256: string; bytes: number }
export interface Pin { version: string; arm64: Asset; x64: Asset }

/**
 * THE PIN TABLE. Versions and sha256 computed on 2026-09-12 from the release assets themselves
 * (Colima and compose publish `.sha256`, Lima publishes SHA256SUMS; the Docker CLI static build and
 * the two DMGs were downloaded and hashed). Moving a pin is a hand edit here and nowhere else.
 */
export const PINS: Record<'colima' | 'lima' | 'dockerCli' | 'compose' | 'orbstack' | 'dockerDesktop', Pin> = {
  colima: {
    version: '0.10.3',
    arm64: { url: 'https://github.com/abiosoft/colima/releases/download/v0.10.3/colima-Darwin-arm64', sha256: '980ad8bf61a4ca370243f4cb41401a61276dcd2c2502bee7b9b86f9250169f34', bytes: 15656320 },
    x64: { url: 'https://github.com/abiosoft/colima/releases/download/v0.10.3/colima-Darwin-x86_64', sha256: '3082737fe8a98afda11cba7d9a20b6e56fe80c6153464beda04bec630758770b', bytes: 16954240 },
  },
  lima: {
    version: '2.2.0',
    arm64: { url: 'https://github.com/lima-vm/lima/releases/download/v2.2.0/lima-2.2.0-Darwin-arm64.tar.gz', sha256: 'bbdef91774885a0d05f7b048c4eb89ae2bcf3a0c252ae7ca7934e63df76d93c3', bytes: 37586365 },
    x64: { url: 'https://github.com/lima-vm/lima/releases/download/v2.2.0/lima-2.2.0-Darwin-x86_64.tar.gz', sha256: '0d6f99c19f6e4bc3c92730c4c29d929e6927f0cb0a0ba1a84383367135a8ff31', bytes: 24415554 },
  },
  dockerCli: {
    version: '29.8.0',
    arm64: { url: 'https://download.docker.com/mac/static/stable/aarch64/docker-29.8.0.tgz', sha256: '3f37afe51f8f53f224192099a76a454a62eb6100d426738da17fdf8472cf4b5f', bytes: 19608851 },
    x64: { url: 'https://download.docker.com/mac/static/stable/x86_64/docker-29.8.0.tgz', sha256: 'aeb74337d43dc9f863d056760e156daa71f9462ffdc0f836a14f1528fa1f0f13', bytes: 20886492 },
  },
  // the static CLI ships no compose plugin, so the standalone binary rides along and the driver
  // calls it directly (compose.ts composeCommand)
  compose: {
    version: '5.5.1',
    arm64: { url: 'https://github.com/docker/compose/releases/download/v5.5.1/docker-compose-darwin-aarch64', sha256: '998735c9b6fe68a4f05895e6ea73d71ad06f9fc7046383ad89e47346781b6af5', bytes: 30532210 },
    x64: { url: 'https://github.com/docker/compose/releases/download/v5.5.1/docker-compose-darwin-x86_64', sha256: 'a264d61e824bf08a78867e59cdf32eb09f0aee9ecdf9f6ebfa43f76dc52880f1', bytes: 32686480 },
  },
  orbstack: {
    version: '2.2.3',
    arm64: { url: 'https://cdn-updates.orbstack.dev/arm64/OrbStack_v2.2.3_20963_arm64.dmg', sha256: '7ca77868f3a0d7d9f57b3f98615aad30cc59d23cc84bbff13f78846df0b493d4', bytes: 463053723 },
    x64: { url: 'https://cdn-updates.orbstack.dev/amd64/OrbStack_v2.2.3_20963_amd64.dmg', sha256: 'd1aa8723d19a6bc8dba4b6490e99710e926aa5f229920da8e1be0fbba903641f', bytes: 501088597 },
  },
  dockerDesktop: {
    version: '238679',
    arm64: { url: 'https://desktop.docker.com/mac/main/arm64/238679/Docker.dmg', sha256: 'c131ee28ef56248d4abee2268c05235b19216b015ddf632727cef1b95a6f995c', bytes: 582430056 },
    x64: { url: 'https://desktop.docker.com/mac/main/amd64/238679/Docker.dmg', sha256: 'd5c1143655cd2a4cbd674e5a1337762fa34699d541e93c53bde034048f1c74c8', bytes: 640886891 },
  },
};

export const archOf = (nodeArch: string = process.arch): Arch => (nodeArch === 'arm64' ? 'arm64' : 'x64');

/** one download the card draws a bar for */
export interface InstallItem {
  name: string;
  asset: Asset;
  /** where the verified file lands */
  dest: string;
  /** what to do with it once verified */
  unpack: 'binary' | 'tar-into-root' | 'tar-docker-cli' | 'dmg';
}

export const downloadsDir = (root: string): string => join(root, 'downloads');

/** the items a runtime needs, in download order — the card's rows */
export function installPlan(runtime: Runtime, root: string, arch: Arch = archOf()): InstallItem[] {
  const bin = nmBinDir(root);
  const dl = downloadsDir(root);
  switch (runtime) {
    case 'colima':
      return [
        { name: 'Colima', asset: PINS.colima[arch], dest: join(bin, 'colima'), unpack: 'binary' },
        // lima's tarball is bin/limactl + share/lima; extracted into the root so the two land as
        // siblings, which is the layout limactl finds its guest files by
        { name: 'Lima', asset: PINS.lima[arch], dest: join(dl, `lima-${PINS.lima.version}.tar.gz`), unpack: 'tar-into-root' },
        { name: 'Docker CLI', asset: PINS.dockerCli[arch], dest: join(dl, `docker-${PINS.dockerCli.version}.tgz`), unpack: 'tar-docker-cli' },
        { name: 'Compose', asset: PINS.compose[arch], dest: join(bin, 'docker-compose'), unpack: 'binary' },
      ];
    case 'orbstack':
      return [{ name: 'OrbStack', asset: PINS.orbstack[arch], dest: join(dl, `OrbStack-${PINS.orbstack.version}.dmg`), unpack: 'dmg' }];
    case 'docker-desktop':
      return [{ name: 'Docker Desktop', asset: PINS.dockerDesktop[arch], dest: join(dl, `Docker-${PINS.dockerDesktop.version}.dmg`), unpack: 'dmg' }];
  }
}

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export interface DownloadFs {
  mkdirp: (dir: string) => void;
  /** write the whole verified body — the file never exists in a half-written or unverified state */
  writeFile: (path: string, bytes: Uint8Array, mode?: number) => void;
  remove: (path: string) => void;
  exists: (path: string) => boolean;
  readFile: (path: string) => Uint8Array;
}

export class ChecksumMismatch extends Error {
  constructor(readonly name: string, readonly expected: string, readonly actual: string) {
    super(`${name}: the download did not match its pinned checksum (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…). The file was deleted.`);
  }
}

/**
 * Fetch one asset to a temp path, VERIFY, then move into place. Progress is bytes over the
 * pinned total. An already-present file that hashes right is reused (a resumed install pays
 * nothing twice); one that hashes wrong is deleted before the fresh download.
 */
export async function downloadAsset(
  item: InstallItem,
  deps: { fs: DownloadFs; fetchImpl: typeof fetch; onProgress: (bytes: number, total: number) => void },
): Promise<void> {
  const { fs } = deps;
  const total = item.asset.bytes;
  if (fs.exists(item.dest)) {
    if (sha256Hex(fs.readFile(item.dest)) === item.asset.sha256) { deps.onProgress(total, total); return; }
    fs.remove(item.dest);
  }
  const res = await deps.fetchImpl(item.asset.url);
  if (!res.ok || !res.body) throw new Error(`${item.name}: download failed (${res.status})`);
  const chunks: Uint8Array[] = [];
  let got = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.byteLength;
    deps.onProgress(Math.min(got, total), total);
  }
  const bytes = Buffer.concat(chunks);
  const actual = sha256Hex(bytes);
  if (actual !== item.asset.sha256) throw new ChecksumMismatch(item.name, item.asset.sha256, actual);
  fs.mkdirp(join(item.dest, '..'));
  fs.writeFile(item.dest, bytes, item.unpack === 'binary' ? 0o755 : 0o644);
  deps.onProgress(total, total);
}

/** the shell steps that place a verified archive — each is one spawn the driver runs */
export function unpackCommands(item: InstallItem, root: string): Array<{ bin: string; args: string[] }> {
  switch (item.unpack) {
    case 'binary': return [];
    case 'tar-into-root': return [{ bin: 'tar', args: ['-xzf', item.dest, '-C', root] }];
    // the static build is docker/docker — strip the folder so the CLI lands in bin
    case 'tar-docker-cli': return [{ bin: 'tar', args: ['-xzf', item.dest, '-C', nmBinDir(root), '--strip-components', '1', 'docker/docker'] }];
    case 'dmg': return [{ bin: 'open', args: [item.dest] }];
  }
}

/** the PATH the app's own runtime runs with — its bin dir first, so colima finds OUR limactl and docker */
export const runtimePath = (root: string, path: string | undefined): string => [nmBinDir(root), ...(path ?? '').split(':').filter(Boolean)].join(':');
