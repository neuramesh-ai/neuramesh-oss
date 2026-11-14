// THE REST OF THE SURFACE (matrix sections D, CB, C, T, S, MK, X, W, H): the starter brain's meter
// and its zero-balance refusals, the workspace voice, room and chat threads, plan-first units,
// cancel and reopen, routine guards and failure alerts, the marketing room's switches, the import
// gate, the public announce door, and the shell's addresses and settings.
import { randomUUID } from 'node:crypto';
import { agentActor, api, cmd, escapeRe, feedRows, getTask, refusal, seeText, snap, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;
const EM = '\u2014';

export const extras = [
  {
    id: 'starter-meter',
    title: 'the starter brain: metered calls, the stream, and the zero-balance refusals (docs/10, credits)',
    async run(t, ctx) {
      const prompt = { contents: [{ role: 'user', parts: [{ text: 'Answer with the single word OK.' }] }] };
      const before = await api('GET', `/v1/usage?workspace=${ctx.ws.id}`, { as: H(ctx) });
      const res = await api('POST', '/v1/starter/generate', { as: H(ctx), raw: true, timeout: 60_000, body: { workspace: ctx.ws.id, ...prompt } });
      const gen = await res.json().catch(() => null);
      t.check('POST /v1/starter/generate answers and meters the call (x-nm-credits-remaining)', res.status === 200 && !!res.headers.get('x-nm-credits-remaining'), { status: res.status, remaining: res.headers.get('x-nm-credits-remaining'), credits: gen?.credits });
      const s = await api('POST', '/v1/starter/stream', { as: H(ctx), raw: true, timeout: 60_000, body: { workspace: ctx.ws.id, ...prompt } });
      const lines = (await s.text()).split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l.slice(0, 80) }; } });
      t.check('POST /v1/starter/stream sends text deltas, then done', s.status === 200 && lines.some((l) => l.t === 'text') && lines.at(-1)?.t === 'done', { status: s.status, kinds: lines.map((l) => l.t ?? 'raw').slice(0, 12) });
      const after = await api('GET', `/v1/usage?workspace=${ctx.ws.id}`, { as: H(ctx) });
      t.check('the usage meter counts the calls', Number(after.brain?.callsToday) >= Number(before.brain?.callsToday) + 2, { before: before.brain?.callsToday, after: after.brain?.callsToday });
      // a second workspace of A's starts with no credits and no machine (workspace-birth.ts)
      const empty = await cmd(H(ctx), { type: 'workspace.create', name: `R6 empty ${ctx.tag}`, slug: `r6-empty-${ctx.tag}` });
      ctx.wsEmpty = empty.workspaceId;
      const u = await api('GET', `/v1/usage?workspace=${ctx.wsEmpty}`, { as: H(ctx) });
      const m = await api('GET', `/v1/machines/usage?workspace=${ctx.wsEmpty}`, { as: H(ctx) });
      t.check('a second workspace gets no signup grant and no runner', u.credits?.outOfCredits === true && (m.machines ?? []).length === 0, { credits: u.credits, machines: (m.machines ?? []).length });
      const g = await refusal(api('POST', '/v1/starter/generate', { as: H(ctx), body: { workspace: ctx.wsEmpty, ...prompt } }));
      t.check('at a zero balance the starter brain refuses with NO_CREDITS (402)', g === 'NO_CREDITS', g);
      const wake = await api('POST', '/v1/machines/wake', { as: H(ctx), raw: true, body: { workspace: ctx.wsEmpty } });
      const wakeBody = await wake.json().catch(() => null);
      t.check('a wake at a zero balance answers 409 capped with NO_CREDITS (what hq\'s Wake button must read)', wake.status === 409 && wakeBody?.capped === true && wakeBody?.code === 'NO_CREDITS', { status: wake.status, body: wakeBody });
      t.note('hq read this refusal as COMPUTE_CAPPED only, so its Wake button failed quietly: fixed in apps/hq/web/webnm-account.ts (webnm-oneoff.test.ts)');
      const stranger = await ctx.extraUser('starter');
      t.check('a non-member cannot spend the workspace\'s starter credits', /NOT_PERMITTED|HTTP 403/.test(await refusal(api('POST', '/v1/starter/generate', { as: stranger.userId, body: { workspace: ctx.ws.id, ...prompt } }))));
      t.check('nor read its keys (credentials resolve tenant guard)', /NOT_PERMITTED|HTTP 403|HTTP 404/.test(await refusal(api('GET', `/v1/credentials/resolve?workspace=${ctx.ws.id}&provider=google`, { as: stranger.userId }))));
      await cmd(H(ctx), { type: 'workspace.delete', workspace: ctx.wsEmpty }).catch(() => {});
    },
  },
  {
    id: 'voice-scrub',
    title: 'the workspace voice: an em dash in agent prose is scrubbed, never in code or a human\'s words (agent-comm-rules)',
    async run(t, ctx) {
      const rex = agentActor(ctx, 'orchestrator');
      const w0 = (await api('GET', '/v1/workspaces', { as: H(ctx) })).workspaces.find((w) => w.id === ctx.ws.id);
      await cmd(H(ctx), { type: 'workspace.update', workspace: ctx.ws.id, commRules: { ste100: false, noEmdash: true, custom: ['Keep it short.'] } });
      const w1 = (await api('GET', '/v1/workspaces', { as: H(ctx) })).workspaces.find((w) => w.id === ctx.ws.id);
      t.check('workspace.update stores the rules', w1.commRules?.noEmdash === true, w1.commRules);
      const threadId = randomUUID();
      const said = `Done ${EM} shipped it ${ctx.tag}.\n\n\`\`\`\na ${EM} b\n\`\`\``;
      const a = await api('POST', '/v1/messages', { as: rex, body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, threadId, body: said } });
      const h = await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, threadId, body: `human ${EM} words ${ctx.tag}` } });
      const rows = await feedRows(H(ctx), 'messages', ctx.ws.id);
      const ab = rows.find((m) => m.id === a?.message?.id)?.body ?? '';
      const hb = rows.find((m) => m.id === h?.message?.id)?.body ?? '';
      const [prose, fence] = [ab.split('```')[0], ab.split('```')[1] ?? ''];
      t.check('the agent\'s prose loses its em dash', !prose.includes(EM), prose);
      t.check('the code fence keeps it', fence.includes(EM), fence);
      t.check('the human\'s words are never rewritten', hb.includes(EM), hb);
      await cmd(H(ctx), { type: 'workspace.update', workspace: ctx.ws.id, commRules: w0.commRules ?? { noEmdash: false } }).catch(() => {});
    },
  },
  {
    id: 'thread-shapes',
    title: 'room threads: a reply rooted at a message, chat-mode threads, agent titles once (docs/31, 34, 35)',
    async run(t, ctx) {
      const rex = agentActor(ctx, 'orchestrator');
      const root = await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, body: `R6 room post ${ctx.tag}` } });
      const rt = randomUUID();
      await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, threadId: rt, rootMessageId: root.message.id, body: `R6 reply ${ctx.tag}` } });
      const th = (await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.id === rt);
      t.check('a reply thread is rooted at its room message', th?.root_message_id === root.message.id, th ? { root: th.root_message_id } : null);
      const ct = randomUUID();
      await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, threadId: ct, threadMode: 'chat', body: `R6 chat ${ctx.tag}: no tasks here please` } });
      t.check('a thread born in chat mode', (await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.id === ct)?.mode === 'chat');
      t.check('a task cannot be filed from a chat-mode thread (CHAT_THREAD)', /CHAT_THREAD/.test(await refusal(cmd(H(ctx), { type: 'task.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, title: 'x', thread: ct }))));
      t.check('an agent cannot switch the mode', /NOT_PERMITTED|HUMAN/.test(await refusal(cmd(rex, { type: 'thread.set_mode', workspace: ctx.ws.id, threadId: ct, mode: 'tasks' }))));
      const first = await refusal(cmd(rex, { type: 'thread.update', workspace: ctx.ws.id, threadId: rt, title: 'First' }));
      const second = await refusal(cmd(rex, { type: 'thread.update', workspace: ctx.ws.id, threadId: rt, title: 'Second' }));
      const human = await refusal(cmd(H(ctx), { type: 'thread.update', workspace: ctx.ws.id, threadId: rt, title: 'Human title' }));
      t.check('an agent titles a thread once, a human may always retitle', first === 'ok' && second !== 'ok' && human === 'ok', { first, second, human });
    },
  },
  {
    id: 'plan-first-unit',
    title: 'a plan-first unit: born in plan_review with legs and subtasks, minted on approval (docs/41)',
    async run(t, ctx) {
      const rex = agentActor(ctx, 'orchestrator');
      const threadId = randomUUID();
      await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, threadId, body: `R6 unit host ${ctx.tag}` } });
      const made = await cmd(H(ctx), { type: 'task.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, title: `R6 unit ${ctx.tag}`, originThread: threadId, plan: { legs: ['build'], subtasks: ['write it', 'check it'], approach: 'Build it in two small steps.' } });
      const unit = made.task;
      t.check('the unit is born in plan_review with its work plan', unit?.state === 'plan_review' && !!unit?.workPlan, { state: unit?.state, workPlan: unit?.workPlan });
      await cmd(H(ctx), { type: 'task.approve_plan', taskId: unit.id });
      const kids = await until('the subtasks', async () => { const k = (await feedRows(H(ctx), 'tasks', ctx.ws.id)).filter((r) => r.parent_task_id === unit.id); return k.length >= 2 ? k : null; }, { timeout: 20_000 }).catch(() => []);
      t.check('approval mints the proposed subtasks under the unit', kids.length === 2, kids.map((k) => k.title));
      const card = (await feedRows(H(ctx), 'messages', ctx.ws.id)).find((m) => m.thread_id === threadId && (m.body ?? '').includes(unit.id));
      t.check('the unit card lands in the thread it was made from', !!card, card?.body?.slice(0, 80));
      const bare = await cmd(rex, { type: 'task.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, title: `R6 bare ${ctx.tag}` }).then(() => 'ok').catch((e) => e.message);
      t.check('an agent cannot file a live task without its plan (PLAN_FIRST)', /PLAN_FIRST/.test(bare), bare.slice(0, 160));
      const c = (await cmd(H(ctx), { type: 'task.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, title: `R6 cancel ${ctx.tag}` })).task;
      await cmd(H(ctx), { type: 'task.cancel', taskId: c.id });
      t.check('cancel closes a task', (await getTask(H(ctx), c.id)).task.state === 'closed');
      t.check('an agent cannot reopen it', /HUMAN_ONLY|NOT_PERMITTED/.test(await refusal(cmd(rex, { type: 'task.reopen', taskId: c.id }))));
      await cmd(H(ctx), { type: 'task.reopen', taskId: c.id });
      t.check('the human reopens it', (await getTask(H(ctx), c.id)).task.state === 'todo');
    },
  },
  {
    id: 'routine-guards',
    title: 'routines: run now, one routine per session, a failure record and the attention bar (routine-*, failure-alerts)',
    async run(t, ctx) {
      const rex = agentActor(ctx, 'orchestrator');
      const threadId = randomUUID();
      await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, threadId, body: `R6 routine host ${ctx.tag}` } });
      const base = { type: 'schedule.create', channel: ctx.ws.channelId, title: `R6 guard ${ctx.tag}`, prompt: 'Say hi.', cadence: 'daily', atTime: '09:00', tz: 'UTC', routine: true };
      t.check('an agent cannot arm a routine directly', /HUMAN_ONLY|NOT_PERMITTED/.test(await refusal(cmd(rex, base))));
      const one = await refusal(cmd(H(ctx), { ...base, thread: threadId }));
      const two = await refusal(cmd(H(ctx), { ...base, title: `R6 guard 2 ${ctx.tag}`, thread: threadId }));
      t.check('a session holds one routine (THREAD_HAS_ROUTINE)', one === 'ok' && /THREAD_HAS_ROUTINE/.test(two), { one, two });
      const s = (await feedRows(H(ctx), 'schedules', ctx.ws.id)).find((x) => x.title === `R6 guard ${ctx.tag}`);
      if (!s) return;
      await cmd(H(ctx), { type: 'schedule.set_status', schedule: s.id, status: 'paused' });
      t.check('run now is refused on a paused routine', (await refusal(cmd(H(ctx), { type: 'schedule.run_now', schedule: s.id }))) !== 'ok');
      await cmd(H(ctx), { type: 'schedule.set_status', schedule: s.id, status: 'active' });
      t.check('an agent cannot run it now', /HUMAN_ONLY|NOT_PERMITTED/.test(await refusal(cmd(rex, { type: 'schedule.run_now', schedule: s.id }))));
      const now = await refusal(cmd(H(ctx), { type: 'schedule.run_now', schedule: s.id }));
      const s2 = (await feedRows(H(ctx), 'schedules', ctx.ws.id)).find((x) => x.id === s.id);
      t.check('run now makes it due at once (next_run_at about now)', now === 'ok' && Math.abs(Date.parse(s2?.next_run_at) - Date.now()) < 5 * 60_000, { now, next: s2?.next_run_at });
      const mark = await refusal(cmd(rex, { type: 'schedule.mark_result', schedule: s.id, error: `boom ${ctx.tag}` }));
      const s3 = (await feedRows(H(ctx), 'schedules', ctx.ws.id)).find((x) => x.id === s.id);
      t.check('the host records a failed run (schedule.mark_result)', mark === 'ok' && (s3?.last_error ?? '').includes('boom'), { mark, lastError: s3?.last_error });
      if (ctx.a.page && s3?.last_error) {
        await ctx.a.page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        const bar = await seeText(ctx.a.page, /need[s]? attention|boom/i, { timeout: 30_000 });
        await snap(ctx.a.page, 'attention-bar');
        t.check('hq raises the attention bar for the failed routine', !!bar, bar);
      }
      await cmd(rex, { type: 'schedule.mark_result', schedule: s.id, error: null }).catch(() => {});
      await cmd(H(ctx), { type: 'schedule.delete', schedule: s.id }).catch(() => {});
    },
  },
  {
    id: 'marketing-room',
    title: 'a marketing room: kind, integration switch, a scored report (marketing-channel, marketing-os)',
    async run(t, ctx) {
      const rex = agentActor(ctx, 'orchestrator');
      const general = (await feedRows(H(ctx), 'channels', ctx.ws.id)).find((c) => c.id === ctx.ws.channelId);
      const made = await refusal(cmd(H(ctx), { type: 'channel.create', workspace: ctx.ws.id, project: general.project_id, slug: `growth-${ctx.tag.slice(-4)}`, topic: 'growth' }));
      const room = (await feedRows(H(ctx), 'channels', ctx.ws.id)).find((c) => c.slug === `growth-${ctx.tag.slice(-4)}`);
      t.check('channel.create makes a room in the project', made === 'ok' && !!room, made);
      if (!room) return;
      t.check('an agent cannot change the room\'s kind', /NOT_PERMITTED|HUMAN/.test(await refusal(cmd(rex, { type: 'channel.set_kind', channel: room.id, kind: 'marketing' }))));
      await cmd(H(ctx), { type: 'channel.set_kind', channel: room.id, kind: 'marketing' });
      t.check('the human makes it a marketing room', (await feedRows(H(ctx), 'channels', ctx.ws.id)).find((c) => c.id === room.id)?.kind === 'marketing');
      const setup = await until('the setup task', async () => (await feedRows(H(ctx), 'tasks', ctx.ws.id)).find((x) => x.channel_id === room.id && x.kind === 'setup'), { timeout: 15_000 }).catch(() => null);
      t.check('a marketing room is born with its setup task', !!setup, setup ? { title: setup.title, state: setup.state } : null);
      const integ = await refusal(cmd(H(ctx), { type: 'marketing.set_integration', channel: room.id, provider: 'posthog', enabled: true }));
      t.check('marketing.set_integration records the switch', integ === 'ok' && /posthog/i.test((await feedRows(H(ctx), 'channels', ctx.ws.id)).find((c) => c.id === room.id)?.marketing ?? ''), integ);
      const rep = await refusal(cmd(rex, { type: 'artifact.create', channel: room.id, kind: 'doc', name: `audit-report-${ctx.tag}.md`, inlineContent: `# Site audit\n2026-10-30 · Score: 72/100 · Basis: homepage\n## Fix these first\n1. the hero\n## What I couldn't determine\n- traffic`, tags: ['report', 'playbook:audit'] }));
      const r = (await feedRows(H(ctx), 'artifacts', ctx.ws.id)).find((a) => a.name === `audit-report-${ctx.tag}.md`);
      t.check('a scored report lands tagged as a playbook report', rep === 'ok' && /report/.test(r?.tags ?? ''), { rep, tags: r?.tags });
    },
  },
  {
    id: 'import-gate',
    title: 'Migrate to Cloud\'s server half: the import batches gate (oss-release U7)',
    async run(t, ctx) {
      const plan = (await api('GET', '/v1/workspaces', { as: H(ctx) })).workspaces.find((w) => w.id === ctx.ws.id)?.plan;
      const exp = await api('GET', `/v1/workspaces/${ctx.ws.id}/export`, { as: H(ctx), raw: true, timeout: 120_000 });
      const { gunzipSync } = await import('node:zlib');
      const tar = gunzipSync(Buffer.from(await exp.arrayBuffer()));
      const size = parseInt(tar.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
      const manifest = JSON.parse(tar.subarray(512, 512 + size).toString('utf8'));
      const res = await api('POST', `/v1/workspaces/${ctx.ws.id}/import/batches`, { as: H(ctx), raw: true, body: { importId: randomUUID(), seq: 0, table: 'projects', rows: [], first: { manifest, totalBytes: 1 } } });
      const body = await res.json().catch(() => null);
      t.check(`the opening import batch answers on the ${plan} plan (Free: PLAN_LIMIT, Pro: accepted, nothing written)`, plan === 'free' ? body?.code === 'PLAN_LIMIT' : res.status === 200, { status: res.status, body });
      const stranger = await ctx.extraUser('import');
      t.check('a stranger cannot import into it', /HTTP 403|NOT_PERMITTED|HTTP 404/.test(await refusal(api('POST', `/v1/workspaces/${ctx.ws.id}/import/batches`, { as: stranger.userId, body: { importId: randomUUID(), seq: 0, table: 'projects', rows: [], first: { manifest, totalBytes: 1 } } }))));
    },
  },
  {
    id: 'announce-door',
    title: 'the public announce door: detect, request, and the queue nobody drains here (docs/44)',
    async run(t, ctx) {
      const d = await api('POST', '/announce/detect', { raw: true, body: { repo: 'nodejs/node' } });
      const dj = await d.json().catch(() => null);
      t.check('POST /announce/detect reads a public repository\'s latest release', d.status === 200 && dj?.ok === true && !!dj?.latest, { status: d.status, latest: dj?.latest?.tag, private: dj?.private });
      const a = await api('POST', '/announce', { raw: true, body: { repo: 'nodejs/node', website: 'example.com', email: `${ctx.prefix}announce-${ctx.tag}@e2e.invalid` } });
      const aj = await a.json().catch(() => null);
      t.check('POST /announce queues a draft set', [200, 202].includes(a.status) && !!aj?.id, { status: a.status, body: aj });
      if (aj?.id) {
        const g = await api('GET', `/announce/${aj.id}`, { raw: true });
        const gj = await g.json().catch(() => null);
        t.note({ announceStatus: gj?.status });
        t.check('the request stays queued: /internal/announce-due is not scheduled on Cloud Run', gj?.status === 'queued', gj?.status);
      }
      t.blocked('the announce worker needs /internal/announce-due on a schedule (NM_INPROC_CRONS or Cloud Scheduler) and Resend for the ready email');
    },
  },
  {
    id: 'shell-addresses',
    title: 'hq\'s shell: deep links, a wrong address, ⌘K, the settings modal and the theme (W4, W7, W8)',
    needs: ['browser'],
    async run(t, ctx) {
      const page = ctx.a.page;
      const task = ctx.boardTask ?? (await feedRows(H(ctx), 'tasks', ctx.ws.id))[0];
      await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}/t/${task.number}`, { waitUntil: 'domcontentloaded' });
      const opened = await seeText(page, new RegExp(escapeRe(task.title)), { timeout: 30_000 });
      await snap(page, 'deep-link-task');
      t.check('/<slug>/t/<number> opens the task', !!opened);
      await page.goto(`${ctx.cfg.hq}/no-such-slug-${ctx.tag}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5_000);
      t.check('a wrong address corrects to the member\'s workspace', new URL(page.url()).pathname.startsWith(`/${ctx.ws.slug}`), page.url());
      await page.keyboard.press('Control+k');
      const pal = await page.getByRole('dialog', { name: 'Quick actions' }).isVisible().catch(() => false);
      t.check('⌘K opens Quick actions', pal);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+Shift+p').catch(() => {});
      const settings = await page.getByRole('dialog').first().isVisible().catch(() => false);
      await snap(page, 'settings');
      t.note({ settingsDialog: settings });
      await page.keyboard.press('Escape').catch(() => {});
      const theme0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await page.evaluate(() => localStorage.setItem('nm:theme', 'paper-dark'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3_000);
      const theme1 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      t.check('a theme choice holds across a reload (machine-local nm:theme)', theme1 && theme1 !== theme0 ? true : theme1 === 'paper-dark', { before: theme0, after: theme1 });
      await page.evaluate((v) => (v ? localStorage.setItem('nm:theme', v) : localStorage.removeItem('nm:theme')), theme0 === 'paper-dark' ? null : null);
      await page.reload({ waitUntil: 'domcontentloaded' });
    },
  },
];
