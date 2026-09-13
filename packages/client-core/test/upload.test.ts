import { describe, expect, it } from 'vitest';
import { artifactUploadInput, messageUploadInput } from '../src/upload';

// The birth columns have to reach the wire (0134 — rule D9): a phone send that names a machine
// and says which client bore it is only a designation if the uploader forwards both.
describe('messageUploadInput', () => {
  const row = {
    workspace_id: 'ws1', channel_id: 'ch1', body: 'hello', task_id: null, thread_id: 'th1', root_message_id: 'm1',
    birth_mode: 'tasks', birth_brain: null, birth_machine: 'mach1', birth_origin: 'web', author_kind: 'human', author_id: 'u1', created_at: 'now', pinned: 0,
  };

  it('forwards the birth columns as the /v1/messages birth fields', () => {
    expect(messageUploadInput('m1', row)).toEqual({
      id: 'm1', workspace: 'ws1', channel: 'ch1', body: 'hello', taskId: undefined,
      threadId: 'th1', rootMessageId: 'm1', threadMode: 'tasks', threadMachineId: 'mach1', threadOrigin: 'web',
    });
  });

  it('Auto writes no designation: a NULL or empty birth_machine is absent, not the string "null"', () => {
    expect(messageUploadInput('m2', { ...row, birth_machine: null }).threadMachineId).toBeUndefined();
    expect(messageUploadInput('m2', { ...row, birth_machine: '' }).threadMachineId).toBeUndefined();
  });

  it('a reply into an existing thread carries the thread id and no birth fields', () => {
    const out = messageUploadInput('m3', { workspace_id: 'ws1', channel_id: 'ch1', body: 'again', thread_id: 'th1' });
    expect(out.threadId).toBe('th1');
    expect(out.threadMode).toBeUndefined();
    expect(out.threadOrigin).toBeUndefined();
    expect(out.rootMessageId).toBeUndefined();
  });

  it('a task reply keeps its task id', () => {
    expect(messageUploadInput('m4', { workspace_id: 'ws1', channel_id: 'ch1', body: 'x', task_id: 't1' }).taskId).toBe('t1');
  });

  it('an unknown mode or origin is dropped rather than sent for the server to reject', () => {
    const out = messageUploadInput('m5', { ...row, birth_mode: 'weird', birth_origin: 'phone' });
    expect(out.threadMode).toBeUndefined();
    expect(out.threadOrigin).toBeUndefined();
  });
});

// The composer's brain has to reach the server or the pick is theatre: `birth_brain` is TEXT
// locally and jsonb server-side, and a malformed one must be NO override rather than a 400 that
// wedges the ordered queue (George, 2026-09-06 — the house brain is the pick that always works).
describe('the brain a send births a thread on', () => {
  it('carries a well-formed override to the wire', () => {
    const out = messageUploadInput('m1', { workspace_id: 'w', channel_id: 'c', body: 'hi', birth_brain: '{"orchestrator":"gemini-3.5-flash-lite"}' });
    expect(out.brainOverride).toEqual({ orchestrator: 'gemini-3.5-flash-lite' });
  });
  it('sends nothing when no brain was picked', () => {
    const out = messageUploadInput('m1', { workspace_id: 'w', channel_id: 'c', body: 'hi' });
    expect(out.brainOverride).toBeUndefined();
  });
  it('drops an unparseable or unknown one rather than failing the send', () => {
    expect(messageUploadInput('m1', { workspace_id: 'w', channel_id: 'c', body: 'hi', birth_brain: 'not json' }).brainOverride).toBeUndefined();
    expect(messageUploadInput('m1', { workspace_id: 'w', channel_id: 'c', body: 'hi', birth_brain: '{"nobody":"nope"}' }).brainOverride).toBeUndefined();
  });
});

// AN ATTACHMENT IS NOT A MESSAGE. The mobile connector only ever handled `messages`, so an
// artifacts row entered the queue, was skipped, and was discarded by tx.complete() — the photo
// existed on the phone and nowhere else. These pin the mapping the new branch sends.
describe('artifactUploadInput', () => {
  const row = {
    workspace_id: 'ws1', channel_id: 'ch1', task_id: null, message_id: 'm1',
    kind: 'screenshot', name: 'photo.jpg', mime: 'image/jpeg',
    inline_content: 'data:image/jpeg;base64,AAAA', size_bytes: 1234, width: 100, height: 80,
  };

  it('carries every column the attachment contract needs', () => {
    expect(artifactUploadInput('a1', row)).toEqual({
      id: 'a1', workspace: 'ws1', channel: 'ch1', messageId: 'm1', taskId: undefined,
      kind: 'screenshot', name: 'photo.jpg', mime: 'image/jpeg',
      inlineContent: 'data:image/jpeg;base64,AAAA', sizeBytes: 1234, width: 100, height: 80,
    });
  });

  // the server's schema is `.optional()`, which admits an absent key and refuses an explicit null.
  // A null taskId came back "invalid artifact" and the photo was dropped in front of the person.
  it('leaves taskId absent rather than null, which the server refuses', () => {
    const out = artifactUploadInput('a1', row)!;
    expect(out.taskId).toBeUndefined();
    expect('taskId' in out).toBe(true);
    expect(artifactUploadInput('a1', { ...row, task_id: 't9' })!.taskId).toBe('t9');
  });

  // a LIBRARY file, which rides artifact.create and a different ACL. Posting it here would file it
  // in the wrong place, so the branch must leave it alone rather than guess.
  it('refuses a row with no message, because that is not an attachment', () => {
    expect(artifactUploadInput('a1', { ...row, message_id: null })).toBeNull();
  });

  it('refuses a row that names no workspace or channel', () => {
    expect(artifactUploadInput('a1', { ...row, workspace_id: null })).toBeNull();
    expect(artifactUploadInput('a1', { ...row, channel_id: '' })).toBeNull();
  });

  it('falls back rather than sends undefined for the two the server requires', () => {
    const out = artifactUploadInput('a1', { workspace_id: 'ws1', channel_id: 'ch1', message_id: 'm1' })!;
    expect(out.kind).toBe('file');
    expect(out.name).toBe('attachment');
  });
});
