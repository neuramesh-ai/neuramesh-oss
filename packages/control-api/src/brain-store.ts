import { brainArtifactInline } from './brain-compatibility';
import { createEvent, type Actor } from '@neuramesh/shared';
import type postgres from 'postgres';
import { brainHash, type BrainObjectRef, type BrainObjectStore } from './brain-objects';
import { readBrainEvents } from './brain-read-events';
import { brainRestoreProjection } from './brain-restore-projection';

export { BrainError } from './brain-error';
import { BrainError } from './brain-error';
export interface BrainCommit {
  workspace: string;
  commitId: string;
  expectedRevision: number;
  deviceId: string;
  events: Array<{ id: string; type: string; timestamp: string; [key: string]: unknown }>;
  runtimeMessages?: unknown[];
  metadata?: Record<string, unknown>;
  artifactIds?: string[];
}
export interface BrainArtifact {
  workspace: string;
  threadId: string;
  id: string;
  name: string;
  mime: string;
  contentBase64: string;
  sha256?: string;
  messageId?: string;
  kind?: 'screenshot' | 'file' | 'doc' | 'diff' | 'test_report' | 'design' | 'ship';
  tags?: string[];
  channel?: string;
}
// A retry may use a different JSON key order. Its semantic payload must stay identical.
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Full Code traces are private to the session member and its current host. Team chat uses
 * the existing workspace-member / registered-agent boundary. Authorization is repeated under
 * the publication lock, so a revoked writer cannot publish bytes uploaded before revocation. */
export async function brainThreadAccess(sql: postgres.Sql, actor: Actor, workspace: string, threadId: string): Promise<{ channel_id: string; task_id: string | null; project_id: string | null; kind: string }> {
  const rows = await sql`
    select t.channel_id, t.task_id, ch.project_id, t.kind from threads t
    join channels ch on ch.id = t.channel_id
    left join code_sessions cs on cs.id = t.id
    left join machines m on m.id = coalesce(cs.machine_id, t.machine_id)
    where t.id = ${threadId}::uuid and t.workspace_id = ${workspace}::uuid
      and (
        (${actor.kind} = 'human' and exists (select 1 from workspace_members wm where wm.workspace_id = t.workspace_id and wm.user_id = ${actor.id}::uuid)
          and (t.kind <> 'coding' or t.created_by = ${`human:${actor.id}`} or cs.created_by = ${actor.id}::uuid or m.owner_user_id = ${actor.id}::uuid))
        or (${actor.kind} = 'agent' and t.kind <> 'coding' and exists (
          select 1 from agent_channels ac join agents a on a.id = ac.agent_id
          where ac.channel_id = t.channel_id and a.id = ${actor.id}::uuid and a.workspace_id = t.workspace_id and a.retired_at is null))
      )`;
  if (!rows[0]) throw new BrainError('NOT_FOUND', 'No accessible brain thread exists in this workspace.', 404);
  return rows[0] as { channel_id: string; task_id: string | null; project_id: string | null; kind: string };
}

type CommitRow = { revision: string; commit_id: string; request_sha256: string; segment: BrainObjectRef; snapshot: BrainObjectRef | null; event_count: number };
export class BrainStore {
  constructor(private readonly sql: postgres.Sql, private readonly objects: BrainObjectStore) {}

  async commit(actor: Actor, threadId: string, input: BrainCommit) {
    await brainThreadAccess(this.sql, actor, input.workspace, threadId);
    const digest = brainHash(canonicalJson(input));
    const previous = await this.sql<CommitRow[]>`select revision, commit_id, request_sha256 from brain_commits where thread_id = ${threadId}::uuid and commit_id = ${input.commitId}::uuid`;
    const retry = (row: CommitRow) => {
      if (row.request_sha256 !== digest) throw new BrainError('BRAIN_COMMIT_REUSED', 'This commit ID names different content. Use a new commit ID.');
      return { ok: true as const, revision: Number(row.revision), commitId: row.commit_id, sha256: digest, duplicate: true };
    };
    if (previous[0]) return retry(previous[0]);
    const uniqueIds = new Set(input.events.map((e) => e.id));
    if (uniqueIds.size !== input.events.length) throw new BrainError('BRAIN_EVENT_REUSED', 'Each event in a commit needs a unique ID.', 400);
    const prefix = `v1/workspaces/${input.workspace}/threads/${threadId}/commits/${input.commitId}/${digest}`;
    const segment = await this.objects.put(`${prefix}/events.jsonl`, Buffer.from(input.events.map((e) => JSON.stringify(e)).join('\n') + (input.events.length ? '\n' : '')), 'application/x-ndjson');
    const snapshot = input.runtimeMessages !== undefined || input.metadata !== undefined
      ? await this.objects.put(`${prefix}/runtime.json`, Buffer.from(JSON.stringify({ runtimeMessages: input.runtimeMessages, metadata: input.metadata })), 'application/json') : null;
    return this.sql.begin(async (transaction) => {
      const tx = transaction as unknown as postgres.Sql;
      await tx`select id from threads where id = ${threadId}::uuid for update`;
      await brainThreadAccess(tx, actor, input.workspace, threadId);
      const again = await tx<CommitRow[]>`select revision, commit_id, request_sha256 from brain_commits where thread_id = ${threadId}::uuid and commit_id = ${input.commitId}::uuid`;
      if (again[0]) return retry(again[0]);
      const [head] = await tx`select coalesce(max(revision), 0)::text as revision from brain_commits where thread_id = ${threadId}::uuid`;
      const revision = Number(head!['revision']);
      if (revision !== input.expectedRevision) throw new BrainError('BRAIN_CONFLICT', `The thread is at revision ${revision}. Restore that revision before another commit.`);
      if (input.events.length) {
        const duplicates = await tx`select event_id from brain_event_ids where thread_id = ${threadId}::uuid and event_id in ${tx([...uniqueIds])} limit 1`;
        if (duplicates.length) throw new BrainError('BRAIN_EVENT_REUSED', 'An event ID already belongs to an earlier commit.');
      }
      if (input.artifactIds?.length) {
        const refs = await tx`select artifact_id from brain_artifacts where workspace_id = ${input.workspace}::uuid and thread_id = ${threadId}::uuid and artifact_id in ${tx(input.artifactIds)} for share`;
        if (refs.length !== new Set(input.artifactIds).size) throw new BrainError('BRAIN_ARTIFACT_MISSING', 'Upload each referenced artifact before this commit.', 400);
      }
      const next = revision + 1;
      await tx`insert into brain_commits (thread_id, revision, commit_id, workspace_id, device_id, actor_kind, actor_id, request_sha256, segment, snapshot, event_count)
        values (${threadId}::uuid, ${next}, ${input.commitId}::uuid, ${input.workspace}::uuid, ${input.deviceId}, ${actor.kind}::actor_kind, ${actor.id}::uuid, ${digest}, ${tx.json(segment as never)}, ${snapshot ? tx.json(snapshot as never) : null}, ${input.events.length})`;
      if (input.events.length) await tx`insert into brain_event_ids ${tx(input.events.map((e) => ({ thread_id: threadId, event_id: e.id, revision: next })))}`;
      const event = createEvent({ type: 'brain.committed', workspace: input.workspace, source: `${actor.kind}:${actor.id}`, target: `resource/thread/${threadId}`, payload: { threadId, revision: next, commitId: input.commitId, eventCount: input.events.length, sha256: digest } });
      await tx`insert into events (id, workspace_id, type, source, target, payload)
        values (${event.id}, ${event.workspace}::uuid, ${event.type}, ${event.source}, ${event.target}, ${tx.json(event.payload as never)})`;
      return { ok: true as const, revision: next, commitId: input.commitId, sha256: digest, duplicate: false };
    });
  }

  async read(actor: Actor, workspace: string, threadId: string, compact = false, since?: number) {
    await brainThreadAccess(this.sql, actor, workspace, threadId);
    // a reader that already holds the head says so with `since`, and nothing else is read: no segment, no snapshot.
    // A phone asks again on each focus, and a long recording takes many seconds to read in full
    if (since !== undefined) {
      const [head] = await this.sql<{ revision: string; commit_id: string }[]>`select revision::text as revision, commit_id from brain_commits where thread_id = ${threadId}::uuid order by revision desc limit 1`;
      const revision = Number(head?.revision ?? 0);
      if (revision === since) return { workspace, threadId, revision, commitId: head?.commit_id ?? null, events: [], unchanged: true as const };
    }
    // One query takes a consistent committed prefix. Later uploads cannot enter this restore.
    const commits = await this.sql<CommitRow[]>`select revision, commit_id, segment, snapshot, event_count from brain_commits where thread_id = ${threadId}::uuid order by revision`;
    const events = await readBrainEvents(this.objects, commits, compact ? brainRestoreProjection() : undefined);
    let runtimeMessages: unknown[] | undefined;
    let metadata: Record<string, unknown> | undefined;
    // Read only the latest value for each optional snapshot field.
    for (const commit of [...commits].reverse()) {
      if (!commit.snapshot) continue;
      const snapshot = JSON.parse((await this.objects.get(commit.snapshot)).toString('utf8')) as { runtimeMessages?: unknown[]; metadata?: Record<string, unknown> };
      runtimeMessages ??= snapshot.runtimeMessages;
      metadata ??= snapshot.metadata;
      if (runtimeMessages !== undefined && metadata !== undefined) break;
    }
    await brainThreadAccess(this.sql, actor, workspace, threadId);
    const head = commits.at(-1);
    return { workspace, threadId, revision: Number(head?.revision ?? 0), commitId: head?.commit_id ?? null, events, runtimeMessages, metadata,
      artifacts: await this.artifacts(actor, workspace, threadId) };
  }

  async artifacts(actor: Actor, workspace: string, threadId: string) {
    await brainThreadAccess(this.sql, actor, workspace, threadId);
    const rows = await this.sql`select a.id, a.name, a.kind, a.tags, a.mime, a.size_bytes, a.content_hash, a.created_at from brain_artifacts b join artifacts a on a.id = b.artifact_id where b.thread_id = ${threadId}::uuid and b.workspace_id = ${workspace}::uuid order by b.created_at`;
    return rows.map((r) => ({ id: r['id'] as string, name: r['name'] as string, kind: r['kind'] as string, tags: r['tags'] as string[], mime: r['mime'] as string, sizeBytes: Number(r['size_bytes']), sha256: r['content_hash'] as string, createdAt: new Date(r['created_at']).toISOString(), storagePath: `brain:${r['id']}`, url: `/v1/brain/artifacts/${r['id']}?workspace=${workspace}` }));
  }

  async artifact(actor: Actor, input: BrainArtifact) {
    const scope = await brainThreadAccess(this.sql, actor, input.workspace, input.threadId);
    if (input.channel && input.channel !== scope.channel_id) throw new BrainError('NOT_FOUND', 'The artifact channel does not belong to this thread.', 404);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.contentBase64)) throw new BrainError('INVALID_INPUT', 'Artifact content must use valid base64.', 400);
    const bytes = Buffer.from(input.contentBase64, 'base64');
    if (bytes.length > 16 * 1024 * 1024) throw new BrainError('TOO_LARGE', 'An artifact must be at most 16 MiB.', 413);
    const sha256 = brainHash(bytes);
    if (input.sha256 && input.sha256 !== sha256) throw new BrainError('BRAIN_CHECKSUM_MISMATCH', 'The artifact checksum does not match its bytes.', 400);
    // Fail before uploading if this workspace has not completed the private-reader rollout.
    brainArtifactInline(bytes, input.mime, input.workspace, scope.kind === 'coding');
    const digest = brainHash(canonicalJson({ workspace: input.workspace, threadId: input.threadId, id: input.id, name: input.name, mime: input.mime, sha256, messageId: input.messageId, kind: input.kind, tags: input.tags, channel: input.channel }));
    const ref = await this.objects.put(`v1/workspaces/${input.workspace}/threads/${input.threadId}/artifacts/${input.id}/${sha256}`, bytes, input.mime);
    await this.sql.begin(async (transaction) => {
      const tx = transaction as unknown as postgres.Sql;
      await tx`select id from threads where id = ${input.threadId}::uuid for update`;
      const thread = await brainThreadAccess(tx, actor, input.workspace, input.threadId);
      const inline = brainArtifactInline(bytes, input.mime, input.workspace, thread.kind === 'coding');
      const [existing] = await tx`select request_sha256 from brain_artifacts where artifact_id = ${input.id}::uuid`;
      if (existing) {
        if (existing['request_sha256'] !== digest) throw new BrainError('BRAIN_ARTIFACT_REUSED', 'This artifact ID names different content. Use a new artifact ID.');
        return;
      }
      let messageId = input.messageId;
      if (messageId) {
        const message = await tx`select id from messages where id = ${messageId}::uuid and thread_id = ${input.threadId}::uuid and workspace_id = ${input.workspace}::uuid`;
        if (!message.length) throw new BrainError('NOT_FOUND', 'The artifact message does not belong to this thread.', 404);
      } else messageId = (await tx`select id from messages where thread_id = ${input.threadId}::uuid and workspace_id = ${input.workspace}::uuid order by created_at, id limit 1`)[0]?.['id'] as string | undefined;
      const collision = await tx`select id from artifacts where id = ${input.id}::uuid`;
      if (collision.length) throw new BrainError('BRAIN_ARTIFACT_REUSED', 'This artifact ID already exists. Use a new artifact ID.');
      await tx`insert into artifacts (id, workspace_id, channel_id, project_id, task_id, message_id, kind, name, mime, tags, content_hash, storage_path, size_bytes, inline_content, created_by_kind, created_by)
        values (${input.id}::uuid, ${input.workspace}::uuid, ${thread.channel_id}::uuid, ${thread.project_id}::uuid, ${thread.task_id}::uuid, ${messageId ?? null}::uuid, ${input.kind ?? (input.mime.startsWith('image/') ? 'screenshot' : 'file')}::artifact_kind, ${input.name}, ${input.mime}, ${input.tags ?? []}, ${sha256}, ${`brain:${input.id}`}, ${bytes.length}, ${inline}, ${actor.kind}::actor_kind, ${actor.id}::uuid)`;
      await tx`insert into brain_artifacts (artifact_id, thread_id, workspace_id, object_ref, request_sha256) values (${input.id}::uuid, ${input.threadId}::uuid, ${input.workspace}::uuid, ${tx.json(ref as never)}, ${digest})`;
      const event = createEvent({ type: 'brain.artifact_created', workspace: input.workspace, source: `${actor.kind}:${actor.id}`, target: `resource/artifact/${input.id}`, payload: { artifactId: input.id, threadId: input.threadId, sha256, sizeBytes: bytes.length } });
      await tx`insert into events (id, workspace_id, type, source, target, payload)
        values (${event.id}, ${event.workspace}::uuid, ${event.type}, ${event.source}, ${event.target}, ${tx.json(event.payload as never)})`;
    });
    return { ok: true, id: input.id, artifactId: input.id, sha256, sizeBytes: bytes.length, url: `/v1/brain/artifacts/${input.id}?workspace=${input.workspace}` };
  }

  async download(actor: Actor, workspace: string, id: string) {
    const [row] = await this.sql`select b.thread_id, b.object_ref, a.name from brain_artifacts b join artifacts a on a.id = b.artifact_id where b.artifact_id = ${id}::uuid and b.workspace_id = ${workspace}::uuid`;
    if (!row) throw new BrainError('NOT_FOUND', 'No artifact exists in this workspace.', 404);
    await brainThreadAccess(this.sql, actor, workspace, row['thread_id']);
    const ref = row['object_ref'] as BrainObjectRef;
    const bytes = await this.objects.get(ref);
    await brainThreadAccess(this.sql, actor, workspace, row['thread_id']);
    return { bytes, ref, name: row['name'] as string };
  }

  async artifactMetadata(actor: Actor, workspace: string, id: string) {
    const [row] = await this.sql`select b.thread_id, a.id, a.name, a.kind, a.tags, a.mime, a.size_bytes, a.content_hash, a.created_at
      from brain_artifacts b join artifacts a on a.id = b.artifact_id where b.artifact_id = ${id}::uuid and b.workspace_id = ${workspace}::uuid`;
    if (!row) throw new BrainError('NOT_FOUND', 'No artifact exists in this workspace.', 404);
    await brainThreadAccess(this.sql, actor, workspace, row['thread_id']);
    return { id, name: row['name'] as string, kind: row['kind'] as string, tags: row['tags'] as string[], mime: row['mime'] as string,
      sizeBytes: Number(row['size_bytes']), sha256: row['content_hash'] as string, createdAt: new Date(row['created_at']).toISOString(),
      storagePath: `brain:${id}`, url: `/v1/brain/artifacts/${id}?workspace=${workspace}` };
  }
}
