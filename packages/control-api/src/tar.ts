// A ustar writer, 512-byte blocks, no dependency (the export lane, export.ts). Every entry is a
// regular file whose size is known when its header is written, so the archive streams entry by
// entry: header, data, zero pad to the block, and two zero blocks at the end. `tar -xzf` and
// every tar reader since 1988 read it; test/untar.ts is the twenty-line reader the tests use.
const BLOCK = 512;

function octal(n: number, width: number): Buffer {
  return Buffer.from(n.toString(8).padStart(width - 1, '0') + '\0', 'ascii');
}

/** The 512-byte header for a regular file. `name` is at most 100 bytes (ours are `<table>.jsonl`). */
export function tarHeader(name: string, size: number, mtime: Date): Buffer {
  if (Buffer.byteLength(name) > 100) throw new Error(`tar entry name over 100 bytes: ${name}`);
  const h = Buffer.alloc(BLOCK);
  h.write(name, 0, 'utf8');
  octal(0o644, 8).copy(h, 100);            // mode
  octal(0, 8).copy(h, 108);                // uid
  octal(0, 8).copy(h, 116);                // gid
  octal(size, 12).copy(h, 124);            // size
  octal(Math.floor(mtime.getTime() / 1000), 12).copy(h, 136); // mtime
  h.fill(' ', 148, 156);                   // chksum placeholder: eight spaces while summing
  h.write('0', 156, 'ascii');              // typeflag: regular file
  h.write('ustar\0', 257, 'ascii');        // magic
  h.write('00', 263, 'ascii');             // version
  let sum = 0;
  for (const b of h) sum += b;
  Buffer.from(sum.toString(8).padStart(6, '0') + '\0 ', 'ascii').copy(h, 148);
  return h;
}

/** Zero bytes that bring `size` up to the next block boundary. */
export function tarPad(size: number): Buffer {
  const rem = size % BLOCK;
  return Buffer.alloc(rem === 0 ? 0 : BLOCK - rem);
}

/** Two zero blocks close the archive. */
export const TAR_END = Buffer.alloc(BLOCK * 2);

export interface TarEntry { name: string; data: Buffer; mtime?: Date }

/** Header, data, pad for each entry as it arrives, then the end marker. */
export async function* tarStream(entries: AsyncIterable<TarEntry> | Iterable<TarEntry>): AsyncGenerator<Buffer> {
  for await (const e of entries) {
    yield tarHeader(e.name, e.data.length, e.mtime ?? new Date());
    yield e.data;
    yield tarPad(e.data.length);
  }
  yield TAR_END;
}
