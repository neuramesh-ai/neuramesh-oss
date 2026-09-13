// The twenty-line tar reader the export tests use: gunzip, walk 512-byte headers, slice data.
import { gunzipSync } from 'node:zlib';

export interface UntarEntry { name: string; data: Buffer }

export function untarGz(archive: Buffer): UntarEntry[] {
  const tar = gunzipSync(archive);
  const out: UntarEntry[] = [];
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break; // the end marker
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const size = parseInt(header.toString('ascii', 124, 136).replace(/\0.*$/s, '').trim(), 8);
    const magic = header.toString('ascii', 257, 262);
    if (magic !== 'ustar') throw new Error(`not a ustar header at ${off}: ${JSON.stringify(magic)}`);
    // the checksum: every byte with the chksum field as spaces
    const claimed = parseInt(header.toString('ascii', 148, 156).replace(/[\0 ].*$/s, ''), 8);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
    if (sum !== claimed) throw new Error(`checksum mismatch for ${name}: ${sum} vs ${claimed}`);
    off += 512;
    out.push({ name, data: Buffer.from(tar.subarray(off, off + size)) });
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}
