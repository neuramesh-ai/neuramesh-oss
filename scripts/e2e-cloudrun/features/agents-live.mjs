// LIVE AGENT TURNS (matrix sections C, T, K, B, S, R): the crew on the starter brain (gemini
// flash-lite through nm-api's metered proxy), on the workspace's Cloud Run runner. Each scenario
// asks for one thing in plain words and asserts the row the agent's tool writes, not the prose.
// A model can miss: every ask gets one retry, and the report says which attempt landed.
import { randomUUID } from 'node:crypto';
import { agentActor, api, cmd, door, escapeRe, feedRows, goView, refusal, replica, seeText, sleep, snap, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;
const REFUSAL = /not logged in|please run \/login|cannot run|```nmauth|starter brain is not|out of credits/i;

/** post as person A in a thread (new unless given) and wait for an agent's answer in it */
async function ask(ctx, words, { threadId = randomUUID(), channel = ctx.ws.channelId, timeout = 240_000 } = {}) {
  const sent = await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel, threadId, body: words } });
  const since = new Date(Date.now() - 5_000).toISOString();
  const reply = await until('an agent reply in the thread', async () => {
    const rows = await feedRows(H(ctx), 'messages', ctx.ws.id);
    return rows.filter((m) => m.thread_id === threadId && m.author_kind === 'agent' && m.created_at > (sent?.message?.createdAt ?? since)).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))[0] ?? null;
  }, { timeout, every: 4_000 }).catch(() => null);
  return { threadId, messageId: sent?.message?.id, reply };
}

/** ask, then ask again in the same thread when the check on the world fails */
async function askUntil(t, ctx, words, check, { retryWords, timeout = 240_000, settle = 20_000 } = {}) {
  const first = await ask(ctx, words, { timeout });
  let got = first.reply ? await until('the agent\'s effect', check, { timeout: settle, every: 3_000 }).catch(() => null) : null;
  if (got) return { attempt: 1, ...first, got };
  t.note({ firstAttempt: { reply: first.reply?.body?.slice(0, 300) ?? null } });
  const second = await ask(ctx, retryWords ?? words, { threadId: first.threadId, timeout });
  got = second.reply ? await until('the agent\'s effect', check, { timeout: settle + 20_000, every: 3_000 }).catch(() => null) : null;
  return { attempt: got ? 2 : 0, ...second, got };
}

export const agentsLive = [
  {
    id: 'agent-reply-ui',
    title: 'a new session from hq\'s composer, and rex answers on the starter brain (docs/34, 35)',
    needs: ['browser', 'model'],
    async run(t, ctx) {
      const page = ctx.a.page;
      // start from the workspace's default project: an earlier scenario's pick must not decide
      // which project (and so which room) the home composer sends into
      await page.evaluate(() => localStorage.removeItem('nm:activeProject')).catch(() => {});
      await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}`, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /^Chat$/ }).first().click({ timeout: 5_000 }).catch(() => {});
      await page.getByRole('button', { name: /^new session/i }).first().click({ timeout: 10_000 }).catch(() => {});
      const box = page.locator('textarea:visible').first();
      await box.waitFor({ timeout: 30_000 });
      const nonce = `kiwi-${ctx.tag}`;
      const words = `@rex reply with one short sentence that contains the word ${nonce}.`;
      await box.fill(words);
      await box.press('End');
      await box.press('Enter');
      await page.waitForTimeout(1_500);
      if ((await box.inputValue()).trim()) await box.press('Enter');
      const mine = await until('the send in the replica', async () => (await replica(page, "SELECT id, thread_id, created_at FROM messages WHERE author_kind = 'human' AND body = ? LIMIT 1", [words]))?.[0], { timeout: 30_000 }).catch(() => null);
      t.check('the composer send lands in a new session', !!mine?.thread_id, mine);
      if (!mine) return;
      const reply = await until('rex\'s reply on the page', async () => (await replica(page, "SELECT body, created_at FROM messages WHERE author_kind = 'agent' AND thread_id = ? AND created_at > ? ORDER BY created_at LIMIT 1", [mine.thread_id, mine.created_at]))?.[0], { timeout: 300_000, every: 3_000 }).catch(() => null);
      t.check('rex answers in the same session, and the page shows it', !!reply && !REFUSAL.test(reply.body ?? ''), reply ? { body: reply.body.slice(0, 200) } : null);
      t.check('the answer carries the word asked for', (reply?.body ?? '').includes(nonce));
      const shown = await seeText(page, new RegExp(escapeRe(nonce)), { timeout: 20_000 });
      await snap(page, 'agent-reply');
      t.check('the reply is visible in the transcript', !!shown);
      ctx.liveThread = mine.thread_id;
    },
  },
  {
    id: 'agent-creates-task',
    title: 'rex files a task on the board with its tool, and the board shows it (docs/03, 41)',
    needs: ['model'],
    async run(t, ctx) {
      const title = `R6 agent task ${ctx.tag}`;
      const r = await askUntil(t, ctx, `@rex please create a task on the board titled exactly "${title}" with the description "made by rex". Use your create task tool. No questions, just file it.`,
        async () => (await feedRows(H(ctx), 'tasks', ctx.ws.id)).find((x) => (x.title ?? '').includes(title)));
      t.check('rex replies', !!r.reply, r.reply?.body?.slice(0, 200));
      t.check('a task row with that title exists, authored by an agent', !!r.got && r.got.creator_kind === 'agent', r.got ? { number: r.got.number, state: r.got.state, creator: r.got.creator_kind, plan: !!r.got.work_plan, attempt: r.attempt } : { reply: r.reply?.body?.slice(0, 300) });
      if (r.got && ctx.a.page) {
        await goView(ctx.a.page, 'Tasks');
        const seen = await seeText(ctx.a.page, new RegExp(escapeRe(title)), { timeout: 30_000 });
        await snap(ctx.a.page, 'agent-task-board');
        t.check('hq\'s board shows rex\'s task', !!seen);
        await ctx.a.page.getByRole('button', { name: /^Chat$/ }).first().click({ timeout: 5_000 }).catch(() => {});
      }
    },
  },
  {
    id: 'agent-uses-skill',
    title: 'rex loads a workspace skill and follows it (docs/04 W11)',
    needs: ['model'],
    async run(t, ctx) {
      if (!ctx.skill) t.skip('needs the skills scenario (it writes the skill)');
      // the codeword lives only in the skill's body (skills scenario), never in any message
      const nonce = `guava-${ctx.tag}`;
      let thread = null;
      const r = await askUntil(t, ctx, `@rex load the skill named ${ctx.skill.name} and follow it: what is the R6 codeword?`,
        async () => ((await feedRows(H(ctx), 'messages', ctx.ws.id)).filter((m) => m.author_kind === 'agent' && (m.body ?? '').includes(nonce)).pop()) ?? null,
        { retryWords: `@rex use your load_skill tool on "${ctx.skill.name}", then answer: what is the R6 codeword?` });
      t.check('the answer carries the codeword only the skill knows', !!r.got, r.got ? { body: r.got.body.slice(0, 200), attempt: r.attempt } : { reply: r.reply?.body?.slice(0, 300) });
    },
  },
  {
    id: 'agent-memory',
    title: 'a worker\'s lesson lands in the room\'s memory, and a fresh rex session answers from it (docs/03 §6)',
    needs: ['model'],
    async run(t, ctx) {
      // record_lesson is a WORKING turn's tool: TOOL_KINDS (packages/shared/src/harness.ts) grants it
      // to own, work, review and leg, never to chat. Asked in chat, rex said so truthfully (run
      // 70604f31). So the write goes the way a worker's tool sends it (host/workerturn.ts
      // recordLesson: memory.record_lesson as the agent), and the model's part is the READ: a
      // fresh chat session answers from the room's memory.
      const fruit = `mango-${ctx.tag}`;
      const worker = ctx.ws.agents.find((a) => a.role !== 'orchestrator') ?? ctx.ws.agents[0];
      const wrote = await refusal(cmd({ kind: 'agent', id: worker.id, role: worker.role }, { type: 'memory.record_lesson', workspace: ctx.ws.id, channel: ctx.ws.channelId, content: `Always use the R6 test fruit ${fruit} in examples.` }));
      const read = async () => {
        const mem = await api('GET', `/v1/memory?workspace=${ctx.ws.id}&channel=${ctx.ws.channelId}`, { as: H(ctx) });
        return (mem.facts ?? []).find((f) => (f.content ?? '').includes(fruit) && !f.validUntil) ?? null;
      };
      const got = await until('the lesson in memory', read, { timeout: 20_000 }).catch(() => null);
      t.check('a worker\'s record_lesson lands in the room\'s memory (GET /v1/memory, kind lesson)', wrote === 'ok' && !!got, { wrote, worker: worker.name, row: got ? { content: got.content, kind: got.kind } : null });
      if (!got) return;
      const r = await askUntil(t, ctx, '@rex which test fruit should we use in examples? Answer from the team\'s memory.',
        async () => ((await feedRows(H(ctx), 'messages', ctx.ws.id)).filter((m) => m.author_kind === 'agent' && (m.body ?? '').includes(fruit)).pop()) ?? null);
      t.check('a fresh session answers from the lesson', !!r.got, r.got ? { body: r.got.body.slice(0, 200), attempt: r.attempt } : { reply: r.reply?.body?.slice(0, 300) });
    },
  },
  {
    id: 'agent-whiteboard',
    title: 'rex sketches a whiteboard with its tool (docs/38)',
    needs: ['model'],
    async run(t, ctx) {
      const title = `R6 agent board ${ctx.tag}`;
      const r = await askUntil(t, ctx, `@rex sketch a whiteboard titled "${title}" that shows three boxes: plan, build, ship. Use your whiteboard tool.`,
        async () => (await feedRows(H(ctx), 'whiteboards', ctx.ws.id)).find((w) => (w.title ?? '').includes(title) && w.created_by_kind === 'agent'));
      t.check('a whiteboard row from the agent exists', !!r.got, r.got ? { title: r.got.title, rev: r.got.rev, attempt: r.attempt } : { reply: r.reply?.body?.slice(0, 300) });
    },
  },
  {
    id: 'routine-fires',
    title: 'a routine armed a minute ahead fires on the runner and its agent posts (routines, docs/29)',
    needs: ['model'],
    async run(t, ctx) {
      const word = `papaya-${ctx.tag}`;
      const runAt = new Date(Date.now() + 90_000).toISOString();
      await cmd(H(ctx), { type: 'schedule.create', channel: ctx.ws.channelId, title: `R6 firing ${ctx.tag}`, prompt: `Post one short sentence that contains the word ${word}.`, cadence: 'once', runAt, tz: 'UTC', agent: 'rex', routine: true });
      const s = await until('the schedule row', async () => (await feedRows(H(ctx), 'schedules', ctx.ws.id)).find((x) => x.title === `R6 firing ${ctx.tag}`), { timeout: 20_000 });
      t.check('a once routine is armed for 90 s from now', !!s?.next_run_at, { next: s?.next_run_at });
      const m = await door.machine(ctx.ws.runner);
      t.note({ runner: { desired: m.desired_replicas, drain: m.drain_state, lastSeen: m.last_seen_at } });
      const fired = await until('the routine\'s post', async () => {
        const rows = await feedRows(H(ctx), 'messages', ctx.ws.id);
        return rows.find((x) => x.schedule_id === s.id && x.author_kind === 'agent' && (x.body ?? '').includes(word)) ?? rows.find((x) => x.author_kind === 'agent' && (x.body ?? '').includes(word));
      }, { timeout: 420_000, every: 5_000 }).catch(() => null);
      const after = (await feedRows(H(ctx), 'schedules', ctx.ws.id)).find((x) => x.id === s.id);
      t.check('the routine fired: run_count moved and last_run_at is set', Number(after?.run_count) >= 1 && !!after?.last_run_at, { runCount: after?.run_count, lastRun: after?.last_run_at, status: after?.status, lastError: after?.last_error });
      t.check('its agent posted the word in the routine\'s thread', !!fired, fired ? { thread: fired.thread_id, schedule: fired.schedule_id, body: fired.body.slice(0, 200) } : null);
      // run now: the same routine fired again on demand
      ctx.firingSchedule = s.id;
    },
  },
  {
    id: 'stall-watchdog',
    title: 'the stall watchdog: human feedback left on a review gate gets rex\'s nudge (docs/19)',
    needs: ['model'],
    async run(t, ctx) {
      // armed early by stall-arm (below); this half only reads what rex did since
      const armed = ctx.stall;
      if (!armed) t.skip('needs stall-arm');
      const designerId = ctx.ws.agents.find((a) => a.role === 'designer')?.id;
      const rexId = ctx.ws.agents.find((a) => a.role === 'orchestrator')?.id;
      const wait = Math.max(0, armed.at + 16 * 60_000 - Date.now());
      t.note(`waiting ${Math.round(wait / 1000)} s so the feedback is 10 min old and a 5-minute sweep has passed`);
      if (wait) await sleep(wait);
      const look = async () => {
        const msgs = (await feedRows(H(ctx), 'messages', ctx.ws.id)).filter((m) => m.task_id === armed.taskId && m.author_kind === 'agent' && m.created_at > armed.feedbackAt);
        const decs = (await feedRows(H(ctx), 'decisions', ctx.ws.id)).filter((d) => d.task_id === armed.taskId && d.created_at > armed.feedbackAt);
        const arts = (await feedRows(H(ctx), 'artifacts', ctx.ws.id)).filter((a) => a.task_id === armed.taskId && a.kind === 'design');
        return { rex: msgs.filter((m) => m.author_id === rexId).map((m) => m.body.slice(0, 200)), designer: msgs.filter((m) => m.author_id === designerId).map((m) => m.body.slice(0, 120)), decisions: decs.map((d) => d.question), rounds: arts.length };
      };
      let seen = await look();
      if (!seen.rex.length && !seen.decisions.length) seen = await until('rex\'s stall notice', async () => { const s = await look(); return s.rex.length || s.decisions.length ? s : null; }, { timeout: 8 * 60_000, every: 15_000 }).catch(() => seen);
      t.note(seen);
      if (!seen.rex.length && !seen.decisions.length && (seen.designer.length || seen.rounds > 1)) {
        t.skip('the designer answered the feedback itself (the task-thread wake), so nothing stalled: the watchdog had nothing to report');
      }
      t.check('rex posts the stall notice (a nudge in the task thread or a Needs-you card)', seen.rex.length > 0 || seen.decisions.length > 0, seen);
    },
  },
];

/** the stall watchdog's setup, run early: a design in review, human feedback in its thread, no verdict */
export const stallArm = {
  id: 'stall-arm',
  title: 'arm the stall watchdog: a design waits in review with human feedback (docs/19)',
  async run(t, ctx) {
    const designer = agentActor(ctx, 'designer');
    const task = (await cmd(H(ctx), { type: 'task.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, title: `R6 stall ${ctx.tag}` })).task;
    await cmd(H(ctx), { type: 'task.request_design', taskId: task.id, kind: 'design' });
    await cmd(designer, { type: 'task.propose_design', taskId: task.id, round: 1, mockups: [{ name: 'home', html: '<h1>R6 stall</h1>' }] });
    const fb = await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, taskId: task.id, body: 'Feedback: make the title blue. (left by the R6 suite, please do not act on it before the watchdog does)' } });
    ctx.stall = { taskId: task.id, at: Date.now(), feedbackAt: fb?.message?.createdAt ?? new Date().toISOString() };
    t.check('a design sits in review with fresh human feedback', !!fb?.message?.id, ctx.stall);
  },
};
