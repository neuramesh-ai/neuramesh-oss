// THE WORKSPACE'S OWN SURFACES (matrix sections M, P, A, S): memory and recall, skills and skill
// packs, projects and rooms, the crew, brains and keys, retro, credits, export, policies. Each is
// written the way hq writes it (the same commands, as the same person), then read back the way hq
// reads it: the feed rows behind the replica, the REST reads, and the page where it has one.
import { agentActor, api, cmd, feedRows, goView, refusal, replica, seeText, snap, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;

export const workspace = [
  {
    id: 'memory',
    title: 'channel memory: summary block, facts, lessons, retire, recall (docs/03 §6)',
    async run(t, ctx) {
      const rex = agentActor(ctx, 'orchestrator');
      const dev = agentActor(ctx, 'developer');
      const ch = ctx.ws.channelId;
      const fact = `The R6 launch codeword is zebra-${ctx.tag}.`;
      await cmd(rex, { type: 'memory.refresh_block', workspace: ctx.ws.id, channel: ch, kind: 'channel_summary', content: `R6 summary ${ctx.tag}: the room tests features.` });
      await cmd(rex, { type: 'memory.upsert_fact', workspace: ctx.ws.id, channel: ch, content: fact });
      t.check('a developer may not write a fact', /NOT_PERMITTED/.test(await refusal(cmd(dev, { type: 'memory.upsert_fact', workspace: ctx.ws.id, channel: ch, content: 'a developer fact that must not land' }))));
      await cmd(dev, { type: 'memory.record_lesson', workspace: ctx.ws.id, channel: ch, content: `R6 lesson ${ctx.tag}: always run the suite twice.` });
      const mem = await api('GET', `/v1/memory?workspace=${ctx.ws.id}&channel=${ch}`, { as: H(ctx) });
      const text = JSON.stringify(mem);
      t.check('GET /v1/memory returns the block, the fact and the lesson', text.includes(`R6 summary ${ctx.tag}`) && text.includes(`zebra-${ctx.tag}`) && text.includes(`R6 lesson ${ctx.tag}`), Object.keys(mem ?? {}));
      const facts = (mem.facts ?? mem.validFacts ?? []).concat(mem.lessons ?? []);
      const lesson = facts.find((f) => (f.content ?? '').includes(`R6 lesson ${ctx.tag}`));
      if (lesson?.id) {
        await cmd(H(ctx), { type: 'memory.retire_fact', factId: lesson.id });
        const after = await api('GET', `/v1/memory?workspace=${ctx.ws.id}&channel=${ch}`, { as: H(ctx) });
        const gone = (after.facts ?? []).find((f) => f.id === lesson.id);
        t.check('the human retires the lesson: it is no longer valid (valid_until set, kept in history)', !!gone?.validUntil && !gone?.supersededBy, gone);
      } else t.note({ lessonIdNotFound: Object.keys(mem ?? {}) });
      // /v1/recall filters on the channel SLUG (pgstore recall's TODO(channel-id)), as the agents' recall tool sends it
      const slug = ctx.ws.channels.find((c) => c.id === ch)?.slug ?? 'general';
      const recall = await api('POST', '/v1/recall', { as: H(ctx), body: { workspace: ctx.ws.id, channel: slug, query: `zebra-${ctx.tag}`, k: 5 } });
      const byId = await api('POST', '/v1/recall', { as: H(ctx), body: { workspace: ctx.ws.id, channel: ch, query: `zebra-${ctx.tag}`, k: 5 } });
      t.note({ recallWithChannelId: (byId.hits ?? []).length, note: 'a channel id finds nothing: the route takes a slug' });
      t.check('POST /v1/recall finds the fact', JSON.stringify(recall.hits ?? recall).includes(`zebra-${ctx.tag}`), { hits: (recall.hits ?? []).length, ms: recall.ms });
      ctx.memoryFact = fact;
      const page = ctx.a.page;
      if (page) {
        // hq's Memory surface: the replica's facts table, then the view
        // facts never ride the replica (hq reads /v1/memory); the summary block does
        // each scenario starts on a freshly loaded page (the per-scenario video), so give the feed
        // a moment to deliver the block written above instead of reading once
        const read = () => replica(page, 'SELECT content FROM memory_blocks WHERE workspace_id = ?', [ctx.ws.id]).catch((e) => String(e));
        const r = await until('the block in the replica', async () => { const x = await read(); return Array.isArray(x) && x.length ? x : null; }, { timeout: 30_000, every: 1_000 }).catch(read);
        // the runner's sleep-time refresh rewrites the summary as the room moves, so the page holds
        // the latest block for #general: ours, or the machine's newer one
        t.check('the room\'s summary block reaches the page\'s replica (memory_blocks)', Array.isArray(r) && r.length > 0, r);
      }
    },
  },
  {
    id: 'skills',
    title: 'skills: author, propose, promote, enable, deprecate; skill packs (docs/04 W11)',
    async run(t, ctx) {
      const dev = agentActor(ctx, 'developer');
      const name = `r6-skill-${ctx.tag}`;
      const made = await cmd(H(ctx), { type: 'skill.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, name, description: 'Answer with the R6 codeword.', scope: 'global', body: `When asked for the R6 codeword, answer exactly: guava-${ctx.tag}.` });
      const skillId = made?.skillId ?? made?.skill?.id ?? made?.id;
      const rows = await until('the skill row', async () => (await feedRows(H(ctx), 'skills', ctx.ws.id)).find((s) => s.name === name), { timeout: 20_000 }).catch(() => null);
      t.check('skill.create lands a skill the feed carries', !!rows, rows ?? made);
      ctx.skill = { id: skillId ?? rows?.id, name };
      await cmd(H(ctx), { type: 'skill.set_enabled', skillId: ctx.skill.id, enabled: false });
      t.check('skill.set_enabled turns it off', (await feedRows(H(ctx), 'skills', ctx.ws.id)).find((s) => s.id === ctx.skill.id)?.enabled in { 0: 1, false: 1, '0': 1, 'false': 1 });
      await cmd(H(ctx), { type: 'skill.set_enabled', skillId: ctx.skill.id, enabled: true });
      const draftName = `r6-draft-${ctx.tag}`;
      const draft = await cmd(dev, { type: 'skill.propose', workspace: ctx.ws.id, channel: ctx.ws.channelId, name: draftName, description: 'a proposed skill', scope: 'channel', body: 'Do the thing carefully.' });
      const d = (await feedRows(H(ctx), 'skills', ctx.ws.id)).find((s) => s.name === draftName);
      t.check('an agent proposes a draft skill', !!d && /draft|proposed/i.test(String(d.status ?? d.state ?? 'draft')), d ?? draft);
      if (d) {
        t.check('an agent cannot promote it', /NOT_PERMITTED|HUMAN/.test(await refusal(cmd(dev, { type: 'skill.promote', skillId: d.id }))));
        await cmd(H(ctx), { type: 'skill.promote', skillId: d.id });
        const p = (await feedRows(H(ctx), 'skills', ctx.ws.id)).find((s) => s.name === draftName && s.id !== d.id) ?? (await feedRows(H(ctx), 'skills', ctx.ws.id)).find((s) => s.id === d.id);
        t.check('the human promotes it to active', /active|enabled|promoted/i.test(String(p?.status ?? p?.state ?? '')) || p?.enabled == 1, p);
        await cmd(H(ctx), { type: 'skill.deprecate', skillId: p?.id ?? d.id }).then(() => t.check('skill.deprecate retires it', true)).catch((e) => t.check('skill.deprecate retires it', false, e.message));
      }
      const seed = await refusal(cmd(H(ctx), { type: 'skillpack.seed_defaults', workspace: ctx.ws.id, channel: ctx.ws.channelId, kind: 'build' }));
      const packs = await feedRows(H(ctx), 'skill_packs', ctx.ws.id);
      t.check('the bundled skill packs are seeded', seed === 'ok' && packs.length > 0, { seed, packs: packs.map((p) => `${p.name}:${p.status}:${p.enabled}`) });
      if (packs[0]) {
        const off = await refusal(cmd(H(ctx), { type: 'skillpack.set_enabled', packId: packs[0].id, enabled: false }));
        const on = await refusal(cmd(H(ctx), { type: 'skillpack.set_enabled', packId: packs[0].id, enabled: true }));
        t.check('a skill pack switches off and on', off === 'ok' && on === 'ok', { off, on });
      }
      if (ctx.a.page) {
        const page = ctx.a.page;
        await goView(page, 'Customizations');
        const seen = await seeText(page, new RegExp(name), { timeout: 20_000 });
        await snap(page, 'skills');
        t.check('hq\'s Customizations › Skills lists the new skill', !!seen);
      }
    },
  },
  {
    id: 'projects-rooms',
    title: 'projects and rooms: create, rename, move, archive, the Free cap (docs/03 §9, 06, 07)',
    async run(t, ctx) {
      const before = await feedRows(H(ctx), 'projects', ctx.ws.id);
      const p1 = await cmd(H(ctx), { type: 'project.create', workspace: ctx.ws.id, name: `R6 Proj ${ctx.tag}`, website: 'https://example.com', newChannels: ['r6-room'] });
      const pid = p1?.projectId ?? p1?.project?.id ?? p1?.id;
      const after = await feedRows(H(ctx), 'projects', ctx.ws.id);
      t.check('project.create adds a project', after.length === before.length + 1, { before: before.length, after: after.map((p) => p.name), result: p1 });
      const chans = await feedRows(H(ctx), 'channels', ctx.ws.id);
      const room = chans.find((c) => c.slug === 'r6-room');
      t.check('its new room exists in the project', !!room && (!pid || room.project_id === pid), room);
      if (room) {
        await cmd(H(ctx), { type: 'channel.rename', channel: room.id, topic: 'the R6 room' });
        t.check('channel.rename sets the topic', (await feedRows(H(ctx), 'channels', ctx.ws.id)).find((c) => c.id === room.id)?.topic === 'the R6 room');
      }
      const proj = pid ?? after.find((p) => p.name === `R6 Proj ${ctx.tag}`)?.id;
      await cmd(H(ctx), { type: 'project.update', project: proj, description: 'updated by the suite' });
      t.check('project.update edits it', (await feedRows(H(ctx), 'projects', ctx.ws.id)).find((p) => p.id === proj)?.description === 'updated by the suite');
      // the Free plan's cap (a workspace whose plan is free: the wizard's starts free in the sandbox)
      const plan = (await api('GET', '/v1/workspaces', { as: H(ctx) })).workspaces.find((w) => w.id === ctx.ws.id)?.plan;
      const codes = [];
      for (let i = 0; i < 4; i++) codes.push(await refusal(cmd(H(ctx), { type: 'project.create', workspace: ctx.ws.id, name: `R6 Cap ${i} ${ctx.tag}` })));
      t.check(`the ${plan} plan caps projects with PLAN_LIMIT`, plan !== 'free' || codes.includes('PLAN_LIMIT'), { plan, codes });
      await cmd(H(ctx), { type: 'project.archive', project: proj });
      t.check('project.archive archives it', (await feedRows(H(ctx), 'projects', ctx.ws.id)).find((p) => p.id === proj)?.status === 'archived', (await feedRows(H(ctx), 'projects', ctx.ws.id)).find((p) => p.id === proj)?.status);
      await cmd(H(ctx), { type: 'project.unarchive', project: proj });
      t.check('project.unarchive brings it back', (await feedRows(H(ctx), 'projects', ctx.ws.id)).find((p) => p.id === proj)?.status !== 'archived');
      if (ctx.a.page) {
        // the rail's PROJECTS head opens the Projects page. The ⌘K list was flaky here: the
        // 2.5 s project poll re-renders it as the new projects arrive, and a click once landed
        // on "Switch to r6-cap-0", which left hq standing in a project with no room
        const page = ctx.a.page;
        await page.locator('button[title="All projects"]').first().click({ timeout: 8_000 }).catch(async () => {
          await page.keyboard.press('Control+k').catch(() => {});
          const dlg = page.getByRole('dialog', { name: 'Quick actions' });
          await dlg.locator('input').first().fill('All projects').catch(() => {});
          await page.waitForTimeout(500);
          await dlg.getByText('All projects', { exact: true }).first().click({ timeout: 8_000 }).catch(() => {});
        });
        const seen = await seeText(page, new RegExp(`R6 Proj ${ctx.tag}`), { timeout: 20_000 });
        await snap(page, 'projects');
        t.check('hq\'s Projects page shows the project', !!seen);
        await page.keyboard.press('Escape').catch(() => {});
      }
      // the cap probe's projects have no room: archive them so later scenarios never land in one
      for (const p of (await feedRows(H(ctx), 'projects', ctx.ws.id)).filter((x) => x.name?.startsWith('R6 Cap ') && x.status !== 'archived')) {
        await cmd(H(ctx), { type: 'project.archive', project: p.id }).catch(() => {});
      }
    },
  },
  {
    id: 'crew',
    title: 'the crew: register, edit, add to a room, retire, rehire, A2A card (docs/03, 06, 13)',
    async run(t, ctx) {
      const name = `r6bot${ctx.tag.slice(-4)}`;
      const reg = await cmd(H(ctx), { type: 'agent.register', workspace: ctx.ws.id, machineId: ctx.ws.runner, name, role: 'worker', model: 'gemini-3.5-flash-lite', runtime: 'gemini', channels: ['general'], description: 'a feature-suite helper' });
      const id = reg?.agentId ?? reg?.agent?.id;
      const row = (await feedRows(H(ctx), 'agents', ctx.ws.id)).find((a) => a.name === name);
      t.check('agent.register adds an agent to the crew', !!row, row ?? reg);
      const aid = id ?? row?.id;
      t.check('an unknown model id is refused', /INVALID_INPUT|HTTP 400/.test(await refusal(cmd(H(ctx), { type: 'agent.update', agent: aid, model: 'not-a-model' }))));
      await cmd(H(ctx), { type: 'agent.update', agent: aid, description: 'renamed by the suite', brief: 'Be brief.' });
      t.check('agent.update edits its description', (await feedRows(H(ctx), 'agents', ctx.ws.id)).find((a) => a.id === aid)?.description === 'renamed by the suite');
      const build = ctx.ws.channels.find((c) => c.slug === 'build');
      if (build) {
        await cmd(H(ctx), { type: 'channel.add_agent', workspace: ctx.ws.id, channel: build.id, agent: aid }).catch(async () => cmd(H(ctx), { type: 'channel.add_agent', workspace: ctx.ws.id, channel: build.id, agent: name }));
        const links = await feedRows(H(ctx), 'agent_channels', ctx.ws.id);
        t.check('channel.add_agent seats it in #build', links.some((l) => l.agent_id === aid && l.channel_id === build.id));
      }
      const card = await api('GET', `/a2a/agents/${aid}/card.json`, { raw: true }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })).catch((e) => ({ error: e.message }));
      t.check('the agent publishes an A2A card', card.status === 200 && !!card.json?.name, { status: card.status, name: card.json?.name, skills: card.json?.skills?.length });
      await cmd(H(ctx), { type: 'agent.retire', agent: aid });
      t.check('agent.retire retires it', !!(await feedRows(H(ctx), 'agents', ctx.ws.id)).find((a) => a.id === aid)?.retired_at);
      t.check('an offer to a retired agent is refused', /NOT_PERMITTED|NOT_FOUND/.test(await refusal(cmd(H(ctx), { type: 'task.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, title: 'x', offerTo: name, kind: 'chore' }))));
      const back = await refusal(cmd(H(ctx), { type: 'agent.register', workspace: ctx.ws.id, machineId: ctx.ws.runner, name, role: 'worker', model: 'gemini-3.5-flash-lite', runtime: 'gemini', channels: ['general'] }));
      t.check('registering the same name rehires it', back === 'ok' && !(await feedRows(H(ctx), 'agents', ctx.ws.id)).find((a) => a.name === name)?.retired_at, back);
      await cmd(H(ctx), { type: 'agent.retire', agent: aid }).catch(() => {});
      if (ctx.a.page) {
        const page = ctx.a.page;
        const r = await replica(page, 'SELECT name, role, retired_at FROM agents WHERE workspace_id = ? ORDER BY name', [ctx.ws.id]).catch((e) => String(e));
        t.check('the page\'s replica has the crew', Array.isArray(r) && r.some((a) => a.name === name), r);
      }
    },
  },
  {
    id: 'brains-keys',
    title: 'brains: packs, custom brains, a per-agent pin, an agent key (docs/08, 10, 22)',
    async run(t, ctx) {
      const packs = await api('GET', `/v1/model-packs?workspace=${ctx.ws.id}`, { as: H(ctx) });
      t.note({ packsBefore: packs.packs?.length ?? packs });
      const m = 'gemini-3.5-flash-lite';
      const roles = Object.fromEntries(['worker', 'developer', 'reviewer', 'orchestrator', 'designer', 'sales', 'architect', 'curator', 'shipper', 'marketer'].map((r) => [r, m]));
      const saved = await cmd(H(ctx), { type: 'modelpack.save', workspace: ctx.ws.id, name: `R6 brain ${ctx.tag}`, roles });
      const packId = saved?.packId ?? saved?.id;
      t.check('modelpack.save makes a custom brain', /^custom:/.test(String(packId)), saved);
      t.check('a duplicate name is refused', /CONFLICT|HTTP 409/.test(await refusal(cmd(H(ctx), { type: 'modelpack.save', workspace: ctx.ws.id, name: `R6 brain ${ctx.tag}`, roles }))));
      const ws0 = (await api('GET', '/v1/workspaces', { as: H(ctx) })).workspaces.find((w) => w.id === ctx.ws.id);
      await cmd(H(ctx), { type: 'workspace.update', workspace: ctx.ws.id, activeModelPack: packId });
      const ws1 = (await api('GET', '/v1/workspaces', { as: H(ctx) })).workspaces.find((w) => w.id === ctx.ws.id);
      t.check('workspace.update activates it', ws1.activeModelPack === packId, { before: ws0.activeModelPack, after: ws1.activeModelPack });
      await cmd(H(ctx), { type: 'modelpack.delete', workspace: ctx.ws.id, packId });
      const ws2 = (await api('GET', '/v1/workspaces', { as: H(ctx) })).workspaces.find((w) => w.id === ctx.ws.id);
      t.check('deleting the active custom brain resets the pointer', ws2.activeModelPack !== packId, ws2.activeModelPack);
      // put the workspace back on the pack the wizard chose, so later agent turns keep their seats
      if (ws0.activeModelPack && ws0.activeModelPack !== ws2.activeModelPack) await cmd(H(ctx), { type: 'workspace.update', workspace: ctx.ws.id, activeModelPack: ws0.activeModelPack }).catch(() => {});
      // the pin: a human model edit is stamped manual
      const scout = ctx.ws.agents.find((a) => a.role === 'reviewer');
      await cmd(H(ctx), { type: 'agent.update', agent: scout.id, model: m, modelSource: 'manual' });
      const pinned = (await feedRows(H(ctx), 'agents', ctx.ws.id)).find((a) => a.id === scout.id);
      t.check('a per-agent pin is recorded (model_source manual)', pinned?.model_source === 'manual', { model: pinned?.model, source: pinned?.model_source });
      await cmd(H(ctx), { type: 'agent.update', agent: scout.id, modelSource: 'pack' }).catch(() => {});
      // a key at AGENT scope on a throwaway agent, so the crew keeps the starter brain
      const keyAgentName = `r6key${ctx.tag.slice(-4)}`;
      const reg = await cmd(H(ctx), { type: 'agent.register', workspace: ctx.ws.id, machineId: ctx.ws.runner, name: keyAgentName, role: 'worker', model: m, runtime: 'gemini', channels: ['research'] });
      const keyAgent = reg?.agentId ?? (await feedRows(H(ctx), 'agents', ctx.ws.id)).find((a) => a.name === keyAgentName)?.id;
      const set = await refusal(cmd(H(ctx), { type: 'credential.set', workspace: ctx.ws.id, provider: 'google', scope: 'agent', agentId: keyAgent, authMode: 'apikey', token: `r6-not-a-real-key-${ctx.tag}` }));
      const creds = await api('GET', `/v1/credentials?workspace=${ctx.ws.id}`, { as: H(ctx) });
      const listed = JSON.stringify(creds);
      t.check('credential.set stores an agent key, and the list never shows the secret', set === 'ok' && /google/.test(listed) && !listed.includes(`r6-not-a-real-key-${ctx.tag}`), { set, credentials: creds });
      await cmd(H(ctx), { type: 'agent.retire', agent: keyAgent }).catch(() => {});
      // the thread brain override needs a thread: the next scenario family makes one
    },
  },
  {
    id: 'retro-credits-export',
    title: 'retro, credits and usage, the export (docs/13, 07, export-format)',
    async run(t, ctx) {
      const retro = await api('GET', `/v1/retro?workspace=${ctx.ws.id}&range=week`, { as: H(ctx) });
      t.check('GET /v1/retro answers for the week', !!retro && typeof retro === 'object', Object.keys(retro ?? {}));
      t.note({ retro: JSON.stringify(retro).slice(0, 800) });
      t.check('a bad range is refused', /HTTP 400|INVALID/.test(await refusal(api('GET', `/v1/retro?workspace=${ctx.ws.id}&range=decade`, { as: H(ctx) }))));
      const usage = await api('GET', `/v1/usage?workspace=${ctx.ws.id}`, { as: H(ctx) });
      t.check('GET /v1/usage shows a balance (signup 500 plus the suite\'s grant)', Number(usage?.credits?.remaining ?? -1) > 0, usage);
      const hist = await api('GET', `/v1/credits/history?workspace=${ctx.ws.id}`, { as: H(ctx) });
      t.check('GET /v1/credits/history lists the grants', JSON.stringify(hist).includes('signup') || (hist?.grants ?? hist?.rows ?? []).length > 0, JSON.stringify(hist).slice(0, 600));
      const stranger = await ctx.extraUser('stranger');
      t.check('a non-member cannot read the usage', /NOT_PERMITTED|HTTP 403|HTTP 404/.test(await refusal(api('GET', `/v1/usage?workspace=${ctx.ws.id}`, { as: stranger.userId }))));
      const res = await api('GET', `/v1/workspaces/${ctx.ws.id}/export`, { as: H(ctx), raw: true, timeout: 120_000 });
      const buf = Buffer.from(await res.arrayBuffer());
      const { gunzipSync } = await import('node:zlib');
      let first = '';
      try { first = gunzipSync(buf).subarray(0, 100).toString('utf8').replace(/\0.*$/s, ''); } catch (e) { first = `not gzip: ${e.message}`; }
      t.check('the owner exports the workspace: a tar.gz led by manifest.json', res.status === 200 && /manifest\.json/.test(first), { status: res.status, bytes: buf.length, first });
      t.check('a stranger cannot export it', /HTTP 403|NOT_PERMITTED|HTTP 404/.test(await refusal(api('GET', `/v1/workspaces/${ctx.ws.id}/export`, { as: stranger.userId }))));
      if (ctx.a.page) {
        const page = ctx.a.page;
        await page.keyboard.press('Control+k').catch(() => {});
        await page.keyboard.type('Credits').catch(() => {});
        await page.keyboard.press('Enter').catch(() => {});
        const seen = await seeText(page, /credits/i, { timeout: 10_000 });
        await snap(page, 'credits');
        t.note({ creditsView: !!seen });
        await page.keyboard.press('Escape').catch(() => {});
      }
    },
  },
  {
    id: 'billing-off',
    title: 'billing where Stripe is absent: the config says off, every door says so (docs/07)',
    async run(t, ctx) {
      const config = await api('GET', '/v1/billing/config', { as: H(ctx) });
      t.check('GET /v1/billing/config reports billing off', config && (config.enabled === false || config.billing === false || config.configured === false || !config.publishableKey), config);
      const checkout = await refusal(api('POST', '/v1/billing/checkout', { as: H(ctx), body: { workspace: ctx.ws.id } }));
      const pack = await refusal(api('POST', '/v1/billing/credits-checkout', { as: H(ctx), body: { workspace: ctx.ws.id, credits: 500 } }));
      const trial = await refusal(api('POST', '/v1/billing/trial', { as: H(ctx), body: { workspace: ctx.ws.id } }));
      const portal = await refusal(api('POST', '/v1/billing/portal', { as: H(ctx), body: { workspace: ctx.ws.id } }));
      t.check('checkout, credit packs, the trial and the portal refuse cleanly (no 5xx)', [checkout, pack, trial, portal].every((c) => !/HTTP 5/.test(c) && c !== 'ok'), { checkout, pack, trial, portal });
      t.blocked('Stripe: Pro checkout, the card trial, credit packs, the portal, seat sync and the plan-flip webhook need STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the price ids on nm-api. The disabled state above is what the sandbox can prove');
    },
  },
];
