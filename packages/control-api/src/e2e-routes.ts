// THE CLOUD RUN END-TO-END TEST'S DOORS (scripts/e2e-cloudrun/README.md). A sandbox deploy has no
// Clerk and no Stripe, so three facts a real user earns there (an account, a paid plan, credits) and
// two moves the fleet makes on its own schedule (a grow drain, an idle stop) need a way in for the
// driver. Each door is the row write the real path makes, nothing more: the drain doors set exactly
// what fleet-cloudrun.ts's walk and the idle sweep (fleet-cloudrun-sweep.ts) set, so the machine
// drains, snapshots and resizes or parks through the production code.
//
// INERT UNLESS BOTH: NM_E2E_ROUTES=1 on the process (server.ts mounts this file only then; the Vercel
// entry never does) and the fleet secret on the call. Never set NM_E2E_ROUTES on a deploy real
// people use: the user door makes accounts and the fund door grants credits.
import { bearerIs, e2eSecret } from './bearer-auth';
import { createEvent, formatAddress } from '@neuramesh/shared';
import type { Env, Hono } from 'hono';
import { z } from 'zod';
import { creditBalance, grantCredits } from './credit-ledger';
import { ledgerFor, sqlOf, type StarterFetch } from './credits';
import { dueProjects, memoryRefreshConfig, refreshProject } from './project-memory-refresh';
import { decideIntake, intakeConfig, readContext } from './intake';
import { asSize, nextSize, SIZE_ORDER, planMaxSize } from './fleet-cloudrun';
import { STOP_DRAIN_SECONDS } from './fleet-cloudrun-sweep';
import { routineRunnerBump } from './fleet-lifecycle';
import { configuredSnapshotStorage, signV4 } from './gcs-sign';
import { COLS as PARK_COLS, toPark, type ParkRow } from './machine-parks';
import { SIGNED_URL_SECONDS, snapshotObject } from './machine-snapshots';
import { routineWakeHorizonMin, wakeForDueRoutines } from './routines-wake';
import type { Store } from './store';

export const e2eRoutesOn = (): boolean => process.env['NM_E2E_ROUTES'] === '1';

const UserSchema = z.object({ email: z.string().email().max(200) });
const FundSchema = z.object({ plan: z.enum(['free', 'cloud']).optional(), credits: z.number().int().min(1).max(100_000).optional() });
const ResizeSchema = z.object({ sizeClass: z.enum(SIZE_ORDER).optional() });
const SEGMENT = /^[A-Za-z0-9][\w.-]{0,79}$/;
/** A git URL inside the machine's own work dir, never a path that climbs out of it. The machine
 *  clones with its own git, so a URL anywhere else (another host, the supervisor's state dir) would
 *  make this door a way to point a cloud machine at code no person attached. */
export const E2E_REPO_URL = /^file:\/\/\/nm\/work\/(?:[\w.-]+\/)*[\w.-]+$/;
const RepoSchema = z.object({
  channel: z.string().uuid(),
  name: z.string().regex(SEGMENT),
  org: z.string().regex(SEGMENT).optional(),
  cloneUrl: z.string().max(300).regex(E2E_REPO_URL).refine((u) => !u.split('/').some((s) => s === '..' || s === '.'), 'no dot segments'),
  defaultBranch: z.string().regex(SEGMENT).optional(),
});
const uuid = (raw: string): string | null => (z.string().uuid().safeParse(raw).success ? raw : null);

export function e2eRoutes<E extends Env>(app: Hono<E>, store: Store, opts: { starterFetch?: StarterFetch } = {}): void {
  // constant time, and its own secret when the deploy sets NM_E2E_SECRET (bearer-auth.ts, R10 NM-107)
  const ok = (auth: string | undefined): boolean => e2eRoutesOn() && bearerIs(auth, e2eSecret());

  // an account without Clerk: the same nm_users row /auth/clerk makes, under an `e2e|` subject no
  // Clerk id can collide with. Idempotent by email. The driver then acts with x-nm-actor (the lane
  // NM_ALLOW_ACTOR_HEADER=1 opens), exactly as the repo's other e2e scripts do.
  app.post('/internal/e2e/users', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const body = UserSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'name the email', code: 'INVALID_INPUT' }, 400);
    const { id, created } = await store.resolveClerkUser(`e2e|${body.data.email.toLowerCase()}`, body.data.email);
    return c.json({ userId: id, created }, created ? 201 : 200);
  });

  // the plan flip and a top-up without Stripe (plan-flip.ts writes the same two facts). The plan
  // sets the largest class a grow may reach (fleet-cloudrun.ts PLAN_MAX: free M, cloud XL)
  app.post('/internal/e2e/workspaces/:id/fund', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const ws = uuid(c.req.param('id'));
    const body = FundSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!ws || !body.success) return c.json({ error: 'invalid input', code: 'INVALID_INPUT' }, 400);
    if (body.data.plan) await sql`update workspaces set plan = ${body.data.plan} where id = ${ws}::uuid`;
    if (body.data.credits) await grantCredits(sql, ws, body.data.credits, 'manual', 'e2e-cloudrun');
    const [w] = await sql<{ plan: string }[]>`select plan from workspaces where id = ${ws}::uuid`;
    // the balance in micros rides the answer: a body of {} reads it, so a check can watch the meter
    // move by less than a credit (Always on bills 6 credits an hour, machine-beat.ts)
    return w ? c.json({ workspaceId: ws, plan: w.plan, remainingMicros: (await creditBalance(sql, ws)).remainingMicros }) : c.json({ error: 'no such workspace' }, 404);
  });

  // OUT OF CREDITS, on demand: a workspace that worked its balance down to zero. The sandbox has no
  // Stripe and no way to spend 500 credits quickly, and the cap drain (fleet-cloudrun-sweep.ts) only
  // acts at a zero balance. Both pools go to spent, the clamp chargeMachineActivity applies when work
  // outruns the balance. No machine_usage row: no machine time or model call happened. The fund door
  // above is the top-up that undoes it.
  app.post('/internal/e2e/workspaces/:id/spend-all', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const ws = uuid(c.req.param('id'));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!ws) return c.json({ error: 'invalid workspace id', code: 'INVALID_INPUT' }, 400);
    const [row] = await sql<{ granted_micros: string; spent_micros: string; purchased_micros: string; purchased_spent_micros: string }[]>`
      update workspace_credits
         set spent_micros = greatest(spent_micros, granted_micros),
             purchased_spent_micros = greatest(purchased_spent_micros, purchased_micros),
             updated_at = now()
       where workspace_id = ${ws}::uuid
       returning granted_micros, spent_micros, purchased_micros, purchased_spent_micros`;
    if (!row) return c.json({ error: 'no credit row for that workspace', code: 'NOT_FOUND' }, 404);
    const remaining = Math.max(0, Number(row.granted_micros) - Number(row.spent_micros)) + Math.max(0, Number(row.purchased_micros) - Number(row.purchased_spent_micros));
    console.log(`e2e_spend_all workspace=${ws} remaining_micros=${remaining}`);
    return c.json({ workspaceId: ws, remainingMicros: remaining });
  });

  // THE ROUTINE WAKE PASS, for one workspace: GET /internal/routines-due (the cron) with its auth
  // swapped for the fleet secret, which is all the e2e driver holds, and its reach cut to the
  // driver's own workspace, so a check never wakes another lane's runner. Same query, same bump
  // (fleet-lifecycle.ts routineRunnerBump), same verdict read back from the row.
  app.post('/internal/e2e/workspaces/:id/routines-due', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const ws = uuid(c.req.param('id'));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!ws) return c.json({ error: 'invalid workspace id', code: 'INVALID_INPUT' }, 400);
    const horizon = routineWakeHorizonMin();
    const out = await wakeForDueRoutines(sql, routineRunnerBump, horizon, ws);
    console.log(`e2e_routines_due workspace=${ws} horizon=${horizon}m considered=${out.considered.length} woken=[${out.woken.join(',')}] capped=[${out.capped.join(',')}]`);
    return c.json({ ...out, horizonMin: horizon });
  });

  // THE PROJECT MEMORY PASS, for one workspace (D15): GET /internal/memory-refresh (the cron) with its
  // auth swapped for the fleet secret and its reach cut to the driver's own workspace. Same due query,
  // same claim, same metered starter call (project-memory-refresh.ts). `force` winds the workspace's
  // project blocks back by one window first, so a check need not wait an hour for the rate limit.
  app.post('/internal/e2e/workspaces/:id/memory-refresh', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const ws = uuid(c.req.param('id'));
    const body = z.object({ force: z.boolean().optional() }).safeParse(await c.req.json().catch(() => ({})));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!ws || !body.success) return c.json({ error: 'invalid input', code: 'INVALID_INPUT' }, 400);
    const key = process.env['STARTER_GOOGLE_API_KEY'];
    const config = memoryRefreshConfig();
    if (!key || !config.intervalMinutes) return c.json({ error: 'the memory refresh is off or the starter brain is not served here', code: 'UNAVAILABLE' }, 503);
    if (body.data.force) {
      await sql`update memory_blocks set updated_at = updated_at - make_interval(mins => ${config.intervalMinutes}::int)
        where workspace_id = ${ws}::uuid and kind = 'project_summary'`;
    }
    const deps = { store, sql, ledger: ledgerFor(store), fetchFn: opts.starterFetch ?? ((u: string, i: RequestInit) => fetch(u, i)), key, config };
    const outcomes: Array<{ project: string; outcome: string }> = [];
    for (const p of await dueProjects(sql, { ...config, batch: 50 }, ws)) outcomes.push({ project: p.id, outcome: await refreshProject(deps, p) });
    const blocks = await sql`select project_id, content, basis_count, updated_at from memory_blocks
      where workspace_id = ${ws}::uuid and kind = 'project_summary' order by updated_at desc`;
    console.log(`e2e_memory_refresh workspace=${ws} force=${!!body.data.force} outcomes=${outcomes.map((o) => o.outcome).join(',') || 'none'}`);
    return c.json({ outcomes, blocks });
  });

  // INTAKE WITH NO THREAD (round 9, the intake eval): the same decision a first message gets (intake.ts
  // decideIntake: the metered starter brain with the strict schema, the build rule beside it, the
  // fallbacks), for any text, with no thread and no write. `projectId` names whose repositories and team
  // the decision reads, else the workspace's default project. The answer is the stored shape.
  app.post('/internal/e2e/intake', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const body = z.object({ workspace: z.string().uuid(), text: z.string().min(1).max(4000), projectId: z.string().uuid().optional() })
      .safeParse(await c.req.json().catch(() => null));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!body.success) return c.json({ error: 'name the workspace and the text', code: 'INVALID_INPUT' }, 400);
    const { workspace, text, projectId } = body.data;
    const [project] = await sql<{ id: string }[]>`select id from projects where workspace_id = ${workspace}::uuid
      and (${projectId ?? null}::uuid is null or id = ${projectId ?? null}::uuid) order by (id = ${projectId ?? null}::uuid) desc nulls last, is_default desc, created_at limit 1`;
    if (projectId && project?.id !== projectId) return c.json({ error: 'no such project in this workspace' }, 404);
    const ctx = await readContext(sql, { workspace, projectId: project?.id ?? null });
    const v = await decideIntake({ ledger: ledgerFor(store), fetchFn: opts.starterFetch ?? ((u: string, i: RequestInit) => fetch(u, i)), config: intakeConfig() },
      { workspace, body: text, ctx, startedAt: Date.now() });
    console.log(`e2e_intake workspace=${workspace} kind=${v.decision?.kind ?? 'none'} source=${v.decision?.source ?? 'none'} workspace_mode=${v.effects.workspaceMode ?? 'none'} ms=${v.ms}${v.why ? ` why=${v.why}` : ''}`);
    return c.json({ decision: v.decision, effects: v.effects, rule: v.rule, why: v.why || null, ms: v.ms, repos: ctx.repos });
  });

  // every park of a workspace, any status, newest first: GET /v1/parks lists only the open ones, and
  // the driver must see a resolved park get claimed by a later epoch and marked done
  app.get('/internal/e2e/workspaces/:id/parks', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const ws = uuid(c.req.param('id'));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!ws) return c.json({ error: 'invalid workspace id', code: 'INVALID_INPUT' }, 400);
    const rows = await sql<ParkRow[]>`select ${PARK_COLS(sql)} from parks p where p.workspace_id = ${ws}::uuid order by p.created_at desc limit 50`;
    return c.json({ parks: rows.map(toPark) });
  });

  // THE STAND-IN FOR THE GITHUB APP CONNECT, for the Cloud Run coding evals
  // (scripts/e2e-cloudrun/coding-evals.mjs). A cloud machine's Code session clones repos.clone_url
  // (relay/engineering-workspace.ts). repo.link takes only github.com URLs, and the sandbox has no
  // GitHub App to connect a repository with. It is not the product path for non-GitHub repos. This door
  // writes the row and the project link repo.link writes (store.linkRepo, the room's project), with a
  // clone URL under the machine's /nm/work: the driver puts a bare repository there first, so the
  // machine then runs its real clone, fetch and worktree path. Provider `git`, never `github`, so no
  // code treats it as a GitHub repository.
  app.post('/internal/e2e/workspaces/:id/repos', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const ws = uuid(c.req.param('id'));
    const body = RepoSchema.safeParse(await c.req.json().catch(() => null));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!ws || !body.success) return c.json({ error: 'name the room, the repository and a file:///nm/work/... clone URL', code: 'INVALID_INPUT' }, 400);
    const [room] = await sql<{ project_id: string | null }[]>`select project_id from channels where id = ${body.data.channel}::uuid and workspace_id = ${ws}::uuid`;
    if (!room) return c.json({ error: 'no such room in this workspace', code: 'NOT_FOUND' }, 404);
    if (!room.project_id) return c.json({ error: 'the room has no project to hold the repository', code: 'NO_PROJECT' }, 409);
    const orgName = body.data.org ?? 'coding-evals';
    const event = createEvent({
      type: 'repo.linked',
      source: formatAddress({ kind: 'resource', type: 'e2e', id: 'repo-door' }),
      target: formatAddress({ kind: 'resource', type: 'repo', id: `${orgName}-${body.data.name}`.replace(/[^A-Za-z0-9._-]/g, '-') }),
      workspace: ws,
      payload: { orgName, name: body.data.name, provider: 'git', channel: body.data.channel },
    });
    const { id, inserted } = await store.linkRepo(
      { workspace: ws, channel: body.data.channel, project: room.project_id, provider: 'git', orgName, name: body.data.name, defaultBranch: body.data.defaultBranch ?? 'main', cloneUrl: body.data.cloneUrl, localPath: null },
      event,
    );
    console.log(`e2e_repo workspace=${ws} repo=${id} inserted=${inserted}`);
    return c.json({ repoId: id, inserted, projectId: room.project_id, label: `${orgName}/${body.data.name}` }, inserted ? 201 : 200);
  });

  // what the driver watches: the machine row's fleet columns (none of them ride the replica)
  app.get('/internal/e2e/machines/:id', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const id = uuid(c.req.param('id'));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!id) return c.json({ error: 'invalid machine id' }, 400);
    const [row] = await sql<Record<string, unknown>[]>`
      select m.id, m.workspace_id, m.kind, m.substrate, m.lifecycle, m.desired_replicas, m.epoch::int as epoch,
             m.restarts::int as restarts, m.size_class, m.drain_state, m.drain_reason, m.drain_deadline, m.drain_lost_at,
             m.parked_at, m.snapshot_work, m.snapshot_box, m.mem_pct, m.used_mib, m.limit_mib, m.last_seen_at, m.last_active_at, m.billed_through,
             m.last_wake_at, m.started_at, m.token_epoch::int as token_epoch, m.token_expires_at,
             (m.boot_credential_hash is not null) as has_boot_credential, w.plan
        from machines m join workspaces w on w.id = m.workspace_id where m.id = ${id}::uuid`;
    return row ? c.json(row) : c.json({ error: 'no such machine' }, 404);
  });

  // THE GROW DRAIN, on demand: what applyMachineStatus writes at memPct >= FLEET_CLOUDRUN_DRAIN_PCT
  // (drain_state requested, reason grow). The walk then picks the next class under the plan's
  // ceiling, so a `sizeClass` other than that one is refused rather than silently ignored.
  app.post('/internal/machines/:id/resize', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const id = uuid(c.req.param('id'));
    const body = ResizeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!id || !body.success) return c.json({ error: 'invalid input', code: 'INVALID_INPUT' }, 400);
    const [row] = await sql<{ size_class: string | null; plan: string; epoch: string }[]>`
      select m.size_class, w.plan, m.epoch from machines m join workspaces w on w.id = m.workspace_id
       where m.id = ${id}::uuid and m.substrate = 'cloudrun'`;
    if (!row) return c.json({ error: 'no cloudrun machine with that id' }, 404);
    const next = nextSize(asSize(row.size_class), planMaxSize(row.plan));
    if (!next) return c.json({ error: `already at the ${row.plan} plan's largest class`, code: 'AT_CEILING' }, 409);
    if (body.data.sizeClass && body.data.sizeClass !== next) {
      return c.json({ error: `a grow from ${asSize(row.size_class)} goes to ${next}, not ${body.data.sizeClass}`, code: 'NOT_NEXT_CLASS', next }, 409);
    }
    const [moved] = await sql<{ id: string }[]>`
      update machines set drain_state = 'requested', drain_reason = 'grow'
       where id = ${id}::uuid and substrate = 'cloudrun' and desired_replicas = 1 and drain_state is null
       returning id`;
    if (!moved) return c.json({ error: 'the machine is asleep or already draining', code: 'NOT_RUNNING' }, 409);
    console.log(`e2e_resize machine=${id} from=${asSize(row.size_class)} to=${next} epoch=${row.epoch}`);
    return c.json({ requested: true, from: asSize(row.size_class), to: next, epoch: Number(row.epoch) });
  });

  // THE IDLE STOP, on demand: what cloudRunSweep writes after NM_IDLE_STOP_MIN without work (draining,
  // reason idle, the 3-minute deadline). The drained report parks the machine (desired 0)
  app.post('/internal/machines/:id/idle-drain', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const id = uuid(c.req.param('id'));
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!id) return c.json({ error: 'invalid machine id' }, 400);
    const [moved] = await sql<{ epoch: string }[]>`
      update machines set drain_state = 'draining', drain_reason = 'idle',
             drain_deadline = now() + make_interval(secs => ${STOP_DRAIN_SECONDS}::int)
       where id = ${id}::uuid and substrate = 'cloudrun' and desired_replicas = 1 and drain_state is null
       returning epoch`;
    if (!moved) return c.json({ error: 'the machine is asleep or already draining', code: 'NOT_RUNNING' }, 409);
    console.log(`e2e_idle_drain machine=${id} epoch=${moved.epoch}`);
    return c.json({ requested: true, epoch: Number(moved.epoch), deadlineSeconds: STOP_DRAIN_SECONDS });
  });

  // what the driver reads instead of a replica: a workspace's messages since a moment, oldest first.
  // The test waits on an agent-authored row here, exactly what claim-e2e reads from postgres.
  app.get('/internal/e2e/workspaces/:id/messages', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const ws = uuid(c.req.param('id'));
    const since = new Date(c.req.query('since') ?? 0);
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!ws || !Number.isFinite(since.getTime())) return c.json({ error: 'invalid input', code: 'INVALID_INPUT' }, 400);
    const rows = await sql<Record<string, unknown>[]>`
      select m.id, m.channel_id, m.task_id, m.author_kind, m.author_id, m.body, m.created_at
        from messages m where m.workspace_id = ${ws}::uuid and m.created_at > ${since}
       order by m.created_at limit 200`;
    return c.json({ messages: rows });
  });

  // THE WORK DIR, FROM OUTSIDE: a signed GET for the machine's latest work snapshot (the key its last
  // drain stored), so the driver can open the tar and see what /work carried across a drain without
  // asking the agent. Same object naming and signer as POST /v1/machines/snapshots/sign.
  app.get('/internal/e2e/machines/:id/snapshot', async (c) => {
    if (!ok(c.req.header('authorization'))) return c.json({ error: 'forbidden' }, 403);
    const sql = sqlOf(store);
    const id = uuid(c.req.param('id'));
    const storage = configuredSnapshotStorage();
    if (!sql) return c.json({ error: 'needs postgres' }, 501);
    if (!storage) return c.json({ error: 'NM_SNAPSHOT_GCS_BUCKET is not set', code: 'SNAPSHOTS_UNAVAILABLE' }, 503);
    if (!id) return c.json({ error: 'invalid machine id' }, 400);
    const [row] = await sql<{ workspace_id: string; snapshot_work: string | null }[]>`select workspace_id, snapshot_work from machines where id = ${id}::uuid`;
    if (!row?.snapshot_work) return c.json({ error: 'no work snapshot stored for this machine', code: 'NOT_FOUND' }, 404);
    const object = snapshotObject('snapshot', row.workspace_id, id, row.snapshot_work);
    const url = await signV4({ bucket: storage.bucket, object, method: 'GET', expiresSeconds: SIGNED_URL_SECONDS }, storage.signer);
    return c.json({ key: row.snapshot_work, object, url });
  });
}
