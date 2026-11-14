// THE r7 UPSTREAM FEATURES (the 2026-11-03 NeuraMesh snapshot): thread permission modes and Auto
// Review, the Agent Desk (team homes and agent-to-agent requests), thread follow-ups, project-owned
// work, and coding-task progress in the parent agent's thread. Each scenario writes the way hq or a
// machine writes (the same routes, as the same person or agent) and reads the rows back.
import { randomUUID } from 'node:crypto';
import { agentActor, api, cmd, door, feedRows, goView, refusal, seeText, sleep, snap, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;
const code = (e) => e?.json?.code ?? (e?.status ? `HTTP ${e.status}` : String(e?.message ?? e).slice(0, 80));
const tryApi = (...a) => api(...a).then((r) => ({ ok: true, r }), (e) => ({ ok: false, code: code(e), status: e?.status }));

/** the workspace's default project and its context room */
async function defaultProject(ctx) {
  const p = (await feedRows(H(ctx), 'projects', ctx.ws.id)).find((x) => Number(x.is_default) === 1 || x.is_default === true);
  return p ? { id: p.id, channelId: p.context_channel_id ?? ctx.ws.channelId } : null;
}

/** a fresh human session in a room: its thread is created by the first message */
async function newSession(ctx, words, channel = ctx.ws.channelId) {
  const threadId = randomUUID();
  await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel, threadId, body: words } });
  return threadId;
}

/** the Agent Desk homes of a project (one thread per teammate), opened as the person */
async function openDesk(ctx, projectId) {
  return api('POST', '/v1/team/open', { as: H(ctx), body: { workspace: ctx.ws.id, projectId } });
}

export const r7 = [
  {
    id: 'permission-modes',
    title: 'thread permission modes: the workspace default (Auto Review), a thread override, who may choose (upstream 0170, 0171)',
    async run(t, ctx) {
      const ws = ctx.ws.id;
      const def = await api('GET', `/v1/permissions?workspace=${ws}`, { as: H(ctx) });
      t.check('the workspace default is Auto Review (0171)', def.workspaceMode === 'auto-review', def);
      t.note({ runtimeReady: def.runtimeReady });
      const threadId = await newSession(ctx, `R7 permissions ${ctx.tag}: a session to set a mode on (no reply needed)`);
      ctx.r7Thread = threadId;
      const before = await until('the thread row', async () => (await tryApi('GET', `/v1/permissions?workspace=${ws}&threadId=${threadId}`, { as: H(ctx) })).r ?? null, { timeout: 30_000, every: 2_000 }).catch(() => null);
      t.check('a new thread follows the workspace default (no override)', before?.threadMode == null && before?.workspaceMode === 'auto-review', before);
      const set = await tryApi('POST', '/v1/permissions', { as: H(ctx), body: { workspace: ws, threadId, mode: 'request-review' } });
      t.check('the thread owner sets Request Review on the thread', set.ok && set.r.threadMode === 'request-review' && set.r.workspaceMode === 'auto-review', set.r ?? set);
      const agent = agentActor(ctx, 'orchestrator');
      const byAgent = await tryApi('POST', '/v1/permissions', { as: agent, body: { workspace: ws, threadId, mode: 'turbo' } });
      t.check('an agent cannot choose a permission mode (403)', !byAgent.ok && byAgent.status === 403, byAgent);
      if (ctx.b?.userId) {
        const stranger = await tryApi('GET', `/v1/permissions?workspace=${ws}&threadId=${threadId}`, { as: ctx.b.userId });
        t.check('a non-member cannot read the thread\'s mode', !stranger.ok, stranger);
      }
      const bad = await tryApi('POST', '/v1/permissions', { as: H(ctx), body: { workspace: ws, threadId, mode: 'yolo' } });
      t.check('an unknown mode is refused (400)', !bad.ok && bad.status === 400, bad);
      const turbo = await tryApi('POST', '/v1/permissions', { as: H(ctx), body: { workspace: ws, mode: 'turbo' } });
      const back = await tryApi('POST', '/v1/permissions', { as: H(ctx), body: { workspace: ws, mode: 'auto-review' } });
      t.check('the owner changes the workspace default and back', turbo.ok && turbo.r.workspaceMode === 'turbo' && back.ok && back.r.workspaceMode === 'auto-review', { turbo: turbo.r?.workspaceMode ?? turbo.code, back: back.r?.workspaceMode ?? back.code });
      if (ctx.a.page) {
        // the composer's permission chip (PermissionPicker.tsx, .perm-trigger) in the thread
        const page = ctx.a.page;
        await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}/c/${threadId}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        // the home stage keeps its own (hidden) chip mounted: take the thread composer's visible one
        const chip = page.locator('button.perm-trigger:visible').last();
        const label = await until('the chip names the mode', async () => { const l = await chip.getAttribute('aria-label', { timeout: 5_000 }).catch(() => null); return /Request Review/.test(l ?? '') ? l : null; }, { timeout: 45_000, every: 1_500 }).catch(() => chip.getAttribute('aria-label', { timeout: 2_000 }).catch(() => null));
        await snap(page, 'perm-chip');
        t.check('hq\'s thread composer shows the thread\'s mode on its permission chip', /Request Review/.test(label ?? ''), label);
        await chip.click({ timeout: 10_000 }).catch(() => {});
        await page.getByRole('menuitemradio', { name: /Auto Review/ }).first().click({ timeout: 10_000 }).catch(() => {});
        const picked = await until('the pick saved', async () => { const r = await api('GET', `/v1/permissions?workspace=${ws}&threadId=${threadId}`, { as: H(ctx) }); return r.threadMode === 'auto-review' ? r : null; }, { timeout: 20_000, every: 1_500 }).catch(() => null);
        await snap(page, 'perm-picked');
        t.check('choosing Auto Review in the chip\'s menu saves it on the thread', !!picked, picked);
      }
      // the Auto Review reviewer acts only on a tool call that would ask; the starter chat's tools
      // are workspace tools (permission-mode.ts workspaceTools), which never ask
      t.note('the Auto Review reviewer turn is not exercised: no starter-brain chat tool would ask');
    },
  },
  {
    id: 'agent-desk',
    title: 'the Agent Desk: one home thread per teammate, an agent asks a teammate, history, a fresh thread (upstream 0160)',
    async run(t, ctx) {
      const proj = await defaultProject(ctx);
      if (!proj) t.skip('no default project');
      const desk = await openDesk(ctx, proj.id);
      const homes = desk.homes ?? [];
      t.check('opening the desk gives each teammate a home thread in the project', homes.length >= 2 && homes.every((h) => h.home_agent_id && h.project_id === proj.id), { homes: homes.length, agents: homes.map((h) => h.home_agent_id?.slice(0, 8)) });
      const byAgent = await tryApi('POST', '/v1/team/open', { as: agentActor(ctx, 'orchestrator'), body: { workspace: ctx.ws.id, projectId: proj.id } });
      t.check('only a person opens the desk (an agent gets 403)', !byAgent.ok && byAgent.status === 403, byAgent);
      const again = await api('GET', `/v1/team?workspace=${ctx.ws.id}&projectId=${proj.id}`, { as: H(ctx) });
      t.check('GET /v1/team lists the same homes', (again.homes ?? []).length === homes.length, { homes: (again.homes ?? []).length });
      ctx.desk = { project: proj, homes };
      const nameOf = (id) => ctx.ws.agents.find((a) => a.id === id)?.name;
      const [src, dst] = homes;
      if (src && dst) {
        // the source home needs a human trigger: an agent request is a reply to its person
        await api('POST', '/v1/messages', { as: H(ctx), body: { workspace: ctx.ws.id, channel: src.channel_id, threadId: src.id, body: `R7 desk ${ctx.tag}: ask your teammate to note the word quince-${ctx.tag}. (suite: no action needed)` } });
        const asker = { kind: 'agent', id: src.home_agent_id, role: ctx.ws.agents.find((a) => a.id === src.home_agent_id)?.role };
        const id = randomUUID();
        const sent = await tryApi('POST', '/v1/team/message', { as: asker, body: { workspace: ctx.ws.id, threadId: src.id, targetThreadId: dst.id, id, body: `Please note the word quince-${ctx.tag}.` } });
        t.check(`${nameOf(src.home_agent_id) ?? 'a teammate'} asks ${nameOf(dst.home_agent_id)} through /v1/team/message`, sent.ok && sent.r.messageId === id, sent.r ?? sent);
        const hist = await api('GET', `/v1/team/history?workspace=${ctx.ws.id}&threadId=${dst.id}`, { as: H(ctx) });
        t.check('the request lands in the teammate\'s home thread (its history)', (hist.messages ?? []).some((m) => m.id === id && m.author_kind === 'agent'), { messages: (hist.messages ?? []).length });
        const human = await tryApi('POST', '/v1/team/message', { as: H(ctx), body: { workspace: ctx.ws.id, threadId: src.id, targetThreadId: dst.id, id: randomUUID(), body: 'x' } });
        t.check('the collaboration route is an agent\'s tool (a person gets 403)', !human.ok && human.status === 403, human);
        const self = await tryApi('POST', '/v1/team/message', { as: asker, body: { workspace: ctx.ws.id, threadId: src.id, targetThreadId: src.id, id: randomUUID(), body: 'x' } });
        t.check('an agent cannot send a request to its own home', !self.ok, self);
        const fresh = await tryApi('POST', '/v1/team/fresh', { as: H(ctx), body: { workspace: ctx.ws.id, projectId: proj.id, threadId: dst.id } });
        const nowDst = (fresh.r?.homes ?? []).find((h) => h.home_agent_id === dst.home_agent_id);
        t.check('a fresh thread replaces the teammate\'s home, and the old one stays in its history', fresh.ok && nowDst && nowDst.id !== dst.id, { fresh: fresh.ok ? 'ok' : fresh.code, newHome: nowDst?.id?.slice(0, 8), old: dst.id.slice(0, 8) });
        if (nowDst) ctx.desk.homes = fresh.r.homes;
      }
      if (ctx.a.page) {
        const page = ctx.a.page;
        await goView(page, 'Agent Desk');
        const section = page.locator('section[aria-label="Agent Desk"]');
        const shown = await section.waitFor({ state: 'visible', timeout: 30_000 }).then(() => true).catch(() => false);
        const names = homes.map((h) => nameOf(h.home_agent_id)).filter(Boolean);
        const named = shown ? await seeText(page, new RegExp(names.slice(0, 2).join('|')), { timeout: 20_000 }) : null;
        await snap(page, 'agent-desk');
        t.check('hq\'s Agent Desk shows the project team', shown && !!named, { shown, names });
        // DESK_THEMES=1: the same desk in each look, for the card styling review (round 8)
        if (shown && process.env.DESK_THEMES === '1') {
          const before = page.viewportSize();
          await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {});
          const look = async (theme, mode) => {
            await page.evaluate(([th, lk]) => { document.documentElement.dataset.theme = th; document.documentElement.dataset.look = lk; }, [theme, mode]);
            await page.waitForTimeout(700);
            await snap(page, `agent-desk-${theme}`);
          };
          for (const [theme, mode] of [['cream-oak', 'elevated'], ['light', 'elevated'], ['soft-dark', 'elevated'], ['dark', 'elevated'], ['paper-cream-oak', 'paper']]) await look(theme, mode);
          await page.evaluate(() => { document.documentElement.dataset.theme = 'cream-oak'; document.documentElement.dataset.look = 'elevated'; });
          const cards = section.locator('.teamdesk-card:not([hidden])');
          await cards.nth(0).locator('.teamdesk-cardtools button').first().click().catch(() => {});
          await cards.nth(1).locator('.teamdesk-cardtools button', { hasText: 'Connectors' }).click().catch(() => {});
          await cards.nth(0).locator('textarea').focus().catch(() => {});
          await page.waitForTimeout(800);
          await snap(page, 'agent-desk-cream-oak-panels');
          const sizes = await page.evaluate(() => {
            const card = document.querySelector('.teamdesk-card:not([hidden])');
            const style = (sel) => { const el = card?.querySelector(sel) ?? (sel === 'card' ? card : null); return el ? getComputedStyle(el) : null; };
            const c = card ? getComputedStyle(card) : null;
            return { cardBg: c?.backgroundColor, deskBg: getComputedStyle(document.querySelector('.teamdesk')).backgroundColor, cardShadow: c?.boxShadow, role: style('.teamdesk-identity > span')?.fontSize, tab: style('.teamdesk-cardtools button')?.fontSize, threadBg: style('.threadpanel')?.backgroundColor };
          });
          t.note({ deskStyle: sizes });
          t.check('cream-oak cards sit on their own elevated surface (card colour differs from the desk)', !!sizes.cardBg && sizes.cardBg !== sizes.deskBg && sizes.cardShadow !== 'none', sizes);
          if (before) await page.setViewportSize(before).catch(() => {});
        }
      }
    },
  },
  {
    id: 'thread-followups',
    title: 'thread follow-ups: queue, remove, steer, and the machine delivers it into the thread (upstream 0172)',
    async run(t, ctx) {
      const ws = ctx.ws.id;
      const threadId = ctx.r7Thread ?? await newSession(ctx, `R7 follow-ups ${ctx.tag}: a session for queued prompts`);
      // park the runner first: an awake machine claims a prompt on an idle thread at once, and the
      // remove below would then meet a delivery in flight (CONFLICT in c8af4201)
      if (ctx.ws.runner) {
        await door.idleDrain(ctx.ws.runner).catch(() => {});
        await until('the runner parked', async () => {
          const m = await door.machine(ctx.ws.runner).catch(() => null);
          return m && Number(m.desired_replicas) === 0 && !m.drain_state ? m : null;
        }, { timeout: 60_000, every: 2_000 }).catch(() => {});
      }
      const q1 = randomUUID();
      const put = await tryApi('POST', '/v1/thread-followups', { as: H(ctx), body: { workspace: ws, threadId, id: q1, body: `R7 queued ${ctx.tag} (remove me)` } });
      const row = Array.isArray(put.r) ? put.r[0] : put.r;
      t.check('a person queues a follow-up on a thread', put.ok && (row?.state === 'queued' || row?.id === q1), put.r ?? put);
      const listed = await api('GET', `/v1/thread-followups?workspace=${ws}&threadId=${threadId}`, { as: H(ctx) });
      t.check('the thread lists its queued prompt', JSON.stringify(listed).includes(q1), listed);
      const rm = await tryApi('POST', '/v1/thread-followups/action', { as: H(ctx), body: { workspace: ws, threadId, id: q1, action: 'remove' } });
      const after = await api('GET', `/v1/thread-followups?workspace=${ws}&threadId=${threadId}`, { as: H(ctx) });
      t.check('removing it takes it off the queue', rm.ok && !JSON.stringify(after).includes(q1), { rm: rm.ok ? 'ok' : rm.code });
      const byAgent = await tryApi('POST', '/v1/thread-followups', { as: agentActor(ctx, 'orchestrator'), body: { workspace: ws, threadId, id: randomUUID(), body: 'x' } });
      t.check('only a person queues a follow-up (an agent gets 403)', !byAgent.ok && byAgent.status === 403, byAgent);
      // delivery: the thread's machine claims a queued prompt when the thread is idle and posts it
      // as the person's message with the same id. Steer asks for it now and bumps the machine
      const q2 = randomUUID();
      const words = `R7 follow-up ${ctx.tag}: reply with the single word fig-${ctx.tag}.`;
      await tryApi('POST', '/v1/thread-followups', { as: H(ctx), body: { workspace: ws, threadId, id: q2, body: words } });
      const steer = await tryApi('POST', '/v1/thread-followups/action', { as: H(ctx), body: { workspace: ws, threadId, id: q2, action: 'steer' } });
      t.note({ steer: steer.ok ? 'ok' : steer.code });
      const delivered = await until('the follow-up delivered as a message', async () => (await feedRows(H(ctx), 'messages', ws)).find((m) => m.id === q2) ?? null, { timeout: 180_000, every: 4_000 }).catch(() => null);
      t.check('the machine delivers the follow-up into the thread as the person\'s message (same id)', !!delivered && delivered.thread_id === threadId && delivered.author_kind === 'human', delivered ? { thread: delivered.thread_id?.slice(0, 8), author: delivered.author_kind } : (await api('GET', `/v1/thread-followups?workspace=${ws}&threadId=${threadId}`, { as: H(ctx) }).catch(() => null)));
    },
  },
  {
    id: 'project-work',
    title: 'project-owned work: a board, a routine and a session in a project\'s room carry the project (upstream 0157)',
    async run(t, ctx) {
      const room = (await feedRows(H(ctx), 'channels', ctx.ws.id)).find((c) => c.slug === 'r6-room') ?? null;
      if (!room?.project_id) t.skip('needs the room projects-rooms made (r6-room)');
      const title = `R7 project board ${ctx.tag}`;
      await cmd(H(ctx), { type: 'whiteboard.create', workspace: ctx.ws.id, channel: room.id, title, mermaid: 'flowchart LR\n  a --> b' });
      const wb = await until('the board row', async () => (await feedRows(H(ctx), 'whiteboards', ctx.ws.id)).find((w) => w.title === title), { timeout: 20_000 }).catch(() => null);
      t.check('a whiteboard made in the room belongs to the room\'s project', wb?.project_id === room.project_id, { board: wb?.project_id, room: room.project_id });
      const rt = `R7 project routine ${ctx.tag}`;
      const sched = await refusal(cmd(H(ctx), { type: 'schedule.create', channel: room.id, title: rt, prompt: 'Say hello.', cadence: 'weekly', runAt: new Date(Date.now() + 7 * 86400_000).toISOString(), tz: 'UTC', agent: 'rex', routine: true }));
      const s = await until('the routine row', async () => (await feedRows(H(ctx), 'schedules', ctx.ws.id)).find((x) => x.title === rt), { timeout: 20_000 }).catch(() => null);
      t.check('a routine made in the room belongs to the room\'s project', s?.project_id === room.project_id, { create: sched, routine: s?.project_id ?? null });
      if (s?.id) await cmd(H(ctx), { type: 'schedule.delete', schedule: s.id }).catch(() => {});
      const threadId = await newSession(ctx, `R7 project session ${ctx.tag} (no reply needed)`, room.id);
      const th = await until('the thread row', async () => (await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.id === threadId), { timeout: 20_000 }).catch(() => null);
      t.check('a session started in the room belongs to the room\'s project', th?.project_id === room.project_id, { thread: th?.project_id ?? null });
    },
  },
  {
    id: 'coding-progress',
    title: 'a coding handoff from an agent\'s desk thread: the coding thread, the plan, and progress lines in the parent thread (upstream 0162 to 0168)',
    async run(t, ctx) {
      const proj = ctx.desk?.project ?? await defaultProject(ctx);
      if (!proj) t.skip('no default project');
      const homes = ctx.desk?.homes ?? (await openDesk(ctx, proj.id)).homes ?? [];
      const rexId = agentActor(ctx, 'orchestrator').id;
      const home = homes.find((h) => h.home_agent_id === rexId) ?? homes[0];
      if (!home) t.skip('no desk home');
      const parent = { kind: 'agent', id: home.home_agent_id, role: ctx.ws.agents.find((a) => a.id === home.home_agent_id)?.role };
      // a repository on the project (the e2e door: a file:///nm/work clone URL, never fetched here)
      const repo = await api('POST', `/internal/e2e/workspaces/${ctx.ws.id}/repos`, { fleet: true, body: { channel: home.channel_id, name: `r7-repo-${ctx.tag}`, cloneUrl: `file:///nm/work/r7-repo-${ctx.tag}` } }).catch((e) => ({ error: code(e) }));
      t.check('the project has a repository (e2e repo door)', !!repo.repoId, repo);
      if (!repo.repoId) return;
      // park the runner: this scenario reads what the API records, and an awake developer would
      // start a coding runtime the sandbox cannot serve (no vendor key)
      if (ctx.ws.runner) {
        await door.idleDrain(ctx.ws.runner).catch(() => {});
        await until('the runner parked', async () => {
          const m = await door.machine(ctx.ws.runner).catch(() => null);
          return m && Number(m.desired_replicas) === 0 && !m.drain_state ? m : null;
        }, { timeout: 60_000, every: 2_000 }).catch(() => {});
      }
      const title = `R7 coding handoff ${ctx.tag}`;
      const made = await tryApi('POST', '/v1/commands', { as: parent, body: {
        type: 'task.create', workspace: ctx.ws.id, channel: home.channel_id, originThread: home.id,
        codingHandoff: { requestId: randomUUID(), visualEvidence: false }, title,
        description: 'You are a developer on the R7 suite project. Add a README line. (The suite checks the handoff records only.)',
        kind: 'chore', repo: { id: repo.repoId, baseRef: 'main' }, checklist: ['README has the line'], definitionOfDone: 'README has the line',
        plan: { legs: ['build', 'review'], subtasks: [], approach: '## Approach\nAdd one line to README.md.\n\n## Definition of done\n- [ ] README has the line' },
      } });
      const taskId = made.r?.task?.id ?? made.r?.taskId ?? made.r?.id;
      const number = made.r?.task?.number;
      t.check('the parent agent hands off a coding task from its desk thread (task.create codingHandoff)', made.ok && !!taskId, made.r ?? made);
      if (!taskId) return;
      const detail = await api('GET', `/v1/tasks/${taskId}`, { as: H(ctx) });
      t.check('the task waits on its plan, owned by a developer', detail.task?.state === 'plan_review', { state: detail.task?.state, assignee: detail.task?.assignee ?? detail.task?.offeredTo });
      const coding = await until('the coding thread', async () => (await feedRows(H(ctx), 'threads', ctx.ws.id)).find((x) => x.task_id === taskId && x.kind === 'coding'), { timeout: 30_000 }).catch(() => null);
      t.check('the task has its own coding thread', !!coding, coding ? { id: coding.id.slice(0, 8) } : null);
      const lines = async () => (await api('GET', `/v1/team/history?workspace=${ctx.ws.id}&threadId=${home.id}`, { as: H(ctx) })).messages ?? [];
      const planLine = await until('the plan line in the parent', async () => (await lines()).find((m) => /plan is ready/i.test(m.body ?? '') && (m.body ?? '').includes(`‹plan:${taskId}`)), { timeout: 30_000 }).catch(() => null);
      t.check('the parent agent\'s thread reports the plan is ready (a progress line)', !!planLine, planLine ? planLine.body.slice(0, 160) : (await lines()).slice(0, 3).map((m) => (m.body ?? '').slice(0, 80)));
      const appr = await refusal(cmd(H(ctx), { type: 'task.approve_plan', taskId }));
      const approved = await until('the approval line', async () => (await lines()).find((m) => /approval is saved/i.test(m.body ?? '') && (m.body ?? '').includes(`#${number}`)), { timeout: 30_000 }).catch(() => null);
      t.check('approving the plan posts the next progress line', appr === 'ok' && !!approved, { approve: appr, line: approved?.body?.slice(0, 160) ?? null });
      const stop = await refusal(cmd(H(ctx), { type: 'task.cancel', taskId }));
      const closed = await until('the closed line', async () => (await lines()).find((m) => /stopped or closed/i.test(m.body ?? '') && (m.body ?? '').includes(`#${number}`)), { timeout: 30_000 }).catch(() => null);
      t.check('stopping the task reports it closed in the parent thread', stop === 'ok' && !!closed, { cancel: stop, line: closed?.body?.slice(0, 120) ?? null });
    },
  },
];
