import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { previewEngineeringFile } from './engineering-file-preview';
import { isEngineeringCommand } from '@neuramesh/shared';

test('file previews use the selected checkout and reject traversal, symlinks, folders, missing and oversized files', async () => {
  const base = await mkdtemp('/tmp/nm-file-preview-');
  const root = `${base}/repo`;
  try {
    await mkdir(root);
    await writeFile(`${root}/README.md`, '# This thread');
    await writeFile(`${base}/private.txt`, 'outside');
    await symlink(`${base}/private.txt`, `${root}/escape.txt`);
    await symlink(base, `${root}/outside`);
    await writeFile(`${root}/large.txt`, 'x'.repeat(2 * 1024 * 1024 + 1));
    assert.equal((await previewEngineeringFile(root, 'one', 'README.md')).content, '# This thread');
    assert.equal((await previewEngineeringFile(root, 'absolute', `${root}/README.md`)).content, '# This thread');
    for (const path of ['../private.txt', `${base}/private.txt`, 'escape.txt', 'outside/private.txt', '.', 'missing.md', 'large.txt']) {
      const result = await previewEngineeringFile(root, 'blocked', path);
      assert.ok(result.error, path); assert.equal(result.content, undefined, path);
    }
    const png = Buffer.from('iVBORw0KGgo=', 'base64');
    await writeFile(`${root}/cover.png`, png);
    assert.equal((await previewEngineeringFile(root, 'image', 'cover.png')).content, `data:image/png;base64,${png.toString('base64')}`);
    assert.equal(isEngineeringCommand({ type: 'preview_file', requestId: 'one', path: 'README.md' }), true);
    assert.equal(isEngineeringCommand({ type: 'preview_file', requestId: 'one', path: '\0secret' }), false);
  } finally { await rm(base, { recursive: true, force: true }); }
});
