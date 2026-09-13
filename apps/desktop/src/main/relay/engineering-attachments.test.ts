import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EngineeringAttachmentInbox, MAX_MACHINE_ATTACHMENT_BYTES } from './engineering-attachments';

test('Code attachments assemble ordered chunks outside the repository and preserve image/file routing', async () => {
  const inbox = new EngineeringAttachmentInbox('actor-test', `thread-${crypto.randomUUID()}`);
  try {
    const source = Buffer.from('a project-specific specification');
    inbox.start('spec-1', 'spec.md', 'text/markdown', source.length);
    await inbox.chunk('spec-1', 0, source.subarray(0, 9).toString('base64'));
    await inbox.chunk('spec-1', 1, source.subarray(9).toString('base64'));
    inbox.end('spec-1');
    const resolved = await inbox.resolve([{ id: 'spec-1', name: 'spec.md', mime: 'text/markdown' }]);
    assert.equal(resolved.userImages.length, 0);
    assert.equal(resolved.userFiles.length, 1);
    assert.equal((await readFile(resolved.userFiles[0]!)).toString(), source.toString());
    assert.equal(resolved.userFiles[0]!.includes('neuramesh-engineering-attachments'), true);
  } finally { inbox.close(); }
});

test('Code attachment assembly rejects reordered and oversized input', async () => {
  const inbox = new EngineeringAttachmentInbox('actor-test', `thread-${crypto.randomUUID()}`);
  try {
    inbox.start('file-1', 'file.txt', 'text/plain', 3);
    await assert.rejects(() => inbox.chunk('file-1', 1, Buffer.from('abc').toString('base64')), /out of order/);
    assert.throws(() => inbox.start('too-big', 'huge.bin', 'application/octet-stream', 20 * 1024 * 1024 + 1), /upload limit/);
  } finally { inbox.close(); }
});

test('Code attachment quota resets after a completed message releases its files', async () => {
  const inbox = new EngineeringAttachmentInbox('actor-test', `thread-${crypto.randomUUID()}`);
  try {
    const refs = Array.from({ length: 10 }, (_, index) => ({ id: `file-${index}`, name: `${index}.txt`, mime: 'text/plain' }));
    for (const ref of refs) {
      inbox.start(ref.id, ref.name, ref.mime, 1);
      await inbox.chunk(ref.id, 0, Buffer.from('x').toString('base64'));
      inbox.end(ref.id);
    }
    await inbox.resolve(refs);
    inbox.release(refs);
    assert.doesNotThrow(() => inbox.start('next', 'next.txt', 'text/plain', 1));
  } finally { inbox.close(); }
});

test('Code attachments cap aggregate declared bytes across every machine session', () => {
  const size = 20 * 1024 * 1024;
  const inboxes: EngineeringAttachmentInbox[] = [];
  try {
    const accepted = Math.floor(MAX_MACHINE_ATTACHMENT_BYTES / size);
    for (let index = 0; index < accepted; index += 1) {
      const inbox = new EngineeringAttachmentInbox(`actor-${index}`, `thread-${crypto.randomUUID()}`);
      inboxes.push(inbox);
      inbox.start(`file-${index}`, 'large.bin', 'application/octet-stream', size);
    }
    const overflow = new EngineeringAttachmentInbox('overflow', `thread-${crypto.randomUUID()}`);
    inboxes.push(overflow);
    assert.throws(() => overflow.start('overflow', 'large.bin', 'application/octet-stream', size), /upload limit/);
  } finally {
    for (const inbox of inboxes) inbox.close();
  }
});

test('a closed attachment inbox rejects late starts without consuming machine quota', () => {
  const closed = new EngineeringAttachmentInbox('closed', `thread-${crypto.randomUUID()}`);
  closed.close();
  assert.throws(() => closed.start('late', 'late.bin', 'application/octet-stream', 20 * 1024 * 1024), /closed/);

  const size = 20 * 1024 * 1024;
  const inboxes: EngineeringAttachmentInbox[] = [];
  try {
    const accepted = Math.floor(MAX_MACHINE_ATTACHMENT_BYTES / size);
    for (let index = 0; index < accepted; index += 1) {
      const inbox = new EngineeringAttachmentInbox(`post-close-${index}`, `thread-${crypto.randomUUID()}`);
      inboxes.push(inbox);
      assert.doesNotThrow(() => inbox.start(`file-${index}`, 'large.bin', 'application/octet-stream', size));
    }
  } finally {
    for (const inbox of inboxes) inbox.close();
  }
});
