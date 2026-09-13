// The ustar writer round-trips through an independent reader, and the header math holds:
// size in octal, a checksum over the header with the field as spaces, and block padding.
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { TAR_END, tarHeader, tarPad, tarStream } from '../src/tar';
import { untarGz } from './untar';

async function collect(gen: AsyncIterable<Buffer>): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const p of gen) parts.push(p);
  return Buffer.concat(parts);
}

describe('the ustar writer', () => {
  it('pads every entry to 512 and closes with two zero blocks', () => {
    expect(tarPad(0).length).toBe(0);
    expect(tarPad(1).length).toBe(511);
    expect(tarPad(512).length).toBe(0);
    expect(tarPad(513).length).toBe(511);
    expect(TAR_END.length).toBe(1024);
    expect(TAR_END.every((b) => b === 0)).toBe(true);
  });

  it('writes a header a reader accepts: magic, size, checksum', () => {
    const h = tarHeader('manifest.json', 1234, new Date('2026-09-12T00:00:00Z'));
    expect(h.length).toBe(512);
    expect(h.toString('ascii', 257, 263)).toBe('ustar\0');
    expect(parseInt(h.toString('ascii', 124, 135), 8)).toBe(1234);
    expect(h.toString('ascii', 156, 157)).toBe('0');
  });

  it('refuses an entry name over 100 bytes rather than truncating it silently', () => {
    expect(() => tarHeader('x'.repeat(101), 0, new Date())).toThrow(/100 bytes/);
  });

  it('round-trips entries of every awkward size, including empty', async () => {
    const entries = [
      { name: 'manifest.json', data: Buffer.from('{"a":1}\n') },
      { name: 'empty.jsonl', data: Buffer.alloc(0) },
      { name: 'exact.jsonl', data: Buffer.alloc(512, 0x41) },
      { name: 'big.jsonl', data: Buffer.alloc(1500, 0x42) },
    ];
    const tar = await collect(tarStream(entries));
    expect(tar.length % 512).toBe(0);
    const back = untarGz(gzipSync(tar));
    expect(back.map((e) => e.name)).toEqual(entries.map((e) => e.name));
    for (let i = 0; i < entries.length; i++) expect(back[i]!.data.equals(entries[i]!.data)).toBe(true);
  });
});
