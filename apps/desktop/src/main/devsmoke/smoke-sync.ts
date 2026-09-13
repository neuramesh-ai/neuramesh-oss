// The `--smoke-sync` gate: the full loop inside Electron main against the dev stack —
// send → upload → server echo, then the FSM end to end (claim · plan · hire · review ·
// PR merge · skills · memory). Driven by scripts/dev-e2e.sh, never by the app.
//
// It stays ONE file on purpose. Unlike the shot modes (independent, split into ten
// modules), these phases are sequential and share their state — ids, timings and the
// live db thread through all of them — so cutting it into phase modules would thread a
// wide context object through a script whose value is that it reads top to bottom. It
// carries a standing ratchet exception with that reason attached.
//
// It must run in Electron main (it calls startSync, which needs app/ipcMain), so it
// cannot move to scripts/. index.ts imports it LAZILY, which is what keeps it out of a
// shipped build's module graph.
// a local git repo of 2 SKILL.md files — drives the REAL Curator clone→parse→
// commit path over file:// (no network), so the import gate is deterministic.
async function buildSkillRepoFixture(): Promise<string> {
  const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nm-skillfix-'));
  for (const [name, body] of [['alpha-skill', 'Alpha procedure.'], ['beta-skill', 'Beta procedure.']] as const) {
    const d = path.join(dir, 'skills', name);
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} for the import gate\n---\n\n# ${name}\n\n${body}\n`);
  }
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'nm', GIT_AUTHOR_EMAIL: 'nm@local', GIT_COMMITTER_NAME: 'nm', GIT_COMMITTER_EMAIL: 'nm@local' };
  await run('git', ['init', '-q'], { cwd: dir, env });
  await run('git', ['add', '-A'], { cwd: dir, env });
  await run('git', ['commit', '-q', '-m', 'fixture'], { cwd: dir, env });
  return dir;
}

import { randomUUID } from 'node:crypto';
import { executing, ghFakeCalls } from '../agents';
import { api, actorId, machineName, startSync, apiUrl, DEV_USER, DEV_WS, thisMachineId } from '../sync';

// --smoke-sync: prove the full path inside Electron main — first sync of the
// real schema, optimistic send, upload via control-api, server echo persists.
export async function smokeSync(): Promise<void> {
  const t0 = Date.now();
  const { db, agentLog } = await startSync();
  await db.waitForFirstSync();
  const firstSyncMs = Date.now() - t0;

  const chs = await db.getAll<{ id: string; slug: string }>(`select id, slug from channels order by slug`);
  if (chs.length < 2) throw new Error(`expected seeded channels, got ${chs.length}`);
  const dev = (chs.find((c) => c.slug === 'dev') ?? chs.find((c) => c.slug === 'build'))!;

  const id = randomUUID();
  const t1 = Date.now();
  await db.execute(
    `insert into messages (id, workspace_id, channel_id, author_kind, author_id, body, created_at)
     values (?, ?, ?, 'human', ?, ?, ?)`,
    [id, DEV_WS, dev.id, DEV_USER, 'hello from electron main', new Date().toISOString()],
  );

  const deadline = Date.now() + 20_000;
  for (;;) {
    const [q] = await db.getAll<{ n: number }>('select count(*) as n from ps_crud');
    const rows = await db.getAll('select id from messages where id = ?', [id]);
    if (Number(q?.n ?? 1) === 0 && rows.length === 1) break;
    if (Date.now() > deadline) throw new Error('round trip timed out');
    await new Promise((r) => setTimeout(r, 150));
  }

  const msgRoundtripMs = Date.now() - t1;

  // tasks stream: create via control-api (server-authoritative), watch it sync down. The HUMAN
  // creates it: a live agent create must carry its implementation plan (PLAN_FIRST, docs/41) and
  // is born in plan_review, while this task only has to exist and sync — the plan-first lane has
  // its own section below.
  const t2 = Date.now();
  const taskRes = await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-nm-actor': JSON.stringify({ kind: 'human', id: DEV_USER }),
    },
    body: JSON.stringify({ type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'smoke task' }),
  });
  if (!taskRes.ok) throw new Error(`task.create failed ${taskRes.status}`);
  const { task } = (await taskRes.json()) as { task: { id: string } };
  const tDeadline = Date.now() + 20_000;
  for (;;) {
    const rows = await db.getAll('select id from tasks where id = ?', [task.id]);
    if (rows.length === 1) break;
    if (Date.now() > tDeadline) {
      const localRows = await db.getAll('select id, number, title, state from tasks');
      const opIds = await db.getAll("select row_id from ps_oplog where row_type = 'tasks'");
      console.log(
        'debug_expected=' + task.id + ' local=' + JSON.stringify(localRows) + ' oplog_ids=' + JSON.stringify(opIds),
      );
      throw new Error('task sync timed out');
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  // presence v0: this machine's registration must sync back down
  const me = machineName();
  const mDeadline = Date.now() + 20_000;
  for (;;) {
    const m = await db.getAll('select id from machines where name = ?', [me]);
    if (m.length === 1) break;
    if (Date.now() > mDeadline) throw new Error('machine presence sync timed out');
    await new Promise((r) => setTimeout(r, 150));
  }

  const taskSyncMs = Date.now() - t2;

  // agent wake→reply (echo): register an agent on this machine, mention it,
  // and require its reply to come back through the full pipeline.
  const mRow = await db.get<{ id: string }>('select id from machines where name = ?', [me]);
  const reg = await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ type: 'agent.register', workspace: DEV_WS, machineId: mRow.id, name: 'echo', channels: ['dev'] }),
  });
  if (!reg.ok) throw new Error(`agent.register failed ${reg.status}: ${await reg.text()}`);
  for (const [name, role] of [['echo-reviewer', 'reviewer'], ['echo-orch', 'orchestrator'], ['echo-architect', 'architect'], ['echo-curator', 'curator']] as const) {
    const r = await fetch(`${apiUrl()}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
      body: JSON.stringify({ type: 'agent.register', workspace: DEV_WS, machineId: mRow.id, name, role, channels: ['dev'] }),
    });
    if (!r.ok) throw new Error(`${name} agent.register failed ${r.status}: ${await r.text()}`);
  }

  const aDeadline = Date.now() + 20_000;
  for (;;) {
    const a = await db.getAll<{ id: string }>(
      `select distinct a.id from agents a join agent_channels ac on ac.agent_id = a.id where a.name in ('echo', 'echo-reviewer', 'echo-orch', 'echo-architect', 'echo-curator')`,
    );
    if (a.length === 5) break;
    if (Date.now() > aDeadline) throw new Error('agent registration sync timed out');
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 600)); // host watch rebuild grace

  // Channel responsibility: a worker @mentioned in the MAIN CHANNEL must stay
  // silent — workers speak only inside the thread of the task they're assigned;
  // the channel is the orchestrator's. (Was the inverse under W3 s1; the model
  // changed.) Echo agents reply instantly if they wake, so a quiet window is a
  // reliable proof of silence. The worker's wake→act path is covered below by
  // the offer→claim→loop test (it acts in its thread, not here).
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ workspace: DEV_WS, channel: 'dev', body: '@echo ping from smoke' }),
  });
  await new Promise((r) => setTimeout(r, 3000));
  const workerChannelReplies = await db.getAll(
    `select m.id from messages m join agents a on a.id = m.author_id
     where a.name = 'echo' and m.author_kind = 'agent' and m.task_id is null`,
  );
  if (workerChannelReplies.length > 0) throw new Error('worker replied in the channel — workers must be silent outside their assigned thread');

  // the full loop: offer a task, require claim + requirements + thread note,
  // then execute→submit→auto-review to `done`, then human accept — all
  // through the enforced API. Claim may already have raced past in_progress.
  const t5 = Date.now();
  const offRes = await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'verify the claim loop', kind: 'feature', offerTo: 'echo' }),
  });
  if (!offRes.ok) throw new Error(`offered task.create failed ${offRes.status}`);
  const { task: offered } = (await offRes.json()) as { task: { id: string } };
  const CLAIMED = new Set(['in_progress', 'in_review', 'done']);
  const cDeadline = Date.now() + 25_000;
  for (;;) {
    const [row] = await db.getAll<{ state: string; requirements_confirmed: number }>(
      'select state, requirements_confirmed from tasks where id = ?',
      [offered.id],
    );
    const thread = await db.getAll('select id from messages where task_id = ?', [offered.id]);
    if (row && CLAIMED.has(row.state) && Number(row.requirements_confirmed) === 1 && thread.length >= 1) break;
    if (Date.now() > cDeadline) throw new Error(`claim loop timed out (state=${row?.state})`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const claimMs = Date.now() - t5;

  const dDeadline = Date.now() + 30_000;
  for (;;) {
    const [row] = await db.getAll<{ state: string }>('select state from tasks where id = ?', [offered.id]);
    if (row?.state === 'done') break;
    if (Date.now() > dDeadline) throw new Error(`execute/review loop timed out (state=${row?.state})`);
    await new Promise((r) => setTimeout(r, 200));
  }
  const acc = await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ type: 'task.accept', taskId: offered.id }),
  });
  if (!acc.ok) throw new Error(`task.accept failed ${acc.status}: ${await acc.text()}`);
  const aAccDeadline = Date.now() + 15_000;
  for (;;) {
    const [row] = await db.getAll<{ state: string }>('select state from tasks where id = ?', [offered.id]);
    if (row?.state === 'accepted') break;
    if (Date.now() > aAccDeadline) throw new Error('accepted state never synced back');
    await new Promise((r) => setTimeout(r, 200));
  }
  const loopMs = Date.now() - t5;

  // repo-backed loop: agent works in a worktree and pushes before review —
  // verify the branch + sha exist on the (local bare) remote afterwards.
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const sh = async (cmd: string, args: string[], cwd?: string) => (await run(cmd, args, { cwd })).stdout.trim();
  const REMOTE = '/tmp/nm-e2e-remote.git';
  const seedDir = await (await import('node:fs/promises')).mkdtemp(`${(await import('node:os')).tmpdir()}/nm-seed-`);
  await sh('rm', ['-rf', REMOTE]);
  await sh('git', ['init', '--bare', '-b', 'main', REMOTE]);
  await sh('git', ['init', '-b', 'main', seedDir]);
  await (await import('node:fs/promises')).writeFile(`${seedDir}/README.md`, '# e2e-local\n');
  await sh('git', ['add', '-A'], seedDir);
  await sh('git', ['-c', 'user.email=e2e@neuramesh.dev', '-c', 'user.name=nm-e2e', 'commit', '-m', 'init'], seedDir);
  await sh('git', ['push', REMOTE, 'main'], seedDir);

  const t6 = Date.now();
  const repoRes = await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({
      type: 'task.create',
      workspace: DEV_WS,
      channel: 'dev',
      title: 'prove the worktree loop',
      kind: 'feature',
      repo: { id: 'b0000000-0000-0000-0000-000000000002', baseRef: 'main' },
      offerTo: 'echo',
    }),
  });
  if (!repoRes.ok) throw new Error(`repo task.create failed ${repoRes.status}: ${await repoRes.text()}`);
  const { task: repoTask } = (await repoRes.json()) as { task: { id: string; repo: { branch: string } } };
  const rDeadline = Date.now() + 45_000;
  for (;;) {
    const [row] = await db.getAll<{ state: string }>('select state from tasks where id = ?', [repoTask.id]);
    if (row?.state === 'done') break;
    if (Date.now() > rDeadline) throw new Error(`repo loop timed out (state=${row?.state})`);
    await new Promise((r) => setTimeout(r, 250));
  }
  const detail = await fetch(`${apiUrl()}/v1/tasks/${repoTask.id}`, {
    headers: { 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
  });
  const { task: finalTask } = (await detail.json()) as { task: { submittedSha: string | null } };
  const lsRemote = await sh('git', ['ls-remote', REMOTE, `refs/heads/${repoTask.repo.branch}`]);
  const remoteSha = lsRemote.split('\t')[0] ?? '';
  if (!finalTask.submittedSha || !remoteSha.startsWith(finalTask.submittedSha)) {
    throw new Error(`pushed sha mismatch: remote=${remoteSha.slice(0, 7)} submitted=${finalTask.submittedSha?.slice(0, 7)}`);
  }
  // review cockpit path: the diff artifact must sync down with real content
  let diffArtifactId = '';
  const artDeadline = Date.now() + 15_000;
  for (;;) {
    const art = await db.getAll<{ id: string; inline_content: string | null }>(
      `select id, inline_content from artifacts where task_id = ? and kind = 'diff'`,
      [repoTask.id],
    );
    if (art.length === 1 && art[0]!.inline_content?.startsWith('diff --git')) {
      diffArtifactId = art[0]!.id;
      break;
    }
    if (Date.now() > artDeadline) throw new Error(`diff artifact never synced (rows=${art.length})`);
    await new Promise((r) => setTimeout(r, 200));
  }

  // library: promote it (human), require promoted=1 back through sync
  await api('/v1/commands', { type: 'artifact.promote', artifactId: diffArtifactId });
  const promDeadline = Date.now() + 15_000;
  for (;;) {
    const [row] = await db.getAll<{ promoted: number }>('select promoted from artifacts where id = ?', [diffArtifactId]);
    if (Number(row?.promoted) === 1) break;
    if (Date.now() > promDeadline) throw new Error('promotion never synced');
    await new Promise((r) => setTimeout(r, 200));
  }

  const repoLoopMs = Date.now() - t6;

  // orchestrated intake loop: a work request in the channel must become an
  // UNOFFERED intake task with the orchestrator's questions in its thread and
  // a #N digest in the channel; a human thread reply (no mention — intake
  // routing) resolves requirements, the orchestrator offers in-thread, and
  // the worker loop runs it to done.
  const t7 = Date.now();
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ workspace: DEV_WS, channel: 'dev', body: '@echo-orch ship the orchestrated demo loop' }),
  });

  // phase 1: intake task opened (todo, unoffered) + thread question + digest
  let intakeTaskId = '';
  const iDeadline = Date.now() + 30_000;
  for (;;) {
    const [task] = await db.getAll<{ id: string; state: string; offered_agent_id: string | null; description: string | null }>(
      `select id, state, offered_agent_id, description from tasks where title like '%orchestrated demo loop%' order by number desc limit 1`,
    );
    if (task) {
      if (task.state !== 'todo' || task.offered_agent_id) throw new Error(`intake task must open unoffered (state=${task.state} offered=${task.offered_agent_id})`);
      if (!task.description?.includes('Intake')) throw new Error('intake task carries no description');
      const threadQ = await db.getAll(
        `select m.id from messages m join agents a on a.id = m.author_id
         where m.task_id = ? and m.author_kind = 'agent' and a.name = 'echo-orch'`,
        [task.id],
      );
      const digest = await db.getAll(
        `select m.id from messages m join agents a on a.id = m.author_id
         where m.author_kind = 'agent' and a.name = 'echo-orch' and m.task_id is null and m.body like '%Opened #%'`,
      );
      if (threadQ.length >= 1 && digest.length >= 1) {
        intakeTaskId = task.id;
        break;
      }
    }
    if (Date.now() > iDeadline) throw new Error(`intake never opened (task=${!!task})`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // phase 2: human answers IN THE THREAD (no mention — todo routing wakes the
  // orchestrator) → offer lands in-thread → claim → execute → review → done.
  // The reply uses the question-card answer convention, so the rendered card
  // compresses to its ✓ line (evidence shots assert this visually).
  const [intakeNum] = await db.getAll<{ number: number }>('select number from tasks where id = ?', [intakeTaskId]);
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({
      workspace: DEV_WS,
      channel: 'dev',
      taskId: intakeTaskId,
      body: `**What does done look like for #${intakeNum?.number}?** → Stub result note`,
    }),
  });
  const oDeadline = Date.now() + 60_000;
  for (;;) {
    const [task] = await db.getAll<{ state: string }>(`select state from tasks where id = ?`, [intakeTaskId]);
    const offerNote = await db.getAll(
      `select m.id from messages m join agents a on a.id = m.author_id
       where m.task_id = ? and m.author_kind = 'agent' and a.name = 'echo-orch' and m.body like '%offered #%'`,
      [intakeTaskId],
    );
    if (task?.state === 'done' && offerNote.length >= 1) break;
    if (Date.now() > oDeadline) throw new Error(`orchestrated intake loop timed out (state=${task?.state ?? 'no task'} offerNote=${offerNote.length})`);
    await new Promise((r) => setTimeout(r, 250));
  }

  const orchLoopMs = Date.now() - t7;

  // multi-intake decomposition: ONE request naming several deliverables must
  // fan into several intake tasks, each with its own thread + a combined digest
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ workspace: DEV_WS, channel: 'dev', body: '@echo-orch build a login page, a signup page, and a settings panel' }),
  });
  let multiIntakeN = 0;
  const miDeadline = Date.now() + 30_000;
  for (;;) {
    const tasks = await db.getAll<{ id: string }>(
      `select id from tasks where title in ('build a login page', 'a signup page', 'a settings panel')`,
    );
    if (tasks.length >= 3) {
      let threaded = 0;
      for (const tk of tasks) {
        const q = await db.getAll(`select id from messages where task_id = ? and author_kind = 'agent'`, [tk.id]);
        if (q.length >= 1) threaded++;
      }
      const digest = await db.getAll(
        `select id from messages where author_kind = 'agent' and task_id is null and body like '%Decomposed into 3 intakes%'`,
      );
      if (threaded >= 3 && digest.length >= 1) { multiIntakeN = tasks.length; break; }
    }
    if (Date.now() > miDeadline) throw new Error(`multi-intake decomposition failed (tasks=${tasks.length})`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // Plan-lifecycle GATE (race-free, pure FSM): a task in planning cannot reach
  // in_progress (a dev can't start while the plan is unsettled); it must go via
  // plan_review. Asserted against the domain transition table directly.
  const { canTransition } = await import('@neuramesh/shared');
  if (canTransition('planning', 'in_progress')) throw new Error('GATE FAIL: planning -> in_progress edge exists');
  if (!canTransition('plan_review', 'in_progress')) throw new Error('plan_review -> in_progress should be legal');

  // Plan flow AUTONOMOUS: a plan-worthy request ("[plan]" marker for echo) is
  // routed by the orchestrator into planning, the architect drafts + proposes a
  // plan (implementation-plan.md), the orchestrator approves + offers, and a
  // worker executes it. We assert the plan artifact lands and the task clears
  // the plan gate into execution.
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ workspace: DEV_WS, channel: 'dev', body: '@echo-orch [plan] build the auth module' }),
  });
  let planIntakeId = '';
  const pfDeadline = Date.now() + 30_000;
  for (;;) {
    const [task] = await db.getAll<{ id: string }>(`select id from tasks where title like '%build the auth module%' order by number desc limit 1`);
    if (task) { planIntakeId = task.id; break; }
    if (Date.now() > pfDeadline) throw new Error('plan-flow intake never opened');
    await new Promise((r) => setTimeout(r, 250));
  }
  // resolve requirements in the thread → orchestrator routes it to the architect
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ workspace: DEV_WS, channel: 'dev', taskId: planIntakeId, body: 'Done = a working auth module. Proceed.' }),
  });
  // The plan lands in plan_review; the orchestrator PRE-OFFERS a worker and posts the approval
  // card. Approval is HUMAN_ONLY (docs/29 §4d): the server refuses the claim until the human's
  // stamp, so the smoke approves as the human and only then expects execution.
  const pfDone = Date.now() + 60_000;
  for (;;) {
    const [task] = await db.getAll<{ state: string; offered_agent_id: string | null }>('select state, offered_agent_id from tasks where id = ?', [planIntakeId]);
    const planArt = await db.getAll(`select id from artifacts where task_id = ? and name like 'implementation-plan%'`, [planIntakeId]);
    const card = await db.getAll(`select id from messages where task_id = ? and body like '%Approve the plan%'`, [planIntakeId]);
    if (['in_progress', 'in_review', 'done', 'accepted'].includes(task?.state ?? '')) {
      throw new Error('plan gate FAIL: executed before the human approved the plan');
    }
    if (planArt.length >= 1 && task?.state === 'plan_review' && task.offered_agent_id && card.length >= 1) break;
    if (Date.now() > pfDone) throw new Error(`plan flow stalled pre-approval (state=${task?.state ?? 'none'} plan_artifact=${planArt.length} offered=${task?.offered_agent_id ? 1 : 0} card=${card.length})`);
    await new Promise((r) => setTimeout(r, 250));
  }
  const pfApprove = await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ type: 'task.approve_plan', taskId: planIntakeId }),
  });
  if (!pfApprove.ok) throw new Error(`task.approve_plan failed ${pfApprove.status}: ${await pfApprove.text()}`);
  const pfExec = Date.now() + 60_000;
  for (;;) {
    const [task] = await db.getAll<{ state: string }>('select state from tasks where id = ?', [planIntakeId]);
    if (['in_progress', 'in_review', 'done', 'accepted'].includes(task?.state ?? '')) break;
    if (Date.now() > pfExec) throw new Error(`approved plan never released to execution (state=${task?.state ?? 'none'})`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // Human plan-review gate: a "[review]" plan is NOT auto-offered — the
  // orchestrator parks it in plan_review with an approval card (+ a desktop
  // notification) and waits. The human's approval then releases it to execution.
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ workspace: DEV_WS, channel: 'dev', body: '@echo-orch [plan][review] build the billing module' }),
  });
  let prIntakeId = '';
  const prIntakeDl = Date.now() + 30_000;
  for (;;) {
    const [task] = await db.getAll<{ id: string }>(`select id from tasks where title like '%build the billing module%' order by number desc limit 1`);
    if (task) { prIntakeId = task.id; break; }
    if (Date.now() > prIntakeDl) throw new Error('plan-review intake never opened');
    await new Promise((r) => setTimeout(r, 250));
  }
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ workspace: DEV_WS, channel: 'dev', taskId: prIntakeId, body: 'Done = working billing. Proceed.' }),
  });
  // the plan must land in plan_review with an approval card AND stay unoffered
  // (awaiting the human) — proving it did NOT auto-execute
  const prHoldDl = Date.now() + 60_000;
  for (;;) {
    const [task] = await db.getAll<{ state: string; offered_agent_id: string | null }>('select state, offered_agent_id from tasks where id = ?', [prIntakeId]);
    const card = await db.getAll(`select id from messages where task_id = ? and body like '%Approve the plan%'`, [prIntakeId]);
    if (task?.state === 'plan_review' && !task.offered_agent_id && card.length >= 1) break;
    if (['in_progress', 'in_review', 'done'].includes(task?.state ?? '')) throw new Error('plan-review gate FAIL: executed without human approval');
    if (Date.now() > prHoldDl) throw new Error(`plan-review hold failed (state=${task?.state ?? 'none'} card=${card.length})`);
    await new Promise((r) => setTimeout(r, 250));
  }
  // the human approves — via the COMMAND the card's Approve really posts (task.approve_plan,
  // HUMAN_ONLY): a prose reply cannot stamp a plan, by construction. The stamp releases the
  // parked task: the orchestrator offers, the worker claims.
  const prApprove = await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ type: 'task.approve_plan', taskId: prIntakeId }),
  });
  if (!prApprove.ok) throw new Error(`task.approve_plan (parked) failed ${prApprove.status}: ${await prApprove.text()}`);
  const prGoDl = Date.now() + 40_000;
  for (;;) {
    const [task] = await db.getAll<{ state: string }>('select state from tasks where id = ?', [prIntakeId]);
    if (['in_progress', 'in_review', 'done', 'accepted'].includes(task?.state ?? '')) break;
    if (Date.now() > prGoDl) throw new Error(`plan-review approval did not release the task (state=${task?.state ?? 'none'})`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // Hire gate: a room with an orchestrator but NO worker must propose a hire
  // (card in the channel), and the clicked accept must create+register the agent
  // (this machine), hand it the waiting task, and the fresh agent must pick it
  // up — the whole flow deterministic, no LLM (docs: orchestrator staffing).
  const humanMsg = (body: unknown) => fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify(body),
  });
  const [defProj] = await db.getAll<{ id: string }>(`select id from projects where workspace_id = '${DEV_WS}' and is_default = 1 limit 1`);
  if (!defProj) throw new Error('hire gate: no default project in the replica');
  const mkRoom = await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ type: 'channel.create', workspace: DEV_WS, project: defProj.id, slug: 'hire-lab', topic: 'staffing gate' }),
  });
  if (!mkRoom.ok) throw new Error(`hire gate: channel.create failed ${mkRoom.status}: ${(await mkRoom.text()).slice(0, 140)}`);
  const hireChId = ((await mkRoom.json()) as { channelId: string }).channelId;
  // orchestrators auto-join every room (addOrchestratorsToChannels) — wait for the membership to replicate
  const orchJoinDl = Date.now() + 20_000;
  for (;;) {
    const rows = await db.getAll(`select 1 from agent_channels ac join agents a on a.id = ac.agent_id where ac.channel_id = ? and a.role = 'orchestrator'`, [hireChId]);
    if (rows.length && hireChId) break;
    if (Date.now() > orchJoinDl) throw new Error('hire gate: orchestrator never joined the new room');
    await new Promise((r) => setTimeout(r, 250));
  }
  await humanMsg({ workspace: DEV_WS, channel: hireChId, body: '@echo-orch competitor SEO analysis of flowe.ai' });
  let hireTask: { id: string; number: number } | null = null;
  const hireIntakeDl = Date.now() + 30_000;
  for (;;) {
    const [t] = await db.getAll<{ id: string; number: number }>(`select id, number from tasks where channel_id = ? order by number desc limit 1`, [hireChId]);
    if (t) { hireTask = t; break; }
    if (Date.now() > hireIntakeDl) throw new Error('hire gate: intake task never opened');
    await new Promise((r) => setTimeout(r, 250));
  }
  // resolving requirements in the thread hits the staffing hole → hire card in the CHANNEL
  await humanMsg({ workspace: DEV_WS, channel: hireChId, taskId: hireTask!.id, body: 'Done = a short findings note. Proceed.' });
  const hireCardDl = Date.now() + 30_000;
  for (;;) {
    const card = await db.getAll(`select id from messages where channel_id = ? and task_id is null and body like '%Hire a new agent for #hire-lab%'`, [hireChId]);
    if (card.length >= 1) break;
    if (Date.now() > hireCardDl) throw new Error('hire gate: the hire card never appeared in the channel');
    await new Promise((r) => setTimeout(r, 250));
  }
  // the human clicks the accept (QuestionFlow posts the answer line verbatim)
  await humanMsg({ workspace: DEV_WS, channel: hireChId, body: `**Hire a new agent for #hire-lab to take #${hireTask!.number}?** → Hire @hire-lab-worker (worker)` });
  const hiredDl = Date.now() + 40_000;
  let hiredAgentId = '';
  for (;;) {
    const [a] = await db.getAll<{ id: string; machine_id: string; brief: string | null; member: number }>(
      `select a.id, a.machine_id, a.brief, exists(select 1 from agent_channels ac where ac.agent_id = a.id and ac.channel_id = ?) as member
       from agents a where a.workspace_id = '${DEV_WS}' and a.name = 'hire-lab-worker' limit 1`, [hireChId]);
    const [t] = await db.getAll<{ offered_agent_id: string | null; state: string }>(`select offered_agent_id, state from tasks where id = ?`, [hireTask!.id]);
    if (a && a.machine_id === thisMachineId() && a.member && a.brief === 'echo-mode stub worker' && (t?.offered_agent_id === a.id || ['in_progress', 'in_review', 'done'].includes(t?.state ?? ''))) { hiredAgentId = a.id; break; }
    if (Date.now() > hiredDl) throw new Error(`hire gate: accept did not hire+offer (agent=${a ? 'row' : 'none'} member=${a?.member ?? 0} brief=${a?.brief ?? 'null'} offered=${t?.offered_agent_id ?? 'null'} state=${t?.state ?? 'none'})`);
    await new Promise((r) => setTimeout(r, 250));
  }
  // the freshly hired agent must actually pick the task up (hosted by this daemon)
  const hireRunDl = Date.now() + 60_000;
  for (;;) {
    const [t] = await db.getAll<{ state: string; assignee_id: string | null }>(`select state, assignee_id from tasks where id = ?`, [hireTask!.id]);
    if (t && t.assignee_id === hiredAgentId && ['in_progress', 'in_review', 'done'].includes(t.state)) break;
    if (Date.now() > hireRunDl) throw new Error(`hire gate: hired agent never picked up #${hireTask!.number} (state=${t?.state ?? 'none'})`);
    await new Promise((r) => setTimeout(r, 250));
  }
  // progress marker: the smoke prints one summary line at the END, so a later
  // gate's (unrelated) failure would otherwise erase the proof this one passed
  console.log('SYNC_E2E progress: hire_gate=ok');

  // resume: claim+confirm via the API as the agent — the host's in-flight
  // guard knows nothing about it (exactly the post-restart state). The host
  // must notice the stranded in_progress task and run it to done.
  const t8 = Date.now();
  const echoId = (await db.get<{ id: string }>(`select id from agents where name = 'echo'`)).id;
  const strandRes = await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'strand me for resume' }),
  });
  const { task: stranded } = (await strandRes.json()) as { task: { id: string } };
  for (const cmd of [
    { type: 'task.claim', taskId: stranded.id },
    { type: 'task.confirm_requirements', taskId: stranded.id, checklist: ['resumed-gate'] },
  ]) {
    const r = await fetch(`${apiUrl()}/v1/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: echoId, role: 'worker' }) },
      body: JSON.stringify(cmd),
    });
    if (!r.ok) throw new Error(`strand ${cmd.type} failed ${r.status}`);
  }
  const sDeadline = Date.now() + 30_000;
  for (;;) {
    const [row] = await db.getAll<{ state: string }>('select state from tasks where id = ?', [stranded.id]);
    const note = await db.getAll(`select id from messages where task_id = ? and body like 'Resuming%'`, [stranded.id]);
    if (row?.state === 'done' && note.length >= 1) break;
    if (Date.now() > sDeadline) throw new Error(`resume loop timed out (state=${row?.state})`);
    await new Promise((r) => setTimeout(r, 250));
  }

  // memory spine: the orchestrator's sleep-time worker must refresh the
  // channel summary block and it must sync back to members
  const mDeadline2 = Date.now() + 30_000;
  for (;;) {
    const [blk] = await db.getAll<{ content: string; basis_count: number }>(
      `select mb.content, mb.basis_count from memory_blocks mb join channels c on c.id = mb.channel_id
       where c.slug = 'dev' and mb.kind = 'channel_summary'`,
    );
    if (blk && blk.content.length > 0 && Number(blk.basis_count) > 0) break;
    if (Date.now() > mDeadline2) throw new Error('channel summary block never refreshed/synced');
    await new Promise((r) => setTimeout(r, 300));
  }

  // fact store: the sleep-time pass must have distilled at least one valid fact
  const fDeadline = Date.now() + 30_000;
  for (;;) {
    const fr = await fetch(`${apiUrl()}/v1/recall`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
      body: JSON.stringify({ workspace: DEV_WS, query: 'channel status open tasks', k: 5 }),
    });
    const fj = (await fr.json()) as { hits: Array<{ kind: string }> };
    if (fj.hits.some((h) => h.kind === 'fact')) break;
    if (Date.now() > fDeadline) throw new Error('no fact distilled by the sleep-time pass');
    await new Promise((r) => setTimeout(r, 500));
  }

  // agent skills (W11): an authored skill must sync to the replica (where the
  // host's agents read it for load_skill) and carry channel scope
  await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: (await db.get<{ id: string }>(`select id from agents where name = 'echo-orch'`)).id, role: 'orchestrator' }) },
    body: JSON.stringify({ type: 'skill.create', workspace: DEV_WS, channel: 'dev', name: 'smoke-skill', description: 'a reusable procedure for the smoke gate', body: '# smoke-skill\nStep 1. Step 2.' }),
  });
  const skDeadline = Date.now() + 15_000;
  for (;;) {
    const [sk] = await db.getAll<{ scope: string; status: string }>(`select scope, status from skills where name = 'smoke-skill'`);
    if (sk && sk.status === 'active' && sk.scope === 'channel') break;
    if (Date.now() > skDeadline) throw new Error('authored skill never synced to the replica');
    await new Promise((r) => setTimeout(r, 250));
  }

  // self-learning (W11 slice 2): a worker proposes a draft → orchestrator
  // promotes it to active (the curation gate). Both must reach the replica.
  const echoId2 = (await db.get<{ id: string }>(`select id from agents where name = 'echo'`)).id;
  const orchId = (await db.get<{ id: string }>(`select id from agents where name = 'echo-orch'`)).id;
  const propRes = await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: echoId2, role: 'worker' }) },
    body: JSON.stringify({ type: 'skill.propose', workspace: DEV_WS, channel: 'dev', name: 'learned-skill', description: 'something a worker figured out', body: '# learned-skill\nDo the thing.' }),
  });
  const proposed = (await propRes.json()) as { skillId: string };
  await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: orchId, role: 'orchestrator' }) },
    body: JSON.stringify({ type: 'skill.promote', skillId: proposed.skillId }),
  });
  // leave one un-promoted draft so the curation UI has something to show
  await fetch(`${apiUrl()}/v1/commands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'agent', id: echoId2, role: 'worker' }) },
    body: JSON.stringify({ type: 'skill.propose', workspace: DEV_WS, channel: 'dev', name: 'pending-skill', description: 'awaiting human curation', body: '# pending-skill\nProposed by a worker; promote to make it active.' }),
  });
  const learnDeadline = Date.now() + 15_000;
  for (;;) {
    const [sk] = await db.getAll<{ status: string }>(`select status from skills where name = 'learned-skill'`);
    if (sk && sk.status === 'active') break;
    if (Date.now() > learnDeadline) throw new Error('proposed→promoted skill never reached active in the replica');
    await new Promise((r) => setTimeout(r, 250));
  }

  // skill packs (slice 1): a pack commits its skills (pack-scoped names let a pack
  // carry 'smoke-skill' alongside the standalone one). Toggling the pack OFF must
  // drop its skills from the agent DISCOVERY query — enable/disable is enforced.
  const orchActor = { kind: 'agent', id: orchId, role: 'orchestrator' };
  const packReq = (body: Record<string, unknown>) =>
    fetch(`${apiUrl()}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(orchActor) }, body: JSON.stringify(body) });
  const packCreate = await packReq({ type: 'skillpack.create', workspace: DEV_WS, channel: 'dev', name: 'smoke-pack', description: 'gate pack', sourceUrl: 'https://github.com/x/y', origin: 'imported' });
  if (!packCreate.ok) throw new Error(`skillpack.create failed ${packCreate.status}: ${(await packCreate.text()).slice(0, 140)}`);
  const packId = ((await packCreate.json()) as { packId: string }).packId;
  const commitRes = await packReq({ type: 'skillpack.commit', packId, version: 'deadbeef', skills: [
    { name: 'smoke-skill', description: 'same name as the standalone — pack-scoped', body: '# smoke-skill (pack)\nDo it.' },
    { name: 'pack-only-skill', description: 'only in the pack', body: '# pack-only-skill\nStep.' },
  ] });
  if (!commitRes.ok) throw new Error(`skillpack.commit failed ${commitRes.status}: ${(await commitRes.text()).slice(0, 140)}`);
  const devChId = (await db.get<{ id: string }>(`select id from channels where slug = 'dev' and workspace_id = '${DEV_WS}'`)).id;
  const discover = async () =>
    (await db.getAll<{ name: string }>(
      `select s.name from skills s left join skill_packs p on p.id = s.pack_id
       where s.status = 'active' and s.enabled = 1 and (s.pack_id is null or p.enabled = 1)
         and (s.channel_id = ? or (s.channel_id is null and s.workspace_id = ?))`,
      [devChId, DEV_WS],
    )).map((r) => r.name);
  const packDeadline = Date.now() + 15_000;
  for (;;) {
    const [pk] = await db.getAll<{ status: string }>(`select status from skill_packs where id = '${packId}'`);
    if (pk?.status === 'ready' && (await discover()).includes('pack-only-skill')) break;
    if (Date.now() > packDeadline) throw new Error('skill pack never reached ready + discoverable in the replica');
    await new Promise((r) => setTimeout(r, 250));
  }
  await packReq({ type: 'skillpack.set_enabled', packId, enabled: false });
  const offDeadline = Date.now() + 10_000;
  for (;;) {
    if (!(await discover()).includes('pack-only-skill')) break;
    if (Date.now() > offDeadline) throw new Error('disabled pack skills still discoverable');
    await new Promise((r) => setTimeout(r, 200));
  }
  await packReq({ type: 'skillpack.set_enabled', packId, enabled: true });
  const onDeadline = Date.now() + 10_000;
  for (;;) {
    if ((await discover()).includes('pack-only-skill')) break;
    if (Date.now() > onDeadline) throw new Error('re-enabled pack skills not discoverable');
    await new Promise((r) => setTimeout(r, 200));
  }
  // bundled defaults: seed_defaults populates #dev with gstack + addyosmani (idempotent)
  const seedRes = await packReq({ type: 'skillpack.seed_defaults', workspace: DEV_WS, channel: 'dev' });
  if (!seedRes.ok) throw new Error(`skillpack.seed_defaults failed ${seedRes.status}: ${(await seedRes.text()).slice(0, 140)}`);
  const seedDeadline = Date.now() + 20_000;
  for (;;) {
    const bundled = (await db.getAll<{ name: string }>(`select name from skill_packs where origin = 'bundled' and channel_id = '${devChId}'`)).map((p) => p.name);
    if (bundled.includes('gstack') && bundled.includes('agent-skills')) break;
    if (Date.now() > seedDeadline) throw new Error('bundled default packs never appeared after seed_defaults');
    await new Promise((r) => setTimeout(r, 300));
  }

  // curator import (slice 4): an 'imported' pack is cloned + parsed + committed by
  // the host watch (echo-curator runs it). A local git fixture over file:// drives
  // the REAL parser/clone/commit — no network. Two SKILL.md → ready with 2 skills.
  const fixture = await buildSkillRepoFixture();
  const importCreate = await packReq({ type: 'skillpack.create', workspace: DEV_WS, channel: 'dev', name: 'imported-pack', description: '', sourceUrl: `file://${fixture}`, origin: 'imported' });
  if (!importCreate.ok) throw new Error(`import skillpack.create failed ${importCreate.status}: ${(await importCreate.text()).slice(0, 140)}`);
  const importPackId = ((await importCreate.json()) as { packId: string }).packId;
  const importDeadline = Date.now() + 30_000;
  for (;;) {
    const [pk] = await db.getAll<{ status: string; error: string }>(`select status, error from skill_packs where id = '${importPackId}'`);
    if (pk?.status === 'error') throw new Error(`curator import errored: ${pk.error}`);
    if (pk?.status === 'ready') {
      const names = (await db.getAll<{ name: string }>(`select name from skills where pack_id = '${importPackId}' and status = 'active'`)).map((r) => r.name);
      if (names.includes('alpha-skill') && names.includes('beta-skill')) break;
      throw new Error(`imported pack ready but skills wrong: ${JSON.stringify(names)}`);
    }
    if (Date.now() > importDeadline) throw new Error('curator import never reached ready in the replica');
    await new Promise((r) => setTimeout(r, 250));
  }

  // slice 5: agents consider skills. Skills are now active in #dev, so mentioning
  // the orchestrator must log that it considered them (the inject log fires in
  // wake() for the echo path too). The model actually load_skill-ing one is a live
  // check; this proves the wiring (query + log) runs deterministically.
  const beforeInject = agentLog.query({ search: 'available in #', limit: 80 }).length;
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ workspace: DEV_WS, channel: 'dev', body: '@echo-orch which skills do we have available?' }),
  });
  const injectDeadline = Date.now() + 15_000;
  let skillConsider = false;
  for (;;) {
    if (agentLog.query({ search: 'available in #', limit: 80 }).length > beforeInject) { skillConsider = true; break; }
    if (Date.now() > injectDeadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!skillConsider) throw new Error('orchestrator did not log skill consideration after skills became available');

  // slice 6: a `/`-attached skill rides as a leading body marker (‹skill:name›).
  // The orchestrator parses + strips it and names the skill in its digest — proves
  // the marker transport end to end (the picker UI writes the same marker).
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ workspace: DEV_WS, channel: 'dev', body: '‹skill:smoke-skill› @echo-orch ship the slash-picker demo' }),
  });
  const slashDeadline = Date.now() + 20_000;
  let slashSteer = false;
  for (;;) {
    const [hit] = await db.getAll<{ body: string }>(
      `select m.body from messages m join agents a on a.id = m.author_id
       where m.author_kind = 'agent' and a.name = 'echo-orch' and m.task_id is null and m.body like '%smoke-skill%' and m.body like '%attached%'`,
    );
    if (hit) { slashSteer = true; break; }
    if (Date.now() > slashDeadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!slashSteer) throw new Error('orchestrator did not reflect the /-attached skill in its digest');

  // review validates requirements: a task that names a repo to commit to but is
  // submitted REPO-LESS (no branch/SHA) must be BOUNCED by the reviewer — not
  // rubber-stamped. Driven on a synthetic off-host worker so the host doesn't
  // re-execute the bounce; the on-host echo-reviewer does the review.
  {
    const human = { kind: 'human', id: actorId() };
    const orchActor = { kind: 'agent', id: orchId, role: 'orchestrator' };
    const rvCmd = (actor: unknown, body: Record<string, unknown>) =>
      fetch(`${apiUrl()}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
    const mreg = await rvCmd(human, { type: 'machine.register', workspace: DEV_WS, name: 'rv-worker', platform: 'seed', daemonVersion: '0.0.0' });
    const { machineId: rvMachine } = (await mreg.json().catch(() => ({}))) as { machineId?: string };
    const wreg = await rvCmd(human, { type: 'agent.register', workspace: DEV_WS, machineId: rvMachine, name: 'rv-dev', role: 'developer', channels: ['dev'] });
    const { agentId: rvWorker } = (await wreg.json().catch(() => ({}))) as { agentId?: string };
    const wactor = { kind: 'agent', id: rvWorker, role: 'developer' };
    const cr = await rvCmd(human, { type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'commit the page to the repo', kind: 'feature', description: 'Deliver a page committed to https://github.com/acme/rv-static.', checklist: ['Commit the file to acme/rv-static'] });
    const rvTask = ((await cr.json()) as { task: { id: string; number: number } }).task;
    await rvCmd(orchActor, { type: 'task.offer', taskId: rvTask.id, offerTo: 'rv-dev', checklist: ['Commit the file to acme/rv-static'] });
    await rvCmd(wactor, { type: 'task.claim', taskId: rvTask.id });
    await rvCmd(wactor, { type: 'task.submit', taskId: rvTask.id, artifacts: [{ kind: 'file', name: 'page.html', content: '<!doctype html><title>rv</title>' }] });
    const rvDl = Date.now() + 25_000;
    let rvBounced = false;
    for (;;) {
      const [task] = await db.getAll<{ state: string }>(`select state from tasks where id = '${rvTask.id}'`);
      const bounce = await db.getAll(`select id from messages where task_id = '${rvTask.id}' and body like '%changes requested%'`);
      if (bounce.length >= 1) { rvBounced = true; break; }
      if (['done', 'accepted'].includes(task?.state ?? '')) throw new Error('review_validates FAIL: repo-less task APPROVED despite a repo-commit requirement');
      if (Date.now() > rvDl) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!rvBounced) throw new Error('reviewer did not request changes for the repo-less task with a commit requirement');

    // re-review on re-submit (regression for "reviewer didn't re-review after a
    // re-submit"): the bounce put #N back in_progress; the worker re-submits the
    // SAME repo-less deliverable → the reviewer must review AGAIN and bounce AGAIN.
    // Without clearing the `reviewed` guard on leaving in_review, the 2nd review is
    // skipped and this stalls in in_review (only one 'changes requested' message).
    const ipDl = Date.now() + 10_000;
    for (;;) {
      const [task] = await db.getAll<{ state: string }>(`select state from tasks where id = '${rvTask.id}'`);
      if (task?.state === 'in_progress' || Date.now() > ipDl) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await rvCmd(wactor, { type: 'task.submit', taskId: rvTask.id, artifacts: [{ kind: 'file', name: 'page.html', content: '<!doctype html><title>rv v2</title>' }] });
    const rrDl = Date.now() + 25_000;
    let reReviewed = false;
    for (;;) {
      const bounces = await db.getAll(`select id from messages where task_id = '${rvTask.id}' and body like '%changes requested%'`);
      if (bounces.length >= 2) { reReviewed = true; break; }
      const [task] = await db.getAll<{ state: string }>(`select state from tasks where id = '${rvTask.id}'`);
      if (['done', 'accepted'].includes(task?.state ?? '')) throw new Error('rereview FAIL: repo-less task approved on re-submit');
      if (Date.now() > rrDl) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!reReviewed) throw new Error('rereview FAIL: reviewer did not re-review the re-submitted task (the `reviewed` guard was not cleared on leaving in_review)');

    // reopen-from-done: a simple task is approved → done; a human can still bounce
    // it back to in_progress for changes (the acceptance gate isn't a one-way ratchet).
    const cr2 = await rvCmd(human, { type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'write a short note', kind: 'feature' });
    const rwTask = ((await cr2.json()) as { task: { id: string } }).task;
    await rvCmd(orchActor, { type: 'task.offer', taskId: rwTask.id, offerTo: 'rv-dev', checklist: ['a note'] });
    await rvCmd(wactor, { type: 'task.claim', taskId: rwTask.id });
    await rvCmd(wactor, { type: 'task.submit', taskId: rwTask.id, artifacts: [{ kind: 'doc', name: 'note.md', content: '# note\nok' }] });
    const doneDl = Date.now() + 20_000;
    for (;;) {
      const [task] = await db.getAll<{ state: string }>(`select state from tasks where id = '${rwTask.id}'`);
      if (task?.state === 'done') break;
      if (Date.now() > doneDl) throw new Error(`reopen: task never reached done (state=${task?.state ?? 'none'})`);
      await new Promise((r) => setTimeout(r, 250));
    }
    const rcRes = await rvCmd(human, { type: 'task.request_changes', taskId: rwTask.id, feedback: 'actually this needs a different note' });
    if (!rcRes.ok) throw new Error(`reopen: human request_changes on a DONE task rejected ${rcRes.status}: ${(await rcRes.text()).slice(0, 140)}`);
    // The reopen is proven by the TRAIL, not by catching a transient: the echo rework loop can
    // re-submit and re-approve inside one poll interval (measured 185ms), so `in_progress` may
    // never be observable. Either sighting it OR a SECOND submission announcement with the task
    // settled again proves the done -> in_progress edge fired and the loop ran on the feedback.
    const reopenDl = Date.now() + 20_000;
    let reopened = false;
    for (;;) {
      const [task] = await db.getAll<{ state: string }>(`select state from tasks where id = '${rwTask.id}'`);
      if (task?.state === 'in_progress') { reopened = true; break; }
      const approvals = await db.getAll(`select id from messages where task_id = '${rwTask.id}' and body like '%Auto-review of%Approved%'`);
      if (approvals.length >= 2 && ['done', 'in_review'].includes(task?.state ?? '')) { reopened = true; break; }
      if (Date.now() > reopenDl) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!reopened) throw new Error('reopen FAIL: done task did not return to in_progress after request_changes');

    // repo.link: registering a GitHub repo makes it bindable. Post the command,
    // wait for the row to sync to the replica, prove idempotency, and that a task
    // can bind to it + derive a branch — the whole point (unblocks repo work).
    const rlRes = await rvCmd(human, { type: 'repo.link', workspace: DEV_WS, channel: 'dev', url: 'https://github.com/galonge/nmesh-gate' });
    if (!rlRes.ok) throw new Error(`repo_link FAIL: repo.link rejected ${rlRes.status}: ${(await rlRes.text()).slice(0, 140)}`);
    const rlBody = (await rlRes.json()) as { repoId: string; inserted: boolean };
    if (!rlBody.inserted) throw new Error('repo_link FAIL: first link should report inserted=true');
    const rlDl = Date.now() + 15_000;
    let rlSynced = false;
    for (;;) {
      const [r] = await db.getAll<{ id: string }>(`select id from repos where org_name = 'galonge' and name = 'nmesh-gate'`);
      if (r) { rlSynced = true; break; }
      if (Date.now() > rlDl) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    if (!rlSynced) throw new Error('repo_link FAIL: registered repo never synced to the replica');
    // idempotent: re-linking the same repo (even with .git) must not duplicate
    const rlAgain = await rvCmd(human, { type: 'repo.link', workspace: DEV_WS, url: 'https://github.com/galonge/nmesh-gate.git' });
    if (((await rlAgain.json()) as { inserted: boolean }).inserted) throw new Error('repo_link FAIL: re-link should report inserted=false');
    const [rlCountRow] = await db.getAll<{ n: number }>(`select count(*) as n from repos where org_name = 'galonge' and name = 'nmesh-gate'`);
    if (Number(rlCountRow?.n) !== 1) throw new Error(`repo_link FAIL: expected 1 repo row, found ${rlCountRow?.n}`);
    // bindable: a task created with the synced repo id becomes repo-backed (branch)
    const rlTaskRes = await rvCmd(human, { type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'use the registered repo', repo: { id: rlBody.repoId, baseRef: 'main' } });
    const rlTask = ((await rlTaskRes.json()) as { task: { repo?: { branch?: string } } }).task;
    if (!rlTask.repo?.branch) throw new Error('repo_link FAIL: task did not bind the registered repo (no branch)');

    // Definition of Done (the editable acceptance contract): a human sets a DoD on
    // a task; it must round-trip command → Postgres → replica so the card + the
    // reviewer read the same bar. A worker may NOT edit it (enforced, not prompted).
    // And an OFFERED task must carry the DoD the orchestrator passed at offer time.
    const dodTaskRes = await rvCmd(human, { type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'task with a definition of done' });
    const dodTaskId = ((await dodTaskRes.json()) as { task: { id: string } }).task.id;
    const dodText = 'PR opened against main, CI green, merged only after approval';
    const setRes = await rvCmd(human, { type: 'task.set_definition_of_done', taskId: dodTaskId, dod: dodText });
    if (!setRes.ok) throw new Error(`dod FAIL: set_definition_of_done rejected ${setRes.status}: ${(await setRes.text()).slice(0, 140)}`);
    const dodDl = Date.now() + 15_000;
    let dodSynced: string | undefined;
    for (;;) {
      const [r] = await db.getAll<{ definition_of_done: string }>(`select definition_of_done from tasks where id = '${dodTaskId}'`);
      if (r?.definition_of_done) { dodSynced = r.definition_of_done; break; }
      if (Date.now() > dodDl) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    if (dodSynced !== dodText) throw new Error(`dod FAIL: the Definition of Done never synced to the replica (got '${dodSynced ?? 'none'}')`);
    const dodDeny = await rvCmd(wactor, { type: 'task.set_definition_of_done', taskId: dodTaskId, dod: 'sneaky worker edit' });
    if (dodDeny.status !== 403) throw new Error(`dod FAIL: a worker editing the Definition of Done should be 403, got ${dodDeny.status}`);
    const dodOfferRes = await rvCmd(human, { type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'offered with a dod', kind: 'feature' });
    const dodOfferId = ((await dodOfferRes.json()) as { task: { id: string } }).task.id;
    const offDodText = 'offered bar: PR green, merged on accept';
    const offRes = await rvCmd(orchActor, { type: 'task.offer', taskId: dodOfferId, offerTo: 'rv-dev', checklist: ['the work'], definitionOfDone: offDodText });
    if (!offRes.ok) throw new Error(`dod FAIL: offer with definitionOfDone rejected ${offRes.status}: ${(await offRes.text()).slice(0, 140)}`);
    const offDl = Date.now() + 15_000;
    let offDod: string | undefined;
    for (;;) {
      const [r] = await db.getAll<{ definition_of_done: string }>(`select definition_of_done from tasks where id = '${dodOfferId}'`);
      if (r?.definition_of_done) { offDod = r.definition_of_done; break; }
      if (Date.now() > offDl) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    if (offDod !== offDodText) throw new Error(`dod FAIL: an offered task did not carry the Definition of Done (got '${offDod ?? 'none'}')`);

    // PR flow merge-on-accept (pr_merge): a repo-backed task that opened a PR is
    // squash-merged to its base ONLY when the human accepts — code reaches main
    // through the PR, never a direct commit. The real gh pr create/checks/merge
    // are founder-live-verified (a file:// fixture can't run GitHub); here a mocked
    // gh (NM_GH_FAKE=1) records the call so the merge-on-accept watch + FSM are
    // proven deterministically. Worker is on a synthetic machine (this host won't
    // execute it) so we inject the PR pointer instead of running a real push.
    const pmRepo = await rvCmd(human, { type: 'repo.link', workspace: DEV_WS, channel: 'dev', url: 'https://github.com/galonge/nmesh-merge' });
    const pmRepoId = ((await pmRepo.json()) as { repoId: string }).repoId;
    const pmMachineRes = await rvCmd(human, { type: 'machine.register', workspace: DEV_WS, name: 'pm-machine', platform: 'seed', daemonVersion: '0.0.0' });
    const pmMachine = ((await pmMachineRes.json()) as { machineId: string }).machineId;
    const pmDevRes = await rvCmd(human, { type: 'agent.register', workspace: DEV_WS, machineId: pmMachine, name: 'pm-dev', role: 'developer', channels: ['dev'] });
    const pmDevId = ((await pmDevRes.json()) as { agentId: string }).agentId;
    const pmDev = { kind: 'agent', id: pmDevId, role: 'developer' };
    const pmTaskRes = await rvCmd(human, { type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'pr-flow merge task', kind: 'feature', checklist: ['the change'], definitionOfDone: 'PR green, merged on accept', repo: { id: pmRepoId, baseRef: 'main' } });
    const pmTaskId = ((await pmTaskRes.json()) as { task: { id: string } }).task.id;
    await rvCmd(orchActor, { type: 'task.offer', taskId: pmTaskId, offerTo: 'pm-dev', checklist: ['the change'] });
    await rvCmd(pmDev, { type: 'task.claim', taskId: pmTaskId });
    const pmSubmit = await rvCmd(pmDev, { type: 'task.submit', taskId: pmTaskId, artifacts: [{ kind: 'diff', name: 'pm.diff', content: 'diff --git a b\n+x' }], sha: 'deadbee', prUrl: 'https://github.com/galonge/nmesh-merge/pull/7', prNumber: 7 });
    if (!pmSubmit.ok) throw new Error(`pr_merge FAIL: submit (with PR pointer) rejected ${pmSubmit.status}: ${(await pmSubmit.text()).slice(0, 140)}`);
    // the PR pointer must round-trip command -> Postgres -> replica
    const pmSyncDl = Date.now() + 15_000;
    let pmPr: { pr_url: string; pr_number: number } | undefined;
    for (;;) {
      const [tk] = await db.getAll<{ pr_url: string; pr_number: number }>(`select pr_url, pr_number from tasks where id = '${pmTaskId}'`);
      if (tk?.pr_number) { pmPr = tk; break; }
      if (Date.now() > pmSyncDl) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (pmPr?.pr_number !== 7) throw new Error(`pr_merge FAIL: the PR pointer never synced to the replica (got ${pmPr?.pr_number ?? 'none'})`);
    // reach done (the auto-reviewer approves; the CI gate is mocked 'none' so it proceeds)
    const pmDoneDl = Date.now() + 20_000;
    for (;;) {
      const [tk] = await db.getAll<{ state: string }>(`select state from tasks where id = '${pmTaskId}'`);
      if (tk?.state === 'done') break;
      if (Date.now() > pmDoneDl) throw new Error(`pr_merge FAIL: task never reached done (state=${(await db.getAll<{ state: string }>(`select state from tasks where id = '${pmTaskId}'`))[0]?.state ?? 'none'})`);
      await new Promise((r) => setTimeout(r, 250));
    }
    // human accept -> the merge-on-accept watch squash-merges + deletes the branch
    const pmAcc = await rvCmd(human, { type: 'task.accept', taskId: pmTaskId });
    if (!pmAcc.ok) throw new Error(`pr_merge FAIL: accept rejected ${pmAcc.status}: ${(await pmAcc.text()).slice(0, 140)}`);
    const pmMergeDl = Date.now() + 15_000;
    let pmMergeCall: string | undefined;
    for (;;) {
      pmMergeCall = ghFakeCalls.find((c) => /^pr merge galonge\/nmesh-merge 7\b.*--delete-branch/.test(c));
      if (pmMergeCall) break;
      if (Date.now() > pmMergeDl) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!pmMergeCall) throw new Error(`pr_merge FAIL: the merge-on-accept watch did not squash-merge the PR (gh calls: ${ghFakeCalls.join(' | ').slice(0, 240)})`);
    const pmMergeCount = ghFakeCalls.filter((c) => /^pr merge galonge\/nmesh-merge 7\b/.test(c)).length;
    if (pmMergeCount !== 1) throw new Error(`pr_merge FAIL: expected exactly 1 merge call for the PR, got ${pmMergeCount}`);

    // STOP a running task (stop): cancelling an in_progress task must (a) be legal
    // now (FSM in_progress->closed) and (b) abort the agent's in-flight run on this
    // host. Echo finishes too fast to catch a real run, so we inject an
    // AbortController into the execution registry (standing in for a live run) and
    // assert the cancel watch aborts it once the task lands in closed.
    const stopMachineRes = await rvCmd(human, { type: 'machine.register', workspace: DEV_WS, name: 'stop-machine', platform: 'seed', daemonVersion: '0.0.0' });
    const stopMachine = ((await stopMachineRes.json()) as { machineId: string }).machineId;
    const stopDevRes = await rvCmd(human, { type: 'agent.register', workspace: DEV_WS, machineId: stopMachine, name: 'stop-dev', role: 'developer', channels: ['dev'] });
    const stopDevId = ((await stopDevRes.json()) as { agentId: string }).agentId;
    const stopDev = { kind: 'agent', id: stopDevId, role: 'developer' };
    const stopTaskRes = await rvCmd(human, { type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'long-running task to stop', kind: 'feature', checklist: ['the work'] });
    const stopTaskId = ((await stopTaskRes.json()) as { task: { id: string } }).task.id;
    await rvCmd(orchActor, { type: 'task.offer', taskId: stopTaskId, offerTo: 'stop-dev', checklist: ['the work'] });
    await rvCmd(stopDev, { type: 'task.claim', taskId: stopTaskId }); // -> in_progress
    const stopAc = new AbortController();
    executing.set(stopTaskId, stopAc); // stand in for a live run on this host
    // a worker may NOT stop (enforced server-side, not prompted)
    const denyStop = await rvCmd(stopDev, { type: 'task.cancel', taskId: stopTaskId });
    if (denyStop.status !== 403) throw new Error(`stop FAIL: a worker stopping an in_progress task should be 403, got ${denyStop.status}`);
    if (stopAc.signal.aborted) throw new Error('stop FAIL: the run was aborted by a denied (worker) stop');
    // the human stops it -> closed (previously impossible from in_progress)
    const doStop = await rvCmd(human, { type: 'task.cancel', taskId: stopTaskId });
    if (!doStop.ok) throw new Error(`stop FAIL: human cancel of an in_progress task rejected ${doStop.status}: ${(await doStop.text()).slice(0, 140)}`);
    const stopDl = Date.now() + 15_000;
    let stopOk = false;
    for (;;) {
      const [tk] = await db.getAll<{ state: string }>(`select state from tasks where id = '${stopTaskId}'`);
      if (tk?.state === 'closed' && stopAc.signal.aborted) { stopOk = true; break; }
      if (Date.now() > stopDl) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!stopOk) {
      const [tk] = await db.getAll<{ state: string }>(`select state from tasks where id = '${stopTaskId}'`);
      throw new Error(`stop FAIL: expected state=closed + run aborted; got state=${tk?.state ?? 'none'} aborted=${stopAc.signal.aborted}`);
    }
    if (executing.has(stopTaskId)) throw new Error('stop FAIL: the execution registry was not cleared after the stop');

    // runtime seam (A2A multi-runtime): an agent registers with a non-claude
    // runtime; the column must round-trip command → Postgres → replica so the
    // host's runtimeFor() selects the right adapter. (Echo never runs the
    // adapter, so this proves the WIRING, not a live Codex/Gemini turn.)
    const arRes = await rvCmd(human, { type: 'agent.register', workspace: DEV_WS, machineId: rvMachine, name: 'seam-codex', role: 'developer', model: 'gpt-5-codex', runtime: 'codex', channels: ['dev'] });
    if (!arRes.ok) throw new Error(`runtime_seam FAIL: agent.register(runtime=codex) rejected ${arRes.status}: ${(await arRes.text()).slice(0, 140)}`);
    const seamCodexId = ((await arRes.json()) as { agentId?: string }).agentId;
    const rtDl = Date.now() + 15_000;
    let rtSynced: string | undefined;
    for (;;) {
      const [a] = await db.getAll<{ runtime: string }>(`select runtime from agents where workspace_id = '${DEV_WS}' and name = 'seam-codex'`);
      if (a?.runtime) { rtSynced = a.runtime; break; }
      if (Date.now() > rtDl) break;
      await new Promise((res) => setTimeout(res, 250));
    }
    if (rtSynced !== 'codex') throw new Error(`runtime_seam FAIL: expected runtime 'codex' on the replica, got '${rtSynced ?? 'none'}'`);
    // and the default claude-code agents must still read 'claude-code' (no regression)
    const [devRt] = await db.getAll<{ runtime: string }>(`select runtime from agents where workspace_id = '${DEV_WS}' and name = 'rv-dev'`);
    if (devRt && devRt.runtime !== 'claude-code') throw new Error(`runtime_seam FAIL: default agent runtime drifted to '${devRt.runtime}'`);

    // serve_card (A2A slice 3): the registered agent's A2A 1.0 card is generated +
    // stored at registration and served PUBLICLY (no x-nm-actor) for discovery.
    if (!seamCodexId) throw new Error('serve_card FAIL: agent.register returned no agentId');
    const cardRes = await fetch(`${apiUrl()}/a2a/agents/${seamCodexId}/card.json`); // no auth header — public
    if (!cardRes.ok) throw new Error(`serve_card FAIL: card endpoint ${cardRes.status} (must be public + populated)`);
    const card = (await cardRes.json()) as { name?: string; skills?: unknown[]; capabilities?: unknown; extensions?: string[]; ['x-neuramesh']?: { runtime?: string } };
    if (card.name !== 'seam-codex') throw new Error(`serve_card FAIL: card.name='${card.name}' (expected seam-codex)`);
    if (!Array.isArray(card.skills) || !card.skills.length || !card.capabilities || card['x-neuramesh']?.runtime !== 'codex') throw new Error('serve_card FAIL: card missing skills/capabilities/x-neuramesh.runtime');
    if (!card.extensions?.includes('https://neuramesh.app/a2a/ext/review/v1')) throw new Error('serve_card FAIL: card missing the review extension');
    // the well-known path resolves the same card via ?agent=
    const wkRes = await fetch(`${apiUrl()}/.well-known/a2a/agent-card.json?agent=${seamCodexId}`);
    if (!wkRes.ok || ((await wkRes.json()) as { name?: string }).name !== 'seam-codex') throw new Error('serve_card FAIL: well-known path did not resolve the agent card');

    // consume_a2a (A2A slice 4): a local A2A fixture server stands in for an
    // external agent — connect it by its card URL, offer it a task, and the host
    // delegates over A2A JSON-RPC → the returned artifact lands → the task reaches
    // review. Deterministic, no network (the fixture is in-process on 127.0.0.1).
    const http = await import('node:http');
    const fixture = http.createServer((req, res) => {
      const port = (fixture.address() as { port: number }).port;
      if (req.method === 'GET' && (req.url ?? '').includes('agent-card.json')) {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ name: 'a2a-fixture', description: 'A2A test agent', version: '1.0.0', url: `http://127.0.0.1:${port}/a2a`, capabilities: { streaming: false, pushNotifications: false }, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/plain'], skills: [{ id: 'echo', name: 'Echo', description: 'Returns a deliverable', tags: ['test'] }], securitySchemes: {}, extensions: ['https://neuramesh.app/a2a/ext/review/v1'], 'x-neuramesh': { role: 'developer' } }));
        return;
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (d) => { body += String(d); });
        req.on('end', () => {
          const rpc = JSON.parse(body || '{}') as { id?: unknown; params?: { message?: { contextId?: string } } };
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { id: 'a2a-task-1', contextId: rpc.params?.message?.contextId ?? 'ctx', status: { state: 'completed' }, artifacts: [{ artifactId: 'art-1', name: 'a2a-deliverable.md', parts: [{ kind: 'text', text: '# A2A deliverable\nDelivered by the external agent over A2A.' }] }] } }));
        });
        return;
      }
      res.statusCode = 404; res.end('{}');
    });
    await new Promise<void>((r) => fixture.listen(0, '127.0.0.1', () => r()));
    const fxPort = (fixture.address() as { port: number }).port;
    try {
      const connectRes = await rvCmd(human, { type: 'agent.connect_remote', workspace: DEV_WS, channels: ['dev'], cardUrl: `http://127.0.0.1:${fxPort}/.well-known/a2a/agent-card.json` });
      if (!connectRes.ok) throw new Error(`consume_a2a FAIL: connect_remote ${connectRes.status}: ${(await connectRes.text()).slice(0, 140)}`);
      if (((await connectRes.json()) as { name?: string }).name !== 'a2a-fixture') throw new Error('consume_a2a FAIL: remote agent name mismatch');
      // wait for the remote agent to sync to the replica (so the host watch sees it)
      const remDl = Date.now() + 15_000;
      for (;;) {
        const [a] = await db.getAll<{ kind: string }>(`select kind from agents where workspace_id = '${DEV_WS}' and name = 'a2a-fixture'`);
        if (a?.kind === 'remote') break;
        if (Date.now() > remDl) throw new Error('consume_a2a FAIL: remote agent never synced');
        await new Promise((r) => setTimeout(r, 250));
      }
      const rtaskRes = await rvCmd(human, { type: 'task.create', workspace: DEV_WS, channel: 'dev', title: 'remote A2A task', kind: 'feature' });
      const rtask = ((await rtaskRes.json()) as { task: { id: string } }).task;
      await rvCmd(orchActor, { type: 'task.offer', taskId: rtask.id, offerTo: 'a2a-fixture', checklist: ['produce a deliverable'] });
      // the host's remote-delegation watch claims + delegates over A2A + submits
      const dDl = Date.now() + 30_000;
      let rstate = '';
      for (;;) {
        const [t] = await db.getAll<{ state: string }>(`select state from tasks where id = '${rtask.id}'`);
        rstate = t?.state ?? '';
        if (['in_review', 'done', 'accepted'].includes(rstate)) break;
        if (rstate === 'blocked') throw new Error('consume_a2a FAIL: remote delegation blocked the task');
        if (Date.now() > dDl) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!['in_review', 'done', 'accepted'].includes(rstate)) throw new Error(`consume_a2a FAIL: task never reached review via A2A (state=${rstate})`);
      const [art] = await db.getAll<{ name: string }>(`select name from artifacts where task_id = '${rtask.id}' and name like 'a2a-%'`);
      if (!art) throw new Error('consume_a2a FAIL: the A2A artifact was not ingested into the task');
    } finally {
      fixture.close();
    }
  }

  // recall: hybrid endpoint must find the loop chatter under the 200ms budget
  const recallRes = await fetch(`${apiUrl()}/v1/recall`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify({ kind: 'human', id: actorId() }) },
    body: JSON.stringify({ workspace: DEV_WS, query: 'worktree loop', k: 5 }),
  });
  if (!recallRes.ok) throw new Error(`recall failed ${recallRes.status}`);
  const recall = (await recallRes.json()) as { hits: Array<{ body: string }>; ms: number };
  if (!recall.hits.length) throw new Error('recall returned no hits for known content');
  if (recall.ms > 200) throw new Error(`recall blew the 200ms budget: ${recall.ms}ms`);

  console.log(
    `SYNC_E2E=PASS first_sync_ms=${firstSyncMs} roundtrip_ms=${msgRoundtripMs} task_sync_ms=${taskSyncMs} channels=${chs.length} machine_presence=ok channel_worker_silent=ok agent_claim_ms=${claimMs} agent_loop_ms=${loopMs} accepted=ok repo_loop_ms=${repoLoopMs} repo_push=ok sha=${finalTask.submittedSha.slice(0, 7)} orch_loop_ms=${orchLoopMs} intake_thread=ok multi_intake=ok n=${multiIntakeN} plan_flow=ok plan_review_gate=ok hire_gate=ok resume_ms=${Date.now() - t8} diff_artifact=ok library_promote=ok memory_block=ok facts=ok skills=ok skill_learn=ok skill_packs=ok pack_toggle=ok bundled_packs=ok pack_import=ok skill_consider=ok slash_skill=ok review_validates=ok rereview=ok reopen_from_done=ok repo_link=ok dod=ok pr_merge=ok stop=ok runtime_seam=ok serve_card=ok consume_a2a=ok recall_ms=${recall.ms}`,
  );
  await db.disconnectAndClear();
  await db.close();
}
