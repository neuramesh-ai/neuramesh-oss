// Who may pay for a workspace or open its billing (billingCaller, credits.ts).
//
// Checkout and the Customer Portal used to ask only for a human, so any signed-in person who held
// a workspace uuid could open that workspace's portal: its invoices, its card, its Cancel. The
// memory store runs without Stripe, so a member who passes the guard meets the config check (404)
// and a stranger never reaches it (403): the two answers tell the gate's two sides apart.
import { beforeEach, describe, expect, it } from 'vitest';
import { createEvent, formatAddress } from '@neuramesh/shared';
import { createApp } from '../src/app';
import { MemoryStore } from '../src/store';

const ROUTES = [
  ['/v1/billing/checkout', {}],
  ['/v1/billing/portal', {}],
  ['/v1/billing/credits-checkout', { credits: 1000 }],
] as const;

let app: ReturnType<typeof createApp>;
let workspace: string;

beforeEach(async () => {
  const store = new MemoryStore();
  app = createApp(store);
  const ev = createEvent({ type: 'workspace.created', source: formatAddress({ kind: 'human', id: 'u-owner' }), target: 'resource/workspace/acme', workspace: 'acme', payload: {} });
  ({ workspaceId: workspace } = await store.createWorkspace({ name: 'Acme', slug: 'acme', createdBy: 'u-owner' }, ev));
});

const post = (path: string, actor: object, body: object) => app.request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) },
  body: JSON.stringify(body),
});

describe('billing is for a human member of the workspace', () => {
  for (const [path, extra] of ROUTES) {
    it(`${path}: a stranger is refused, and learns nothing about the deploy`, async () => {
      const res = await post(path, { kind: 'human', id: 'u-stranger' }, { workspace, ...extra });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'not your workspace', code: 'NOT_PERMITTED' });
    });

    it(`${path}: a member passes the guard (and meets the config check, since tests run without Stripe)`, async () => {
      const res = await post(path, { kind: 'human', id: 'u-owner' }, { workspace, ...extra });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'billing not configured', code: 'NOT_FOUND' });
    });

    it(`${path}: an agent is refused, and a missing workspace is a 400`, async () => {
      expect((await post(path, { kind: 'agent', id: 'rex', role: 'orchestrator' }, { workspace, ...extra })).status).toBe(403);
      const res = await post(path, { kind: 'human', id: 'u-owner' }, { ...extra });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'workspace required', code: 'INVALID_INPUT' });
    });
  }
});
