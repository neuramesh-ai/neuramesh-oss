// TASKS AND STAGES (docs/03, 09, 14, 15, 16, 17, 23, 24, 41; matrix section T). The board's state
// machine driven the way the product drives it: the human through hq's commands, each agent through
// the header its machine's host writes with (the bare-header lane names the agent), so no model turn
// is needed to prove the gates. The page then has to show what the rows say.
import { agentActor, api, cmd, door, escapeRe, feedRows, getTask, goView, refusal, replica, replicaRow, seeText, sleep, snap, until } from './lib.mjs';

const H = (ctx) => ctx.a.userId;
const create = async (ctx, title, extra = {}) => (await cmd(H(ctx), { type: 'task.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, title, ...extra })).task;
const state = async (ctx, id) => (await getTask(H(ctx), id)).task.state;

/** open hq's board (Code mode's Tasks row, else the ⌘K palette) and look for a title */
async function boardShows(ctx, title) {
  const page = ctx.a.page;
  if (!page) return null;
  await goView(page, 'Tasks');
  const seen = await seeText(page, new RegExp(escapeRe(title)), { timeout: 30_000 });
  await snap(page, 'board');
  // back to Chat mode, where the other destinations live
  await page.getByRole('button', { name: /^Chat$/ }).first().click({ timeout: 5_000 }).catch(() => {});
  return seen;
}

export const tasks = [
  {
    id: 'task-board',
    title: 'the board: create, offer, claim, submit, review, accept (docs/03, 09, 16)',
    async run(t, ctx) {
      const dev = agentActor(ctx, 'developer');
      const rev = agentActor(ctx, 'reviewer');
      const devName = ctx.ws.agents.find((a) => a.id === dev.id).name;
      // this scenario drives the developer's and the reviewer's steps itself. On an awake runner
      // the same agents act too: in run bf4aab14 the developer's claimflow confirmed the
      // requirements within a second of the claim, and its reviewer bounced the work. Park the
      // runner first: the steps below take about a second, and a wake takes longer than that
      if (ctx.ws.runner) {
        await until('the runner parked', async () => (await door.idleDrain(ctx.ws.runner).then(() => true).catch((e) => (e.status === 409 ? true : null))), { timeout: 60_000, every: 5_000 }).catch(() => {});
        await sleep(5_000); // the drain itself takes about a second (machine_status drainMs)
      }
      const title = `R6 board task ${ctx.tag}`;
      const task = await create(ctx, title, { description: 'a feature-suite task' });
      t.check('task.create files a todo task', task?.state === 'todo', { id: task?.id, number: task?.number, state: task?.state });
      ctx.boardTask = task;
      t.check('an offer without a work-type kind is refused (docs/16 triage)', /INVALID_INPUT|HTTP 400/.test(await refusal(cmd(H(ctx), { type: 'task.offer', taskId: task.id, offerTo: devName }))));
      await cmd(H(ctx), { type: 'task.offer', taskId: task.id, offerTo: devName, kind: 'bug' });
      t.check('the offer to the developer lands, with its kind', ['offered', 'todo'].includes(await state(ctx, task.id)), await getTask(H(ctx), task.id).then((x) => ({ state: x.task.state, kind: x.task.kind, assignee: x.task.assignee ?? x.task.offeredTo })));
      await cmd(dev, { type: 'task.claim', taskId: task.id });
      t.check('the developer claims it: in_progress', (await state(ctx, task.id)) === 'in_progress');
      t.check('a second claimer is refused (the claim is the dedupe)', /ALREADY_CLAIMED|ILLEGAL_TRANSITION|CONFLICT|NOT_PERMITTED/.test(await refusal(cmd(rev, { type: 'task.claim', taskId: task.id }))));
      t.check('a submit before the requirements are confirmed is refused', /REQUIREMENTS_NOT_CONFIRMED/.test(await refusal(cmd(dev, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'test_report', name: 'early.txt', content: 'x' }] }))));
      await cmd(dev, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['the bug is fixed', 'a test covers it'] });
      t.check('a submit with no evidence is refused', /EVIDENCE_REQUIRED/.test(await refusal(cmd(dev, { type: 'task.submit', taskId: task.id, artifacts: [] }))));
      await cmd(dev, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'test_report', name: 'tests.txt', content: 'ok 1 - the feature suite\n' }] });
      t.check('a submit with a test report moves it to review', (await state(ctx, task.id)) === 'in_review');
      t.check('the developer cannot approve its own work', /SELF_REVIEW|NOT_PERMITTED/.test(await refusal(cmd(dev, { type: 'task.approve', taskId: task.id }))));
      await cmd(rev, { type: 'task.request_changes', taskId: task.id, feedback: 'add one more test' });
      t.check('the reviewer bounces it with feedback: back to in_progress', (await state(ctx, task.id)) === 'in_progress');
      await cmd(dev, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'test_report', name: 'tests-2.txt', content: 'ok 1\nok 2\n' }] });
      await cmd(rev, { type: 'task.approve', taskId: task.id });
      t.check('the reviewer approves: done', (await state(ctx, task.id)) === 'done');
      t.check('an agent cannot accept (human only)', /HUMAN_ONLY|NOT_PERMITTED/.test(await refusal(cmd(rev, { type: 'task.accept', taskId: task.id }))));
      const detail = await getTask(H(ctx), task.id);
      t.check('the task keeps its artifacts and events', detail.artifacts?.length >= 2 && detail.events?.length >= 5, { artifacts: detail.artifacts?.map((a) => `${a.kind}:${a.name}`), events: detail.events?.map((e) => e.type) });
      // the page: the replica row and the board
      if (ctx.a.page) {
        // the feed polls about every second: wait for the row to reach its new state
        const row = await until('the done row in the replica', async () => { const r = (await replica(ctx.a.page, 'SELECT id, state, title FROM tasks WHERE id = ?', [task.id]))?.[0]; return r?.state === 'done' ? r : null; }, { timeout: 30_000 }).catch(async () => (await replica(ctx.a.page, 'SELECT id, state, title FROM tasks WHERE id = ?', [task.id]))?.[0] ?? null);
        t.check('the replica carries the task in its new state', row?.state === 'done', row);
        t.check('hq\'s board shows the task', !!(await boardShows(ctx, title)));
      }
    },
  },
  {
    id: 'needs-you-accept',
    title: 'Needs you (the bell, docs/12 mission control): a done task is accepted from hq',
    needs: ['browser'],
    async run(t, ctx) {
      const task = ctx.boardTask;
      if (!task) t.skip('needs task-board');
      const page = ctx.a.page;
      // the bell lives in the shell's top dock: its popover is the dialog "Needs you"
      const bell = page.locator('button.bellbtn').first();
      // the page was just reloaded (the per-scenario video): wait for the feed to count the done task
      const readLabel = () => bell.getAttribute('aria-label', { timeout: 10_000 }).catch(() => null);
      const label = await until('the bell counts a waiting item', async () => { const l = await readLabel(); return /waiting/.test(l ?? '') && !/nothing waiting/.test(l ?? '') ? l : null; }, { timeout: 30_000, every: 1_000 }).catch(readLabel);
      t.check('the bell counts what waits (a done task waits on its accept)', /waiting/.test(label ?? '') && !/nothing waiting/.test(label ?? ''), label);
      // the bell opens on click (and on hover): the first click can land while a hover already
      // opened it and close it again, so look, and click once more when it is shut
      const pop = page.getByRole('dialog', { name: 'Needs you' });
      let open = false;
      for (let i = 0; i < 3 && !open; i++) {
        await bell.click({ timeout: 10_000 }).catch(() => {});
        open = await pop.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true).catch(() => false);
      }
      t.check('the bell opens the Needs you list', open);
      await snap(page, 'bell');
      let accepted = false;
      if (open) {
        const accept = pop.getByRole('button', { name: /^accept/i }).first();
        accepted = await accept.click({ timeout: 10_000 }).then(() => true).catch(() => false);
      }
      if (!accepted) {
        t.note('no Accept button in the bell: the task is accepted through the API instead, and the bell check above stands');
        await cmd(H(ctx), { type: 'task.accept', taskId: task.id });
      }
      const final = await until('accepted', async () => ((await getTask(H(ctx), task.id)).task.state === 'accepted' ? true : null), { timeout: 30_000 }).catch(() => false);
      t.check(accepted ? 'Accept in the bell moves the task to accepted' : 'the task is accepted', !!final);
    },
  },
  {
    id: 'task-block-dod-backlog',
    title: 'block and unblock, the Definition of Done, the backlog (docs/03, 09, 15)',
    async run(t, ctx) {
      const dev = agentActor(ctx, 'developer');
      const task = await create(ctx, `R6 block ${ctx.tag}`);
      await cmd(H(ctx), { type: 'task.set_definition_of_done', taskId: task.id, dod: '- the suite passes\n- the page shows it' });
      const d = (await getTask(H(ctx), task.id)).task;
      t.check('the human sets the Definition of Done', /the suite passes/.test(d.definitionOfDone ?? d.definition_of_done ?? ''), { dod: d.definitionOfDone ?? d.definition_of_done });
      t.check('a developer may not edit it', /NOT_PERMITTED|HUMAN_ONLY/.test(await refusal(cmd(dev, { type: 'task.set_definition_of_done', taskId: task.id, dod: 'nothing' }))));
      t.check('a todo task cannot be blocked (only work in a stage)', /ILLEGAL_TRANSITION/.test(await refusal(cmd(H(ctx), { type: 'task.block', taskId: task.id, reason: 'x' }))));
      const devName = ctx.ws.agents.find((a) => a.id === dev.id).name;
      await cmd(H(ctx), { type: 'task.offer', taskId: task.id, offerTo: devName, kind: 'chore' });
      await cmd(dev, { type: 'task.claim', taskId: task.id });
      await cmd(H(ctx), { type: 'task.block', taskId: task.id, reason: 'waiting on a decision' });
      t.check('block parks in-progress work', (await state(ctx, task.id)) === 'blocked');
      await cmd(H(ctx), { type: 'task.unblock', taskId: task.id });
      t.check('unblock returns it to the stage it left', (await state(ctx, task.id)) === 'in_progress');
      // backlog: an agent may park an idea, only a human (or rex) promotes it
      const idea = (await cmd(dev, { type: 'task.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, title: `R6 idea ${ctx.tag}`, backlog: true })).task;
      t.check('an agent parks an idea in the backlog', idea?.state === 'backlog', idea?.state);
      t.check('a backlog item cannot be born offered', /INVALID_INPUT/.test(await refusal(cmd(H(ctx), { type: 'task.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, title: 'x', backlog: true, offerTo: 'patch' }))));
      t.check('a developer cannot promote it', /NOT_PERMITTED|ILLEGAL/.test(await refusal(cmd(dev, { type: 'task.promote', taskId: idea.id }))));
      await cmd(H(ctx), { type: 'task.promote', taskId: idea.id });
      t.check('the human promotes it to todo', (await state(ctx, idea.id)) === 'todo');
      await cmd(H(ctx), { type: 'task.update_details', taskId: idea.id, title: `R6 idea renamed ${ctx.tag}` });
      t.check('update_details renames a pre-work task', /renamed/.test((await getTask(H(ctx), idea.id)).task.title));
      await cmd(H(ctx), { type: 'task.cancel', taskId: idea.id }).catch(() => {});
      await cmd(H(ctx), { type: 'task.archive', taskId: idea.id }).catch(() => {});
      t.note({ cancelledThenArchived: (await getTask(H(ctx), idea.id)).task.state });
    },
  },
  {
    id: 'design-stage',
    title: 'the design stage: request, mockups, human approval (docs/14)',
    async run(t, ctx) {
      const designer = agentActor(ctx, 'designer');
      const task = await create(ctx, `R6 design ${ctx.tag}`);
      await cmd(H(ctx), { type: 'task.request_design', taskId: task.id, kind: 'feature' });
      t.check('request_design moves it to designing', (await state(ctx, task.id)) === 'designing');
      await cmd(designer, { type: 'task.propose_design', taskId: task.id, round: 1, summary: 'one screen', mockups: [{ name: 'home', html: '<!doctype html><h1>R6 mockup</h1>' }] });
      const d = await getTask(H(ctx), task.id);
      t.check('the designer proposes mockups: design_review with a design artifact', d.task.state === 'design_review' && d.artifacts.some((a) => a.kind === 'design'), { state: d.task.state, artifacts: d.artifacts.map((a) => `${a.kind}:${a.name}`) });
      t.check('an agent cannot approve the design', /HUMAN_ONLY|NOT_PERMITTED/.test(await refusal(cmd(designer, { type: 'task.approve_design', taskId: task.id }))));
      await cmd(H(ctx), { type: 'task.revise_design', taskId: task.id, feedback: 'bigger title' });
      t.check('revise sends it back to designing', (await state(ctx, task.id)) === 'designing');
      await cmd(designer, { type: 'task.propose_design', taskId: task.id, round: 2, mockups: [{ name: 'home', html: '<!doctype html><h1 style="font-size:4em">R6 mockup</h1>' }] });
      await cmd(H(ctx), { type: 'task.approve_design', taskId: task.id });
      const after = await getTask(H(ctx), task.id);
      const arts = (await feedRows(H(ctx), 'artifacts', ctx.ws.id)).filter((a) => a.task_id === task.id && a.kind === 'design');
      t.check('the human approves: planning', after.task.state === 'planning', after.task.state);
      t.check('the approved (latest) mockup round joins the library (promoted), the older one does not', arts.some((a) => /-v2-/.test(a.name) && Number(a.promoted) === 1) && !arts.some((a) => /-v1-/.test(a.name) && Number(a.promoted) === 1), arts.map((a) => `${a.name}:${a.promoted}`));
      ctx.designTask = task;
    },
  },
  {
    id: 'plan-gate',
    title: 'the plan gate and plan-first units: architect plan, legs, subtasks, sign-off (docs/12, 24, 41)',
    async run(t, ctx) {
      const arch = agentActor(ctx, 'architect');
      const dev = agentActor(ctx, 'developer');
      const task = ctx.designTask ?? await create(ctx, `R6 plan ${ctx.tag}`);
      if ((await state(ctx, task.id)) !== 'planning') await cmd(H(ctx), { type: 'task.request_plan', taskId: task.id, kind: 'feature' });
      t.check('the task is in planning', (await state(ctx, task.id)) === 'planning');
      await cmd(arch, { type: 'task.propose_plan', taskId: task.id, plan: '## Steps\n1. build it\n2. test it', legs: ['build'], subtasks: ['write the page', 'write the test'] }).catch(async (e) => {
        t.note(`propose_plan with legs and subtasks was refused (${e?.json?.code ?? e.message}): retrying with the plan only`);
        await cmd(arch, { type: 'task.propose_plan', taskId: task.id, plan: '## Steps\n1. build it\n2. test it' });
      });
      const p = await getTask(H(ctx), task.id);
      t.check('the architect proposes: plan_review with the plan document', p.task.state === 'plan_review' && p.artifacts.some((a) => /plan/i.test(a.name)), { state: p.task.state, artifacts: p.artifacts.map((a) => a.name), workPlan: p.task.workPlan ?? null });
      t.check('an agent cannot sign the plan off', /HUMAN_ONLY|NOT_PERMITTED/.test(await refusal(cmd(dev, { type: 'task.approve_plan', taskId: task.id }))));
      await cmd(H(ctx), { type: 'task.approve_plan', taskId: task.id });
      const a = await getTask(H(ctx), task.id);
      t.check('the human signs off: the plan is approved', !!(a.task.planApprovedAt ?? a.task.plan_approved_at) || !['plan_review'].includes(a.task.state), { state: a.task.state, planApprovedAt: a.task.planApprovedAt ?? a.task.plan_approved_at });
      // subtasks (docs/24): the children the plan proposed, or one filed by hand under the parent
      const all = await feedRows(H(ctx), 'tasks', ctx.ws.id);
      let kids = all.filter((r) => r.parent_task_id === task.id);
      if (!kids.length) {
        const child = (await cmd(H(ctx), { type: 'task.create', workspace: ctx.ws.id, channel: ctx.ws.channelId, title: `R6 subtask ${ctx.tag}`, parent: task.id }).catch((e) => ({ error: e?.json?.code ?? e.message })));
        t.note({ subtaskByHand: child?.task ? { id: child.task.id, parent: child.task.parent ?? child.task.parentId } : child });
        kids = (await feedRows(H(ctx), 'tasks', ctx.ws.id)).filter((r) => r.parent_task_id === task.id);
      }
      t.check('subtasks hang under their parent (docs/24)', kids.length >= 1, kids.map((k) => ({ id: k.id, title: k.title, state: k.state })));
      if (kids[0]) {
        const kid = kids[0];
        await cmd(dev, { type: 'task.claim', taskId: kid.id }).catch(() => {});
        const done = await refusal(cmd(dev, { type: 'task.finish_subtask', taskId: kid.id, note: 'done', artifacts: [{ kind: 'doc', name: 'notes.md', content: 'done' }] }));
        t.check('a subtask is finished with a note (task.finish_subtask)', done === 'ok', done);
      }
    },
  },
  {
    id: 'beats',
    title: 'beats: an agent declares steps and ticks them (docs/17, 26 live status)',
    async run(t, ctx) {
      const dev = agentActor(ctx, 'developer');
      const devName = ctx.ws.agents.find((a) => a.id === dev.id).name;
      const task = await create(ctx, `R6 beats ${ctx.tag}`, { offerTo: devName, kind: 'chore' });
      await cmd(dev, { type: 'task.claim', taskId: task.id });
      t.check('a human cannot declare beats', /NOT_PERMITTED|HUMAN|AGENT/.test(await refusal(cmd(H(ctx), { type: 'beats.declare', taskId: task.id, phase: 'in_progress', items: ['a'] }))));
      await cmd(dev, { type: 'beats.declare', taskId: task.id, phase: 'in_progress', items: ['read the code', 'write the fix', 'run the tests'] });
      await cmd(dev, { type: 'beats.advance', taskId: task.id, seq: 0, status: 'done' });
      await cmd(dev, { type: 'beats.advance', taskId: task.id, seq: 1, status: 'active' }).catch(async () => cmd(dev, { type: 'beats.advance', taskId: task.id, seq: 1, status: 'doing' }));
      const rows = await feedRows(H(ctx), 'beats', ctx.ws.id).catch(() => []);
      const mine = rows.filter((r) => r.task_id === task.id);
      t.check('the beats ride the feed with their states', mine.length === 3 && mine.some((r) => r.status === 'done'), mine.map((r) => ({ seq: r.seq, status: r.status, label: r.label ?? r.text })));
      if (ctx.a.page) {
        const r = await until('three beats in the page replica', async () => { const x = await replica(ctx.a.page, 'SELECT seq, status FROM beats WHERE task_id = ? ORDER BY seq', [task.id]); return x?.length === 3 ? x : null; }, { timeout: 30_000 }).catch((e) => e.message);
        t.check('the page\'s replica holds the beats', Array.isArray(r) && r.length === 3, r);
      }
    },
  },
  {
    id: 'ship-stage',
    title: 'the ship stage: shipper claims, plan, human approval, checklist gate (docs/23)',
    async run(t, ctx) {
      const shipper = agentActor(ctx, 'shipper');
      const dev = agentActor(ctx, 'developer');
      const rev = agentActor(ctx, 'reviewer');
      const devName = ctx.ws.agents.find((a) => a.id === dev.id).name;
      // the gate: a ship-gated project
      const projects = await feedRows(H(ctx), 'projects', ctx.ws.id);
      const channel = (await feedRows(H(ctx), 'channels', ctx.ws.id)).find((c) => c.id === ctx.ws.channelId);
      const project = projects.find((p) => p.id === channel?.project_id) ?? projects[0];
      const gate = await refusal(cmd(H(ctx), { type: 'project.update', project: project.id, shipGate: true }));
      t.check('the project takes the release gate (project.update shipGate)', gate === 'ok', gate);
      const task = await create(ctx, `R6 ship ${ctx.tag}`, { offerTo: devName, kind: 'feature' });
      await cmd(dev, { type: 'task.claim', taskId: task.id });
      await cmd(dev, { type: 'task.confirm_requirements', taskId: task.id, checklist: ['it ships'] });
      await cmd(dev, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'test_report', name: 't.txt', content: 'ok' }], sha: 'deadbeef', prUrl: 'https://github.com/neuramesh-e2e/none/pull/1', prNumber: 1 });
      await cmd(rev, { type: 'task.approve', taskId: task.id });
      const claim = await refusal(cmd(shipper, { type: 'task.claim_ship', taskId: task.id }));
      t.check('the shipper claims the approved PR task: shipping', claim === 'ok' && (await state(ctx, task.id)) === 'shipping', { claim, state: await state(ctx, task.id) });
      if (claim !== 'ok') return;
      await cmd(shipper, { type: 'task.propose_ship_plan', taskId: task.id, report: '## Risk\nlow', risk: 'low', items: [{ id: 'smoke', title: 'smoke the page', owner: 'human' }] });
      t.check('the ship plan goes to review', (await state(ctx, task.id)) === 'ship_review');
      t.check('an agent cannot approve the ship plan', /HUMAN_ONLY|NOT_PERMITTED/.test(await refusal(cmd(shipper, { type: 'task.approve_ship_plan', taskId: task.id }))));
      await cmd(H(ctx), { type: 'task.approve_ship_plan', taskId: task.id });
      t.check('the human approves: releasing', (await state(ctx, task.id)) === 'releasing');
      t.check('the merge is refused while an item is open', /SHIP_ITEMS_PENDING/.test(await refusal(cmd(shipper, { type: 'task.execute_ship', taskId: task.id }))));
      await cmd(H(ctx), { type: 'task.check_ship_item', taskId: task.id, itemId: 'smoke', state: 'done' });
      const go = await refusal(cmd(shipper, { type: 'task.execute_ship', taskId: task.id }));
      t.check('with every item checked the merge goes ahead: verifying', go === 'ok' && (await state(ctx, task.id)) === 'verifying', { go, state: await state(ctx, task.id) });
      t.note('the merge itself (gh pr merge) runs on a machine against a real repo: r6-machines owns that half');
    },
  },
  {
    id: 'decisions',
    title: 'question cards become decisions, answered from hq (docs/03, 12; approvals)',
    async run(t, ctx) {
      const rex = agentActor(ctx, 'orchestrator');
      const q = `R6 ship it ${ctx.tag}?`;
      const body = `Quick question.\n\n\`\`\`nmq\n${JSON.stringify({ question: q, options: ['Yes', 'No'] })}\n\`\`\``;
      const posted = await api('POST', '/v1/messages', { as: rex, body: { workspace: ctx.ws.id, channel: ctx.ws.channelId, body } });
      const msgId = posted?.message?.id;
      const dec = await until('the decision row', async () => (await feedRows(H(ctx), 'decisions', ctx.ws.id)).find((d) => (d.question ?? '').includes(ctx.tag)), { timeout: 30_000 }).catch(() => null);
      t.check('an agent\'s nmq card mints an open decision', dec?.status === 'open', dec ?? { message: msgId });
      if (!dec) return;
      t.check('an agent cannot answer it', /HUMAN_ONLY|NOT_PERMITTED/.test(await refusal(cmd(rex, { type: 'decision.answer', decisionId: dec.id, answer: 'Yes' }))));
      let viaUi = false;
      const page = ctx.a.page;
      if (page) {
        // the card renders in its thread: open the bell, then the thread, and click the option
        await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForTimeout(3_000);
        const msg = (await feedRows(H(ctx), 'messages', ctx.ws.id)).find((m) => m.id === dec.message_id);
        const thread = msg?.thread_id ?? posted?.message?.threadId ?? posted?.message?.thread_id;
        t.note({ decisionThread: thread ?? null });
        if (thread) await page.goto(`${ctx.cfg.hq}/${ctx.ws.slug}/c/${thread}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        const seen = await seeText(page, new RegExp(ctx.tag), { timeout: 30_000 });
        t.check('hq shows the question card', !!seen);
        await snap(page, 'decision-card');
        const yes = page.getByRole('button', { name: /^\s*yes\b/i }).first();
        viaUi = await yes.click({ timeout: 10_000 }).then(() => true).catch(() => false);
        if (!viaUi) t.note({ cardButtons: await page.getByRole('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)).filter(Boolean).slice(-40)).catch(() => []) });
      }
      if (!viaUi) await cmd(H(ctx), { type: 'decision.answer', decisionId: dec.id, answer: 'Yes' });
      const answered = await until('answered', async () => (await feedRows(H(ctx), 'decisions', ctx.ws.id)).find((d) => d.id === dec.id && d.status === 'answered'), { timeout: 30_000 }).catch(() => null);
      t.check(viaUi ? 'the human answers on the card in hq: answered' : 'the human answers (API): answered', !!answered, answered);
      t.check('a second answer is refused', /CONFLICT|ILLEGAL|ALREADY/.test(await refusal(cmd(H(ctx), { type: 'decision.answer', decisionId: dec.id, answer: 'No' }))));
    },
  },
];
