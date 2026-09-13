import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { draftPostsFromWorkspace, type ContentDraftCmd } from './content-producer';

test('draftPostsFromWorkspace: posts.json → one task-attached content.create per valid post', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-cp-'));
  try {
    await writeFile(join(dir, 'posts.json'), JSON.stringify([
      { platform: 'x', body: 'first draft' },
      { platform: 'linkedin', body: 'second', mediaUrl: 'https://cdn.example/y.png' },
      { platform: 'snapchat', body: 'unsupported → skipped' },
      { platform: 'x', body: '' }, // empty → skipped
    ]));
    const cmds: ContentDraftCmd[] = [];
    const out = await draftPostsFromWorkspace(dir, { taskId: 'tk-1025', channelId: 'c-marketing' }, async (c) => { cmds.push(c); return `ci-${cmds.length}`; });
    assert.equal(out.made, 2, 'only the two valid posts create content items');
    assert.deepEqual(cmds.map((c) => c.platform), ['x', 'linkedin']);
    assert.equal(cmds[0]!.type, 'content.create');
    assert.equal(cmds[0]!.task, 'tk-1025', 'drafts attach to THIS task');
    assert.equal(cmds[0]!.channel, 'c-marketing');
    assert.equal(cmds[1]!.mediaUrl, 'https://cdn.example/y.png');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draftPostsFromWorkspace: no posts.json → 0 created, nothing emitted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-cp-'));
  try {
    let calls = 0;
    const out = await draftPostsFromWorkspace(dir, { taskId: 't', channelId: 'c' }, async () => { calls++; return 'ci-1'; });
    assert.equal(out.made, 0);
    assert.equal(calls, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draftPostsFromWorkspace: a rejected emit is not counted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-cp-'));
  try {
    await writeFile(join(dir, 'posts.json'), JSON.stringify([{ platform: 'x', body: 'a' }, { platform: 'x', body: 'b' }]));
    const out = await draftPostsFromWorkspace(dir, { taskId: 't', channelId: 'c' }, async (c) => (c.body === 'a' ? 'ci-1' : null));
    assert.equal(out.made, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draftPostsFromWorkspace: an image brief becomes real pixels — thumb on the draft, full file on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-cp-'));
  try {
    await writeFile(join(dir, 'posts.json'), JSON.stringify([
      { platform: 'x', body: 'copy', imageBrief: 'a warm gold lamp' },
      { platform: 'x', body: 'no brief on this one' },
    ]));
    const cmds: ContentDraftCmd[] = [];
    const briefs: string[] = [];
    const out = await draftPostsFromWorkspace(dir, { taskId: 't', channelId: 'c' }, async (c) => { cmds.push(c); return `ci-${cmds.length}`; }, async (p) => {
      briefs.push(p.imageBrief ?? '');
      return { bytes: Buffer.from('PNGBYTES'), mime: 'image/png', thumb: 'data:image/jpeg;base64,AAAA' };
    });
    assert.equal(out.made, 2);
    assert.equal(out.images, 1, 'only the post with a brief is generated');
    assert.deepEqual(briefs, ['a warm gold lamp']);
    assert.equal(cmds[0]!.thumb, 'data:image/jpeg;base64,AAAA');
    assert.equal(cmds[0]!.imageBrief, 'a warm gold lamp', 'the brief is kept beside the image');
    assert.equal(cmds[1]!.thumb, undefined);
    assert.deepEqual(await readdir(join(dir, 'media')), ['x-1.png']);
    assert.equal(await readFile(join(dir, 'media', 'x-1.png'), 'utf8'), 'PNGBYTES');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draftPostsFromWorkspace: the publish-size copy is hosted against the draft it belongs to', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-cp-'));
  try {
    await writeFile(join(dir, 'posts.json'), JSON.stringify([
      { platform: 'instagram', body: 'copy', imageBrief: 'a lamp' },
      { platform: 'x', body: 'no brief' },
    ]));
    const cmds: ContentDraftCmd[] = [];
    const attached: Array<{ itemId: string; dataUrl: string }> = [];
    const out = await draftPostsFromWorkspace(
      dir,
      { taskId: 't', channelId: 'c' },
      async (c) => { cmds.push(c); return `ci-${cmds.length}`; },
      async () => ({ bytes: Buffer.from('X'), mime: 'image/png', thumb: 'data:image/jpeg;base64,TH', publish: 'data:image/jpeg;base64,PUB' }),
      async (itemId, dataUrl) => { attached.push({ itemId, dataUrl }); return true; },
    );
    assert.equal(out.hosted, 1);
    assert.deepEqual(attached, [{ itemId: 'ci-1', dataUrl: 'data:image/jpeg;base64,PUB' }], 'hosted against the item the create returned');
    assert.equal(cmds[0]!.thumb, 'data:image/jpeg;base64,TH', 'the small copy still rides the draft for the card');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draftPostsFromWorkspace: a draft whose image could not be hosted says so — it cannot publish', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-cp-'));
  try {
    await writeFile(join(dir, 'posts.json'), JSON.stringify([{ platform: 'instagram', body: 'copy', imageBrief: 'a lamp' }]));
    const out = await draftPostsFromWorkspace(
      dir,
      { taskId: 't', channelId: 'c' },
      async () => 'ci-1',
      async () => ({ bytes: Buffer.from('X'), mime: 'image/png', thumb: 'data:image/jpeg;base64,TH', publish: 'data:image/jpeg;base64,PUB' }),
      async () => false,
    );
    assert.equal(out.made, 1);
    assert.equal(out.images, 1);
    assert.equal(out.hosted, 0);
    assert.match(out.notes[0]!, /generated but not hosted/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draftPostsFromWorkspace: a generation failure still creates the post and reports why', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-cp-'));
  try {
    await writeFile(join(dir, 'posts.json'), JSON.stringify([{ platform: 'instagram', body: 'copy', imageBrief: 'a lamp' }]));
    const cmds: ContentDraftCmd[] = [];
    const out = await draftPostsFromWorkspace(dir, { taskId: 't', channelId: 'c' }, async (c) => { cmds.push(c); return `ci-${cmds.length}`; }, async () => ({ error: 'rate limit reached' }));
    assert.equal(out.made, 1, 'the draft survives a failed image');
    assert.equal(out.images, 0);
    assert.deepEqual(out.notes, ['image for the instagram draft: rate limit reached']);
    assert.equal(cmds[0]!.thumb, undefined);
    assert.equal(cmds[0]!.imageBrief, 'a lamp', 'the brief stays so the card can still say what it wanted');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draftPostsFromWorkspace: a thrown maker is caught, and an agent-supplied mediaUrl skips generation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-cp-'));
  try {
    await writeFile(join(dir, 'posts.json'), JSON.stringify([
      { platform: 'x', body: 'a', imageBrief: 'boom' },
      { platform: 'x', body: 'b', imageBrief: 'skip me', mediaUrl: 'https://cdn.example/real.png' },
    ]));
    let calls = 0;
    const out = await draftPostsFromWorkspace(dir, { taskId: 't', channelId: 'c' }, async () => 'ci-x', async () => { calls++; throw new Error('socket hang up'); });
    assert.equal(calls, 1, 'the post that already has a real URL is never generated for');
    assert.equal(out.made, 2);
    assert.deepEqual(out.notes, ['image for the x draft: socket hang up']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('draftPostsFromWorkspace: generation is capped, and the cap is announced rather than silent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'nm-cp-'));
  try {
    await writeFile(join(dir, 'posts.json'), JSON.stringify(
      Array.from({ length: 6 }, (_, i) => ({ platform: 'x', body: `post ${i}`, imageBrief: `brief ${i}` })),
    ));
    let calls = 0;
    const cmds: ContentDraftCmd[] = [];
    const out = await draftPostsFromWorkspace(dir, { taskId: 't', channelId: 'c' }, async (c) => { cmds.push(c); return `ci-${cmds.length}`; }, async () => {
      calls++;
      return { bytes: Buffer.from('X'), mime: 'image/png', thumb: 'data:image/jpeg;base64,AA' };
    });
    assert.equal(calls, 4, 'at most four paid generations per task');
    assert.equal(out.made, 6, 'every draft is still created');
    assert.equal(out.images, 4);
    assert.equal(out.notes.length, 1);
    assert.match(out.notes[0]!, /image cap 4 reached/);
    assert.equal(cmds[5]!.thumb, undefined);
    assert.equal(cmds[5]!.imageBrief, 'brief 5');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
