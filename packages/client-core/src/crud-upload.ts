import { failure } from './api';
// The shared uploader for the SQLite outbox. Messages and attachments retry transient failures;
// whiteboards converge using server revisions and retain their established refusal policy.
// Unsupported operations remain queued for recovery rather than disappearing during upgrade.
export interface CrudEntry {
  id: string;
  table: string;
  op: 'PUT' | 'PATCH' | 'DELETE';
  opData?: Record<string, unknown>;
}

export interface UploadIdentity {
  apiUrl: string;
  /** default workspace when a row lacks workspace_id (desktop: the dev seed; machine: its own) */
  workspaceFallback: string;
  /** actor when a row carries no author columns (desktop: the signed-in human; machine: its owner) */
  defaultActor: { kind: string; id: string };
  /** headers added to every call (the machine bearer; desktop adds none) */
  authHeaders?: Record<string, string>;
  /** log-line prefix ('' on desktop, '[machined] ' on machines) */
  logPrefix?: string;
  /** injectable for tests */
  fetchImpl?: typeof fetch;
}

export type UploadOutcome = 'uploaded' | 'skipped' | 'unhandled';

function headers(ident: UploadIdentity, actor: { kind: unknown; id: unknown }): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(ident.authHeaders ?? {}),
    'x-nm-actor': JSON.stringify(actor),
  };
}

async function send(
  ident: UploadIdentity,
  table: string,
  opId: string,
  url: string,
  method: string,
  actor: { kind: unknown; id: unknown },
  body: unknown,
): Promise<Response> {
  const doFetch = ident.fetchImpl ?? fetch;
  try {
    return await doFetch(url, { method, headers: headers(ident, actor), body: JSON.stringify(body) });
  } catch (err) {
    // connection-level failure (API down) — previously silent forever on desktop
    console.error(`${ident.logPrefix ?? ''}upload_failed table=${table} id=${opId} url=${ident.apiUrl} err=${err instanceof Error ? err.message : err}`);
    throw err;
  }
}

async function throwUnless409(ident: UploadIdentity, table: string, opId: string, res: Response): Promise<void> {
  if (!res.ok && res.status !== 409) {
    const detail = await res.text();
    console.error(`${ident.logPrefix ?? ''}upload_failed table=${table} id=${opId} status=${res.status} ${detail.slice(0, 160)}`);
    throw failure(`/v1/${table}`, res.status, detail);
  }
}

/** upload one crud op. throws to retry without acknowledging the queued write; 'unhandled' leaves policy to the caller. */
export async function uploadCrudEntry(ident: UploadIdentity, op: CrudEntry): Promise<UploadOutcome> {
  const d = op.opData ?? {};
  const kind = op.op as unknown as string;

  if (op.table === 'messages' && kind === 'PUT') {
    const actor = { kind: d['author_kind'] ?? ident.defaultActor.kind, id: d['author_id'] ?? ident.defaultActor.id };
    const res = await send(ident, 'messages', op.id, `${ident.apiUrl}/v1/messages`, 'POST', actor, {
      id: op.id,
      workspace: d['workspace_id'] ?? ident.workspaceFallback,
      project: d['birth_project'] ?? undefined,
      channel: d['channel_id'], // post by channel id — slugs repeat across projects
      body: d['body'] ?? '',
      taskId: d['task_id'] ?? undefined,
      // a fresh thread id births the conversation server-side (title heuristic),
      // transactionally with this message; the thread row then syncs back down
      threadId: d['thread_id'] ?? undefined,
      // …and when that birth is a REPLY, the room message it hangs off (docs/31)
      rootMessageId: d['root_message_id'] ?? undefined,
      // …and the composer's Tasks toggle (docs/34), applied at birth and ignored after
      threadMode: d['birth_mode'] ?? undefined,
      // …and the brain the composer was showing when this conversation was born
      brainOverride: d['birth_brain'] ? JSON.parse(d['birth_brain'] as string) : undefined,
      // …and where the session runs and which client bore it (0134), the same birth-only contract
      threadMachineId: d['birth_machine'] ?? undefined,
      threadOrigin: d['birth_origin'] ?? undefined,
      // …and the kind (0144): `coding` when the repo chip was set, applied at birth and ignored after
      threadKind: d['birth_kind'] ?? undefined,
    });
    await throwUnless409(ident, 'messages', op.id, res);
    return 'uploaded';
  }

  if (op.table === 'artifacts' && kind === 'PUT') {
    // message_id is required by the attachments contract, so this never fires for other rows
    if (!d['message_id']) return 'skipped';
    const res = await send(ident, 'artifacts', op.id, `${ident.apiUrl}/v1/artifacts`, 'POST', ident.defaultActor, {
      id: op.id,
      workspace: d['workspace_id'] ?? ident.workspaceFallback,
      channel: d['channel_id'],
      taskId: d['task_id'] ?? undefined,
      messageId: d['message_id'],
      kind: d['kind'] ?? 'file',
      name: d['name'] ?? 'attachment',
      mime: d['mime'] ?? undefined,
      inlineContent: d['inline_content'] ?? undefined,
      sizeBytes: d['size_bytes'] ?? undefined,
      width: d['width'] ?? undefined,
      height: d['height'] ?? undefined,
    });
    await throwUnless409(ident, 'artifacts', op.id, res);
    return 'uploaded';
  }

  if (op.table === 'whiteboards' && (kind === 'PUT' || kind === 'PATCH')) {
    const isPut = kind === 'PUT';
    if (!isPut && d['rev'] == null) {
      console.error(`${ident.logPrefix ?? ''}upload_skipped table=whiteboards id=${op.id} patch without rev — dropped`);
      return 'skipped';
    }
    const res = await send(
      ident,
      'whiteboards',
      op.id,
      isPut ? `${ident.apiUrl}/v1/whiteboards` : `${ident.apiUrl}/v1/whiteboards/${op.id}`,
      isPut ? 'POST' : 'PATCH',
      ident.defaultActor,
      isPut
        ? {
            id: op.id,
            workspace: d['workspace_id'] ?? ident.workspaceFallback,
            channel: d['channel_id'],
            threadId: d['thread_id'] ?? undefined,
            taskId: d['task_id'] ?? undefined,
            title: d['title'] ?? 'Untitled board',
            scene: d['scene'] ?? undefined,
            snapshotSvg: d['snapshot_svg'] ?? undefined,
            snapshotRev: d['snapshot_rev'] ?? undefined,
            rev: d['rev'] ?? 1,
          }
        : {
            rev: d['rev'],
            title: d['title'] ?? undefined,
            scene: d['scene'] ?? undefined,
            snapshotSvg: d['snapshot_svg'] ?? undefined,
            snapshotRev: d['snapshot_rev'] ?? undefined,
            // tri-state: only ride the key when the column actually changed
            ...('archived_at' in d ? { archivedAt: d['archived_at'] ?? null } : {}),
          },
    );
    if (!res.ok && res.status !== 409) {
      const detail = await res.text();
      if (res.status >= 500) {
        console.error(`${ident.logPrefix ?? ''}upload_failed table=whiteboards id=${op.id} status=${res.status} ${detail.slice(0, 160)}`);
        throw new Error(`upload failed ${res.status}: ${detail}`);
      }
      console.error(`${ident.logPrefix ?? ''}upload_skipped table=whiteboards id=${op.id} status=${res.status} ${detail.slice(0, 160)}`);
      return 'skipped';
    }
    return 'uploaded';
  }

  return 'unhandled';
}
