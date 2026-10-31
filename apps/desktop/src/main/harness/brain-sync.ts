import { brainApiBaseUrl } from '@neuramesh/shared';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { BrainCommitRequest, BrainCommitResult, BrainConversationEvent, BrainThreadSnapshot } from '@neuramesh/shared';
import { brainRoot } from './brain';
import { durableAppend, durableWrite, packEvent, packRuntime, portableBrainValue, readJSON, unpackEvent, unpackRuntime } from './brain-sync-codec';
export { portableBrainValue } from './brain-sync-codec';
export { bindConversationCallback, captureConversationRecorder, conversationContext, conversationToolsThrough, setConversationHistoryBoundary, withoutConversationBrain, excludeConversationSecret, publishConversationArtifact, recordConversationEvent, withConversationBrain } from './brain-sync-context';

export interface BrainSyncOptions {
  workspace: string;
  actorId: string;
  threadId: string;
  apiUrl: string;
  headers: () => Promise<Record<string, string>>;
  root?: string;
  deviceId?: string;
  fetchImpl?: typeof fetch;
  intervalMs?: number;
  log?: (line: string) => void;
  headersForActor?: (actor: { kind: string; id: string; role?: string }) => Promise<Record<string, string>>;
}

interface LocalState { revision: number; acknowledged: number; runtimeHash?: string }
interface RuntimeState { messages?: unknown[]; metadata?: Record<string, unknown> }
const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
/** An append-only fsynced journal plus an idempotent durable cloud outbox. */
export class ConversationBrain {
  readonly path: string;
  private state: LocalState;
  private runtime: RuntimeState;
  private journal: BrainConversationEvent[];
  private eventIds: Set<string>;
  private readonly secrets = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private closed = false;
  private runtimeDirty = false;
  private readonly call: typeof fetch;
  private readonly deviceId: string;
  private uploading: Promise<void> | null = null;

  constructor(readonly options: BrainSyncOptions) {
    // Full hashes retain all of the identity. The old subject slug truncated thread IDs.
    const root = options.root ?? brainRoot();
    this.path = join(root, 'conversations', digest(options.workspace), digest(options.actorId), digest(options.threadId));
    mkdirSync(this.path, { recursive: true, mode: 0o700 });
    this.call = options.fetchImpl ?? fetch;
    const deviceFile = join(root, 'brain-device.json');
    if (!existsSync(deviceFile)) durableWrite(deviceFile, JSON.stringify({ id: randomUUID() }));
    this.deviceId = options.deviceId ?? readJSON<{ id: string }>(deviceFile, { id: '' }).id;
    this.state = readJSON(join(this.path, 'state.json'), { revision: 0, acknowledged: 0 });
    this.runtime = readJSON(join(this.path, 'runtime.json'), {});
    this.runtimeDirty = !!this.runtime.messages && this.state.runtimeHash !== digest(JSON.stringify(this.runtime));
    this.journal = this.recover();
    this.eventIds = new Set(this.journal.map((event) => event.id));
    if (this.state.acknowledged > this.journal.length) throw new Error('The local brain checkpoint is incomplete. Restore the thread before its next turn.');
    if (this.pending() || this.runtimeDirty || existsSync(join(this.path, 'pending.json')) || existsSync(join(this.path, 'uploads'))) this.schedule();
  }

  private recover(): BrainConversationEvent[] {
    const file = join(this.path, 'events.jsonl');
    if (!existsSync(file)) return [];
    const lines = readFileSync(file, 'utf8').split('\n');
    const events: BrainConversationEvent[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]?.trim()) continue;
      try {
        const event = JSON.parse(lines[i]!) as BrainConversationEvent;
        if (!event.id || !event.type || !event.timestamp) throw new Error('Invalid event');
        events.push(event);
      } catch {
        durableWrite(`${file}.${Date.now()}.bad`, lines.slice(i).join('\n'));
        durableWrite(file, events.map((event) => JSON.stringify(event) + '\n').join(''));
        this.options.log?.('brain_journal_tail_quarantined');
        break;
      }
    }
    return events;
  }

  excludeSecret(secret: string | undefined): void { if (secret) this.secrets.add(secret); }
  events(): readonly BrainConversationEvent[] { return this.journal; }
  messages(): unknown[] | undefined { return this.runtime.messages; }
  metadata(): Record<string, unknown> | undefined { return this.runtime.metadata; }
  revision(): number { return this.state.revision; }
  pending(): number { return this.journal.length - this.state.acknowledged; }

  record(type: string, payload: unknown, id: string = randomUUID()): void {
    if (this.closed) throw new Error('The conversation recorder is closed.');
    if (this.eventIds.has(id)) return;
    const event: BrainConversationEvent = { id, type, timestamp: new Date().toISOString(), payload: portableBrainValue(payload, [...this.secrets]) };
    durableAppend(join(this.path, 'events.jsonl'), JSON.stringify(event) + '\n');
    this.journal.push(event);
    this.eventIds.add(event.id);
    this.schedule();
  }

  setRuntime(messages: unknown[], metadata?: Record<string, unknown>): void {
    this.runtime = portableBrainValue({ messages, metadata }, [...this.secrets]);
    durableWrite(join(this.path, 'runtime.json'), JSON.stringify(this.runtime));
    this.runtimeDirty = true;
    this.schedule();
  }

  async artifact(body: Record<string, unknown>, actor: { kind: string; id: string; role?: string }): Promise<Response> {
    const inline = String(body['inlineContent']);
    const data = /^data:([^;,]+);base64,([\s\S]*)$/.exec(inline);
    const bytes = data ? Buffer.from(data[2]!, 'base64') : Buffer.from(inline, 'utf8');
    if (bytes.length > 16 * 1024 * 1024) throw new Error('The artifact exceeds the 16 MB upload limit.');
    const textContent = !data || /^(?:text\/|application\/(?:json|xml))/.test(data[1]!) ? bytes.toString('utf8') : null;
    if (textContent !== null && portableBrainValue(textContent, [...this.secrets]) !== textContent) throw new Error('The artifact contains a credential. Remove it before upload.');
    const id = typeof body['id'] === 'string' ? body['id'] : randomUUID();
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const dir = join(this.path, 'uploads');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const request = { workspace: this.options.workspace, threadId: this.options.threadId, id, name: body['name'], mime: data?.[1] ?? body['mime'] ?? 'text/plain', contentBase64: bytes.toString('base64'), sha256,
      ...(body['kind'] ? { kind: body['kind'] } : {}), ...(body['tags'] ? { tags: body['tags'] } : {}), ...(body['messageId'] ? { messageId: body['messageId'] } : {}), ...(body['channel'] ? { channel: body['channel'] } : {}) };
    durableWrite(join(dir, `${digest(id)}.json`), JSON.stringify({ actor, request }));
    this.schedule();
    await this.flushArtifacts();
    return new Response(JSON.stringify({ ok: true, id, artifactId: id, sha256, sizeBytes: bytes.length }), { headers: { 'content-type': 'application/json' } });
  }

  private flushArtifacts(): Promise<void> {
    if (this.uploading) return this.uploading;
    this.uploading = this.publishArtifacts().finally(() => { this.uploading = null; });
    return this.uploading;
  }

  private async publishArtifacts(): Promise<void> {
    const dir = join(this.path, 'uploads');
    if (!existsSync(dir)) return;
    for (;;) {
      const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
      if (!files.length) break;
      for (const file of files) {
      const pending = readJSON<{ actor: { kind: string; id: string; role?: string }; request: { id: string; name: string; sha256: string; mime: string } }>(join(dir, file), null!);
      const response = await this.call(`${brainApiBaseUrl(this.options.apiUrl)}/v1/brain/artifacts`, { method: 'POST', headers: { 'content-type': 'application/json', ...(await (this.options.headersForActor?.(pending.actor) ?? this.options.headers())) }, body: JSON.stringify(pending.request), signal: AbortSignal.timeout(60_000) });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { code?: string } | null;
        if (body?.code === 'BRAIN_READER_UPGRADE_REQUIRED') throw new Error('Artifact uploads are not enabled for this workspace yet. Your files remain saved on this machine; ask the workspace administrator to enable artifact storage after updating its clients.');
        throw new Error(`The artifact upload failed (${response.status}). Its bytes remain queued on this device.`);
      }
      this.record('artifact.created', { id: pending.request.id, name: pending.request.name, sha256: pending.request.sha256, mime: pending.request.mime }, `artifact:${pending.request.id}`);
      unlinkSync(join(dir, file));
      }
    }
  }

  /** Never replace unsent local work with a remote head. A conflict retains the local branch. */
  async hydrate(): Promise<void> {
    const response = await this.call(`${brainApiBaseUrl(this.options.apiUrl)}/v1/brain/threads/${encodeURIComponent(this.options.threadId)}?workspace=${encodeURIComponent(this.options.workspace)}&format=compact`, {
      headers: await this.options.headers(), signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`The cloud brain could not load (${response.status}). Retry before this thread continues.`);
    const remote = await response.json() as BrainThreadSnapshot;
    if (!Number.isInteger(remote.revision) || !Array.isArray(remote.events) || remote.workspace !== this.options.workspace || remote.threadId !== this.options.threadId) throw new Error('The cloud brain returned an invalid checkpoint.');
    if (remote.revision <= this.state.revision) return;
    // A lost commit response is recovered by the durable request first. Its id remains stable.
    if (existsSync(join(this.path, 'pending.json'))) await this.flush();
    if (remote.revision <= this.state.revision) return;
    if (this.pending() || this.runtimeDirty) throw new Error('This thread changed on another device. The local events are safe. Sync or resolve the local branch first.');
    const events = remote.events.map(unpackEvent);
    durableWrite(join(this.path, 'events.jsonl'), events.map((event) => JSON.stringify(event) + '\n').join(''));
    this.journal = events;
    this.eventIds = new Set(events.map((event) => event.id));
    this.runtime = { messages: unpackRuntime(remote.runtimeMessages), metadata: remote.metadata };
    durableWrite(join(this.path, 'runtime.json'), JSON.stringify(this.runtime));
    this.state = { revision: remote.revision, acknowledged: remote.events.length, runtimeHash: digest(JSON.stringify(this.runtime)) };
    this.runtimeDirty = false;
    durableWrite(join(this.path, 'state.json'), JSON.stringify(this.state));
  }

  private schedule(): void {
    if (this.closed || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush().catch((error: unknown) => { this.options.log?.(`brain_sync_pending: ${error instanceof Error ? error.message : 'upload failed'}`); this.schedule(); }); }, this.options.intervalMs ?? 5_000);
    this.timer.unref?.();
  }

  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.publish().catch((error: unknown) => { this.schedule(); throw error; }).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async publish(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    await this.flushArtifacts();
    const pendingFile = join(this.path, 'pending.json');
    while (this.pending() || this.runtimeDirty || existsSync(pendingFile)) {
      // Retry a persisted request before inspecting newer events. The same commit id and
      // bytes recover a lost acknowledgement even if a later event exceeds the wire limit.
      let request = readJSON<BrainCommitRequest | null>(pendingFile, null);
      if (!request) {
        const batch: BrainConversationEvent[] = [];
        const artifactIds = new Set<string>();
        let batchBytes = 0;
        for (const original of this.journal.slice(this.state.acknowledged)) {
          const event = packEvent(original);
          const bytes = Buffer.byteLength(JSON.stringify(event));
          if (bytes > 8 * 1024 * 1024) throw new Error('A conversation event exceeds the 8 MB sync limit. The complete event remains in the local brain.');
          const artifactId = original.type === 'artifact.created' ? (original.payload as { id: string }).id : undefined;
          if (batch.length >= 4096 || batchBytes + bytes > 8 * 1024 * 1024 || (artifactId && !artifactIds.has(artifactId) && artifactIds.size >= 256)) break;
          batch.push(event); batchBytes += bytes;
          if (artifactId) artifactIds.add(artifactId);
        }
        const lastBatch = batch.length === this.pending();
        const runtime = lastBatch ? { ...(this.runtime.messages ? { runtimeMessages: packRuntime(this.runtime.messages) } : {}), ...(this.runtime.metadata ? { metadata: this.runtime.metadata } : {}) } : {};
        if (Buffer.byteLength(JSON.stringify(runtime)) > 7 * 1024 * 1024) throw new Error('The runtime checkpoint exceeds the 7 MB sync limit. The full transcript remains in the local brain. Compact the model context before a device handoff.');
        request = {
          workspace: this.options.workspace, commitId: randomUUID(), expectedRevision: this.state.revision,
          deviceId: this.deviceId, events: batch, ...runtime, artifactIds: [...artifactIds],
        };
        durableWrite(pendingFile, JSON.stringify(request));
      }
      let result: BrainCommitResult;
      try {
        const response = await this.call(`${brainApiBaseUrl(this.options.apiUrl)}/v1/brain/threads/${encodeURIComponent(this.options.threadId)}/commits`, {
          method: 'POST', headers: { 'content-type': 'application/json', ...(await this.options.headers()) },
          body: JSON.stringify(request), signal: AbortSignal.timeout(60_000),
        });
        if (response.status === 409) throw new Error('This thread changed on another device. The local brain branch is safe.');
        if (!response.ok) throw new Error(`The cloud brain upload failed (${response.status}). The local events remain queued.`);
        result = await response.json() as BrainCommitResult;
        if (result.commitId !== request.commitId || result.revision !== request.expectedRevision + 1) throw new Error('The cloud brain returned an invalid commit acknowledgement.');
      } catch (error) { throw error; }
      // Crash after state rename but before unlink must not count the same events twice.
      if (this.state.revision < result.revision) {
        this.state = { revision: result.revision, acknowledged: this.state.acknowledged + request.events.length, runtimeHash: request.runtimeMessages ? digest(JSON.stringify({ messages: unpackRuntime(request.runtimeMessages), ...(request.metadata ? { metadata: request.metadata } : {}) })) : this.state.runtimeHash };
        durableWrite(join(this.path, 'state.json'), JSON.stringify(this.state));
      }
      this.runtimeDirty = !!this.runtime.messages && this.state.runtimeHash !== digest(JSON.stringify(this.runtime));
      unlinkSync(pendingFile);
    }
  }

  async close(): Promise<void> {
    try { await this.flush(); } finally { this.closed = true; if (this.timer) clearTimeout(this.timer); }
  }
}
