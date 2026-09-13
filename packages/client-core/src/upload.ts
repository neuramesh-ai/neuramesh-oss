// THE UPLOADER'S MESSAGE MAPPING (the mobile-cloud round, S3): a queued local `messages` row →
// the /v1/messages body, the birth columns forwarded exactly as the desktop's uploader forwards
// them (apps/desktop/src/main/sync/upload.ts) — the root a reply hangs off (docs/31), the mode
// (docs/34), where the session runs and which client bore it (0134). Pure, so the phone's
// connector is one call and test/upload.test.ts fails the moment a birth column stops reaching
// the wire: a send that lost its designation would still land, and only the machine would notice.
import { parseBrainOverride } from '@neuramesh/shared';
import type { ControlApiClient } from './api';

export type MessageUploadInput = Parameters<ControlApiClient['postMessage']>[0];

const MODES = new Set(['tasks', 'chat']);
const ORIGINS = new Set(['desktop', 'web', 'routine']);

/** `d` is the crud op's `opData` — every column the local insert wrote, as SQLite hands it back */
export function messageUploadInput(id: string, d: Record<string, unknown>): MessageUploadInput {
  // an absent column, a NULL and an empty string all mean "not set" — a birth column is ONLY
  // ever set by the send that births the thread, and the server ignores it on an existing one
  const s = (k: string): string | undefined => (d[k] == null || d[k] === '' ? undefined : String(d[k]));
  const mode = s('birth_mode');
  const origin = s('birth_origin');
  return {
    id,
    workspace: s('workspace_id') ?? '',
    channel: s('channel_id') ?? '',
    body: String(d['body'] ?? ''),
    taskId: s('task_id'),
    threadId: s('thread_id'),
    rootMessageId: s('root_message_id'),
    threadMode: mode && MODES.has(mode) ? (mode as 'tasks' | 'chat') : undefined,
    // the brain the composer picked, role -> model. Parsed here rather than trusted: the column is
    // TEXT locally and jsonb server-side, and a malformed one must be no override, never a 400 that
    // wedges the ordered queue.
    brainOverride: parseBrainOverride(s('birth_brain')) ?? undefined,
    threadMachineId: s('birth_machine'),
    threadOrigin: origin && ORIGINS.has(origin) ? (origin as 'desktop' | 'web' | 'routine') : undefined,
  };
}

export type ArtifactUploadInput = Parameters<ControlApiClient['postArtifact']>[0];

/** A ROW THE CONNECTOR MUST NOT INVENT. Pure like messageUploadInput, and for the same reason: the
 *  phone writes the attachment locally and this is the only place its columns become a request, so
 *  a column that stops reaching the wire fails a test rather than a person's photo.
 *
 *  Null when `message_id` is absent. That is not a defensive nicety: an artifact with no message is
 *  a LIBRARY file, which rides the `artifact.create` command and a different ACL, and posting one
 *  here would file it in the wrong place. */
export function artifactUploadInput(id: string, d: Record<string, unknown>): ArtifactUploadInput | null {
  const s = (k: string): string | undefined => (typeof d[k] === 'string' && d[k] ? (d[k] as string) : undefined);
  const n = (k: string): number | undefined => (typeof d[k] === 'number' ? (d[k] as number) : undefined);
  const messageId = s('message_id');
  const workspace = s('workspace_id');
  const channel = s('channel_id');
  if (!messageId || !workspace || !channel) return null;
  return {
    id,
    workspace,
    channel,
    messageId,
    // UNDEFINED, NEVER NULL: the server's schema is `.optional()`, which admits an absent key and
    // refuses an explicit null — a null here came back "invalid artifact" (2026-09-07).
    taskId: s('task_id'),
    kind: s('kind') ?? 'file',
    name: s('name') ?? 'attachment',
    mime: s('mime'),
    inlineContent: s('inline_content'),
    sizeBytes: n('size_bytes'),
    width: n('width'),
    height: n('height'),
  };
}
