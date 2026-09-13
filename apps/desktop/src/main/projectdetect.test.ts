// Folder → project-metadata detection (projectdetect.ts): the New project modal
// prefill. Run from apps/desktop: pnpm exec tsx --test src/main/projectdetect.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectProjectMeta, descriptionFromReadme, parseOriginRemote, suggestRooms, slugifyName } from './projectdetect';

const fixture = async (name: string, files: Record<string, string>, dirs: string[] = []) => {
  const root = await mkdtemp(join(tmpdir(), 'nm-detect-'));
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  for (const d of dirs) await mkdir(join(dir, d), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const parent = rel.includes('/') ? join(dir, rel.slice(0, rel.lastIndexOf('/'))) : dir;
    await mkdir(parent, { recursive: true });
    await writeFile(join(dir, rel), content);
  }
  return { dir, cleanup: () => rm(root, { recursive: true, force: true }) };
};

test('package.json description wins; name stays the folder basename', async () => {
  const f = await fixture('flowe-ai', {
    'package.json': JSON.stringify({ name: '@george/flowe-monorepo', description: 'Breath-led focus for deep work' }),
    'README.md': '# Flowe\n\nSomething else entirely.',
  });
  try {
    const d = await detectProjectMeta(f.dir);
    assert.equal(d.name, 'flowe-ai'); // basename, NOT the pkg name
    assert.equal(d.slug, 'flowe-ai');
    assert.equal(d.description, 'Breath-led focus for deep work');
  } finally { await f.cleanup(); }
});

test('README fallback skips badges/headings/html and caps at a word boundary', async () => {
  const long = 'An agent collaboration platform where humans and AI teammates plan, build, review and ship together across every project you run, with cloud-consistent state everywhere.';
  const f = await fixture('mesh', {
    'README.md': `# Mesh\n\n[![CI](https://x/badge.svg)](https://x)\n<p align="center"><img src="logo.png"></p>\n\n${long}\n\nSecond paragraph.`,
  });
  try {
    const d = await detectProjectMeta(f.dir);
    assert.ok(d.description.length <= 161, `capped (${d.description.length})`);
    assert.ok(d.description.startsWith('An agent collaboration platform'));
    assert.ok(d.description.endsWith('…'));
    assert.ok(!d.description.includes('Second paragraph'));
  } finally { await f.cleanup(); }
});

test('malformed package.json falls through to the README', async () => {
  const f = await fixture('broken', {
    'package.json': '{ not json',
    'README.md': 'A tiny tool that does one thing well.',
  });
  try {
    assert.equal((await detectProjectMeta(f.dir)).description, 'A tiny tool that does one thing well.');
  } finally { await f.cleanup(); }
});

test('git origin remote is parsed from .git/config (scp-like + https forms)', async () => {
  const f = await fixture('withgit', {
    '.git/config': '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = git@github.com:george/flowe-ai.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
  });
  try {
    const d = await detectProjectMeta(f.dir);
    assert.equal(d.remoteUrl, 'git@github.com:george/flowe-ai.git');
    assert.equal(d.remoteLabel, 'github.com/george/flowe-ai');
  } finally { await f.cleanup(); }
  assert.deepEqual(parseOriginRemote('[remote "origin"]\n\turl = https://gitlab.com/team/app.git\n'), {
    url: 'https://gitlab.com/team/app.git', label: 'gitlab.com/team/app',
  });
  assert.deepEqual(parseOriginRemote('[remote "origin"]\n\turl = ssh://git@github.com/o/r\n'), {
    url: 'ssh://git@github.com/o/r', label: 'github.com/o/r',
  });
  assert.equal(parseOriginRemote('[core]\n\tbare = false\n'), null);
});

test('room suggestions are conservative: explicit dirs only', async () => {
  assert.deepEqual(suggestRooms([]), ['general', 'dev']);
  assert.deepEqual(suggestRooms(['src', 'apps', 'packages']), ['general', 'dev']); // app layout ≠ marketing
  assert.deepEqual(suggestRooms(['Research', 'src']), ['general', 'dev', 'research']);
  assert.deepEqual(suggestRooms(['site', 'notebooks']), ['general', 'dev', 'research', 'marketing']);
  const f = await fixture('roomy', {}, ['marketing', 'src']);
  try {
    assert.deepEqual((await detectProjectMeta(f.dir)).rooms, ['general', 'dev', 'marketing']);
  } finally { await f.cleanup(); }
});

test('empty folder still yields safe fallbacks', async () => {
  const f = await fixture('Empty Folder!', {});
  try {
    const d = await detectProjectMeta(f.dir);
    assert.equal(d.name, 'Empty Folder!');
    assert.equal(d.slug, 'empty-folder');
    assert.equal(d.description, '');
    assert.equal(d.remoteUrl, null);
    assert.deepEqual(d.rooms, ['general', 'dev']);
  } finally { await f.cleanup(); }
});

test('slugifyName mirrors the server rules', () => {
  assert.equal(slugifyName('My App!! v2'), 'my-app-v2');
  assert.equal(slugifyName('  --Weird--  '), 'weird');
  assert.equal(slugifyName('x'.repeat(60)), 'x'.repeat(40));
});

test('short taglines and non-md READMEs are kept whole', async () => {
  const f = await fixture('tiny', { 'README': 'Focus companion.' });
  try {
    assert.equal((await detectProjectMeta(f.dir)).description, 'Focus companion.');
  } finally { await f.cleanup(); }
  assert.equal(descriptionFromReadme('# Title only\n\n## Another heading'), '');
});
