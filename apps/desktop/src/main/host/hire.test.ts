// the pack reader that the hire and the runner's seed share (host/hire.ts readActivePackRoles).
// a failed read throws, so the runner's seed can hold plume for the next pass instead of letting
// the schema seat its default model. the hire still reads a failure as no pack (makeHire).
// run from apps/desktop: pnpm exec tsx --test src/main/host/hire.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACKS } from '@neuramesh/shared';
import { readActivePackRoles } from './hire';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const pack = (id: string) => json(200, { workspaces: [{ id: 'ws1', activeModelPack: id }] });

// the machine bearer, as on a runner, so no test asks Clerk for a token
async function withApi(answer: (url: string) => Response, run: () => Promise<void>): Promise<void> {
  const realFetch = globalThis.fetch;
  const hadToken = process.env['NM_MACHINE_TOKEN'];
  globalThis.fetch = (async (url: string | URL) => answer(String(url))) as typeof fetch;
  process.env['NM_MACHINE_TOKEN'] = 'nmm_test';
  try { await run(); } finally {
    globalThis.fetch = realFetch;
    if (hadToken === undefined) delete process.env['NM_MACHINE_TOKEN'];
    else process.env['NM_MACHINE_TOKEN'] = hadToken;
  }
}

test('the pack reader tells a failed read from no pack', async () => {
  await withApi(() => pack('starter'), async () => {
    assert.deepEqual(await readActivePackRoles('https://api.test', 'owner-1', 'ws1'), PACKS['starter']!.roles);
  });
  // the server reports a workspace with no pack as the sentinel
  await withApi(() => pack('custom'), async () => {
    assert.equal(await readActivePackRoles('https://api.test', 'owner-1', 'ws1'), null);
  });
  await withApi(() => json(502, {}), async () => {
    await assert.rejects(readActivePackRoles('https://api.test', 'owner-1', 'ws1'));
  });
  // a custom brain whose list does not load is a failed read too
  await withApi((url) => (url.includes('/v1/model-packs') ? json(500, {}) : pack('custom:brain-1')), async () => {
    await assert.rejects(readActivePackRoles('https://api.test', 'owner-1', 'ws1'));
  });
});
