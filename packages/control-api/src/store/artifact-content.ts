import type { Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { brainHash, configuredBrainObjects, type BrainObjectRef } from '../brain-objects';
import { actorInWorkspace, sqlOf } from '../credits';
import { BrainError } from '../brain-store';
import { hashMachineToken } from '../machine-auth';
import type { Store } from './contract';

/** Internal readers call this only after a scoped task or channel lookup. Private Code references
 * are excluded by those queries and are served through the owner-checked brain route instead. */
export async function artifactContent(inline: string | null, ref: BrainObjectRef | null): Promise<string | null> {
  if (!ref) return inline;
  const objects = configuredBrainObjects();
  if (!objects) {
    if (inline === null) throw new Error('Configure brain object storage to read this artifact.');
    const prefix = `data:${ref.mime};base64,`;
    const bytes = inline.startsWith(prefix) ? Buffer.from(inline.slice(prefix.length), 'base64') : Buffer.from(inline);
    if (bytes.length !== ref.sizeBytes || brainHash(bytes) !== ref.sha256) throw new Error('Artifact compatibility copy failed verification.');
    return inline;
  }
  const bytes = await objects.get(ref);
  return /^(text\/|application\/(json|xml|javascript)(;|$))/.test(ref.mime)
    ? bytes.toString('utf8') : `data:${ref.mime};base64,${bytes.toString('base64')}`;
}

export async function assertTaskArtifactRead(store: Store, actor: Actor, taskId: string, workspace: string, authorization?: string): Promise<void> {
  const sql = sqlOf(store);
  if (!sql) return; // The fixture store has no SQL memberships or object references.
  const token = /^Bearer\s+(nmm_.+)$/i.exec(authorization ?? '')?.[1];
  if (token && (await store.machineByTokenHash?.(hashMachineToken(token)))?.workspace_id !== workspace) throw new BrainError('NOT_FOUND', 'No accessible task exists.', 404);
  if (!await actorInWorkspace(store, actor, workspace)) throw new BrainError('NOT_FOUND', 'No accessible task exists.', 404);
  if (actor.kind === 'agent') {
    const [allowed] = await sql`select 1 from tasks t join agent_channels ac on ac.channel_id = t.channel_id join agents a on a.id = ac.agent_id
      where t.id = ${taskId}::uuid and a.id = ${actor.id}::uuid and a.retired_at is null`;
    if (!allowed) throw new BrainError('NOT_FOUND', 'No accessible task exists.', 404);
  }
}

export function taskDetailRoute<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store): void {
  app.get('/v1/tasks/:id', async (c) => {
    const task = await store.getTask(c.req.param('id'));
    if (!task) return c.json({ error: 'not found', code: 'NOT_FOUND' }, 404);
    await assertTaskArtifactRead(store, c.get('actor'), task.id, task.workspace, c.req.header('authorization'));
    const events = (await store.listEvents(`task:${task.number}`)).filter((event) => event.workspace === task.workspace);
    const artifacts = await store.listArtifacts(task.id);
    await assertTaskArtifactRead(store, c.get('actor'), task.id, task.workspace, c.req.header('authorization'));
    return c.json({ task, events, artifacts });
  });
}
