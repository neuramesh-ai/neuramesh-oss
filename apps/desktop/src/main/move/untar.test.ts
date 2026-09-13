// The tar reader against the export's writer. Run from apps/desktop:
//   pnpm exec tsx --test src/main/move/untar.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { EXPORT_TABLES, parseExport } from '@neuramesh/shared';
import { tarHeader, TAR_END } from '../../../../../packages/control-api/src/tar';
import { exportEntriesOf, untar, untarGz } from './untar';
import { archiveOf, exportEntries, ROWS } from './testworld';

test('untar: a round trip through control-api tar.ts gives back every entry, name and bytes, in order', async () => {
  const entries = exportEntries();
  const back = untarGz(await archiveOf(entries));
  assert.deepEqual(back.map((e) => e.name), entries.map((e) => e.name));
  for (const [i, e] of entries.entries()) assert.ok(back[i]!.data.equals(e.data), `${e.name} bytes`);
  // an empty table is an empty entry, not a missing one
  assert.equal(back.find((e) => e.name === 'repos.jsonl')!.data.length, 0);
});

test('untar: the entries parse as an export, with the manifest counts', async () => {
  const exp = parseExport(exportEntriesOf(await archiveOf()));
  for (const t of EXPORT_TABLES) assert.equal(exp.rows[t].length, ROWS[t].length, t);
  assert.equal(exp.manifest.workspace.name, 'Acme Robotics');
});

test('untar: sizes that are not block multiples pad correctly, and utf8 survives', async () => {
  const data = Buffer.from('héllo wörld · 513 bytes follow\n'.padEnd(513, 'x'), 'utf8');
  const back = untarGz(await archiveOf([{ name: 'odd.txt', data }, { name: 'tiny.txt', data: Buffer.from('a') }]));
  assert.equal(back.length, 2);
  assert.ok(back[0]!.data.equals(data));
  assert.equal(back[1]!.data.toString(), 'a');
});

test('untar: a damaged header is refused with a plain sentence, not a silent short read', () => {
  const h = tarHeader('x.txt', 1, new Date(0));
  h[0] = 0x79; // 'y': the name changed after the checksum was summed
  assert.throws(() => untar(Buffer.concat([h, Buffer.alloc(512, 'a'), TAR_END])), /damaged/);
  assert.throws(() => untarGz(gzipSync(Buffer.alloc(1024, 'z'))), /not a tar file/);
});
