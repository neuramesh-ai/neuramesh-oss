// A ustar reader for the workspace export (control-api's tar.ts writes it, docs/export-format.md
// "The archive"): gunzip, walk the 512-byte headers, slice each entry. Regular files only, names
// under 100 bytes, one gzip member, which is every archive the export writes. Pure, so a round
// trip against the writer is a unit test and no tar binary is spawned on a person's Mac.
import { gunzipSync } from 'node:zlib';

export interface UntarEntry { name: string; data: Buffer }

const BLOCK = 512;
const field = (h: Buffer, at: number, len: number): string => h.toString('ascii', at, at + len).replace(/\0.*$/s, '').trim();

/** the header checksum: every byte, with the chksum field read as eight spaces */
function checksum(h: Buffer): number {
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
  return sum;
}

/** The entries of one ustar archive. Throws a plain Error on a header that is not ustar or does not sum. */
export function untar(tar: Buffer): UntarEntry[] {
  const out: UntarEntry[] = [];
  let off = 0;
  while (off + BLOCK <= tar.length) {
    const header = tar.subarray(off, off + BLOCK);
    if (header.every((b) => b === 0)) break; // the end marker: two zero blocks
    if (header.toString('ascii', 257, 262) !== 'ustar') throw new Error(`The archive is not a tar file (offset ${off}).`);
    const claimed = parseInt(field(header, 148, 8), 8);
    if (checksum(header) !== claimed) throw new Error(`The archive is damaged (offset ${off}).`);
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const size = parseInt(field(header, 124, 12), 8);
    const type = header.toString('ascii', 156, 157);
    off += BLOCK;
    if (off + size > tar.length) throw new Error(`The archive ends before ${name} does.`);
    if (type === '0' || type === '\0') out.push({ name, data: Buffer.from(tar.subarray(off, off + size)) });
    off += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}

export const untarGz = (archive: Buffer): UntarEntry[] => untar(gunzipSync(archive));

/** the entries as the text parseExport (shared import.ts) reads */
export const exportEntriesOf = (archive: Buffer): Array<{ name: string; text: string }> =>
  untarGz(archive).map((e) => ({ name: e.name, text: e.data.toString('utf8') }));
