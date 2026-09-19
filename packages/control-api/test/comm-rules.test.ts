// The workspace voice at the server boundary (docs/design/agent-comm-rules-2026-08):
// config roundtrip + the em-dash scrub applied to AGENT prose only, fences exempt.
import { createEvent, formatAddress, type Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const george: Actor = { kind: 'human', id: 'george' };
const rex: Actor = { kind: 'agent', id: 'a-rex', role: 'orchestrator' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;
let ws: string;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const base = () => ({ workspace: ws, channel: 'dev' });

const send = (actor: Actor, path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  store = new MemoryStore();
  app = createApp(store);
  ({ workspaceId: ws } = await store.createWorkspace(
    { name: 'Acme', slug: 'acme', createdBy: 'george' },
    createEvent({ type: 'workspace.created', source: formatAddress({ kind: 'human', id: 'george' }), target: 'resource/workspace/acme', workspace: 'acme', payload: {} }),
  ));
});

describe('comm rules config', () => {
  it('workspace.update stores them; agents may not touch them', async () => {
    const ok = await send(george, '/v1/commands', { type: 'workspace.update', workspace: ws, commRules: { ste100: false, custom: ['Dates are absolute.'] } });
    expect(ok.status).toBe(200);
    expect(await store.getCommRules(ws)).toEqual({ ste100: false, custom: ['Dates are absolute.'] });
    const no = await send(rex, '/v1/commands', { type: 'workspace.update', workspace: ws, commRules: { noEmdash: false } });
    expect(no.status).toBe(403);
  });
});

describe('the em-dash scrub — agent prose only, fences exempt, defaults ON', () => {
  it('scrubs an agent message; never a fence; never a human', async () => {
    const a = await j(await send(rex, '/v1/messages', { ...base(), body: 'fast — safe — Done\n```\nx — y\n```' }));
    expect(a.message.body).toContain('fast, safe. Done');
    expect(a.message.body).toContain('x — y');
    const h = await j(await send(george, '/v1/messages', { ...base(), body: 'humans — keep their dashes' }));
    expect(h.message.body).toContain('—');
  });
  it('an opted-out workspace posts agent dashes untouched', async () => {
    await send(george, '/v1/commands', { type: 'workspace.update', workspace: ws, commRules: { noEmdash: false } });
    const a = await j(await send(rex, '/v1/messages', { ...base(), body: 'kept — as-is' }));
    expect(a.message.body).toBe('kept — as-is');
  });
  it('an agent draft and its revision are scrubbed, body and image brief; a human draft is not', async () => {
    const proj = await j(await send(george, '/v1/commands', { type: 'project.create', workspace: ws, name: 'Growth' }));
    const { channelId } = await j(await send(george, '/v1/commands', { type: 'channel.create', workspace: ws, project: proj.projectId, slug: 'marketing' }));
    const items = () => (store as unknown as { contentItems: Array<{ id: string; body: string; brief?: string | null }> }).contentItems;
    const a = await j(await send(rex, '/v1/commands', { type: 'content.create', channel: channelId, platform: 'tiktok', body: '[0:00-0:03] HOOK — handheld, no laptop bag\nSpoken: "my code — Still there"', imageBrief: '9:16 — phone in hand' }));
    expect(items().find((x) => x.id === a.itemId)).toMatchObject({ body: '[0:00-0:03] HOOK, handheld, no laptop bag\nSpoken: "my code. Still there"', brief: '9:16, phone in hand' });
    await send(rex, '/v1/commands', { type: 'content.revise', item: a.itemId, body: 'second cut — tighter' });
    expect(items().find((x) => x.id === a.itemId)?.body).toBe('second cut, tighter');
    const h = await j(await send(george, '/v1/commands', { type: 'content.create', channel: channelId, platform: 'x', body: 'humans — keep theirs' }));
    expect(items().find((x) => x.id === h.itemId)?.body).toBe('humans — keep theirs');
    await send(george, '/v1/commands', { type: 'workspace.update', workspace: ws, commRules: { noEmdash: false } });
    const o = await j(await send(rex, '/v1/commands', { type: 'content.create', channel: channelId, platform: 'x', body: 'opted out — kept' }));
    expect(items().find((x) => x.id === o.itemId)?.body).toBe('opted out — kept');
  });
  it('agent task titles and descriptions are scrubbed at birth', async () => {
    const r = await j(await send(rex, '/v1/commands', { type: 'task.create', ...base(), title: 'CTA test — homepage', description: 'measure — then decide', backlog: true }));
    expect(r.task.title).toBe('CTA test, homepage');
    expect(r.task.description).toBe('measure, then decide');
  });
});
