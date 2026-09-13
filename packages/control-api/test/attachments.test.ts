import type { Actor } from '@neuramesh/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

// Server-enforced attachment caps (doctrine: invariants live in the server, not prompts). The
// desktop forwards each staged attachment to POST /v1/artifacts; the per-plan caps are enforced
// here, idempotently, so a tampered or buggy client can't exceed them.

const george: Actor = { kind: 'human', id: 'george' };
let app: ReturnType<typeof createApp>;
let store: MemoryStore;

const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MB = 1024 * 1024;

function postArtifact(body: unknown) {
  return app.request('/v1/artifacts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(george) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  store = new MemoryStore();
  app = createApp(store);
});

describe('chat attachment caps (server-enforced)', () => {
  const base = { workspace: 'ws_acme', channel: 'dev', messageId: uuid(1), kind: 'screenshot', name: 'photo.png', mime: 'image/png', sizeBytes: 1024 };

  it('free: allows 3 attachments per message, rejects the 4th with PLAN_LIMIT', async () => {
    for (let i = 1; i <= 3; i++) {
      expect((await postArtifact({ ...base, id: uuid(100 + i) })).status).toBe(200);
    }
    const r4 = await postArtifact({ ...base, id: uuid(104) });
    expect(r4.status).toBe(402);
    expect((await j(r4)).code).toBe('PLAN_LIMIT');
  });

  it('is idempotent: re-POSTing the same id succeeds and does not consume a slot', async () => {
    expect((await postArtifact({ ...base, id: uuid(200) })).status).toBe(200);
    expect((await postArtifact({ ...base, id: uuid(200) })).status).toBe(200); // retry
    expect((await postArtifact({ ...base, id: uuid(201) })).status).toBe(200);
    expect((await postArtifact({ ...base, id: uuid(202) })).status).toBe(200);
    expect((await postArtifact({ ...base, id: uuid(203) })).status).toBe(402); // now full
  });

  it('free: rejects a file larger than 5MB', async () => {
    const r = await postArtifact({ ...base, id: uuid(300), sizeBytes: 6 * MB });
    expect(r.status).toBe(402);
    expect((await j(r)).code).toBe('PLAN_LIMIT');
  });

  it('cloud: allows 10 attachments and 20MB files', async () => {
    await store.setWorkspacePlan('ws_cloud', { plan: 'cloud' });
    const cloud = { workspace: 'ws_cloud', channel: 'dev', messageId: uuid(2), kind: 'screenshot', name: 'p.png', mime: 'image/png', sizeBytes: 15 * MB };
    for (let i = 1; i <= 10; i++) {
      expect((await postArtifact({ ...cloud, id: uuid(400 + i) })).status).toBe(200);
    }
    expect((await postArtifact({ ...cloud, id: uuid(411), sizeBytes: 1024 })).status).toBe(402); // 11th
    // and a >20MB file is rejected even on cloud
    expect((await postArtifact({ ...cloud, messageId: uuid(3), id: uuid(412), sizeBytes: 21 * MB })).status).toBe(402);
  });
});
