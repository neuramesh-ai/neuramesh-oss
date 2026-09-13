// the two vercel-cron passes, extracted from app.ts verbatim (the size ratchet forced the
// move when the fleet route landed beside them; the internal-secret routes now live
// together — these two here, fleet's in fleet.ts).

import type { Env, Hono } from 'hono';
import { POSTERS, connectorsEnabled, publicApiBase, publishDueItems } from './connectors';
import { runLifecyclePass } from './lifecycle';
import { mailEnabled } from './mail';
import { REVIEW_LEAD_MIN } from '@neuramesh/shared';
import type { PushService } from './push';
import type { Store } from './store';

/** the reminder pass: every scheduled post landing inside the lead gets one push, ever. The window
 *  is read from the store and the words come from the pure rule, so this function only carries rows
 *  between them — nothing here decides what "soon" means or what it says. */
export async function remindDuePosts(store: Store, push: PushService | undefined, now: Date): Promise<number> {
  if (!push || !store.upcomingContentItems) return 0;
  const to = new Date(now.getTime() + REVIEW_LEAD_MIN * 60_000);
  const items = await store.upcomingContentItems(now.toISOString(), to.toISOString(), 100);
  let sent = 0;
  for (const item of items) {
    // one bad row must not stop the rest, and a failed push is never worth failing the cron over:
    // the publish pass runs in the same request and a post landing matters more than a reminder
    try {
      await push.notifyPostReview(item, now);
      sent += 1;
    } catch (e) {
      console.error('review reminder failed:', item.id, e);
    }
  }
  return sent;
}

export function cronRoutes<E extends Env>(app: Hono<E>, store: Store, push?: PushService): void {
  // The publish pass (plan §4.8): Vercel cron GETs this with `authorization: Bearer $CRON_SECRET`
  // (sent automatically when the env is set). Due + approved → post via the connector → receipt.
  app.get('/internal/publish-due', async (c) => {
    const secret = process.env['CRON_SECRET'];
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ error: 'forbidden' }, 403);
    const now = new Date();
    // THE REVIEW REMINDER RIDES HERE, and it runs BEFORE the connectors gate on purpose: a post can
    // be scheduled and worth a second look on a workspace that has connected nothing yet, and the
    // reminder is about the human's decision rather than the publish. This cron already fires every
    // minute, so the lead is exact and there is no second cron to add or forget.
    const reminded = await remindDuePosts(store, push, now);
    if (!connectorsEnabled()) return c.json({ published: 0, failed: 0, reminded, note: 'connectors not configured' });
    const out = await publishDueItems(store, POSTERS, now, publicApiBase(c.req.url));
    return c.json({ ...out, reminded });
  });

  // The lifecycle pass (docs/27 §3): Vercel cron GETs this with `authorization: Bearer
  // $CRON_SECRET`. Enqueues + drains due onboarding email. Safe to double-fire — the outbox's
  // UNIQUE dedupe_key turns a second run into a no-op rather than a second send.
  app.get('/internal/emails-due', async (c) => {
    const secret = process.env['CRON_SECRET'];
    if (!secret || c.req.header('authorization') !== `Bearer ${secret}`) return c.json({ error: 'forbidden' }, 403);
    if (!mailEnabled()) return c.json({ sent: 0, skipped: 0, failed: 0, note: 'mail not configured' });
    return c.json(await runLifecyclePass(store));
  });
}
