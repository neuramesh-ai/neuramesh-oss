import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { localRepoRead } from './repo-local-read';
import { gitChildEnv } from '../harness/workspaces';

test('local project reads use the checkout and revisions without escaping the registered repository', async () => {
  const area = await mkdtemp('/tmp/nm-project-reader-');
  const repo = join(area, 'repo');
  await mkdir(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: gitChildEnv() });
  try {
    git('init', '-q');
    await writeFile(join(repo, 'README.md'), 'Committed project facts');
    await writeFile(join(area, 'outside.txt'), 'Other project private data');
    await symlink('../outside.txt', join(repo, 'escape.md'));
    git('add', '.'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'Project fixture');
    await writeFile(join(repo, 'README.md'), 'Working project facts');
    assert.match(await localRepoRead(repo, 'file', 'README.md'), /Working project facts/);
    assert.match(await localRepoRead(repo, 'file', 'README.md', 'HEAD'), /Committed project facts/);
    assert.match(await localRepoRead(repo, 'tree'), /README.md/);
    assert.match(await localRepoRead(repo, 'changes'), /Project fixture/);
    assert.doesNotMatch(await localRepoRead(repo, 'changes', '', undefined, '2099-01-01'), /Project fixture/);
    await assert.rejects(localRepoRead(repo, 'file', '../outside.txt'), /inside/);
    await assert.rejects(localRepoRead(repo, 'file', 'escape.md'), /outside/);
    await assert.rejects(localRepoRead(repo, 'file', 'escape.md', 'HEAD'), /regular/);
    await assert.rejects(localRepoRead(repo, 'file', '.git/config'), /metadata/);
    await symlink('.git', join(repo, 'metadata-alias'));
    await symlink('.git/config', join(repo, 'config-alias'));
    await assert.rejects(localRepoRead(repo, 'file', 'metadata-alias/config'), /metadata/);
    await assert.rejects(localRepoRead(repo, 'file', 'config-alias'), /metadata/);
    await assert.rejects(localRepoRead(repo, 'file', 'README.md', '--help'), /revision/);
    await writeFile(join(repo, 'binary.dat'), Buffer.from([0, 1, 2]));
    assert.match(await localRepoRead(repo, 'file', 'binary.dat'), /binary/);
  } finally { await rm(area, { recursive: true, force: true }); }
});
