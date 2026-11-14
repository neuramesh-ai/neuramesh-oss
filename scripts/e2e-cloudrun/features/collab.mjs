// TWO PEOPLE (matrix section I): an invitation, the invitee's own hq, the shared room. Person B is
// a second IAP smoke account, so the join runs through the gateway and the page exactly as a
// teammate's does. Email delivery is dry-run in the sandbox (NM_MAIL_DRY_RUN=1, no Resend key).
import { api, cmd, door, feedRows, gw, refusal, replica, seeText, snap, until, videoOpts, watchPage } from './lib.mjs';

const H = (ctx) => ctx.a.userId;

export const collab = [
  {
    id: 'invite-join',
    title: 'invite a second person, who joins from their own hq (docs/27, member machines plan)',
    needs: ['personB'],
    async run(t, ctx) {
      const b = ctx.b;
      // Free holds one seat (FREE_SEAT_CAP = 1): the invitation is refused with the Team plan named
      const plan0 = (await api('GET', '/v1/workspaces', { as: H(ctx) })).workspaces.find((w) => w.id === ctx.ws.id)?.plan;
      if (plan0 === 'free') {
        t.check('on Free, a second seat is refused (PLAN_LIMIT)', (await refusal(cmd(H(ctx), { type: 'workspace.invite', workspace: ctx.ws.id, email: b.email }))) === 'PLAN_LIMIT');
        // the plan flip Stripe's webhook makes (plan-flip.ts), through the sandbox's door
        await api('POST', `/internal/e2e/workspaces/${ctx.ws.id}/fund`, { fleet: true, body: { plan: 'cloud' } });
        t.note('the workspace is now on the cloud (Team) plan through the fund door: the first invitation reshapes the fleet (the owner\'s runner becomes their member machine and a fresh runner is minted), which r6-machines covers');
      }
      // the machine budget: the runner sleeps before the reshape, and the runner it mints is drained
      // as soon as it exists (the invite path is what this scenario proves, not the machines)
      await door.idleDrain(ctx.ws.runner).catch(() => {});
      const machinesBefore = (await api('GET', `/v1/machines/usage?workspace=${ctx.ws.id}`, { as: H(ctx) })).machines ?? [];
      const inv = await cmd(H(ctx), { type: 'workspace.invite', workspace: ctx.ws.id, email: b.email, memberRole: 'member' });
      const machinesAfter = (await api('GET', `/v1/machines/usage?workspace=${ctx.ws.id}`, { as: H(ctx) })).machines ?? [];
      t.note({ teamShape: { before: machinesBefore.map((m) => `${m.kind}:${m.id.slice(0, 8)}`), after: machinesAfter.map((m) => `${m.kind}:${m.id.slice(0, 8)}`) } });
      const newRunner = machinesAfter.find((m) => m.kind === 'runner')?.id;
      if (newRunner && newRunner !== ctx.ws.runner) { ctx.ws.oldRunner = ctx.ws.runner; ctx.ws.runner = newRunner; }
      for (const m of machinesAfter) if (m.id !== ctx.ws.oldRunner) await until(`${m.kind} ${m.id.slice(0, 8)} drained`, async () => (await door.idleDrain(m.id).then(() => true).catch((e) => (e.status === 409 ? true : null))), { timeout: 60_000, every: 5_000 }).catch(() => {});
      t.check('workspace.invite creates the invitation', !!inv?.inviteId, inv);
      t.note(`invite delivery: ${inv?.delivery} (Resend is not configured: the email is queued and dry-run)`);
      const pending = await api('GET', `/v1/invites?workspace=${ctx.ws.id}`, { as: H(ctx) });
      t.check('the Members tab lists it as pending', JSON.stringify(pending).includes(b.email), pending);
      const mine = await gw(b, 'GET', '/v1/invites/mine');
      t.check('person B sees the invitation through the gateway', (mine.invites ?? []).some((i) => (i.inviteId ?? i.id) === inv.inviteId), mine);
      // person B's own browser
      const chromium = (await import('./lib.mjs')).playwright();
      b.context = await ctx.browser.newContext({ extraHTTPHeaders: { authorization: `Bearer ${b.jwt}` }, viewport: { width: 1440, height: 900 }, ...videoOpts() });
      b.page = await b.context.newPage();
      b.seen = watchPage(b.page, 'B');
      void chromium;
      await b.page.goto(`${ctx.cfg.hq}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const card = await seeText(b.page, /is expecting you|Join /, { timeout: 60_000 });
      await snap(b.page, 'b-invited');
      t.check('B\'s hq opens on the invitation, not the wizard', !!card, card);
      const join = b.page.getByRole('button', { name: /^join /i }).first();
      const clicked = await join.click({ timeout: 15_000 }).then(() => true).catch(() => false);
      t.check('B clicks Join', clicked);
      const member = await until('B is a member', async () => ((await gw(b, 'GET', '/v1/workspaces')).workspaces ?? []).find((w) => w.id === ctx.ws.id), { timeout: 60_000 }).catch(() => null);
      t.check('B is now a member of the workspace', !!member, member ? { role: member.role, memberCount: member.memberCount } : null);
      const members = await feedRows(H(ctx), 'workspace_members', ctx.ws.id);
      t.check('A\'s feed carries B\'s membership', members.some((m) => m.user_id === b.userId), members.map((m) => ({ user: m.user_id, role: m.role })));
      await b.page.waitForTimeout(3_000);
      await b.page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await b.page.waitForFunction(() => !!window.__nmDb?.currentStatus?.lastSyncedAt, null, { timeout: 120_000, polling: 500 }).catch(() => {});
      const agents = await replica(b.page, 'SELECT name FROM agents WHERE workspace_id = ?', [ctx.ws.id]).catch(() => null);
      t.check('B\'s replica holds the shared workspace (the crew)', (agents?.length ?? 0) > 0, agents);
      await snap(b.page, 'b-joined');
      // B speaks in the room; A's page sees it
      await cmd(b.userId, { type: 'member.update_profile', workspace: ctx.ws.id, displayName: 'R6 Teammate' }).catch((e) => t.note(`update_profile: ${e.message}`));
      const words = `hello from person B ${ctx.tag}`;
      const sent = await gw(b, 'POST', '/v1/messages', { body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, body: words } });
      t.check('B posts in #general through the gateway', !!sent?.message?.id, sent?.message?.id);
      if (ctx.a.page) {
        const row = await until('B\'s message in A\'s replica', async () => (await replica(ctx.a.page, 'SELECT id, author_id FROM messages WHERE body = ?', [words]))?.[0], { timeout: 60_000 }).catch(() => null);
        t.check('A\'s page receives B\'s message through the feed', row?.author_id === b.userId, row);
      }
      const name = (await feedRows(H(ctx), 'workspace_members', ctx.ws.id)).find((m) => m.user_id === b.userId)?.display_name;
      t.check('B\'s display name rides the membership', name === 'R6 Teammate', name);
      // a decline and a revoke (docs/27): a third and a fourth address, never answered by a person
      const c = await ctx.extraUser('decline');
      const ic = await cmd(H(ctx), { type: 'workspace.invite', workspace: ctx.ws.id, email: c.email });
      const dec = await refusal(cmd(c.userId, { type: 'workspace.decline_invite', invite: ic.inviteId }));
      const id = await cmd(H(ctx), { type: 'workspace.invite', workspace: ctx.ws.id, email: `${ctx.prefix}revoke-${ctx.tag}@e2e.invalid` });
      const rev = await refusal(cmd(H(ctx), { type: 'workspace.revoke_invite', workspace: ctx.ws.id, invite: id.inviteId }));
      const still = JSON.stringify((await api('GET', `/v1/invites?workspace=${ctx.ws.id}`, { as: H(ctx) })).invites ?? []);
      t.check('a decline and a revoke both clear their invitation', dec === 'ok' && rev === 'ok' && !still.includes(c.email) && !still.includes(`revoke-${ctx.tag}`), { dec, rev });
      t.check('the owner cannot leave their own workspace', (await refusal(cmd(H(ctx), { type: 'workspace.leave', workspace: ctx.ws.id }))) !== 'ok');
      const stranger = await ctx.extraUser('peek');
      const peek = await refusal(api('GET', `/v1/invites?workspace=${ctx.ws.id}`, { as: stranger.userId }));
      t.check('a stranger cannot read the workspace\'s pending invitations (emails)', peek !== 'ok', peek);
    },
  },
];
