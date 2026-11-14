// CONVERSATIONS AND WHAT THEY MAKE (matrix sections C, R, F, B): sessions (threads) and their
// controls, pins, runs and live status, replies, whiteboards, files and deliverables, routines as
// rows, content and the calendar, the setup flows, connectors and policies. API writes as the
// person or as an agent (the host's lane), then the feed and the page read them back.
import { randomUUID } from 'node:crypto';
import { agentActor, api, cmd, feedRows, goView, refusal, replica, seeText, snap, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;
const post = (ctx, as, body, extra = {}) => api('POST', '/v1/messages', { as, body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, body, ...extra } });

/** a fresh session (thread) in #general, opened the way hq's composer opens one */
async function newThread(ctx, words) {
  const threadId = randomUUID();
  const sent = await post(ctx, H(ctx), words, { threadId });
  return { threadId, messageId: sent?.message?.id };
}

export const content = [
  {
    id: 'sessions',
    title: 'sessions: a thread, rename, mode, brain override, move, settle, archive (docs/34, 35, 36)',
    async run(t, ctx) {
      const words = `R6 session ${ctx.tag}: please do not answer, this is a test.`;
      const { threadId, messageId } = await newThread(ctx, words);
      const thread = await until('the thread row', async () => (await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.id === threadId), { timeout: 20_000 }).catch(() => null);
      t.check('a message with a new threadId opens a session (threads row)', !!thread, thread ?? { messageId });
      if (!thread) return;
      ctx.thread = { threadId, messageId };
      await cmd(H(ctx), { type: 'thread.update', workspace: ctx.ws.id, threadId, title: `R6 thread ${ctx.tag}` });
      t.check('thread.update renames it', (await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.id === threadId)?.title === `R6 thread ${ctx.tag}`);
      await cmd(H(ctx), { type: 'thread.set_mode', workspace: ctx.ws.id, threadId, mode: 'chat' });
      t.check('thread.set_mode switches it to chat mode (docs/34)', (await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.id === threadId)?.mode === 'chat');
      await cmd(H(ctx), { type: 'thread.set_mode', workspace: ctx.ws.id, threadId, mode: 'tasks' });
      const rex = agentActor(ctx, 'orchestrator');
      t.check('an agent may not set the brain override', /HUMAN_ONLY|NOT_PERMITTED/.test(await refusal(cmd(rex, { type: 'thread.set_brain', workspace: ctx.ws.id, threadId, override: { orchestrator: 'gemini-3.5-flash-lite' } }))));
      const ov = await refusal(cmd(H(ctx), { type: 'thread.set_brain', workspace: ctx.ws.id, threadId, override: { orchestrator: 'gemini-3.5-flash-lite' } }));
      const row = (await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.id === threadId);
      t.check('the human sets a per-thread brain override', ov === 'ok' && /gemini/.test(row?.brain_override ?? ''), { ov, brain: row?.brain_override });
      await cmd(H(ctx), { type: 'thread.set_brain', workspace: ctx.ws.id, threadId, override: null });
      const research = ctx.ws.channels.find((c) => c.slug === 'research');
      if (research) {
        await cmd(H(ctx), { type: 'thread.move', workspace: ctx.ws.id, threadId, channel: research.id });
        t.check('thread.move files it in #research', (await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.id === threadId)?.channel_id === research.id);
        await cmd(H(ctx), { type: 'thread.move', workspace: ctx.ws.id, threadId, channel: ctx.ws.channelId });
      }
      await cmd(H(ctx), { type: 'message.pin', message: messageId, pinned: true });
      t.check('message.pin pins the opener', Number((await feedRows(H(ctx), 'messages', ctx.ws.id)).find((m) => m.id === messageId)?.pinned) === 1);
      await cmd(H(ctx), { type: 'thread.settle', workspace: ctx.ws.id, threadId });
      t.check('thread.settle settles it', !!(await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.id === threadId)?.settled_at);
      await cmd(H(ctx), { type: 'thread.unsettle', workspace: ctx.ws.id, threadId });
      if (ctx.a.page) {
        const page = ctx.a.page;
        await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}/c/${threadId}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        const seen = await seeText(page, new RegExp(`R6 session ${ctx.tag}`), { timeout: 30_000 });
        await snap(page, 'session');
        t.check('hq opens the session at its address (/<slug>/c/<id>) and shows the message', !!seen);
        const rail = await seeText(page, new RegExp(`R6 thread ${ctx.tag}`), { timeout: 10_000 });
        t.check('the rail lists the session by its new title', !!rail);
      }
      await cmd(H(ctx), { type: 'thread.archive', workspace: ctx.ws.id, threadId });
      t.check('thread.archive archives it', !!(await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.id === threadId)?.archived_at);
      await cmd(H(ctx), { type: 'thread.unarchive', workspace: ctx.ws.id, threadId });
    },
  },
  {
    id: 'runs-live-status',
    title: 'runs and live status: an agent run opens, steps and settles; the page shows it (docs/26, 29)',
    async run(t, ctx) {
      const rex = agentActor(ctx, 'orchestrator');
      const { threadId } = ctx.thread ?? await newThread(ctx, `R6 run host ${ctx.tag}`);
      const runId = randomUUID();
      const open = await refusal(cmd(rex, { type: 'run.open', id: runId, workspace: ctx.ws.id, channel: ctx.ws.channelId, threadId, kind: 'work', title: `R6 run ${ctx.tag}`, total: 3, step: 'reading the brief' }));
      t.check('an agent opens a run', open === 'ok', open);
      t.check('a human never opens a run', /NOT_PERMITTED|HUMAN|AGENT/.test(await refusal(cmd(H(ctx), { type: 'run.open', workspace: ctx.ws.id, channel: ctx.ws.channelId, kind: 'work', title: 'x' }))));
      await cmd(rex, { type: 'run.step', runId, step: 'writing the answer', done: 2, total: 3 });
      const live = (await feedRows(H(ctx), 'runs', ctx.ws.id)).find((r) => r.id === runId);
      t.check('the run row carries the live step and progress', live?.step === 'writing the answer' && Number(live?.done) === 2, live);
      if (ctx.a.page) {
        const page = ctx.a.page;
        await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}/c/${threadId}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        const seen = await seeText(page, /writing the answer/i, { timeout: 30_000 });
        await snap(page, 'live-status');
        t.check('hq shows the live status line in the session', !!seen);
      }
      await cmd(rex, { type: 'run.settle', runId, state: 'done', summary: 'answered' });
      const done = (await feedRows(H(ctx), 'runs', ctx.ws.id)).find((r) => r.id === runId);
      t.check('run.settle ends it (state done, ended_at)', done?.state === 'done' && !!done?.ended_at, { state: done?.state, ended: done?.ended_at });
    },
  },
  {
    id: 'replies',
    title: 'reply radar: queue reminders on a message, mark, clear (docs/31, design reply-radar)',
    async run(t, ctx) {
      // the queue hangs off a reply-ops card: the agent's ```nmreply block of reply opportunities
      const rex = agentActor(ctx, 'orchestrator');
      const { threadId } = await newThread(ctx, `R6 replies host ${ctx.tag}: find posts worth replying to.`);
      const row = (letter, n) => ({ letter, target: { handle: `r6user${n}`, url: `https://x.com/r6user${n}/status/${n}`, text: `a post about agents ${n}`, platform: 'x', source: 'web' }, draft: `R6 reply draft ${n} ${ctx.tag}`, why: 'on topic' });
      const card = `Two posts worth a reply.\n\n\`\`\`nmreply\n${JSON.stringify({ channel: ctx.ws.channelId, items: [row('A', 1), row('B', 2)] })}\n\`\`\``;
      const posted = await api('POST', '/v1/messages', { as: rex, body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, threadId, body: card } });
      const messageId = posted?.message?.id;
      t.check('an agent posts a reply-ops card (an nmreply block)', !!messageId, posted?.message?.id);
      const q = await refusal(cmd(H(ctx), { type: 'reply.queue', message: messageId, letters: ['a', 'b'], gapMin: 5, startAt: new Date(Date.now() + 3_600_000).toISOString() }));
      const rows = (await feedRows(H(ctx), 'reply_reminders', ctx.ws.id)).filter((r) => r.message_id === messageId);
      t.check('reply.queue schedules reminders on the message', q === 'ok' && rows.length >= 1, { q, rows: rows.map((r) => ({ letter: r.letter, state: r.state, due: r.due_at })) });
      if (rows[0]) {
        const m = await refusal(cmd(H(ctx), { type: 'reply.mark', reminder: rows[0].id, state: 'posted' }));
        t.check('reply.mark records a posted reply', m === 'ok' && (await feedRows(H(ctx), 'reply_reminders', ctx.ws.id)).find((r) => r.id === rows[0].id)?.state === 'posted', m);
      }
      const c = await refusal(cmd(H(ctx), { type: 'reply.clear', message: messageId }));
      t.check('reply.clear clears the rest', c === 'ok', c);
    },
  },
  {
    id: 'whiteboards',
    title: 'whiteboards: an agent draws one, the human edits it in hq (docs/38)',
    async run(t, ctx) {
      const rex = agentActor(ctx, 'orchestrator');
      const made = await cmd(rex, { type: 'whiteboard.create', channel: ctx.ws.channelId, title: `R6 board ${ctx.tag}`, mermaid: 'flowchart LR\n  A[Plan] --> B[Build] --> C[Ship]' });
      const wbId = made?.whiteboardId ?? made?.id ?? made?.whiteboard?.id;
      const wb = await until('the whiteboard row', async () => (await feedRows(H(ctx), 'whiteboards', ctx.ws.id)).find((w) => w.title === `R6 board ${ctx.tag}`), { timeout: 20_000 }).catch(() => null);
      t.check('whiteboard.create (the agent tool\'s command) makes a board', !!wb, wb ? { id: wb.id, rev: wb.rev, source: (wb.source ?? '').slice(0, 60) } : made);
      if (!wb) return;
      const upd = await refusal(cmd(rex, { type: 'whiteboard.update', whiteboardId: wb.id, baseRev: Number(wb.rev), mermaid: 'flowchart LR\n  A[Plan] --> B[Build] --> C[Test] --> D[Ship]' }));
      const wb2 = (await feedRows(H(ctx), 'whiteboards', ctx.ws.id)).find((w) => w.id === wb.id);
      t.check('whiteboard.update revises it (rev moves on)', upd === 'ok' && Number(wb2?.rev) > Number(wb.rev), { upd, rev: wb2?.rev });
      t.check('a stale baseRev is refused', /CONFLICT|STALE|REV/.test(await refusal(cmd(rex, { type: 'whiteboard.update', whiteboardId: wb.id, baseRev: Number(wb.rev), title: 'stale' }))));
      // the human's edit is hq's own lane: PATCH /v1/whiteboards/:id with the scene's rev (LWW)
      const patched = await api('PATCH', `/v1/whiteboards/${wb.id}`, { as: H(ctx), body: { rev: Number(wb2?.rev ?? wb.rev) + 1, title: `R6 board edited ${ctx.tag}` } });
      t.check('the human\'s edit lands (PATCH /v1/whiteboards/:id)', patched?.applied === true, patched);
      // a board born in hq: POST /v1/whiteboards, the New board path
      const id = randomUUID();
      const born = await api('POST', '/v1/whiteboards', { as: H(ctx), body: { id, workspace: ctx.ws.id, channel: ctx.ws.channelId, title: `R6 hq board ${ctx.tag}`, scene: JSON.stringify({ type: 'excalidraw', elements: [] }), rev: 1 } }).catch((e) => ({ error: e.message }));
      t.check('a person makes a board (POST /v1/whiteboards)', !born?.error, born);
      if (ctx.a.page) {
        const page = ctx.a.page;
        await goView(page, 'Whiteboards');
        const listed = await seeText(page, new RegExp(`R6 board edited ${ctx.tag}`), { timeout: 30_000 });
        await snap(page, 'whiteboards');
        t.check('hq\'s Whiteboards lists the board with the human\'s title', !!listed);
        await page.getByText(`R6 board edited ${ctx.tag}`).first().click({ timeout: 10_000 }).catch(() => {});
        const canvas = await page.locator('.excalidraw, svg, canvas').first().waitFor({ timeout: 30_000 }).then(() => true).catch(() => false);
        await snap(page, 'whiteboard-open');
        t.check('opening it renders the canvas', canvas);
        await page.keyboard.press('Escape').catch(() => {});
      }
    },
  },
  {
    id: 'files-deliverables',
    title: 'files and deliverables: a doc, an attachment, the library, promote, download (docs/30, workspace-files)',
    async run(t, ctx) {
      const rex = agentActor(ctx, 'orchestrator');
      const doc = await refusal(cmd(rex, { type: 'artifact.create', channel: ctx.ws.channelId, kind: 'doc', name: `r6-brief-${ctx.tag}.md`, inlineContent: `# R6 brief\n\nThe deliverable ${ctx.tag}.`, tags: ['brand'] }));
      const arts = await feedRows(H(ctx), 'artifacts', ctx.ws.id);
      const a = arts.find((x) => x.name === `r6-brief-${ctx.tag}.md`);
      t.check('an agent writes a doc deliverable (artifact.create)', doc === 'ok' && !!a, { doc, row: a ? { id: a.id, kind: a.kind, tags: a.tags, promoted: a.promoted } : null });
      // an attachment, as hq's composer uploads one with its message
      const messageId = randomUUID();
      const threadId = randomUUID();
      const attId = randomUUID();
      await api('POST', '/v1/messages', { as: H(ctx), body: { id: messageId, workspace: ctx.ws.id, channel: ctx.ws.channelId, threadId, body: `R6 attachment ${ctx.tag}` } });
      const att = await refusal(api('POST', '/v1/artifacts', { as: H(ctx), body: { id: attId, workspace: ctx.ws.id, channel: ctx.ws.channelId, messageId, kind: 'file', name: `r6-notes-${ctx.tag}.txt`, mime: 'text/plain', inlineContent: `notes ${ctx.tag}`, sizeBytes: 20 } }));
      const row = (await feedRows(H(ctx), 'artifacts', ctx.ws.id)).find((x) => x.id === attId);
      t.check('a person attaches a file to a message (POST /v1/artifacts)', att === 'ok' && row?.message_id === messageId, { att, row: row ? { kind: row.kind, mime: row.mime, size: row.size_bytes } : null });
      if (a) {
        await cmd(H(ctx), { type: 'artifact.promote', artifactId: a.id });
        t.check('artifact.promote puts the doc in the library', Number((await feedRows(H(ctx), 'artifacts', ctx.ws.id)).find((x) => x.id === a.id)?.promoted) === 1);
      }
      // the brain lane: a thread's artifact in GCS, uploaded and read back (NM_BRAIN_GCS_BUCKET)
      const bid = randomUUID();
      const up = await api('POST', '/v1/brain/artifacts', { as: H(ctx), body: { workspace: ctx.ws.id, threadId, id: bid, name: `r6-brain-${ctx.tag}.md`, mime: 'text/markdown', contentBase64: Buffer.from(`brain ${ctx.tag}`).toString('base64') } }).catch((e) => ({ error: e.message, status: e.status }));
      t.check('a thread artifact uploads to the brain store in GCS (POST /v1/brain/artifacts)', !up?.error, up);
      const listed = await api('GET', `/v1/brain/threads/${threadId}/artifacts?workspace=${ctx.ws.id}`, { as: H(ctx) }).catch((e) => ({ error: e.message }));
      t.check('the thread lists it', JSON.stringify(listed).includes(bid), JSON.stringify(listed).slice(0, 300));
      if (!up?.error) {
        const res = await api('GET', `/v1/brain/artifacts/${bid}?workspace=${ctx.ws.id}`, { as: H(ctx), raw: true });
        const body = await res.text();
        t.check('the brain artifact downloads with its bytes', res.status === 200 && body.includes(`brain ${ctx.tag}`), { status: res.status, bytes: body.length });
        t.note({ disposition: res.headers.get('content-disposition'), etag: res.headers.get('etag') });
      }
      if (ctx.a.page) {
        const page = ctx.a.page;
        await goView(page, 'Files');
        // the Files home lists projects; its search box finds a file across the workspace
        const search = page.getByPlaceholder(/search every file/i).first();
        await search.fill(`r6-brief-${ctx.tag}`).catch(() => {});
        const seen = await seeText(page, new RegExp(`r6-brief-${ctx.tag}`), { timeout: 30_000 });
        await snap(page, 'files');
        t.check('hq\'s Files lists the deliverable', !!seen);
        if (seen) {
          // the hit row toggles its preview. Use the row's keyboard path: a click at the row's
          // middle can land on its room link, which opens the room instead
          const row = page.locator('.wftable .wftr').first();
          await row.focus({ timeout: 10_000 }).catch(() => {});
          await row.press('Enter').catch(() => {});
          const opened = await seeText(page, new RegExp(`The deliverable ${ctx.tag}`), { timeout: 20_000 });
          await snap(page, 'file-open');
          t.check('opening it shows its content', !!opened);
        }
      }
    },
  },
  {
    id: 'routine-rows',
    title: 'routines as rows: arm, edit, pause, resume, run now, delete; hq\'s Routines tab (design routine-*)',
    async run(t, ctx) {
      const at = new Date(Date.now() + 3 * 3_600_000).toISOString();
      const made = await cmd(H(ctx), { type: 'schedule.create', channel: ctx.ws.channelId, title: `R6 routine ${ctx.tag}`, prompt: 'Post one line that says the routine ran.', cadence: 'once', runAt: at, tz: 'UTC', agent: 'rex', routine: true }).catch(async (e) => {
        t.note(`schedule.create with routine:true refused (${e?.json?.code ?? e.message}): retrying without it`);
        return cmd(H(ctx), { type: 'schedule.create', channel: ctx.ws.channelId, title: `R6 routine ${ctx.tag}`, prompt: 'Post one line that says the routine ran.', cadence: 'once', runAt: at, tz: 'UTC', agent: 'rex' });
      });
      const s = await until('the schedule row', async () => (await feedRows(H(ctx), 'schedules', ctx.ws.id)).find((x) => x.title === `R6 routine ${ctx.tag}`), { timeout: 20_000 }).catch(() => null);
      t.check('schedule.create arms a routine', !!s && s.status === 'active' && !!s.next_run_at, s ? { id: s.id, status: s.status, next: s.next_run_at, cadence: s.cadence } : made);
      if (!s) return;
      await cmd(H(ctx), { type: 'schedule.update', schedule: s.id, title: `R6 routine edited ${ctx.tag}`, prompt: 'Post one line.', cadence: 'daily', atTime: '09:30', tz: 'UTC' });
      const s2 = (await feedRows(H(ctx), 'schedules', ctx.ws.id)).find((x) => x.id === s.id);
      t.check('schedule.update moves it to daily 09:30', s2?.cadence === 'daily' && s2?.at_time?.startsWith('09:30'), { cadence: s2?.cadence, at: s2?.at_time, next: s2?.next_run_at });
      await cmd(H(ctx), { type: 'schedule.set_status', schedule: s.id, status: 'paused' });
      t.check('pause', (await feedRows(H(ctx), 'schedules', ctx.ws.id)).find((x) => x.id === s.id)?.status === 'paused');
      await cmd(H(ctx), { type: 'schedule.set_status', schedule: s.id, status: 'active' });
      if (ctx.a.page) {
        const page = ctx.a.page;
        await goView(page, 'Automations');
        const seen = await seeText(page, new RegExp(`R6 routine edited ${ctx.tag}`), { timeout: 30_000 });
        await snap(page, 'routines');
        t.check('hq\'s Automations › Routines lists it', !!seen);
      }
      await cmd(H(ctx), { type: 'schedule.delete', schedule: s.id });
      t.check('schedule.delete removes it', !(await feedRows(H(ctx), 'schedules', ctx.ws.id)).find((x) => x.id === s.id && x.status !== 'deleted'));
    },
  },
  {
    id: 'content-calendar',
    title: 'content and the calendar: a draft, approve to a slot, edit, unschedule, delete (marketing OS)',
    async run(t, ctx) {
      const mk = ctx.ws.channels.find((c) => c.slug === 'marketing') ?? { id: ctx.ws.channelId };
      const marketer = ctx.ws.agents.find((a) => a.role === 'marketer') ? agentActor(ctx, 'marketer') : agentActor(ctx, 'orchestrator');
      const { threadId } = await newThread(ctx, `R6 content host ${ctx.tag}`);
      const made = await cmd(marketer, { type: 'content.create', channel: mk.id, thread: threadId, platform: 'x', body: `R6 post ${ctx.tag}: shipping on Cloud Run.` });
      const item = await until('the content row', async () => (await feedRows(H(ctx), 'content_items', ctx.ws.id)).find((c) => (c.body ?? '').includes(`R6 post ${ctx.tag}`)), { timeout: 20_000 }).catch(() => null);
      t.check('an agent drafts a post (content.create)', !!item, item ? { id: item.id, status: item.status, platform: item.platform } : made);
      if (!item) return;
      const slot = new Date(Date.now() + 2 * 86_400_000).toISOString();
      await cmd(H(ctx), { type: 'content.approve', item: item.id, scheduledAt: slot });
      const i2 = (await feedRows(H(ctx), 'content_items', ctx.ws.id)).find((c) => c.id === item.id);
      t.check('the human approves it to a slot (scheduled)', /scheduled|approved/.test(i2?.status ?? '') && !!i2?.scheduled_at, { status: i2?.status, at: i2?.scheduled_at });
      await cmd(H(ctx), { type: 'content.update', item: item.id, body: `R6 post edited ${ctx.tag}` });
      t.check('content.update edits it', (await feedRows(H(ctx), 'content_items', ctx.ws.id)).find((c) => c.id === item.id)?.body === `R6 post edited ${ctx.tag}`);
      if (ctx.a.page) {
        const page = ctx.a.page;
        await goView(page, 'Automations');
        await page.getByRole('tab', { name: 'Calendar' }).click({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(2_000);
        const text = await seeText(page, new RegExp(`R6 post edited ${ctx.tag}|R6 post`), { timeout: 20_000 });
        await snap(page, 'calendar');
        t.check('hq\'s Calendar shows the scheduled post', !!text);
      }
      await cmd(H(ctx), { type: 'content.unschedule', item: item.id });
      t.check('content.unschedule takes it off the calendar', !(await feedRows(H(ctx), 'content_items', ctx.ws.id)).find((c) => c.id === item.id)?.scheduled_at || (await feedRows(H(ctx), 'content_items', ctx.ws.id)).find((c) => c.id === item.id)?.status !== 'scheduled');
      await cmd(H(ctx), { type: 'content.delete', item: item.id });
      t.note('publishing to X, LinkedIn, Instagram or TikTok needs the social OAuth apps and the /internal/publish-due cron (not wired on Cloud Run)');
    },
  },
  {
    id: 'setup-flows',
    title: 'setup flows: the marketing setup, step by step (docs/39)',
    async run(t, ctx) {
      const mk = ctx.ws.channels.find((c) => c.slug === 'marketing');
      if (!mk) t.skip('no #marketing room');
      const s1 = await refusal(cmd(H(ctx), { type: 'setup.step', channel: mk.id, flow: 'marketing.v1', step: 'product', value: 'https://example.com' }));
      t.check('setup.step records a step of the marketing flow', s1 === 'ok', s1);
      const s2 = await refusal(cmd(H(ctx), { type: 'marketing.setup', channel: mk.id, website: 'https://example.com', focus: ['social', 'content'], goal: 'prove the suite' }));
      t.check('marketing.setup saves the room\'s marketing profile', s2 === 'ok', s2);
      const ch = (await feedRows(H(ctx), 'channels', ctx.ws.id)).find((c) => c.id === mk.id);
      t.check('the room carries its marketing profile', /example\.com/.test(ch?.marketing ?? ''), ch?.marketing);
      if (ctx.a.page) {
        const page = ctx.a.page;
        await goView(page, 'Marketing OS');
        await page.waitForTimeout(2_000);
        await snap(page, 'marketing-os');
        const seen = await seeText(page, /marketing/i, { timeout: 10_000 });
        t.check('hq\'s Marketing OS opens', !!seen);
      }
    },
  },
  {
    id: 'connectors-policies',
    title: 'connectors where no social app exists, and agent policies (design connectors, agent-instructions)',
    async run(t, ctx) {
      const x = await api('GET', `/v1/x/search?workspace=${ctx.ws.id}&q=neuramesh`, { as: H(ctx), raw: true });
      t.check('X search reports NOT_CONFIGURED, never a crash', x.status === 501, x.status);
      const pol = await refusal(cmd(H(ctx), { type: 'policy.set', workspace: ctx.ws.id, scope: 'workspace', capability: 'net.egress', selector: { kind: 'host', glob: '*.example.com' }, verdict: 'deny', rationale: 'the suite' }));
      const rows = await feedRows(H(ctx), 'policies', ctx.ws.id);
      t.check('policy.set writes a workspace policy', pol === 'ok' && rows.length > 0, { pol, rows: rows.map((r) => `${r.capability}:${r.verdict}`) });
      if (rows[0]) t.check('policy.delete removes it', (await refusal(cmd(H(ctx), { type: 'policy.delete', workspace: ctx.ws.id, policyId: rows[0].id }))) === 'ok');
      t.blocked('social OAuth (X, Meta, LinkedIn, TikTok) and PostHog need their app credentials on nm-api (X_CLIENT_ID and friends): connect, post and read are not testable here. The NOT_CONFIGURED answers above are the disabled state');
    },
  },
];
