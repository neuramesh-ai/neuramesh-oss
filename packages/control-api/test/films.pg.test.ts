// The video rung on the REAL schema (0140): the films rows, the film charge that splits across the
// two pools, the refund that puts each part back and writes its ledger row, the day's video
// meter, and the workspace's tier pick. Run via scripts/test-pg.sh; skipped without DATABASE_URL.
import { createEvent, formatAddress, type Actor } from '@neuramesh/shared';
import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { creditBalance, grantCredits, refundFilm, spendCreditsForFilm, usageToday } from '../src/credit-ledger';
import { PostgresStore } from '../src/pgstore';

const DB = process.env['DATABASE_URL'];
const george: Actor = { kind: 'human', id: '00000000-0000-0000-0000-000000000001' };
const store = DB ? new PostgresStore(DB) : null;
const app = store ? createApp(store) : null;
const sql = DB ? postgres(DB) : null;
const j = (r: Response): Promise<any> => r.json() as Promise<any>;
const send = (actor: Actor, body: unknown) => app!.request('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });

afterAll(async () => { await sql?.end(); await store?.close(); });

describe.skipIf(!DB)('the video rung on postgres', () => {
  it('charges a film across the pools, meters it as video, refunds it exactly, and keeps the rows', async () => {
    const { workspaceId: ws } = await j(await send(george, { type: 'workspace.create', name: 'Film Lab', slug: 'film-lab' }));
    // 100 credits granted, 150 purchased: a 194-credit clip drains the grant first, then the purchase
    await grantCredits(sql!, ws, 100, 'manual', 'test');
    await grantCredits(sql!, ws, 150, 'purchase', 'cs_test_film');
    const micros = 1_940_000; // 8 s of Seedance 2.0 fast at $0.2419/s, rounded up to 194 whole credits
    const spent = await spendCreditsForFilm(sql!, ws, micros, { seconds: 8 });
    expect(spent).toEqual({ remainingMicros: 2_500_000 - micros, grantMicros: 1_000_000, purchasedMicros: 940_000 });
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(2_500_000 - micros);
    expect(await usageToday(sql!, ws)).toMatchObject({ videoClips: 1, videoMicros: micros });
    // a second clip does not fit: nothing is charged
    expect(await spendCreditsForFilm(sql!, ws, micros, { seconds: 8 })).toBeNull();
    expect((await creditBalance(sql!, ws)).remainingMicros).toBe(2_500_000 - micros);
    // the refund reverses each pool as it was drained, the meter goes back, the ledger keeps the line
    await refundFilm(sql!, ws, { grantMicros: spent!.grantMicros, purchasedMicros: spent!.purchasedMicros, seconds: 8 }, 'refund: test');
    const bal = await creditBalance(sql!, ws);
    expect(bal.remainingMicros).toBe(2_500_000);
    expect(bal.purchasedRemainingMicros).toBe(1_500_000); // the purchase is whole again, and still never expires
    expect(await usageToday(sql!, ws)).toMatchObject({ videoClips: 0, videoMicros: 0 });
    const [refund] = await sql!`select micros, kind from credit_grants where workspace_id = ${ws}::uuid and kind = 'refund'`;
    expect(Number(refund!['micros'])).toBe(micros);

    // the rows
    const proj = await j(await send(george, { type: 'project.create', workspace: ws, name: 'Growth' }));
    const { channelId } = await j(await send(george, { type: 'channel.create', workspace: ws, project: proj.projectId, slug: 'marketing' }));
    const { itemId } = await j(await send(george, { type: 'content.create', channel: channelId, platform: 'x', body: 'caption', script: '[0:00-0:03] hook' }));
    const films = store!.films;
    const { id } = await films.create({ workspaceId: ws, itemId, tier: 'starter', model: 'seedance-2.0-fast', endpoint: 'bytedance/seedance-2.0/fast/text-to-video', requestId: 'req-1', seconds: 8, micros, grantMicros: 1_000_000, purchasedMicros: 940_000, createdBy: george.id });
    expect((await films.open(10)).map((f) => f.id)).toContain(id);
    expect((await films.openForItem(itemId))?.id).toBe(id);
    await films.update(id, { status: 'running' });
    await films.update(id, { status: 'done', finishedAt: new Date().toISOString() });
    expect((await films.open(10)).some((f) => f.id === id)).toBe(false);
    expect((await films.forWorkspace(ws, 5))[0]).toMatchObject({ id, status: 'done', micros, grantMicros: 1_000_000, purchasedMicros: 940_000 });
    expect(await films.openForItem(itemId)).toBeNull();

    // the draft's pending flag and its facts, through the store's media patch
    await store!.reviseDraft(itemId, { body: null, imageBrief: null, thumb: null, videoPending: true }, (w) => createEvent({ type: 'content.updated', source: formatAddress(george), target: `resource/content/${itemId}`, workspace: w, payload: {} }));
    let [row] = await sql!`select media from content_items where id = ${itemId}::uuid`;
    expect((row!['media'] as Record<string, unknown>)['video_pending']).toBe(true);
    await store!.reviseDraft(itemId, { body: null, imageBrief: null, thumb: null, videoPending: false, videoMeta: { tier: 'starter', model: 'seedance-2.0-fast', seconds: 8, credits: 194, at: '2026-09-19T00:00:00.000Z' } }, (w) => createEvent({ type: 'content.updated', source: formatAddress(george), target: `resource/content/${itemId}`, workspace: w, payload: {} }));
    [row] = await sql!`select media from content_items where id = ${itemId}::uuid`;
    expect((row!['media'] as Record<string, unknown>)['video_pending']).toBeUndefined();
    expect((row!['media'] as Record<string, unknown>)['video']).toMatchObject({ tier: 'starter', credits: 194 });

    // the tier pick is Pro only: Free is refused before the column is touched, then set, read, cleared
    expect((await send(george, { type: 'workspace.update', workspace: ws, videoTier: 'premium' })).status).toBe(403);
    expect(await store!.getVideoTier(ws)).toBeNull();
    await sql!`update workspaces set plan = 'cloud' where id = ${ws}::uuid`;
    expect((await send(george, { type: 'workspace.update', workspace: ws, videoTier: 'premium' })).status).toBe(200);
    expect(await store!.getVideoTier(ws)).toBe('premium');
    expect((await send(george, { type: 'workspace.update', workspace: ws, videoTier: null })).status).toBe(200);
    expect(await store!.getVideoTier(ws)).toBeNull();
  });
});
