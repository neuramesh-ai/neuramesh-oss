import { MARKETING_SETUP_FLOW, TaskSchema, type NMEvent, type Task } from '@neuramesh/shared';
import { DomainError } from '../errors';
import type { Store } from './contract';
const anchors = new WeakMap<object, Map<string, string>>();
type Project = { id: string; status: string; workspace: string };
type Channel = { id: string; projectId: string; slug: string };
export async function startProjectMarketingMem(
  store: Pick<Store, 'humanMemberIds' | 'createChannel' | 'nextTaskNumber'>,
  projects: Project[], channels: Channel[], tasks: Map<string, Task>, events: NMEvent[],
  projectId: string, userId: string, makeEvent: (workspace: string) => NMEvent,
): Promise<{ channelId: string; taskId: string }> {
  const p = projects.find((x) => x.id === projectId && x.status === 'active');
  if (!p) throw new DomainError('NOT_FOUND', 'active project not found');
  if (!(await store.humanMemberIds(p.workspace)).includes(userId)) throw new DomainError('NOT_PERMITTED', 'project membership required');
  let c = channels.find((x) => x.projectId === p.id && x.slug === 'general');
  if (!c) {
    const made = await store.createChannel({ workspace: p.workspace, projectId, slug: 'general', topic: '' }, makeEvent(p.workspace));
    c = channels.find((x) => x.id === made.id)!;
  }
  const ids = anchors.get(store) ?? new Map<string, string>();
  anchors.set(store, ids);
  const prior = ids.get(projectId);
  const existing = prior ? tasks.get(prior) : undefined;
  if (existing) {
    if (existing.state === 'closed') tasks.set(existing.id, { ...existing, state: 'todo', updatedAt: new Date().toISOString() });
    return { channelId: c.id, taskId: existing.id };
  }
  const now = new Date().toISOString();
  const task = TaskSchema.parse({ id: crypto.randomUUID(), workspace: p.workspace, channel: c.slug,
    number: await store.nextTaskNumber(p.workspace), title: MARKETING_SETUP_FLOW.title, description: MARKETING_SETUP_FLOW.description,
    state: 'todo', kind: 'setup', creator: { kind: 'human', id: userId }, createdAt: now, updatedAt: now });
  tasks.set(task.id, task);
  ids.set(projectId, task.id);
  events.push(makeEvent(p.workspace));
  return { channelId: c.id, taskId: task.id };
}

export async function backfillSetupTasksMem<T>(channels: T[], ensure: (channel: T) => Promise<boolean>): Promise<number> {
  let made = 0;
  for (const channel of channels) if (await ensure(channel)) made += 1;
  return made;
}
