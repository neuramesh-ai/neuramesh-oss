// A read-only survey of the deployed surface: which reads answer, which tables the person's feed
// carries, and which destinations the hq nav offers. It asserts only that nothing answers 5xx; the
// rest is evidence for the matrix.
import { api, bodyText, cfg, gw, snap } from './lib.mjs';

const READS = [
  ['/v1/me', null],
  ['/v1/billing/config', null],
  ['/v1/usage?workspace=:ws', null],
  ['/v1/credits/history?workspace=:ws', null],
  ['/v1/machines/usage?workspace=:ws', null],
  ['/v1/retro?workspace=:ws', null],
  ['/v1/memory?workspace=:ws', null],
  ['/v1/model-packs?workspace=:ws', null],
  ['/v1/credentials?workspace=:ws', null],
  ['/v1/parks?workspace=:ws', null],
  ['/v1/invites?workspace=:ws', null],
  ['/v1/invites/mine', null],
  ['/v1/repo/changes?workspace=:ws', null],
  ['/v1/x/search?workspace=:ws&q=neuramesh', null],
  ['/.well-known/nm-config', null],
];

export const probe = [
  {
    id: 'probe',
    title: 'survey: the reads a person makes, the feed tables, the nav',
    async run(t, ctx) {
      const out = {};
      let fives = 0;
      for (const [p] of READS) {
        const path = p.replaceAll(':ws', ctx.ws.id);
        const res = await api('GET', path, { as: ctx.a.userId, raw: true }).catch((e) => ({ status: 0, text: async () => String(e) }));
        const text = await res.text();
        // 501 NOT_CONFIGURED is a feature's honest "this server has no account for it" (X search)
        if (res.status >= 500 && !(res.status === 501 && /NOT_CONFIGURED/.test(text))) fives++;
        out[p] = { status: res.status, body: text.slice(0, 400) };
      }
      t.note({ reads: out });
      t.check('no person read answers 5xx', fives === 0, Object.fromEntries(Object.entries(out).filter(([, v]) => v.status >= 500)));
      t.note({ syncedTables: ctx.ws.tables });
      if (ctx.a.page) {
        const page = ctx.a.page;
        const nav = await page.locator('button.navitem').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))).catch(() => []);
        const buttons = await page.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 40)).filter(Boolean)).catch(() => []);
        t.note({ nav, buttons: [...new Set(buttons)].slice(0, 150) });
        const who = await gw(ctx.a, 'GET', '/__hq/whoami').catch((e) => ({ error: String(e) }));
        t.note({ whoami: { userId: who.userId, sync: who.sync, relay: who.relay } });
        await snap(page, 'probe-home');
        t.note({ homeText: (await bodyText(page)).slice(0, 1500) });
        t.check('the hq nav lists destinations', nav.length > 0, nav);
      }
      t.note({ cfg: { hq: cfg.hq, api: cfg.api } });
    },
  },
];
