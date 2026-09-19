// The video rung's door and its cron (docs/design/video-rung-2026-09, issue #539): a video post's
// hook filmed on the platform's fal.ai key, metered on cloud credits. The Starter brain's twin, in
// the same order of guards: member gate, the balance FIRST, then price, debit, submit, a films row,
// 202. A film takes minutes, so the door never waits for it: the minute cron polls fal's queue,
// downloads the clip, hosts it through the picture's lane and stamps the draft; a failure refunds
// the credits with a ledger row beside the charge and lands on the card. The key lives in this
// process only, and the local stack keeps this door shut (CLAUDE.md #5).
import { CREDIT_MICROS, VIDEO_TIER_LABELS, createEvent, formatAddress, sniffVideoMime, type Actor } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import { actorInWorkspace, ledgerFor, type Ledger } from './credits';
import { falResult, falStatus, falSubmit, type FalFetch } from './fal';
import { localMode } from './localmode';
import type { Store } from './store';
import type { FilmRow } from './store/films';
import { VIDEO_MODELS, priceFilm, tierFor, videoTiers, type VideoTierSpec } from './video-registry';

const FILM_MAX_BYTES = 8_000_000; // the attach lane's ceiling (Instagram's own)
const FILM_TIMEOUT_MS = 12 * 60_000; // a row older than this is failed and refunded, whatever fal says
const SYSTEM: Actor = { kind: 'agent', id: '00000000-0000-0000-0000-000000000000' };

const FilmSchema = z.object({ workspace: z.string().uuid(), item: z.string().uuid(), prompt: z.string().min(8).max(2_000) });

/** the tiers as a client reads them: what each films on and what it costs */
export const tierView = (t: VideoTierSpec) => ({ tier: t.tier, label: t.label, model: t.model.label, vendor: t.model.vendor, seconds: t.seconds, credits: t.credits });

export function starterVideoRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store, opts: { ledger?: Ledger | null; env?: NodeJS.ProcessEnv; fetchFn?: FalFetch } = {}): void {
  const ledger = opts.ledger === undefined ? ledgerFor(store) : opts.ledger;
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchFn ?? fetch;

  // what this server films on, and the workspace's pick: the card's facts line and the Settings line read it
  app.get('/v1/starter/video', async (c) => {
    const workspace = c.req.query('workspace');
    if (!workspace) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    if (!(await actorInWorkspace(store, c.get('actor'), workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    const tiers = localMode() ? [] : videoTiers(env);
    const [pick, plan] = await Promise.all([store.getVideoTier(workspace).catch(() => null), store.workspacePlan(workspace).catch(() => 'free')]);
    const active = tierFor(tiers, pick);
    // the pick is a Pro setting: a Free workspace holds no credits, so it films on the default tier only, or on its own key
    return c.json({ served: tiers.length > 0 && !!ledger, tier: active?.tier ?? null, pick: pick ?? null, canPick: plan === 'cloud', tiers: tiers.map(tierView), labels: VIDEO_TIER_LABELS });
  });

  app.post('/v1/starter/film', async (c) => {
    if (localMode()) return c.json({ error: 'The local stack has no video lane. Add a Google AI key under Image generation.', code: 'UNAVAILABLE' }, 503);
    if (!ledger || !store.films) return c.json({ error: 'credits not served by this store', code: 'UNAVAILABLE' }, 503);
    const body = FilmSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body', issues: body.error.issues }, 400);
    const { workspace, item, prompt } = body.data;
    const actor = c.get('actor');
    if (!(await actorInWorkspace(store, actor, workspace))) return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    // the balance guard runs FIRST: "you are out of credits" is a true and stable answer whether or
    // not this server films at all, and a caller falls to its own key on it
    const before = await ledger.balance(workspace);
    if (before.remainingMicros <= 0) return c.json({ error: 'out of credits', code: 'NO_CREDITS', remainingCredits: 0 }, 402);
    const tiers = videoTiers(env);
    const tier = tierFor(tiers, await store.getVideoTier(workspace).catch(() => null));
    if (!tier) return c.json({ error: 'video is not served here', code: 'UNAVAILABLE' }, 503);
    const media = await store.contentItemMedia(item);
    if (!media || media.workspace !== workspace) return c.json({ error: 'draft not found', code: 'NOT_FOUND' }, 404);
    if (await store.films.openForItem(item)) return c.json({ error: 'a film is already in flight for this draft', code: 'IN_FLIGHT' }, 409);
    const micros = priceFilm(tier.model, tier.seconds);
    // the whole clip or nothing: charged before the submit, so two presses in flight cannot overspend
    const spent = await ledger.spendFilm(workspace, micros, { seconds: tier.seconds });
    if (!spent) return c.json({ error: 'out of credits', code: 'NO_CREDITS', remainingCredits: Math.floor(before.remainingMicros / CREDIT_MICROS), credits: Math.ceil(micros / CREDIT_MICROS) }, 402);
    const key = env['FAL_KEY']!;
    const sub = await falSubmit(key, tier.model.endpoint, tier.model.input(prompt, tier.seconds), fetchFn);
    if (!sub.requestId) {
      await ledger.refundFilm(workspace, { grantMicros: spent.grantMicros, purchasedMicros: spent.purchasedMicros, seconds: tier.seconds }, `refund: ${tier.model.label} did not accept the film`);
      return c.json({ error: sub.error ?? 'the film was not accepted', code: sub.unavailable ? 'UNAVAILABLE' : 'UPSTREAM' }, sub.unavailable ? 503 : 502);
    }
    const { id } = await store.films.create({ workspaceId: workspace, itemId: item, tier: tier.tier, model: tier.model.key, endpoint: tier.model.endpoint, requestId: sub.requestId, seconds: tier.seconds, micros, grantMicros: spent.grantMicros, purchasedMicros: spent.purchasedMicros, createdBy: actor.kind === 'human' ? actor.id : null });
    await store.reviseDraft(item, { body: null, imageBrief: null, thumb: null, videoPending: true, videoError: '' }, (ws) => createEvent({ type: 'content.updated', source: formatAddress({ kind: actor.kind, id: actor.id }), target: formatAddress({ kind: 'resource', type: 'content', id: item }), workspace: ws, payload: { item, filming: id } })).catch(() => {});
    c.header('x-nm-credits-remaining', String(Math.floor(spent.remainingMicros / CREDIT_MICROS)));
    return c.json({ ok: true, film: id, tier: tierView(tier), credits: Math.ceil(micros / CREDIT_MICROS), remainingCredits: Math.floor(spent.remainingMicros / CREDIT_MICROS) }, 202);
  });
}

/** the minute cron's door, the announce cron's shape: `authorization: Bearer $CRON_SECRET`, outside /v1 */
export function filmsCronRoute<E extends Env>(app: Hono<E>, store: Store, opts: { ledger?: Ledger | null; env?: NodeJS.ProcessEnv; fetchFn?: FalFetch } = {}): void {
  app.get('/internal/films-due', async (c) => {
    const secret = (opts.env ?? process.env)['CRON_SECRET'];
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ error: 'forbidden' }, 403);
    const results = await filmsDue(store, opts);
    return c.json({ processed: results.length, results });
  });
}

/** One cron pass over the open films: status, then the clip, then the draft. Returns what happened to each row. */
export async function filmsDue(store: Store, opts: { ledger?: Ledger | null; env?: NodeJS.ProcessEnv; fetchFn?: FalFetch; now?: () => number; limit?: number } = {}): Promise<Array<{ id: string; outcome: string }>> {
  const ledger = opts.ledger === undefined ? ledgerFor(store) : opts.ledger;
  const env = opts.env ?? process.env;
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? Date.now;
  const key = env['FAL_KEY'];
  if (!store.films || !ledger || !key) return [];
  const out: Array<{ id: string; outcome: string }> = [];
  for (const row of await store.films.open(opts.limit ?? 10)) {
    const fail = async (why: string): Promise<void> => {
      await ledger.refundFilm(row.workspaceId, { grantMicros: row.grantMicros, purchasedMicros: row.purchasedMicros, seconds: row.seconds }, `refund: film ${row.id.slice(0, 8)} on ${row.model} failed`);
      await store.films!.update(row.id, { status: 'failed', error: why, finishedAt: new Date(now()).toISOString() });
      await patchDraft(store, row, { videoPending: false, videoError: why });
      out.push({ id: row.id, outcome: `failed: ${why}` });
    };
    if (now() - new Date(row.createdAt).getTime() > FILM_TIMEOUT_MS) { await fail('the film took longer than twelve minutes'); continue; }
    if (!row.requestId) { await fail('the film was never submitted'); continue; }
    const st = await falStatus(key, row.endpoint, row.requestId, fetchFn);
    if (st.state === 'failed') { await fail(st.error ?? 'the film failed'); continue; }
    if (st.state !== 'done') {
      if (st.state === 'running' && row.status !== 'running') await store.films.update(row.id, { status: 'running' });
      out.push({ id: row.id, outcome: st.state });
      continue;
    }
    const res = await falResult(key, row.endpoint, row.requestId, fetchFn);
    if (!res.url) { await fail(res.error ?? 'the film came back empty'); continue; }
    const dl = await fetchFn(res.url, { redirect: 'follow' }).catch(() => null);
    if (!dl?.ok) { await fail(`the film could not be downloaded (${dl?.status ?? 'no answer'})`); continue; }
    const bytes = Buffer.from(await dl.arrayBuffer());
    if (!bytes.length) { await fail('the film downloaded empty'); continue; }
    if (bytes.length > FILM_MAX_BYTES) { await fail(`the film is too large to attach (${Math.round(bytes.length / 1e6)} MB, max 8 MB)`); continue; }
    const mime = sniffVideoMime(new Uint8Array(bytes.subarray(0, 16))) ?? res.contentType ?? 'video/mp4';
    try {
      await store.attachContentMedia(row.itemId, mime, bytes, SYSTEM, (ws) => createEvent({ type: 'content.updated', source: formatAddress(SYSTEM), target: formatAddress({ kind: 'resource', type: 'content', id: row.itemId }), workspace: ws, payload: { item: row.itemId, media: 'hosted', film: row.id } }));
    } catch (e) { await fail(`the film did not attach to the draft (${e instanceof Error ? e.message : String(e)})`); continue; }
    const at = new Date(now()).toISOString();
    // the model's NAME on the card (Seedance 2.0), the registry key stays on the row
    await patchDraft(store, row, { videoPending: false, videoError: '', videoMeta: { tier: row.tier, model: VIDEO_MODELS[row.model]?.label ?? row.model, seconds: row.seconds, credits: Math.ceil(row.micros / CREDIT_MICROS), at } });
    await store.films.update(row.id, { status: 'done', finishedAt: at });
    out.push({ id: row.id, outcome: 'done' });
  }
  return out;
}

async function patchDraft(store: Store, row: FilmRow, patch: { videoPending: boolean; videoError: string; videoMeta?: import('./store').VideoMeta }): Promise<void> {
  await store.reviseDraft(row.itemId, { body: null, imageBrief: null, thumb: null, ...patch }, (ws) => createEvent({ type: 'content.updated', source: formatAddress(SYSTEM), target: formatAddress({ kind: 'resource', type: 'content', id: row.itemId }), workspace: ws, payload: { item: row.itemId, film: row.id } })).catch(() => {});
}
