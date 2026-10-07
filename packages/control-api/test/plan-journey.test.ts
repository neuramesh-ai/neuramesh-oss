// The plan document's last word (2026-10-05, the review of the homepage words round 2). The journey ends
// in the person's word: merge for a unit with a repository, accept for one without. The orchestrator's
// create binds no repository (it binds one at the offer, after the plan), so the plan of a code unit in a
// room whose project has a repository said "accept" while the reviewer's line said "Say merge". A code
// unit in such a room ends in merge now; other work, and a room with no repository, end in accept.
import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const rex: Actor = { kind: 'agent', id: 'rex', role: 'orchestrator' };
const j = (r: Response): Promise<any> => r.json() as Promise<any>;

let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let build: string;
let plain: string;

beforeEach(async () => {
  store = new MemoryStore();
  build = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p1', slug: 'build', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  plain = (await store.createChannel({ workspace: 'ws_acme', projectId: 'p2', slug: 'notes', topic: '' }, { type: 'test', workspace: 'ws_acme' } as never)).id;
  store.announcements.seedRepo({ channelId: build, workspaceId: 'ws_acme', projectId: 'p1', repoId: 'r1', orgName: 'acme', name: 'site', cloneUrl: 'https://github.com/acme/site.git', provider: 'github' });
  app = createApp(store);
});

async function journeyOf(channel: string, kind: string): Promise<string> {
  const res = await app.request('/v1/commands', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(rex) },
    body: JSON.stringify({ type: 'task.create', workspace: 'ws_acme', channel, title: `A ${kind} unit`, description: 'x', kind, plan: { legs: ['build', 'review'], subtasks: [], approach: '## Approach\nDo the work, then test it, then ship it.' } }),
  });
  expect(res.status).toBe(200);
  const { task } = await j(res);
  const doc = (await store.listArtifacts(task.id)).find((a) => a.name === 'implementation-plan-v1.md');
  return /\*\*Journey:\*\* (.+)/.exec(doc?.content ?? '')?.[1] ?? '';
}

describe('the plan document ends in the person\'s word', () => {
  it('a code unit in a room with a repository ends in merge', async () => {
    expect(await journeyOf(build, 'feature')).toBe('plan → build → review → merge');
    expect(await journeyOf(build, 'bug')).toBe('plan → build → review → merge');
  });

  it('other work, and a room with no repository, end in accept', async () => {
    expect(await journeyOf(build, 'research')).toBe('plan → research → review → accept');
    expect(await journeyOf(plain, 'feature')).toBe('plan → build → review → accept');
  });
});
