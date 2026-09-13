// The `nm:debug-seed-*` fixtures — extracted from sync.ts (track B-sync).
//
// Dev-only: each seeds rows a shot/evidence run needs (logs with token costs, a plan in
// review, a lessons set, a DoD, a PR, a skill import). They were registered
// unconditionally in EVERY build — runtime-gated on NM_ALLOW_DEBUG, but present — so a
// signed release carried seven fixture writers it could never legitimately run.
//
// startSync now imports this module only when the harness opts in, which keeps it out of
// the shipped bundle entirely rather than merely unreachable.
//
// WS and actorId are imported (not passed) so they stay ESM LIVE bindings: WS changes when
// the app switches workspace, and a value captured at registration would seed into the
// workspace you started in.
import { ipcMain } from 'electron';
import type { PowerSyncDatabase } from '@powersync/node';
import type { AgentLog } from '../../agentlog';
import { actorId, apiUrl, ws } from '../../sync';

export interface DebugSeedDeps {
  db: () => PowerSyncDatabase;
  agentLog: AgentLog;
}

export function registerDebugSeed({ db, agentLog }: DebugSeedDeps): void {
// shot-harness only: seed token-bearing activity so the Activity evidence has
// realistic rows (claude-mode usage; gates force echo, which logs no tokens).
// Always registered (avoids a registration race), but a no-op unless the
// harness opted in via NM_ALLOW_DEBUG — never reachable in a normal run.
ipcMain.handle('nm:debug-seed-logs', async () => {
  if (process.env['NM_ALLOW_DEBUG'] !== '1') return { ok: false };
  {
    const sink = agentLog.for({ agentId: 'dbg', agentName: 'rex', taskNumber: 1004, channelSlug: 'dev' });
    sink({ kind: 'wake', phase: 'claimed', summary: 'woke on #1004 — claiming the orchestrated demo loop' });
    // skill consideration (slice 5): the agent scans available skills before
    // improvising, then loads the fitting one and follows it
    sink({ kind: 'tool', phase: 'inject', summary: '3 skills available — scan before improvising' });
    sink({ kind: 'tool', phase: 'call', summary: 'load_skill frontend-ui-engineering (agent-skills)' });
    sink({ kind: 'exec', phase: 'start', summary: 'worktree nm/1004-orchestrated-demo-loop prepared · base main' });
    sink({ kind: 'tool', phase: 'use', summary: 'Edit index.html — render the demo shell' });
    sink({ kind: 'tool', phase: 'result', summary: '→ wrote index.html (1.4kb)' });
    sink({ kind: 'turn', phase: 'success', summary: 'replied (412 tok, 1.8s)', tokens: 5230 });
    sink({ kind: 'tool', phase: 'result', summary: '→ screenshot captured (1280×720) for validation' });
    sink({ kind: 'result', phase: 'error', summary: 'lint failed [exit 1] — retrying', level: 'error' });
    sink({ kind: 'result', phase: 'success', summary: 'completed 47s · pushed nm/1004 @ 0ee4c97', tokens: 18740 });
    return { ok: true };
  }
});
// shot-harness only: seed a held plan_review task (with a plan artifact) so the
// Phase-3 inline-comment review UI has something to render. [review] keeps the
// orchestrator from auto-offering it; the architect may also draft (harmless).
ipcMain.handle('nm:debug-seed-plan', async () => {
  if (process.env['NM_ALLOW_DEBUG'] !== '1') return { ok: false };
  const orch = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
  const arch = { kind: 'agent', id: '20000000-0000-0000-0000-000000000004', role: 'architect' };
  const cmd = (actor: unknown, body: Record<string, unknown>) =>
    fetch(`${apiUrl()}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
  const ch = await db().getAll<{ slug: string }>(`select slug from channels where workspace_id = ? order by slug limit 1`, [ws()]);
  const channel = ch[0]?.slug ?? 'dev';
  const create = await cmd({ kind: 'human', id: actorId() }, { type: 'task.create', workspace: ws(), channel, title: '[review] Build the auth module', kind: 'feature', description: 'demo task for the plan-review UI', checklist: ['working auth'] });
  if (!create.ok) return { ok: false, error: (await create.text()).slice(0, 160) };
  const task = ((await create.json()) as { task: { id: string; number: number } }).task;
  await cmd(orch, { type: 'task.request_plan', taskId: task.id });
  const plan = `# Implementation Plan: Build the auth module\n\n## Approach\nEmail + password auth with sessions. Hash with \`argon2id\`, store sessions in a signed \`httpOnly\` cookie, rotate on privilege change. Reuse the existing \`users\` table; add a \`sessions\` table.\n\n> [!IMPORTANT]\n> **Assumption:** we own first-party auth — no external IdP (Google/GitHub SSO) is required for v1. Confirm before we build local password auth, since adding SSO later changes the session model.\n\n> [!TIP]\n> **Recommendation:** tune \`argon2id\` to ~250ms on the target hardware and pin the params in config so they can be raised over time without breaking existing hashes.\n\n## Steps\n1. Add the \`sessions\` table + migration:\n\n\`\`\`sql\ncreate table sessions (\n  id          uuid primary key default gen_random_uuid(),\n  user_id     uuid not null references users(id) on delete cascade,\n  expires_at  timestamptz not null,\n  created_at  timestamptz not null default now()\n);\ncreate index on sessions (user_id);\n\`\`\`\n\n2. \`POST /auth/login\` — verify the password, issue a session cookie.\n3. \`POST /auth/logout\` — revoke the session.\n4. Middleware: load the session, attach the user, refresh near expiry.\n5. Rate-limit login by IP + account.\n\n## Risks & fallbacks\n- Timing attacks on verify — use a constant-time compare.\n- Session fixation — rotate the id on login.\n- Lockout DoS — cap attempts per account, not just per IP.\n\n> [!NOTE]\n> **Open question:** should sessions use sliding expiry (refresh on each use) or an absolute lifetime? The plan assumes sliding with a 14-day hard cap.\n\n## Validation\n- Unit: hash/verify round-trip, expiry, rotation.\n- E2E: login → protected route → logout → 401.\n- A screenshot of the login flow.`;
  await cmd(arch, { type: 'task.propose_plan', taskId: task.id, plan }).catch(() => {});
  // simulate one review round so the fixture has TWO versions: a human requests
  // changes, the architect re-drafts → implementation-plan-v2.md (the latest)
  await cmd(orch, { type: 'task.revise_plan', taskId: task.id, feedback: 'Account for Google SSO; pin the cookie flags.' }).catch(() => {});
  const planV2 = `# Implementation Plan: Build the auth module\n\n## Approach\nEmail + password auth with sessions, **plus an optional Google SSO path** (per review). Hash with \`argon2id\`, store sessions in a signed \`httpOnly\` cookie pinned to \`SameSite=Lax; Secure; Path=/\`, rotate on privilege change. Reuse the existing \`users\` table; add a \`sessions\` table.\n\n> [!TIP]\n> **Resolved (v1 → v2):** added Google SSO as an optional sign-in and pinned the cookie flags, per the review comments on v1.\n\n> [!IMPORTANT]\n> **Assumption:** SSO is additive — local password auth stays the primary path. Confirm the OAuth client is provisioned before we wire the callback.\n\n## Steps\n1. Add the \`sessions\` table + migration:\n\n\`\`\`sql\ncreate table sessions (\n  id          uuid primary key default gen_random_uuid(),\n  user_id     uuid not null references users(id) on delete cascade,\n  expires_at  timestamptz not null,\n  created_at  timestamptz not null default now()\n);\ncreate index on sessions (user_id);\n\`\`\`\n\n2. \`POST /auth/login\` — verify the password, issue a session cookie.\n3. \`GET /auth/google\` + \`/auth/google/callback\` — OAuth sign-in, same session model.\n4. \`POST /auth/logout\` — revoke the session.\n5. Middleware: load the session, attach the user, refresh near expiry.\n6. Rate-limit login by IP + account.\n\n## Risks & fallbacks\n- Timing attacks on verify — use a constant-time compare.\n- Session fixation — rotate the id on login.\n- Account linking — match SSO identities to existing emails, don't duplicate users.\n\n## Validation\n- Unit: hash/verify round-trip, expiry, rotation.\n- E2E: password login → protected route → logout → 401; Google login → same.\n- A screenshot of both sign-in flows.`;
  await cmd(arch, { type: 'task.propose_plan', taskId: task.id, plan: planV2 }).catch(() => {});
  // orchestrator review message points the human at the LATEST version
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(orch) },
    body: JSON.stringify({
      workspace: ws(), channel, taskId: task.id,
      body: `📐 Plan revised for #${task.number} → see **implementation-plan-v2.md** (incorporates your review of v1).`,
    }),
  }).catch(() => {});
  await fetch(`${apiUrl()}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(orch) },
    body: JSON.stringify({
      workspace: ws(), channel, taskId: task.id,
      body: `📋 The implementation plan for #${task.number} “${'Build the auth module'}” is ready for your review — see **implementation-plan-v2.md** in the artifacts. Nothing executes until you approve.`,
    }),
  }).catch(() => {});
  return { ok: true, number: task.number };
});

// NM_ALLOW_DEBUG seed: a finished task in `in_review` carrying real deliverable
// artifacts (an interactive HTML page + an image + a result doc) AND an approved
// plan, for the validation-panel + read-only-plan UI. Drives the full command
// path: create → plan → approve(offer) → claim → submit(deliverables).
ipcMain.handle('nm:debug-seed-review', async () => {
  if (process.env['NM_ALLOW_DEBUG'] !== '1') return { ok: false };
  const human = { kind: 'human', id: actorId() };
  const orch = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
  const arch = { kind: 'agent', id: '20000000-0000-0000-0000-000000000004', role: 'architect' };
  const cmd = (actor: unknown, body: Record<string, unknown>) =>
    fetch(`${apiUrl()}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
  const ch = await db().getAll<{ slug: string }>(`select slug from channels where workspace_id = ? order by slug limit 1`, [ws()]);
  const channel = ch[0]?.slug ?? 'dev';
  // register the worker on a SYNTHETIC machine (not this host's) so the running
  // AgentHost won't auto-claim/execute it — the seed drives it deterministically
  const mreg = await cmd(human, { type: 'machine.register', workspace: ws(), name: 'seed-worker', platform: 'seed', daemonVersion: '0.0.0' });
  const { machineId: seedMachine } = (await mreg.json().catch(() => ({}))) as { machineId?: string };
  const wreg = await cmd(human, { type: 'agent.register', workspace: ws(), machineId: seedMachine, name: 'echo-dev', role: 'developer', channels: [channel] });
  const { agentId: workerId } = (await wreg.json().catch(() => ({}))) as { agentId?: string };
  const wactor = { kind: 'agent', id: workerId, role: 'developer' };
  const create = await cmd(human, { type: 'task.create', workspace: ws(), channel, title: 'Gamified 404 page with playable Snake', kind: 'feature', description: 'A self-contained HTML 404 page with a fully playable Snake game. Deliverable is a single local HTML file (no repo).', checklist: ['Single self-contained HTML file', 'Fully playable Snake game on canvas', 'Works on desktop + mobile'] });
  if (!create.ok) return { ok: false, error: (await create.text()).slice(0, 160) };
  const task = ((await create.json()) as { task: { id: string; number: number } }).task;
  await cmd(orch, { type: 'task.request_plan', taskId: task.id });
  await cmd(arch, { type: 'task.propose_plan', taskId: task.id, plan: `# Implementation Plan: Gamified 404 Page\n\n## Approach\nA single self-contained \`404.html\` — all CSS and JS inlined, zero external dependencies — delivering a fully playable Snake game on a dark-themed 404 page.\n\n## Steps\n1. HTML skeleton + 404 messaging.\n2. Snake game loop on a \`<canvas>\`.\n3. Touch + keyboard controls.\n\n## Validation\n- Plays in-browser with no server.\n- A screenshot of each game state.` }).catch(() => {});
  await cmd(orch, { type: 'task.offer', taskId: task.id, offerTo: 'echo-dev', checklist: ['plan approved'] }).catch(() => {});
  await cmd(wactor, { type: 'task.claim', taskId: task.id }).catch(() => {});
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{height:100%;margin:0}body{font-family:system-ui,-apple-system,sans-serif;background:radial-gradient(120% 120% at 50% 0%,#13203a,#0a0f1c);color:#e6edf3;display:grid;place-items:center}.card{background:#11182a;border:1px solid #243049;border-radius:18px;padding:40px 52px;text-align:center;box-shadow:0 28px 70px -22px rgba(0,0,0,.7)}h1{margin:0;font-size:64px;font-weight:800;letter-spacing:-2px;background:linear-gradient(90deg,#3ECF8E,#22d3ee);-webkit-background-clip:text;background-clip:text;color:transparent}p{color:#9fb0c9;margin:6px 0 22px}.n{font-size:46px;font-weight:800;color:#3ECF8E;margin-bottom:14px}button{background:#3ECF8E;color:#06281b;border:none;border-radius:11px;padding:13px 26px;font-size:15px;font-weight:700;cursor:pointer}button:hover{filter:brightness(1.07)}</style></head><body><div class="card"><h1>404</h1><p>This page slithered away — interactive demo deliverable.</p><div class="n" id="n">0</div><button onclick="window.c=(window.c||0)+1;document.getElementById('n').textContent=window.c">Click me — I run in the sandbox</button></div></body></html>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="320" viewBox="0 0 520 320"><rect width="520" height="320" fill="#0b1220"/><text x="260" y="135" font-family="system-ui,sans-serif" font-size="96" font-weight="800" fill="#3ECF8E" text-anchor="middle">404</text><text x="260" y="180" font-family="system-ui,sans-serif" font-size="22" fill="#9fb0c9" text-anchor="middle">This page slithered away</text><rect x="170" y="214" width="180" height="48" rx="24" fill="#3ECF8E"/><text x="260" y="244" font-family="system-ui,sans-serif" font-size="17" font-weight="700" fill="#06281b" text-anchor="middle">▶  Play Snake</text></svg>`;
  await cmd(wactor, { type: 'task.submit', taskId: task.id, artifacts: [
    { kind: 'file', name: 'demo.html', content: html },
    { kind: 'screenshot', name: 'snake-preview.svg', content: svg },
    { kind: 'doc', name: 'result.md', content: '# Result\n\nShipped a self-contained, fully playable 404 page — see `demo.html`. Screenshots captured for each game state.' },
  ] }).catch(() => {});
  // approve so it lands in `done` (awaiting human acceptance) — the dogfood has
  // no reviewer agent; the human is also a valid reviewer
  await cmd(human, { type: 'task.approve', taskId: task.id }).catch(() => {});
  return { ok: true, number: task.number };
});

// NM_ALLOW_DEBUG seed: channel memory for the Memory-view evidence shot — the summary
// block, two durable facts, and two LESSONS (review-correction norms with task
// provenance) so the "Lessons from reviews" section renders with real data. Human
// actor throughout: block/fact writes are human-allowed; record_lesson takes any teammate.
ipcMain.handle('nm:debug-seed-lessons', async () => {
  if (process.env['NM_ALLOW_DEBUG'] !== '1') return { ok: false };
  const human = { kind: 'human', id: actorId() };
  const cmd = (actor: unknown, body: Record<string, unknown>) =>
    fetch(`${apiUrl()}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
  // a slug can repeat across projects (each project owns its own #dev) and a fresh
  // shot profile activates the DEFAULT project — seed the channel the app can see
  const ch = await db().getAll<{ id: string; slug: string }>(
    `select c.id, c.slug from channels c join projects p on p.id = c.project_id
     where c.workspace_id = ? order by p.is_default desc, c.slug limit 1`,
    [ws()],
  );
  const channel = ch[0];
  if (!channel) return { ok: false };
  const create = await cmd(human, { type: 'task.create', workspace: ws(), channel: channel.slug, title: 'Polish desktop sign-in + create-account flow', description: 'Component polish with screenshot evidence for review.' });
  if (!create.ok) return { ok: false, error: (await create.text()).slice(0, 160) };
  const task = ((await create.json()) as { task: { id: string; number: number } }).task;
  await cmd(human, { type: 'memory.refresh_block', workspace: ws(), channel: channel.id, content: `#${channel.slug}: sign-in polish is in review; the evidence flow was tightened after #${task.number} — renders attach as artifacts, mock HTML stays out of PRs. Board otherwise quiet.`, basisCount: 12 });
  await cmd(human, { type: 'memory.upsert_fact', workspace: ws(), channel: channel.id, content: 'the team decided review evidence attaches as artifacts on the task, rendered by the cockpit' });
  await cmd(human, { type: 'memory.upsert_fact', workspace: ws(), channel: channel.id, content: 'releases ship backend before desktop; migrations auto-apply on the prod deploy' });
  await cmd(human, { type: 'memory.record_lesson', workspace: ws(), channel: channel.id, content: 'mock evidence HTML is review evidence, never committed — stage it under .nm-evidence/ and attach renders as artifacts', taskId: task.id });
  await cmd(human, { type: 'memory.record_lesson', workspace: ws(), channel: channel.id, content: 'screenshots named in the Definition of Done must be attached as image artifacts before submit — prose claims do not pass review' });
  return { ok: true, slug: channel.slug, number: task.number };
});

// NM_ALLOW_DEBUG seed: a repo-backed task in_progress (an EDITABLE state) carrying
// a Definition of Done (the PR-flow acceptance contract) — drives the editable
// DoD-card shot (view + edit). Worker lives on a synthetic machine so this host's
// AgentHost won't auto-execute it; the seed just parks it at the editable state.
ipcMain.handle('nm:debug-seed-dod', async () => {
  if (process.env['NM_ALLOW_DEBUG'] !== '1') return { ok: false };
  const human = { kind: 'human', id: actorId() };
  const orch = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
  const cmd = (actor: unknown, body: Record<string, unknown>) =>
    fetch(`${apiUrl()}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
  const ch = await db().getAll<{ slug: string }>(`select slug from channels where workspace_id = ? order by slug limit 1`, [ws()]);
  const channel = ch[0]?.slug ?? 'dev';
  const rl = await cmd(human, { type: 'repo.link', workspace: ws(), channel, url: 'https://github.com/galonge/nmesh-auth' });
  const { repoId } = (await rl.json().catch(() => ({}))) as { repoId?: string };
  const dod = '- Rate limiting active on `POST /login` — 5 attempts / 15 min per IP; past the limit returns HTTP 429.\n- Unit + integration tests cover the limit boundary and the reset window; the suite is green.\n- Delivered as a **pull request** against `main` with CI checks passing — merged only after approval (never committed straight to main).';
  const checklist = ['429 past the limit', 'tests cover the boundary + reset window'];
  const create = await cmd(human, { type: 'task.create', workspace: ws(), channel, title: 'Rate-limit the login endpoint', kind: 'feature', description: 'Add IP-based rate limiting to `POST /login` to blunt credential-stuffing.', checklist, definitionOfDone: dod, ...(repoId ? { repo: { id: repoId, baseRef: 'main' } } : {}) });
  if (!create.ok) return { ok: false, error: (await create.text()).slice(0, 160) };
  const task = ((await create.json()) as { task: { id: string; number: number } }).task;
  const mreg = await cmd(human, { type: 'machine.register', workspace: ws(), name: 'seed-dod', platform: 'seed', daemonVersion: '0.0.0' });
  const { machineId } = (await mreg.json().catch(() => ({}))) as { machineId?: string };
  const wreg = await cmd(human, { type: 'agent.register', workspace: ws(), machineId, name: 'dod-dev', role: 'developer', channels: [channel] });
  const { agentId } = (await wreg.json().catch(() => ({}))) as { agentId?: string };
  await cmd(orch, { type: 'task.offer', taskId: task.id, offerTo: 'dod-dev', checklist }).catch(() => {});
  await cmd({ kind: 'agent', id: agentId, role: 'developer' }, { type: 'task.claim', taskId: task.id }).catch(() => {});
  return { ok: true, number: task.number };
});

// NM_ALLOW_DEBUG seed: a repo-backed task driven to `done` carrying a PULL
// REQUEST pointer (url/number) — drives the PR-link shot (the meta rail link +
// "accept to merge"). Worker on a synthetic machine; the PR pointer is injected
// on submit (no real push) and NM_GH_FAKE keeps the reviewer's CI check hermetic.
ipcMain.handle('nm:debug-seed-pr', async () => {
  if (process.env['NM_ALLOW_DEBUG'] !== '1') return { ok: false };
  const human = { kind: 'human', id: actorId() };
  const orch = { kind: 'agent', id: '20000000-0000-0000-0000-000000000002', role: 'orchestrator' };
  const cmd = (actor: unknown, body: Record<string, unknown>) =>
    fetch(`${apiUrl()}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(actor) }, body: JSON.stringify(body) });
  const ch = await db().getAll<{ slug: string }>(`select slug from channels where workspace_id = ? order by slug limit 1`, [ws()]);
  const channel = ch[0]?.slug ?? 'dev';
  const rl = await cmd(human, { type: 'repo.link', workspace: ws(), channel, url: 'https://github.com/galonge/nmesh-auth' });
  const { repoId } = (await rl.json().catch(() => ({}))) as { repoId?: string };
  const dod = '- Rate limiting active on `POST /login` — returns HTTP 429 past the limit.\n- Delivered as a **pull request** against `main`, CI green, merged only after approval.';
  const checklist = ['429 past the limit', 'tests cover the boundary'];
  const create = await cmd(human, { type: 'task.create', workspace: ws(), channel, title: 'Rate-limit the login endpoint', kind: 'feature', description: 'Add IP-based rate limiting to `POST /login`.', checklist, definitionOfDone: dod, ...(repoId ? { repo: { id: repoId, baseRef: 'main' } } : {}) });
  if (!create.ok) return { ok: false, error: (await create.text()).slice(0, 160) };
  const task = ((await create.json()) as { task: { id: string; number: number } }).task;
  const mreg = await cmd(human, { type: 'machine.register', workspace: ws(), name: 'seed-pr', platform: 'seed', daemonVersion: '0.0.0' });
  const { machineId } = (await mreg.json().catch(() => ({}))) as { machineId?: string };
  const wreg = await cmd(human, { type: 'agent.register', workspace: ws(), machineId, name: 'pr-dev', role: 'developer', channels: [channel] });
  const { agentId } = (await wreg.json().catch(() => ({}))) as { agentId?: string };
  const wactor = { kind: 'agent', id: agentId, role: 'developer' };
  await cmd(orch, { type: 'task.offer', taskId: task.id, offerTo: 'pr-dev', checklist }).catch(() => {});
  await cmd(wactor, { type: 'task.claim', taskId: task.id }).catch(() => {});
  await cmd(wactor, { type: 'task.submit', taskId: task.id, artifacts: [{ kind: 'diff', name: `nm-${task.number}.diff`, content: 'diff --git a/login.ts b/login.ts\n+ rate limiter' }], sha: 'a1b2c3d', prUrl: `https://github.com/galonge/nmesh-auth/pull/12`, prNumber: 12 }).catch(() => {});
  await cmd(human, { type: 'task.approve', taskId: task.id }).catch(() => {}); // -> done, PR open, awaiting accept
  return { ok: true, number: task.number };
});

// NM_ALLOW_DEBUG seed: three imported skill packs in #general (which has no
// Curator — the dogfood curator lives in #dev — so these states stay put for
// the shot): a mid-import stepper, an error+retry, and a finished imported pack.
ipcMain.handle('nm:debug-seed-import', async () => {
  if (process.env['NM_ALLOW_DEBUG'] !== '1') return { ok: false };
  const human = { kind: 'human', id: actorId() };
  const cmd = (body: Record<string, unknown>) =>
    fetch(`${apiUrl()}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nm-actor': JSON.stringify(human) }, body: JSON.stringify(body) });
  const mk = async (name: string, description: string, sourceUrl: string) =>
    ((await (await cmd({ type: 'skillpack.create', workspace: ws(), channel: 'general', name, description, sourceUrl, origin: 'imported' })).json()) as { packId?: string }).packId;
  // 1. mid-import — the stepper sits on "Scan"
  const a = await mk('acme-playbooks', 'Acme internal engineering playbooks', 'https://github.com/acme/playbooks');
  if (a) await cmd({ type: 'skillpack.update', packId: a, step: 'Scanning for skills…', progress: 55 });
  // 2. failed import — error + Retry
  const b = await mk('legacy-skills', '', 'https://github.com/acme/legacy');
  if (b) await cmd({ type: 'skillpack.update', packId: b, status: 'error', step: 'Import failed', error: 'repository not found — check the URL is a public GitHub repo' });
  // 3. finished import — "imported" + version chip + skills
  const c = await mk('team-rituals', 'Standups, retros, and release rituals', 'https://github.com/acme/rituals');
  if (c) await cmd({ type: 'skillpack.commit', packId: c, version: 'a1b2c3d4e5f6', skills: [
    { name: 'standup-async', description: 'Run an async daily standup', body: '# standup-async\nPost blockers by 10am.' },
    { name: 'retro-blameless', description: 'Facilitate a blameless retro', body: '# retro-blameless\nWhat went well, what didn’t, one change.' },
    { name: 'release-checklist', description: 'Ship a release safely', body: '# release-checklist\nTag, changelog, deploy, watch dashboards.' },
  ] });
  return { ok: true };
});
}
