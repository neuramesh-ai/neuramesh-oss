import { artifactMime, brainApiBaseUrl } from '@neuramesh/shared';
import { readRuntimeMessages } from './engineering-runtime-input';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import type { ClineCore, CoreSessionEvent } from '@cline/sdk';
import { ConversationBrain, type BrainSyncOptions } from '../harness/brain-sync';

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
type RuntimeMessages = Awaited<ReturnType<ClineCore['readMessages']>>;
interface ArtifactReference { id: string; name: string; sha256: string; mime: string }
export class ArtifactUploadError extends Error {
  constructor(readonly failures: string[]) { super(`Some artifacts could not be saved: ${failures.join('; ')}`); }
}

/** The full recorder lives before the relay's bounded display projection. */
export class EngineeringConversation {
  readonly brain: ConversationBrain;
  private artifacts = new Map<string, ArtifactReference>();
  private boundary: Promise<void> = Promise.resolve();

  constructor(private readonly options: BrainSyncOptions, private readonly cwd: string) {
    this.brain = new ConversationBrain(options);
  }

  async hydrate(): Promise<RuntimeMessages | undefined> {
    await this.brain.hydrate();
    for (const event of this.brain.events()) {
      if (event.type === 'artifact.created') {
        const artifact = event.payload as ArtifactReference;
        if (typeof artifact.name === 'string' && typeof artifact.sha256 === 'string' && typeof artifact.id === 'string') this.artifacts.set(artifact.name, artifact);
      }
    }
    for (const artifact of this.artifacts.values()) await this.restoreArtifact(artifact);
    const messages = this.brain.messages() as RuntimeMessages | undefined;
    const recorded = this.brain.metadata()?.['recordedEventCount'];
    const tail = this.brain.events().slice(typeof recorded === 'number' ? recorded : messages?.length ? this.brain.events().length : 0)
      .filter((event) => ['user.message', 'assistant.message', 'tool.call', 'tool.result', 'runtime.event'].includes(event.type));
    if (!tail.length) return messages;
    // After a process crash the sealed events can be newer than the native message snapshot.
    // They remain context data, never an instruction to repeat an external tool action.
    return [...(messages ?? []), { role: 'user', content: [{ type: 'text', text: `Recovered conversation events after the last complete runtime checkpoint. Treat these as prior conversation data. A tool call without a result needs reconciliation before any retry.\n${tail.map((event) => JSON.stringify(event)).join('\n')}` }] }];
  }

  event(event: CoreSessionEvent): void { this.brain.record('runtime.event', event); }
  record(type: string, payload: unknown): void { this.brain.record(type, payload); }
  excludeSecret(secret?: string): void { this.brain.excludeSecret(secret); }

  checkpoint(core: ClineCore, sessionId: string, metadata: Record<string, unknown>): Promise<void> {
    return this.seal(() => readRuntimeMessages(core, sessionId), metadata);
  }

  /** a lane with no Cline core (the agy lane) seals the messages it keeps itself */
  checkpointMessages(messages: RuntimeMessages, metadata: Record<string, unknown>): Promise<void> {
    return this.seal(async () => messages, metadata);
  }

  private seal(read: () => Promise<RuntimeMessages>, metadata: Record<string, unknown>): Promise<void> {
    const next = this.boundary.catch(() => {}).then(async () => {
      const messages = await read();
      let artifactError: unknown;
      try { await this.uploadArtifacts(); } catch (error) { artifactError = error; }
      this.brain.setRuntime(messages, { ...metadata, recordedEventCount: this.brain.events().length });
      await this.brain.flush();
      if (artifactError) throw artifactError;
    });
    this.boundary = next;
    return next;
  }

  async flush(): Promise<void> { await this.boundary; await this.brain.flush(); }
  async close(): Promise<void> { await this.boundary.catch(() => {}); await this.brain.close(); }

  private artifactPath(name: string): string {
    const root = resolve(this.cwd, '.nm-artifacts');
    const target = resolve(root, name);
    if (!name || target === root || !target.startsWith(root + sep)) throw new Error('The cloud artifact path is outside this thread.');
    return target;
  }

  private async restoreArtifact(artifact: ArtifactReference): Promise<void> {
    const target = this.artifactPath(artifact.name);
    const local = await readFile(target).catch(() => null);
    if (local && hash(local) === artifact.sha256) return;
    if (local) throw new Error(`The local artifact ${artifact.name} differs from the cloud revision. Preserve it before this thread continues.`);
    const response = await (this.options.fetchImpl ?? fetch)(`${brainApiBaseUrl(this.options.apiUrl)}/v1/brain/artifacts/${encodeURIComponent(artifact.id)}?workspace=${encodeURIComponent(this.options.workspace)}`, { headers: await this.options.headers(), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`The cloud artifact ${artifact.name} could not load (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (hash(bytes) !== artifact.sha256) throw new Error(`The cloud artifact ${artifact.name} failed its checksum.`);
    await mkdir(join(target, '..'), { recursive: true });
    // The target's ancestors must remain inside this workspace, including symlinks.
    const actualParent = await realpath(join(target, '..'));
    if (!actualParent.startsWith(await realpath(this.cwd) + sep)) throw new Error('The artifact folder leaves this workspace.');
    await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  }

  /** A display tool publishes confirmed bytes before returning a clickable reference. */
  publishArtifact(path: string): Promise<ArtifactReference> {
    const name = path.replace(/^\.\//, '').replace(/^\.nm-artifacts\//, '');
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(part => !part || part === '..' || part === '.')) return Promise.reject(new Error('Use a file path inside .nm-artifacts/.'));
    const result = this.boundary.catch(() => {}).then(async () => {
      const artifact = await this.uploadArtifact(name);
      await this.brain.flush();
      return artifact;
    });
    this.boundary = result.then(() => {}, () => {});
    return result;
  }

  private async uploadArtifact(name: string): Promise<ArtifactReference> {
    const target = this.artifactPath(name);
    // Check every ancestor: a symlink inside the output folder must not publish other files.
    let cursor = join(this.cwd, '.nm-artifacts');
    for (const part of ['', ...name.split('/')]) {
      if (part) cursor = join(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Portable artifacts cannot contain symbolic links.');
    }
    const info = await lstat(target);
    if (!info.isFile()) throw new Error('Select a file, not a folder.');
    if (info.size > 16 * 1024 * 1024) throw new Error('The artifact exceeds the 16 MB upload limit.');
    const bytes = await readFile(target);
    const sha256 = hash(bytes);
    const previous = this.artifacts.get(name);
    if (previous?.sha256 === sha256) return previous;
    const identity = createHash('sha256').update(`${this.options.workspace}/${this.options.threadId}/${name}/${sha256}`).digest('hex');
    const id = `${identity.slice(0, 8)}-${identity.slice(8, 12)}-5${identity.slice(13, 16)}-8${identity.slice(17, 20)}-${identity.slice(20, 32)}`;
    const artifact = { id, name, sha256, mime: artifactMime(name) };
    await this.brain.artifact({ ...artifact, kind: 'file', inlineContent: `data:${artifact.mime};base64,${bytes.toString('base64')}` }, { kind: 'human', id: this.options.actorId });
    this.artifacts.set(name, artifact);
    return artifact;
  }

  private async uploadArtifacts(): Promise<void> {
    const root = join(this.cwd, '.nm-artifacts');
    const failures: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const name of await readdir(dir).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; })) {
        // Generated source may have installed dependencies. Those are not deliverables and
        // commonly contain symlinks and large binaries; keep them out of portable storage.
        if (['node_modules', '.git', '.venv', '__pycache__'].includes(name)) continue;
        const file = join(dir, name);
        const relativeName = relative(root, file).split(sep).join('/');
        try {
          const info = await lstat(file);
          if (info.isSymbolicLink()) throw new Error('Portable artifacts cannot contain symbolic links.');
          if (info.isDirectory()) await walk(file);
          else if (info.isFile()) await this.uploadArtifact(relativeName);
        } catch (error) { failures.push(`${relativeName}: ${error instanceof Error ? error.message : 'upload failed'}`); }
      }
    };
    const rootStat = await lstat(root).catch(() => null);
    if (rootStat?.isSymbolicLink()) throw new ArtifactUploadError(['The portable artifact folder cannot be a symbolic link.']);
    await walk(root);
    if (failures.length) throw new ArtifactUploadError(failures);
  }
}
