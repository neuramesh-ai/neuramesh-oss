import { applyShare, type BrainOverride, parseBrainOverride, serializeBrainOverride, attachmentUpgradeReason, buildAgentCard, flowForChannelKind, FREE_SEAT_CAP, planLabel, seatLimitReason, readAnswers, taskBranch, threadModeOf, threadTitle, type ActorRef, type Beat, type BeatStatus, type NMEvent, type Run, type RunSettleState, type RetroPayload, type RetroRange, type Task, type TaskKind, type TaskState, type ThreadMode, priceActiveSeconds } from '@neuramesh/shared';
import { trackDomainEvent } from './analytics';
import { createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { embed } from './embedder';
import { DomainError } from './errors';
import { dueContentItemsSql, upcomingContentItemsSql, type DueItem, type UpcomingItem } from './store/content-reads';
import { setThreadMachineSql, workspaceMachine } from './store/thread-machine';
import { latestHumanWordSql, setThreadSettledSql, threadTaskIdSql } from './store/thread-settle';
import { markScheduleResultSql, setScheduleCursorSql } from './store/release-routine';
import { seedBundledPacksSql } from './store/skillpack-seed';
import { PgAnnounceStore } from './store/announce';
import { PgFilmStore } from './store/films';
import { computeRetro } from './retro';
import { SKILL_SEED } from './seed/skill-seed';
import { MARKETING_SKILL_SEED } from './seed/marketing-skill-seed';
import { MARKETING_OS_SKILL_SEED } from './seed/marketing-os-skill-seed';
import type { LifecycleRow } from './lifecycle';
import { computeFleetDesired, createCloudMachine, machineByTokenHash, rotateMachineToken, type CloudMachineCreate, type FleetDesired, type MachineIdentityRow } from './fleet';
import { machineWorkspace, type MachineAttachRow } from './relay';
import { bumpMachineWake, machineSweep, machineUsageToday, type MachineSweepResult } from './fleet-lifecycle';
import { chargeMachineActivity } from './credit-ledger';
import { localMode } from './localmode';
import { schemaVersionSql, seedLocalUserSql, userIdForLocalTokenHashSql, type LocalUserSeed } from './store/local-identity';
import type { ArtifactRow, AttachmentInput, DecisionRow, DecisionSeed, DesktopAuthResult, MutationResult, NMMessage, PolicyInput, PolicyRow, RunInput, ScheduleInput, Store, VideoMeta, WhiteboardCreate, WhiteboardLwwPatch, WhiteboardMeta, WhiteboardRow, WhiteboardUpdate } from './store';

type Row = Record<string, any>;
// postgres.js TransactionSql isn't assignable to Sql in the typings even
// though it's call-compatible; normalize at the begin() boundary.
const asSql = (tx: unknown): postgres.Sql => tx as postgres.Sql;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Resolve a channel reference to its UUID id — the ONLY unambiguous key now that a slug can
// repeat across projects within a workspace (each project owns its own #dev/#general). `ref` is a
// channel id (preferred; callers that hold the row pass this) or a legacy slug. A slug is scoped to
// `projectId` when the caller knows it; otherwise the default project's channel wins (deterministic
// legacy fallback). Throws NOT_FOUND if nothing matches.
async function resolveChannelId(
  sql: postgres.Sql,
  workspace: string,
  ref: string,
  projectId?: string | null,
): Promise<string> {
  if (UUID_RE.test(ref)) {
    const [c] = await sql`select id from channels where id = ${ref}::uuid and workspace_id = ${workspace}::uuid`;
    if (c) return c['id'] as string;
    throw new DomainError('NOT_FOUND', `channel ${ref} not found`);
  }
  const rows = projectId
    ? await sql`select id from channels where workspace_id = ${workspace}::uuid and project_id = ${projectId}::uuid and slug = ${ref}`
    : await sql`select c.id from channels c join projects p on p.id = c.project_id
        where c.workspace_id = ${workspace}::uuid and c.slug = ${ref} order by p.is_default desc limit 1`;
  if (!rows.length) throw new DomainError('NOT_FOUND', `channel ${ref} not found`);
  return rows[0]!['id'] as string;
}

export class PostgresStore implements Store {
  /** the pool, readable by modules that own their own SQL (credits.ts) rather than
   *  becoming five more delegates on a file already at its size cap */
  readonly sql: postgres.Sql;
  private ann?: PgAnnounceStore;
  get announcements(): PgAnnounceStore { return (this.ann ??= new PgAnnounceStore(this.sql)); }
  private filmStore: PgFilmStore | undefined;   get films(): PgFilmStore { return (this.filmStore ??= new PgFilmStore(this.sql)); }

  constructor(url: string) {
    // prepare:false keeps Supavisor pooler compatibility.
    //
    // SERVERLESS POOL HYGIENE. On Vercel this store is a per-instance singleton, and a warm
    // instance lingers for minutes between requests. With no idle_timeout it HOARDS its `max`
    // connections for its whole life, so a burst of concurrent instances (a cold-start flood, the
    // push-token spam) multiplies out past Supavisor's 200-client cap. That is the EMAXCONN that
    // 500s /v1/commands, sign-in, and the agent wake — the message that shows "thinking" forever.
    // Serverless keeps a small pool and releases idle connections fast; the long-running local and
    // daemon process keeps its warm pool unchanged.
    const serverless = !!process.env['VERCEL'];
    this.sql = postgres(url, {
      max: serverless ? 3 : 5,
      idle_timeout: serverless ? 20 : 0,
      connect_timeout: 15,
      prepare: false,
      onnotice: () => {},
    });
  }

  async close() {
    await this.sql.end();
  }

  // Agent Retro aggregation (docs/13) — read-only, rides existing indexes.
  async retro(workspace: string, range: RetroRange, dayStart: number): Promise<RetroPayload> {
    return computeRetro(this.sql, workspace, range, dayStart);
  }

  // fleet desired state — the nm-fleet operator's poll (docs/design/cloud-first-2026-08).
  // fleet, relay, lifecycle and local-identity delegates in the one-line shape — the pgstore
  // ratchet cap leaves no room for the three-line one.
  async fleetDesired(): Promise<FleetDesired> { return computeFleetDesired(this.sql); }

  async createCloudMachine(m: CloudMachineCreate): Promise<{ id: string }> { return createCloudMachine(this.sql, m); }

  async machineByTokenHash(hash: string): Promise<MachineIdentityRow | null> { return machineByTokenHash(this.sql, hash); }

  async rotateMachineToken(machineId: string, tokenHash: string): Promise<{ id: string } | null> { return rotateMachineToken(this.sql, machineId, tokenHash); }

  // the local stack's one human (0138) — store/local-identity.ts
  async seedLocalUser(input: LocalUserSeed): Promise<{ id: string }> { return seedLocalUserSql(this.sql, input); }

  async userIdForLocalTokenHash(hash: string): Promise<string | null> { return userIdForLocalTokenHashSql(this.sql, hash); }

  async schemaVersion(): Promise<string | null> { return schemaVersionSql(this.sql); }
  async machineWorkspace(machineId: string): Promise<MachineAttachRow | null> { return machineWorkspace(this.sql, machineId); }

  async bumpMachineWake(workspaceId: string, originUserId: string | null = null): Promise<void> { await bumpMachineWake(this.sql, workspaceId, originUserId); }

  async machineSweep(intervalMin: number): Promise<MachineSweepResult> { return machineSweep(this.sql, intervalMin); }

  async machineUsageToday(workspaceId: string): Promise<{ day: string; minutes: number }> { return machineUsageToday(this.sql, workspaceId); }


  async nextTaskNumber(workspace: string): Promise<number> {
    const [r] = await this.sql`select nm_next_task_number(${workspace}::uuid) as n`;
    return Number(r!['n']);
  }

  private rowToTask(r: Row): Task {
    const actor = (kind: string | null, id: string | null): ActorRef | null =>
      kind && id ? { kind: kind as ActorRef['kind'], id } : null;
    return {
      id: r['id'],
      workspace: r['workspace_id'],
      channel: r['channel_slug'],
      project: r['project_slug'] ?? null,
      number: r['number'],
      title: r['title'],
      description: r['description'],
      state: r['state'],
      kind: r['kind'] ?? null,
      creator: actor(r['creator_kind'], r['creator_id'])!,
      assignee: actor(r['assignee_kind'], r['assignee_id']),
      offeredAgentId: r['offered_agent_id'] ?? null,
      repo: r['repo_id'] ? { id: r['repo_id'], baseRef: r['base_ref'] ?? 'main', branch: r['branch'] ?? '' } : null,
      submittedSha: r['submitted_sha'],
      prUrl: r['pr_url'] ?? '',
      prNumber: r['pr_number'] ?? null,
      artifactCount: r['artifact_count'],
      blockedFrom: r['blocked_from'] ?? null,
      requirements: r['requirements'] ?? null,
      requirementsConfirmed: r['requirements_confirmed'],
      planApprovedAt: r['plan_approved_at'] ? new Date(r['plan_approved_at'] as string).toISOString() : null,
      definitionOfDone: r['definition_of_done'] ?? '',
      shipPlan: r['ship_plan'] ?? null,
      workPlan: r['work_plan'] ?? null,
      originThreadId: r['origin_thread_id'] ?? null,
      parentTaskId: r['parent_task_id'] ?? null,
      version: r['version'],
      createdAt: new Date(r['created_at']).toISOString(),
      updatedAt: new Date(r['updated_at']).toISOString(),
    };
  }

  private async insertEvent(sql: postgres.Sql, e: NMEvent, taskId: string | null) {
    await sql`insert into events (id, workspace_id, type, source, target, task_id, payload, in_reply_to)
      values (${e.id}, ${e.workspace}::uuid, ${e.type}, ${e.source}, ${e.target}, ${taskId}, ${sql.json(e.payload as never)}, ${e.in_reply_to})`;
    // Activation-funnel telemetry: event-level only, no content, no-op without POSTHOG_KEY.
    // Enqueued (not awaited) so it never adds latency to the command path; over-counting on
    // the rare txn rollback is acceptable analytics imprecision. See analytics.ts.
    trackDomainEvent(e);
  }

  async createTask(task: Task, event: NMEvent): Promise<Task> {
    await this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // A subtask's channel is its PARENT'S row, by id — never a slug resolution. Task.channel
      // is a slug (getTask maps channel_slug), and every project seeds the same starter slugs,
      // so resolving a subtask's inherited "marketing" picked the FIRST marketing room in the
      // workspace — round 3's live run filed a Plausible subtask (and its deliverables) into
      // the Flowe AI room. The parent row is the one truth that cannot collide.
      const parentCh = task.parentTaskId
        ? (await sql`select channel_id from tasks where id = ${task.parentTaskId}`)[0]?.['channel_id'] as string | undefined
        : undefined;
      const chId = parentCh ?? await resolveChannelId(sql, task.workspace, task.channel);
      // a task's project is its channel's project (1:N — projects own channels)
      const [ch] = await sql`select project_id from channels where id = ${chId}`;
      const projectId = (ch?.['project_id'] as string | null) ?? null;
      // plan_approved_at rides the INSERT (round 3, found live): a hands-off unit (routine- or
      // playbook-born) is born with its plan already approved — the memory store persisted the
      // whole object while this column list silently dropped the stamp, so on postgres every
      // "born approved" unit was actually born GATED and parked at plan_review forever.
      await sql`insert into tasks (id, workspace_id, channel_id, project_id, number, title, description, state, kind,
          creator_kind, creator_id, repo_id, base_ref, branch, offered_agent_id, requirements, requirements_confirmed, definition_of_done, parent_task_id, work_plan, origin_thread_id, plan_approved_at)
        values (${task.id}, ${task.workspace}::uuid, ${chId}, ${projectId}, ${task.number}, ${task.title},
          ${task.description}, ${task.state}::task_state, ${task.kind}::task_kind, ${task.creator.kind}::actor_kind, ${task.creator.id}::uuid,
          ${task.repo?.id ?? null}, ${task.repo?.baseRef ?? null}, ${task.repo?.branch ?? null},
          ${task.offeredAgentId}::uuid, ${task.requirements ? sql.json(task.requirements as never) : null}, ${task.requirementsConfirmed}, ${task.definitionOfDone}, ${task.parentTaskId}::uuid, ${task.workPlan ? sql.json(task.workPlan as never) : null}, ${task.originThreadId}::uuid, ${task.planApprovedAt})`;
      await this.insertEvent(sql, event, task.id);
    });
    return task;
  }

  async recentDuplicateTask(workspace: string, channel: string, normTitle: string, sinceIso: string | null): Promise<{ number: number; title: string } | null> {
    const chId = await resolveChannelId(this.sql, workspace, channel);
    // normalization mirrors normalizeTaskTitle (store.ts): trim, collapse whitespace, lowercase
    const rows = await this.sql`select number, title from tasks
      where channel_id = ${chId} and state not in ('accepted', 'closed', 'backlog')
        and lower(regexp_replace(btrim(title), '\\s+', ' ', 'g')) = ${normTitle}
        and (${sinceIso}::timestamptz is null or created_at >= ${sinceIso})
      order by created_at desc limit 1`;
    return rows.length ? { number: rows[0]!['number'] as number, title: rows[0]!['title'] as string } : null;
  }

  async getTask(id: string): Promise<Task | null> {
    const rows = await this.sql`select t.*, c.slug as channel_slug, p.slug as project_slug
      from tasks t join channels c on c.id = t.channel_id
      left join projects p on p.id = t.project_id where t.id = ${id}`;
    return rows.length ? this.rowToTask(rows[0]!) : null;
  }

  async pendingSubtasks(taskId: string): Promise<number> {
    const [r] = await this.sql`select count(*) as n from tasks where parent_task_id = ${taskId} and state not in ('done', 'closed')`;
    return Number(r!['n']);
  }

  async subtaskCount(taskId: string): Promise<number> {
    const [r] = await this.sql`select count(*) as n from tasks where parent_task_id = ${taskId} and state != 'closed'`;
    return Number(r!['n']);
  }

  async getTaskByNumber(workspace: string, channel: string, number: number): Promise<{ id: string; number: number; state: TaskState } | null> {
    const rows = await this.sql`select t.id, t.number, t.state from tasks t join channels c on c.id = t.channel_id
      where t.workspace_id = ${workspace}::uuid and c.slug = ${channel} and t.number = ${number} limit 1`;
    return rows.length ? { id: rows[0]!['id'], number: rows[0]!['number'], state: rows[0]!['state'] } : null;
  }

  async shipGate(taskId: string): Promise<boolean> {
    // default ON: a task with no project row (legacy) or a pre-flag project reads true;
    // only an explicit ship_gate = false disarms the release gate (docs/23)
    const rows = await this.sql`select coalesce(p.ship_gate, true) as g
      from tasks t left join projects p on p.id = t.project_id where t.id = ${taskId}`;
    if (!rows.length) throw new DomainError('NOT_FOUND', `task ${taskId} not found`);
    return rows[0]!['g'] !== false;
  }

  async mutate(id: string, fn: (task: Task) => Promise<MutationResult>): Promise<MutationResult> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const rows = await sql`select t.*, c.slug as channel_slug, p.slug as project_slug
        from tasks t join channels c on c.id = t.channel_id
        left join projects p on p.id = t.project_id where t.id = ${id} for update of t`;
      if (!rows.length) throw new DomainError('NOT_FOUND', `task ${id} not found`);
      const out = await fn(this.rowToTask(rows[0]!));
      const t = out.task;
      // version/updated_at are owned by the DB trigger; the state guard
      // trigger re-validates the transition pairs as defense-in-depth.
      await sql`update tasks set state = ${t.state}::task_state, kind = ${t.kind}::task_kind,
          title = ${t.title}, description = ${t.description},
          assignee_kind = ${t.assignee?.kind ?? null}::actor_kind, assignee_id = ${t.assignee?.id ?? null}::uuid,
          submitted_sha = ${t.submittedSha}, artifact_count = ${t.artifactCount},
          pr_url = ${t.prUrl}, pr_number = ${t.prNumber}, blocked_from = ${t.blockedFrom}::task_state,
          requirements = ${t.requirements ? sql.json(t.requirements as never) : null},
          requirements_confirmed = ${t.requirementsConfirmed}, definition_of_done = ${t.definitionOfDone},
          ship_plan = ${t.shipPlan ? sql.json(t.shipPlan as never) : null},
          work_plan = ${t.workPlan ? sql.json(t.workPlan as never) : null},
          plan_approved_at = ${t.planApprovedAt}
        where id = ${id}`;
      for (const e of out.events) await this.insertEvent(sql, e, id);
      for (const a of out.artifacts ?? []) {
        const by = t.assignee ?? t.creator;
        // a finishing subtask's deliverables attach to the PARENT (docs/24)
        const artTask = out.artifactTaskId ?? id;
        await sql`insert into artifacts (workspace_id, channel_id, task_id, kind, name, inline_content, size_bytes, created_by_kind, created_by)
          values (${rows[0]!['workspace_id']}, ${rows[0]!['channel_id']}, ${artTask}, ${a.kind}::artifact_kind, ${a.name},
            ${a.content ?? null}, ${a.content?.length ?? null}, ${by.kind}::actor_kind, ${by.id}::uuid)`;
      }
      if (out.promoteLatestDesignRound) {
        // the approved (latest) mockup round joins the channel library atomically
        await sql`with rounds as (
            select id, coalesce((regexp_match(name, '^design-mockup-v(\\d+)-'))[1]::int, 0) as r
            from artifacts where task_id = ${id} and kind = 'design'
          )
          update artifacts set promoted = true
          where id in (select id from rounds where r = (select max(r) from rounds))`;
      }
      if (out.promoteLatestShipRound) {
        // the human-approved release plan joins the channel library like a design round
        await sql`with rounds as (
            select id, coalesce((regexp_match(name, '^ship-plan-v(\\d+)\\.md$'))[1]::int, 0) as r
            from artifacts where task_id = ${id} and kind = 'ship'
          )
          update artifacts set promoted = true
          where id in (select id from rounds where r = (select max(r) from rounds))`;
      }
      if (out.dismissOpenDecisions) {
        // a terminal task can't still owe the human an answer — retire its open nmq
        // cards in the same transaction so Mission Control stops surfacing them
        await sql`update decisions set status = 'dismissed', answered_at = now()
          where task_id = ${id} and status = 'open'`;
      }
      return out;
    }) as Promise<MutationResult>;
  }

  async createWorkspace(input: { name: string; slug: string; createdBy: string }, event: NMEvent): Promise<{ workspaceId: string; channelId: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [exists] = await sql`select 1 from workspaces where slug = ${input.slug}`;
      if (exists) throw new DomainError('CONFLICT', `workspace slug "${input.slug}" is taken`);
      const [ws] = await sql`insert into workspaces (name, slug, created_by)
        values (${input.name}, ${input.slug}, ${input.createdBy}::uuid) returning id`;
      const workspaceId = ws!['id'] as string;
      // the creator's name comes from nm_users, which is where an identity's email lives in the
      // Clerk world. This read was `auth.users` (Supabase) and always returned nothing, so every
      // new workspace's owner was displayed as the literal word "owner" — the phone's greeting
      // said "Good afternoon, owner" (found in the copy pass, 2026-09-05).
      const [creator] = await sql`select email from nm_users where id = ${input.createdBy}::uuid`;
      // compute shared with the workspace by default (George, 2026-09-03) — the 0119 backfill's rule, for everyone who comes later
      await sql`insert into workspace_members (workspace_id, user_id, role, display_name, compute)
        values (${workspaceId}, ${input.createdBy}::uuid, 'owner', ${(creator?.['email'] as string | undefined)?.split('@')[0] ?? 'owner'}, '{"shares":["*"]}'::jsonb)`;
      // one default project per workspace (the work axis) — all starter channels
      // live in it; the user creates more projects and moves channels into them.
      // named 'Default' (not 'general') so it never collides with the #general channel.
      const [proj] = await sql`insert into projects (workspace_id, name, slug, is_default, status)
        values (${workspaceId}, 'Default', 'default', true, 'active') returning id`;
      const defaultProjectId = proj!['id'] as string;
      const defaults: Array<[string, string, string]> = [
        ['general', 'Team home base', 'build'],
        ['build', 'Engineering', 'build'],
        ['research', 'Exploration & spikes', 'build'],
        ['marketing', 'Story & growth', 'marketing'],
      ];
      let generalId = '';
      let devId = '';
      for (const [slug, topic, kind] of defaults) {
        const [ch] = await sql`insert into channels (workspace_id, slug, topic, project_id, kind)
          values (${workspaceId}, ${slug}, ${topic}, ${defaultProjectId}::uuid, ${kind}) returning id`;
        if (slug === 'general') generalId = ch!['id'] as string;
        if (slug === 'build') devId = ch!['id'] as string;
        // a kind with a setup flow starts with its setup task — day one's needs-you item
        if (kind === 'marketing') await this.ensureSetupTask(sql, workspaceId, ch!['id'] as string);
      }
      // #build (né #dev) ships with the bundled default skill packs (gstack + addyosmani)
      if (devId) await seedBundledPacksSql(sql, workspaceId, devId, SKILL_SEED);
      await this.insertEvent(sql, { ...event, workspace: workspaceId }, null);
      return { workspaceId, channelId: generalId };
    }) as Promise<{ workspaceId: string; channelId: string }>;
  }

  async listWorkspaces(userId: string): Promise<Array<{ id: string; name: string; slug: string; role: string; memberCount: number; autoFailover: boolean; activeModelPack: string; commRules: unknown; plan: string; seats: number; subscriptionStatus: string | null; currentPeriodEnd: string | null; primaryMachineId: string | null; onboarded: boolean }>> {
    // `onboarded`: the crew is registered at LAUNCH, so a workspace with no agents never finished
    // the wizard (the rule, and why it is needed, live in the client's wsident.ts). Derived
    // rather than stamped: a stamp can outlive what it claims; agents cannot.
    const rows = await this.sql`select w.id, w.name, w.slug, w.auto_failover, w.active_model_pack, w.comm_rules, w.plan, w.seats, w.subscription_status, w.current_period_end, w.primary_machine_id, m.role,
        (select count(*) from workspace_members mm where mm.workspace_id = w.id) as member_count, exists (select 1 from agents a where a.workspace_id = w.id) as onboarded
      from workspaces w
      join workspace_members m on m.workspace_id = w.id where m.user_id = ${userId}::uuid order by w.created_at`;
    return rows.map((r) => ({ id: r['id'], name: r['name'], slug: r['slug'], role: r['role'], memberCount: Number(r['member_count']), autoFailover: !!r['auto_failover'], activeModelPack: (r['active_model_pack'] as string) ?? 'custom', commRules: (r['comm_rules'] as Record<string, unknown> | null) ?? null, plan: (r['plan'] as string) ?? 'free', seats: Number(r['seats'] ?? 1), subscriptionStatus: (r['subscription_status'] as string | null) ?? null, currentPeriodEnd: r['current_period_end'] ? new Date(r['current_period_end'] as string).toISOString() : null, primaryMachineId: (r['primary_machine_id'] as string | null) ?? null, onboarded: !!r['onboarded'] }));
  }

  async deleteWorkspace(workspaceId: string, requestedBy: string): Promise<void> {
    await this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [me] = await sql`select role from workspace_members where workspace_id = ${workspaceId}::uuid and user_id = ${requestedBy}::uuid`;
      if (!me) throw new DomainError('NOT_FOUND', 'workspace not found');
      if (me['role'] !== 'owner') throw new DomainError('NOT_PERMITTED', 'only the owner deletes a workspace');
      const [n] = await sql`select count(*) as c from workspace_members where workspace_id = ${workspaceId}::uuid`;
      if (Number(n!['c']) > 1) {
        // Reachable now: `workspace.leave` (0113) is the action this names. Before it existed
        // this message pointed at nothing a member could actually do.
        throw new DomainError('CONFLICT', 'other members are still in this workspace — they each need to leave it first');
      }
      // the ONLY sanctioned events purge: transaction-local, reset on commit
      await sql`select set_config('nm.allow_event_purge', 'on', true)`;
      await sql`delete from workspaces where id = ${workspaceId}::uuid`;
    });
  }

  async deleteAccount(userId: string): Promise<void> {
    const [n] = await this.sql`select count(*) as c from workspace_members where user_id = ${userId}::uuid`;
    // True since 0113: leaving is a real action now. A single accepted invite used to make this
    // an unreachable state — you were a member of someone else's workspace with no way out, so
    // your own account could never be deleted.
    if (Number(n!['c']) > 0) throw new DomainError('CONFLICT', 'leave or delete your workspaces first');
    // drop the identity mapping (Clerk-backed users have no auth.users row)
    await this.sql`delete from nm_users where id = ${userId}::uuid`;
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (url && key) {
      const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (!res.ok && res.status !== 404) {
        throw new DomainError('INVITE_FAILED', `auth user deletion failed (${res.status})`);
      }
    } else {
      await this.sql`delete from auth.users where id = ${userId}::uuid`;
    }
  }

  async offerTask(
    taskId: string,
    agentName: string,
    repo: { id: string; baseRef: string } | null,
    checklist: string[] | null,
    dod: string | null,
    kind: TaskKind | null,
    event: (agentId: string) => NMEvent,
  ): Promise<{ offeredAgentId: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [t] = await sql`select t.id, t.state, t.number, t.title, t.workspace_id, t.channel_id, c.slug as channel_slug
        from tasks t join channels c on c.id = t.channel_id where t.id = ${taskId} for update of t`;
      if (!t) throw new DomainError('NOT_FOUND', `task ${taskId} not found`);
      // todo (trivial path) or plan_review (the approved, planned task) may be
      // offered to a developer — the claim then transitions to in_progress
      if (t['state'] !== 'todo' && t['state'] !== 'plan_review') throw new DomainError('ILLEGAL_TRANSITION', 'only todo or plan_review tasks can be offered');
      // match the agent by the task's channel id — the slug repeats across projects now
      const [agent] = await sql`select a.id, a.retired_at from agents a
        join agent_channels ac on ac.agent_id = a.id
        where a.workspace_id = ${t['workspace_id']} and a.name = ${agentName} and ac.channel_id = ${t['channel_id']}`;
      if (!agent) throw new DomainError('NOT_FOUND', `agent ${agentName} is not registered to #${t['channel_slug']}`);
      // a retired agent keeps its channel rows (rehire restores remit) but can't take work
      if (agent['retired_at']) throw new DomainError('NOT_PERMITTED', `agent ${agentName} is retired — rehire it or offer to someone else`);
      // Hand the task off: a planned task is still assigned to the ARCHITECT (request_plan set the
      // assignee so the board shows who's planning it). Offering it to a developer must release that
      // assignment — otherwise the claim is denied (claiming requires the task be unassigned or the
      // claimer's own), so the offered dev can never pick up a planned task. Clear it on every offer
      // (a no-op for the trivial todo path, where it's already null).
      if (repo) {
        // intake resolved to repo-backed work — bind it now, branch derived
        // the same way task.create does
        const branch = taskBranch(Number(t['number']), t['title'] as string);
        await sql`update tasks set offered_agent_id = ${agent['id']}, assignee_id = null, assignee_kind = null, repo_id = ${repo.id}::uuid, base_ref = ${repo.baseRef}, branch = ${branch} where id = ${taskId}`;
      } else {
        await sql`update tasks set offered_agent_id = ${agent['id']}, assignee_id = null, assignee_kind = null where id = ${taskId}`;
      }
      if (checklist?.length) {
        // the orchestrator resolved requirements in the thread — recorded
        // here so the offered worker executes them instead of inventing its own
        await sql`update tasks set requirements = ${sql.json(checklist as never)}, requirements_confirmed = true where id = ${taskId}`;
      }
      if (dod) {
        // the orchestrator settled the acceptance contract for this offer
        await sql`update tasks set definition_of_done = ${dod} where id = ${taskId}`;
      }
      if (kind) {
        // stamp the work-type label the orchestrator settled at offer (docs/16)
        await sql`update tasks set kind = ${kind}::task_kind where id = ${taskId}`;
      }
      await this.insertEvent(sql, event(agent['id'] as string), taskId);
      return { offeredAgentId: agent['id'] as string };
    }) as Promise<{ offeredAgentId: string }>;
  }

  // ── invitations (0092, docs/27 §1d) ──────────────────────────────────────
  // An invite is a ROW plus an email. It deliberately does NOT create a user: the old flow
  // made a Supabase auth user in a Clerk world, so the invitee later signed up through Clerk,
  // resolved to a DIFFERENT nm_users id, and had no membership. Identity is resolved when
  // they actually authenticate — see claimInvitesForEmail.

  async createInvite(
    input: { workspace: string; email: string; memberRole: string; invitedBy: string },
    event: NMEvent,
  ): Promise<{ inviteId: string; token: string; workspaceName: string; inviterName: string; inviterEmail: string }> {
    const [inviter] = await this.sql`select wm.role, u.email, coalesce(wm.display_name, split_part(u.email, '@', 1)) as name
      from workspace_members wm join nm_users u on u.id = wm.user_id
      where wm.workspace_id = ${input.workspace}::uuid and wm.user_id = ${input.invitedBy}::uuid`;
    if (!inviter || !['owner', 'admin'].includes(inviter['role'] as string)) {
      throw new DomainError('NOT_PERMITTED', 'only workspace owners or admins invite members');
    }
    const email = input.email.trim().toLowerCase();
    const [already] = await this.sql`select 1 from workspace_members wm join nm_users u on u.id = wm.user_id
      where wm.workspace_id = ${input.workspace}::uuid and lower(u.email) = ${email}`;
    // CONFLICT (409), not INVITE_FAILED (502): "already a member" is a permanent state of the
    // world, and a 502 tells the client this was an upstream hiccup worth retrying. That code
    // was right when inviting called Supabase's admin API; it survived the flow that used it.
    if (already) throw new DomainError('CONFLICT', 'that address is already a member of this workspace');

    // random token, stored only as its sha256 — a database read can never yield a working link
    const token = randomBytes(24).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const [ws] = await this.sql`select name from workspaces where id = ${input.workspace}::uuid`;

    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // one live invite per address per workspace: a resend rotates the token on the SAME row
      // rather than racing a second claimable one (the partial unique index enforces it)
      const [row] = await sql`insert into workspace_invites (workspace_id, email, role, token_hash, invited_by)
        values (${input.workspace}::uuid, ${email}, ${input.memberRole}, ${tokenHash}, ${input.invitedBy}::uuid)
        on conflict (workspace_id, lower(email)) where status = 'pending'
        do update set token_hash = excluded.token_hash, role = excluded.role,
                      expires_at = now() + interval '14 days', created_at = now()
        returning id`;
      await this.insertEvent(sql, event, null);
      return {
        inviteId: row!['id'] as string,
        token,
        workspaceName: (ws?.['name'] as string) ?? 'your workspace',
        inviterName: (inviter['name'] as string) ?? 'A teammate',
        inviterEmail: (inviter['email'] as string) ?? '',
      };
    }) as Promise<{ inviteId: string; token: string; workspaceName: string; inviterName: string; inviterEmail: string }>;
  }

  /** Members + unexpired pending invites. The pending half is the whole point: counting
   *  members alone lets a free workspace issue ten invites at 1/3 and land at eleven. */
  async workspaceSeatsUsed(workspace: string): Promise<number> {
    const [row] = await this.sql`select
      (select count(*) from workspace_members where workspace_id = ${workspace}::uuid)
      + (select count(*) from workspace_invites
           where workspace_id = ${workspace}::uuid and status = 'pending' and expires_at > now()) as n`;
    return Number(row?.['n'] ?? 0);
  }

  /** Every pending invite waiting on a VERIFIED email. Read-only — see acceptInvite for why.
   *  The caller MUST have confirmed the address is verified with the auth provider: matching an
   *  unverified address would let anyone be shown (and then join) someone else's invitation. */
  async pendingInvitesForEmail(email: string): Promise<Array<{
    inviteId: string; workspaceId: string; workspaceName: string; role: string;
    inviterEmail: string | null; inviterName: string | null; createdAt: string; expiresAt: string;
  }>> {
    const lower = email.trim().toLowerCase();
    const rows = await this.sql`select i.id, i.workspace_id, i.role, i.created_at, i.expires_at,
        w.name as ws_name,
        (select u.email from nm_users u where u.id = i.invited_by) as inviter_email,
        (select coalesce(wm.display_name, split_part(u.email, '@', 1)) from nm_users u
           left join workspace_members wm on wm.user_id = u.id and wm.workspace_id = i.workspace_id
          where u.id = i.invited_by) as inviter_name
      from workspace_invites i join workspaces w on w.id = i.workspace_id
      where lower(i.email) = ${lower} and i.status = 'pending' and i.expires_at > now()
      order by i.created_at desc`;
    return rows.map((r) => ({
      inviteId: r['id'] as string,
      workspaceId: r['workspace_id'] as string,
      workspaceName: (r['ws_name'] as string) ?? 'a workspace',
      role: r['role'] as string,
      inviterEmail: (r['inviter_email'] as string | null) ?? null,
      inviterName: (r['inviter_name'] as string | null) ?? null,
      createdAt: new Date(r['created_at'] as string).toISOString(),
      expiresAt: new Date(r['expires_at'] as string).toISOString(),
    }));
  }

  /** Answer an invitation with a yes. `email` MUST be the caller's own re-verified address:
   *  the invite id travels in an email and a URL, so it is a handle, never an authorisation —
   *  the address match is what makes this the invitee's own act. */
  async acceptInvite(inviteId: string, userId: string, email: string): Promise<{
    workspaceId: string; workspaceName: string; role: string; inviterEmail: string | null; seatsUsed: number; plan: string;
  }> {
    const lower = email.trim().toLowerCase();
    const [inv] = await this.sql`select i.id, i.workspace_id, i.role, w.name as ws_name, w.plan,
        (select u.email from nm_users u where u.id = i.invited_by) as inviter_email
      from workspace_invites i join workspaces w on w.id = i.workspace_id
      where i.id = ${inviteId}::uuid and lower(i.email) = ${lower}
        and i.status = 'pending' and i.expires_at > now()`;
    if (!inv) throw new DomainError('NOT_FOUND', 'that invitation is no longer open');
    const workspaceId = inv['workspace_id'] as string;
    const plan = (inv['plan'] as string) ?? 'free';
    // Re-check the cap at ACCEPT time: an invite can sit pending for 14 days while the workspace
    // fills up. Refusing here (rather than at invite time only) is what stops N outstanding
    // invites from all landing and overshooting the cap.
    if (plan !== 'cloud') {
      const [c] = await this.sql`select count(*) as n from workspace_members where workspace_id = ${workspaceId}::uuid`;
      if (Number(c?.['n'] ?? 0) >= FREE_SEAT_CAP) throw new DomainError('PLAN_LIMIT', seatLimitReason());
    }
    await this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      await sql`insert into workspace_members (workspace_id, user_id, role, display_name, compute)
        values (${workspaceId}::uuid, ${userId}::uuid, ${inv['role']}, ${lower.split('@')[0] ?? lower}, '{"shares":["*"]}'::jsonb)
        on conflict (workspace_id, user_id) do nothing`;
      await sql`update workspace_invites set status = 'accepted', accepted_at = now(), accepted_user_id = ${userId}::uuid
        where id = ${inviteId}::uuid`;
    });
    return {
      workspaceId, workspaceName: (inv['ws_name'] as string) ?? 'your workspace', role: inv['role'] as string,
      inviterEmail: (inv['inviter_email'] as string) ?? null,
      seatsUsed: await this.workspaceSeatsUsed(workspaceId), plan,
    };
  }

  /** Answer with a no. Leaves the `status='pending'` predicate the unique index is built on, so
   *  the address is free again — inviting someone who declined once must not 23505. */
  async declineInvite(inviteId: string, email: string): Promise<boolean> {
    const lower = email.trim().toLowerCase();
    const rows = await this.sql`update workspace_invites set status = 'declined', declined_at = now()
      where id = ${inviteId}::uuid and lower(email) = ${lower} and status = 'pending' returning id`;
    return rows.length > 0;
  }

  async pendingInvites(workspace: string): Promise<Array<{ id: string; email: string; role: string; expiresAt: string; createdAt: string }>> {
    const rows = await this.sql`select id, email, role, expires_at, created_at from workspace_invites
      where workspace_id = ${workspace}::uuid and status = 'pending' and expires_at > now() order by created_at desc`;
    return rows.map((r) => ({
      id: r['id'] as string, email: r['email'] as string, role: r['role'] as string,
      expiresAt: new Date(r['expires_at'] as string).toISOString(), createdAt: new Date(r['created_at'] as string).toISOString(),
    }));
  }

  async revokeInvite(inviteId: string, workspace: string): Promise<boolean> {
    const rows = await this.sql`update workspace_invites set status = 'revoked'
      where id = ${inviteId}::uuid and workspace_id = ${workspace}::uuid and status = 'pending' returning id`;
    return rows.length > 0;
  }

  /** Leave a workspace you are a member of (0113). The owner is refused: a workspace with no
   *  owner has nobody who can delete it or manage billing, so leaving would strand it. */
  async leaveWorkspace(workspaceId: string, userId: string): Promise<void> {
    const [me] = await this.sql`select role from workspace_members
      where workspace_id = ${workspaceId}::uuid and user_id = ${userId}::uuid`;
    if (!me) throw new DomainError('NOT_FOUND', 'you are not a member of that workspace');
    if (me['role'] === 'owner') {
      throw new DomainError('NOT_PERMITTED', 'you own this workspace — make someone else the owner first, or delete it if you are the last one here');
    }
    await this.sql`delete from workspace_members where workspace_id = ${workspaceId}::uuid and user_id = ${userId}::uuid`;
  }

  /** Remove someone else (owner/admin only). Never the owner, and never yourself — leaving is
   *  its own act with its own rules, and folding them together would let an admin self-remove
   *  past the owner check. */
  async removeMember(workspaceId: string, targetUserId: string, requestedBy: string): Promise<void> {
    if (targetUserId === requestedBy) throw new DomainError('NOT_PERMITTED', 'use leave to remove yourself');
    const [me] = await this.sql`select role from workspace_members
      where workspace_id = ${workspaceId}::uuid and user_id = ${requestedBy}::uuid`;
    if (!me) throw new DomainError('NOT_FOUND', 'workspace not found');
    if (!['owner', 'admin'].includes(me['role'] as string)) {
      throw new DomainError('NOT_PERMITTED', 'only workspace owners or admins remove members');
    }
    const [target] = await this.sql`select role from workspace_members
      where workspace_id = ${workspaceId}::uuid and user_id = ${targetUserId}::uuid`;
    if (!target) throw new DomainError('NOT_FOUND', 'they are not a member of this workspace');
    if (target['role'] === 'owner') throw new DomainError('NOT_PERMITTED', 'the owner cannot be removed');
    await this.sql`delete from workspace_members where workspace_id = ${workspaceId}::uuid and user_id = ${targetUserId}::uuid`;
  }

  async inviteByToken(tokenHash: string): Promise<{ id: string; workspaceId: string; workspaceName: string; email: string; role: string } | null> {
    const [row] = await this.sql`select i.id, i.workspace_id, i.email, i.role, w.name
      from workspace_invites i join workspaces w on w.id = i.workspace_id
      where i.token_hash = ${tokenHash} and i.status = 'pending' and i.expires_at > now()`;
    return row ? {
      id: row['id'] as string, workspaceId: row['workspace_id'] as string,
      workspaceName: row['name'] as string, email: row['email'] as string, role: row['role'] as string,
    } : null;
  }

  // ── email outbox (0091) ──────────────────────────────────────────────────

  /** Insert-if-absent on the UNIQUE dedupe_key. `null` means it was already queued or sent —
   *  that rejection IS the exactly-once guarantee, so it is a normal outcome, not an error. */
  async enqueueEmail(input: {
    workspace?: string | null; userId?: string | null; toEmail: string; template: string;
    kind: 'transactional' | 'lifecycle' | 'broadcast'; subject: string; dedupeKey: string;
    payload?: unknown; scheduledAt?: string | null;
  }): Promise<{ id: string } | null> {
    const rows = await this.sql`insert into emails
        (workspace_id, user_id, to_email, template, kind, subject, dedupe_key, payload, scheduled_at)
      values (${input.workspace ?? null}, ${input.userId ?? null}, ${input.toEmail.trim().toLowerCase()},
              ${input.template}, ${input.kind}, ${input.subject}, ${input.dedupeKey},
              ${input.payload === undefined ? null : this.sql.json(input.payload as never)},
              ${input.scheduledAt ?? new Date().toISOString()})
      on conflict (dedupe_key) do nothing
      returning id`;
    return rows.length ? { id: rows[0]!['id'] as string } : null;
  }

  async markEmail(id: string, patch: { status: 'sent' | 'failed' | 'skipped'; providerId?: string | null; error?: string | null }): Promise<void> {
    await this.sql`update emails set status = ${patch.status}, provider_id = ${patch.providerId ?? null},
      error = ${patch.error ?? null}, sent_at = ${patch.status === 'sent' ? new Date().toISOString() : null}
      where id = ${id}::uuid`;
  }

  /** Candidates for the lifecycle pass. Everything `dueFor` needs, in one query per user, so
   *  the decision stays a pure function. `onboarding_at is not null` is the gate that keeps
   *  users who predate the email system from receiving a day-1 nudge months late. */
  async lifecycleCandidates(limit: number): Promise<LifecycleRow[]> {
    const rows = await this.sql`
      with u as (
        select n.id, n.email, n.onboarding_at, n.unsubscribed_at, n.email_bounced_at,
               (select wm.workspace_id from workspace_members wm where wm.user_id = n.id order by wm.created_at asc limit 1) as workspace_id
        from nm_users n
        where n.email is not null and n.onboarding_at is not null
          and n.onboarding_at > now() - interval '30 days'
          and n.unsubscribed_at is null and n.email_bounced_at is null
      )
      select u.id, u.email, u.workspace_id,
        coalesce(w.plan, 'free') as plan,
        extract(epoch from (now() - u.onboarding_at)) / 3600.0 as age_hours,
        (select extract(epoch from (now() - max(e.created_at))) / 3600.0 from emails e
           where e.user_id = u.id and e.kind = 'lifecycle' and e.status = 'sent') as since_last_hours,
        exists (select 1 from tasks t where t.workspace_id = u.workspace_id and t.state <> 'todo' and t.state <> 'backlog') as started_task,
        exists (select 1 from channels c where c.workspace_id = u.workspace_id and c.kind = 'marketing') as has_marketing_room,
        (select count(*) from workspace_members m where m.workspace_id = u.workspace_id)
          + (select count(*) from workspace_invites i where i.workspace_id = u.workspace_id and i.status = 'pending' and i.expires_at > now()) as seats_used,
        (select count(*) from tasks t where t.workspace_id = u.workspace_id and t.accepted_at is not null) as stat_accepted,
        (select count(*) from events e where e.workspace_id = u.workspace_id and e.type in ('task.approved', 'task.changes_requested')) as stat_reviews,
        (select count(*) from facts f where f.workspace_id = u.workspace_id and f.kind = 'lesson') as stat_lessons,
        (select t.title from tasks t where t.workspace_id = u.workspace_id and t.accepted_at is not null order by t.accepted_at desc limit 1) as shipped_thing
      from u left join workspaces w on w.id = u.workspace_id
      limit ${limit}`;

    const out: LifecycleRow[] = [];
    for (const r of rows) {
      const workspaceId = (r['workspace_id'] as string) ?? null;
      out.push({
        userId: r['id'] as string,
        email: (r['email'] as string) ?? null,
        workspaceId,
        plan: (r['plan'] as string) ?? 'free',
        ageHours: Number(r['age_hours'] ?? 0),
        unsubscribed: false, // filtered in the CTE
        bounced: false,
        sinceLastHours: r['since_last_hours'] == null ? null : Number(r['since_last_hours']),
        startedTask: !!r['started_task'],
        hasMarketingRoom: !!r['has_marketing_room'],
        seatsUsed: Number(r['seats_used'] ?? 1),
        statAccepted: Number(r['stat_accepted'] ?? 0),
        statReviews: Number(r['stat_reviews'] ?? 0),
        statLessons: Number(r['stat_lessons'] ?? 0),
        shippedThing: (r['shipped_thing'] as string) ?? null,
        // day3 quotes the reader's OWN newest lesson, with the agents who produced it
        lesson: workspaceId ? await this.newestLesson(workspaceId) : null,
      });
    }
    return out;
  }

  /** The newest mined lesson in a workspace + the names day3 needs. Null when nothing has been
   *  corrected yet — which is exactly when day3 must not send. */
  private async newestLesson(workspaceId: string): Promise<LifecycleRow['lesson']> {
    const [row] = await this.sql`select f.content, t.number as task_number, c.slug as channel,
        (select a.name from agents a where a.workspace_id = ${workspaceId}::uuid and a.role = 'reviewer' and a.retired_at is null order by a.created_at limit 1) as reviewer,
        (select a.name from agents a where a.workspace_id = ${workspaceId}::uuid and a.role = 'developer' and a.retired_at is null order by a.created_at limit 1) as worker
      from facts f
      left join tasks t on t.id = f.task_id
      left join channels c on c.id = f.channel_id
      where f.workspace_id = ${workspaceId}::uuid and f.kind = 'lesson'
      order by f.created_at desc limit 1`;
    if (!row?.['content']) return null;
    return {
      text: row['content'] as string,
      taskNumber: row['task_number'] == null ? null : Number(row['task_number']),
      channel: (row['channel'] as string) ?? 'dev',
      reviewer: (row['reviewer'] as string) ?? 'your reviewer',
      worker: (row['worker'] as string) ?? 'your developer',
    };
  }

  async emailSuppressed(userId: string): Promise<boolean> {
    const [row] = await this.sql`select unsubscribed_at, email_bounced_at from nm_users where id = ${userId}::uuid`;
    return !!(row?.['unsubscribed_at'] || row?.['email_bounced_at']);
  }

  async setUnsubscribed(userId: string): Promise<void> {
    await this.sql`update nm_users set unsubscribed_at = coalesce(unsubscribed_at, now()) where id = ${userId}::uuid`;
  }

  /** A hard bounce suppresses future non-transactional mail; a complaint also unsubscribes.
   *  Reputation on a young sending domain is the scarce asset — a complained-about address
   *  must never receive a second message. */
  async markEmailBounced(toEmail: string, complaint: boolean): Promise<void> {
    const lower = toEmail.trim().toLowerCase();
    await this.sql`update nm_users set email_bounced_at = coalesce(email_bounced_at, now())
      ${complaint ? this.sql`, unsubscribed_at = coalesce(unsubscribed_at, now())` : this.sql``}
      where lower(email) = ${lower}`;
  }

  // Cloud: Supabase admin API owns auth users. Dev/test: the auth-shim table
  // stands in (id + unique email), keeping invites idempotent either way. Either
  // way the id is mirrored into nm_users (the identity table the user FKs now
  // reference) so the membership insert satisfies the repointed FK.
  private async ensureAuthUser(email: string, password: string): Promise<string> {
    const id = await this.createAuthUser(email, password);
    // mirror into nm_users (clerk_user_id = the id-as-text = the legacy/dev JWT sub)
    await this.sql`insert into nm_users (id, clerk_user_id, email) values (${id}::uuid, ${id}, ${email})
      on conflict (id) do update set email = excluded.email`;
    return id;
  }

  private async createAuthUser(email: string, password: string): Promise<string> {
    const url = process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (url && key) {
      const hdrs = { apikey: key, Authorization: `Bearer ${key}`, 'content-type': 'application/json' };
      const res = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers: hdrs,
        body: JSON.stringify({ email, password, email_confirm: true }),
      });
      const body = (await res.json()) as any;
      if (res.ok && body.id) return body.id as string;
      // already registered → look the user up instead of failing the invite
      const list = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=1&email=${encodeURIComponent(email)}`, { headers: hdrs });
      const found = ((await list.json()) as any).users?.find((u: any) => u.email === email);
      if (found?.id) return found.id as string;
      throw new DomainError('INVITE_FAILED', body.msg ?? body.error_description ?? `auth user creation failed (${res.status})`);
    }
    const [row] = await this.sql`insert into auth.users (email) values (${email})
      on conflict (email) do update set email = excluded.email returning id`;
    return row!['id'] as string;
  }

  // Auth-provider migration: resolve a Clerk user (the JWT `sub` + email) to a
  // stable internal uuid, creating the mapping on first sign-in. New Clerk
  // identities get a fresh nm_users row (we deliberately do NOT auto-merge by
  // email onto the backfilled dev/legacy rows — that would clobber their sub).
  async resolveClerkUser(clerkId: string, email: string | null): Promise<{ id: string; created: boolean }> {
    const [existing] = await this.sql`select id from nm_users where clerk_user_id = ${clerkId}`;
    if (existing) return { id: existing['id'] as string, created: false };
    // onboarding_at starts the activation clock the lifecycle sequence measures against; it is
    // set ONLY here, so a user who predates the email system keeps a NULL and can never be
    // handed a "day 1" nudge months after the fact (see lifecycleCandidates).
    const [row] = await this.sql`insert into nm_users (clerk_user_id, email, onboarding_at) values (${clerkId}, ${email}, now())
      on conflict (clerk_user_id) do update set email = coalesce(excluded.email, nm_users.email)
      returning id`;
    return { id: row!['id'] as string, created: true };
  }

  // Read-only Clerk id → uuid for the /v1 Bearer middleware. Cached briefly: the
  // mapping is immutable once created, so a positive hit can't go stale; a miss is
  // never cached (a just-signed-up user must resolve on their next call).
  async userIdentity(userId: string): Promise<{ clerkUserId: string | null; email: string | null } | null> {
    const [row] = await this.sql`select clerk_user_id, email from nm_users where id = ${userId}::uuid`;
    if (!row) return null;
    return { clerkUserId: (row['clerk_user_id'] as string | null) ?? null, email: (row['email'] as string | null) ?? null };
  }

  private clerkIdCache = new Map<string, { id: string; at: number }>();
  async userIdForClerkId(clerkId: string): Promise<string | null> {
    const hit = this.clerkIdCache.get(clerkId);
    if (hit && Date.now() - hit.at < 600_000) return hit.id;
    const [row] = await this.sql`select id from nm_users where clerk_user_id = ${clerkId}`;
    if (!row) return null;
    const id = row['id'] as string;
    this.clerkIdCache.set(clerkId, { id, at: Date.now() });
    return id;
  }

  async registerDevice(input: { userId: string; platform: 'ios' | 'android'; token: string; deviceName?: string | null; appVersion?: string | null }): Promise<void> {
    await this.sql`insert into device_tokens (user_id, platform, token, device_name, app_version)
      values (${input.userId}::uuid, ${input.platform}, ${input.token}, ${input.deviceName ?? null}, ${input.appVersion ?? null})
      on conflict (user_id, token) do update set last_seen_at = now(), revoked_at = null,
        device_name = excluded.device_name, app_version = excluded.app_version`;
  }

  async removeDevice(userId: string, token: string): Promise<void> {
    await this.sql`delete from device_tokens where user_id = ${userId}::uuid and token = ${token}`;
  }

  async devicesForUsers(userIds: string[]): Promise<Array<{ userId: string; token: string; platform: string }>> {
    if (userIds.length === 0) return [];
    const rows = await this.sql`select user_id, token, platform from device_tokens
      where user_id = any(${userIds}::uuid[]) and revoked_at is null`;
    return rows.map((r) => ({ userId: r['user_id'] as string, token: r['token'] as string, platform: r['platform'] as string }));
  }

  async revokeDeviceToken(token: string): Promise<void> {
    await this.sql`update device_tokens set revoked_at = now() where token = ${token} and revoked_at is null`;
  }

  // one-line like the relay/lifecycle delegates above — this file sits AT its ratchet cap
  async agentWorkspace(agentId: string): Promise<string | null> { const [a] = await this.sql`select workspace_id from agents where id = ${agentId}::uuid`; return (a?.['workspace_id'] as string | undefined) ?? null; }
  async humanMemberIds(workspace: string): Promise<string[]> {
    const rows = await this.sql`select user_id from workspace_members where workspace_id = ${workspace}::uuid`;
    return rows.map((r) => r['user_id'] as string);
  }

  async recordPushOnce(userId: string, dedupeKey: string, windowMs: number): Promise<boolean> {
    const rows = await this.sql`insert into push_log (user_id, dedupe_key) values (${userId}::uuid, ${dedupeKey})
      on conflict (user_id, dedupe_key) do update set sent_at = now()
      where push_log.sent_at < now() - make_interval(secs => ${windowMs}::float8 / 1000)
      returning user_id`;
    return rows.length > 0;
  }

  async startDesktopAuth(input: { nonce: string; pollSecretHash: string; ttlSeconds: number }): Promise<void> {
    await this.sql`insert into desktop_auth_sessions (nonce, poll_secret_hash, expires_at)
      values (${input.nonce}, ${input.pollSecretHash}, now() + make_interval(secs => ${input.ttlSeconds}))`;
    // opportunistic GC — cheap, indexed; keeps the rendezvous table from accreting dead rows
    await this.sql`delete from desktop_auth_sessions where expires_at < now()`;
  }

  async completeDesktopAuth(nonce: string, result: DesktopAuthResult): Promise<{ ok: boolean }> {
    const rows = await this.sql`update desktop_auth_sessions
      set status = 'done', result = ${this.sql.json(result as never)}
      where nonce = ${nonce} and status = 'pending' and expires_at > now()
      returning nonce`;
    return { ok: rows.length > 0 };
  }

  async claimDesktopAuth(nonce: string, pollSecretHash: string): Promise<{ status: 'pending' | 'done' | 'gone'; result?: DesktopAuthResult }> {
    const [row] = await this.sql`select status, result from desktop_auth_sessions
      where nonce = ${nonce} and poll_secret_hash = ${pollSecretHash} and expires_at > now()`;
    if (!row) return { status: 'gone' }; // wrong secret / expired / unknown all look the same
    if (row['status'] === 'pending') return { status: 'pending' };
    await this.sql`delete from desktop_auth_sessions where nonce = ${nonce}`; // single-use
    return { status: 'done', result: row['result'] as DesktopAuthResult };
  }

  async upsertFact(
    input: { workspace: string; channel: string; content: string; basisCount: number; kind?: 'fact' | 'lesson'; taskId?: string | null },
    makeEvent: (decision: string) => NMEvent,
  ): Promise<{ decision: 'add' | 'update' | 'noop'; factId: string }> {
    const vecs = await embed([input.content]); // null when the embedder is off
    const kind = input.kind ?? 'fact';
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const chId = await resolveChannelId(sql, input.workspace, input.channel);
      // kind-scoped reconcile: lessons supersede lessons, facts supersede facts
      const valid = await sql`select id, content from facts where channel_id = ${chId} and kind = ${kind} and valid_until is null`;

      const exact = valid.find((f) => f['content'] === input.content);
      if (exact) return { decision: 'noop' as const, factId: exact['id'] as string };

      // lexical overlap catches restatements; the vector leg (when on) catches
      // paraphrased contradictions the words miss
      const words = new Set(input.content.toLowerCase().split(/\s+/));
      let nearId: string | null =
        (valid.find((f) => {
          const fw = (f['content'] as string).toLowerCase().split(/\s+/);
          return fw.filter((w) => words.has(w)).length / Math.max(fw.length, 1) > 0.6;
        })?.['id'] as string) ?? null;
      if (!nearId && vecs?.[0]) {
        const [hit] = await sql`select id, embedding <=> ${JSON.stringify(vecs[0])}::vector as d
          from facts where channel_id = ${chId} and kind = ${kind} and valid_until is null and embedding is not null
          order by d asc limit 1`;
        // < 0.1 = near-paraphrase for bge-small. Calibrated 2026-07-07, the embedder's first
        // live run: two DISTINCT same-topic lessons sat at cosine distance 0.246 and the old
        // < 0.25 wrongly superseded one — topical closeness is not contradiction. True
        // rephrasings measure ≤ ~0.1; anything looser falls through to ADD (both stay valid).
        if (hit && Number(hit['d']) < 0.1) nearId = hit['id'] as string;
      }

      const [inserted] = await sql`insert into facts (workspace_id, channel_id, content, embedding, basis_count, kind, task_id)
        values (${input.workspace}::uuid, ${chId}, ${input.content},
          ${vecs?.[0] ? JSON.stringify(vecs[0]) : null}::vector, ${input.basisCount}, ${kind}, ${input.taskId ?? null}) returning id`;
      const factId = inserted!['id'] as string;
      if (nearId) {
        await sql`update facts set valid_until = now(), superseded_by = ${factId} where id = ${nearId}`;
      }
      const decision = nearId ? ('update' as const) : ('add' as const);
      await this.insertEvent(sql, makeEvent(decision), null);
      return { decision, factId };
    }) as Promise<{ decision: 'add' | 'update' | 'noop'; factId: string }>;
  }

  async retireFact(factId: string, supersededBy: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; retired: boolean }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // superseded_by carries an FK to facts — resolve it so a bad successor is a
      // clean 404 instead of an FK violation surfacing as a 500
      if (supersededBy) {
        const [succ] = await sql`select id from facts where id = ${supersededBy}`;
        if (!succ) throw new DomainError('NOT_FOUND', `fact ${supersededBy} not found`);
      }
      const [row] = await sql`update facts
          set valid_until = now(), superseded_by = coalesce(${supersededBy}::uuid, superseded_by)
        where id = ${factId} and valid_until is null
        returning workspace_id`;
      if (!row) {
        const [exists] = await sql`select id from facts where id = ${factId}`;
        if (!exists) throw new DomainError('NOT_FOUND', `fact ${factId} not found`);
        return { id: factId, retired: false }; // already retired — idempotent, no second event
      }
      await this.insertEvent(sql, makeEvent(row['workspace_id'] as string), null);
      return { id: factId, retired: true };
    }) as Promise<{ id: string; retired: boolean }>;
  }

  async refreshMemoryBlock(
    input: { workspace: string; channel: string; kind: string; content: string; basisCount: number },
    event: NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const chId = await resolveChannelId(sql, input.workspace, input.channel);
      const [row] = await sql`insert into memory_blocks (workspace_id, channel_id, kind, content, basis_count, updated_at)
        values (${input.workspace}::uuid, ${chId}, ${input.kind}, ${input.content}, ${input.basisCount}, now())
        on conflict (channel_id, kind) where project_id is null
        do update set content = excluded.content, basis_count = excluded.basis_count, updated_at = now()
        returning id`;
      await this.insertEvent(sql, event, null);
      return { id: row!['id'] as string };
    }) as Promise<{ id: string }>;
  }

  async promoteArtifact(artifactId: string, promotedByAgent: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ workspace: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // provenance only for agents that exist in the registry (FK-safe)
      const [row] = await sql`update artifacts set promoted = true,
          promoted_by = (select id from agents where id = ${promotedByAgent}::uuid)
        where id = ${artifactId} returning workspace_id, task_id`;
      if (!row) throw new DomainError('NOT_FOUND', `artifact ${artifactId} not found`);
      await this.insertEvent(sql, makeEvent(row['workspace_id']), row['task_id']);
      return { workspace: row['workspace_id'] as string };
    }) as Promise<{ workspace: string }>;
  }

  /** The one row `artifact.delete` needs before it decides — kind + name are what `isGateArtifact` judges. */
  async artifactById(artifactId: string): Promise<{ id: string; kind: string; name: string; taskId: string | null } | null> {
    const [r] = await this.sql`select id, kind, name, task_id from artifacts where id = ${artifactId}`;
    return r ? { id: r['id'] as string, kind: r['kind'] as string, name: r['name'] as string, taskId: (r['task_id'] as string | null) ?? null } : null;
  }

  async deleteArtifact(artifactId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ workspace: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // the event is written BEFORE the row goes, so the trail records what was removed even
      // though the thing it points at no longer exists
      const [row] = await sql`select workspace_id, task_id from artifacts where id = ${artifactId}`;
      if (!row) throw new DomainError('NOT_FOUND', `artifact ${artifactId} not found`);
      await this.insertEvent(sql, makeEvent(row['workspace_id']), row['task_id']);
      await sql`delete from artifacts where id = ${artifactId}`;
      return { workspace: row['workspace_id'] as string };
    }) as Promise<{ workspace: string }>;
  }

  async listArtifacts(taskId: string): Promise<ArtifactRow[]> {
    const rows = await this.sql`select id, task_id, kind, name, inline_content, created_at
      from artifacts where task_id = ${taskId} order by created_at`;
    return rows.map((r) => ({
      id: r['id'],
      taskId: r['task_id'],
      kind: r['kind'],
      name: r['name'],
      content: r['inline_content'],
      createdAt: new Date(r['created_at']).toISOString(),
    }));
  }

  // Beats (docs/17) — one run (set) per declare; advance targets the task's latest run.
  async declareBeats(task: Task, role: string, items: string[]): Promise<{ runId: string }> {
    const runId = crypto.randomUUID();
    await this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      for (const [i, title] of items.entries()) {
        await sql`insert into beats (workspace_id, task_id, run_id, phase, role, seq, title)
          values (${task.workspace}::uuid, ${task.id}::uuid, ${runId}::uuid, ${task.state}::task_state, ${role}, ${i}, ${title})`;
      }
    });
    return { runId };
  }
  async advanceBeat(taskId: string, seq: number, status: BeatStatus): Promise<void> {
    await this.sql`update beats set status = ${status}::beat_status, updated_at = now(),
        started_at = case when ${status} = 'active' and started_at is null then now() else started_at end,
        done_at = case when ${status} = 'done' then now() else done_at end
      where run_id = (select run_id from beats where task_id = ${taskId}::uuid order by created_at desc limit 1) and seq = ${seq}`;
  }
  async settleBeats(taskId: string): Promise<void> {
    await this.sql`update beats set status = 'done'::beat_status, done_at = coalesce(done_at, now()), updated_at = now()
      where task_id = ${taskId}::uuid and status = 'active'::beat_status`;
  }
  // Runs (docs/29) — the durable row behind a stretch of agent work.
  /**
   * Opens a run — and, when `triggerMessageId` is set, IS the wake lease (0114).
   *
   * Shared compute means several member machines may host the same agent, so a single chat
   * message can be seen by several live daemons. Task work was already safe (`task.claim` is
   * atomic and the host claims before spending a token); a wake was not — 0060 dedupes at the
   * REPLY INSERT, which is after generation, so every host would spin a model and all but one
   * answer would be discarded. Opening the run first moves that race in front of the spend.
   *
   * `won: false` is a normal outcome, not an error: another host got there and this one stands
   * down silently.
   */
  async openRun(input: RunInput & { triggerMessageId?: string | null; machineId?: string | null }): Promise<{ id: string; won: boolean }> {
    const id = input.id ?? crypto.randomUUID();
    // idempotent by id: the daemon mints the uuid so it can address the run before the round
    // trip, and a retried post must not fork a second row
    const rows = await this.sql`insert into runs (id, workspace_id, channel_id, thread_id, task_id, agent_id, parent_run_id, kind, title, total, step, seat, trigger_message_id, machine_id)
      values (${id}::uuid, ${input.workspace}::uuid, ${input.channelId}::uuid, ${input.threadId ?? null}::uuid, ${input.taskId ?? null}::uuid,
              ${input.agentId}::uuid, ${input.parentRunId ?? null}::uuid, ${input.kind}, ${input.title}, ${input.total ?? 0}, ${input.step ?? null}, ${input.seat ?? null},
              ${input.triggerMessageId ?? null}::uuid, ${input.machineId ?? null}::uuid)
      on conflict do nothing
      returning id`;
    if (rows.length) return { id, won: true };
    // No row: either this exact run id already existed (a retry — still ours), or the partial
    // unique index on (agent_id, trigger_message_id) rejected us because another host holds the
    // lease. Distinguishing them matters: a retry must keep working, a loser must stop.
    if (input.triggerMessageId) {
      const [holder] = await this.sql`select id from runs
        where agent_id = ${input.agentId}::uuid and trigger_message_id = ${input.triggerMessageId}::uuid`;
      return { id: (holder?.['id'] as string) ?? id, won: holder?.['id'] === id };
    }
    return { id, won: true }; // same-id retry on a non-lease run
  }
  async getRun(id: string): Promise<Run | null> {
    const [row] = await this.sql`select * from runs where id = ${id}::uuid`;
    return row ? this.toRun(row) : null;
  }
  async stepRun(id: string, patch: { step?: string; done?: number; total?: number }): Promise<void> {
    // a partial patch: an omitted field coalesces back to its current value, so a leg bumping
    // only `done` can't blank the step line another writer just set
    await this.sql`update runs set
        step = coalesce(${patch.step ?? null}, step),
        done = coalesce(${patch.done ?? null}::int, done),
        total = coalesce(${patch.total ?? null}::int, total),
        updated_at = now()
      where id = ${id}::uuid`;
  }
  async settleRun(id: string, state: RunSettleState, summary: string | null): Promise<void> {
    await this.sql`update runs set state = ${state}::run_state, summary = ${summary}, ended_at = now(), updated_at = now()
      where id = ${id}::uuid and state = 'running'::run_state`;
    // legs never outlive their parent — a closed head with pulsing children is the
    // eternal-spinner bug one level down
    await this.sql`update runs set state = ${state === 'done' ? 'done' : 'stopped'}::run_state, ended_at = now(), updated_at = now()
      where parent_run_id = ${id}::uuid and state = 'running'::run_state`;
  }
  async listOpenRuns(workspaceId: string): Promise<Run[]> {
    const rows = await this.sql`select * from runs where workspace_id = ${workspaceId}::uuid and state = 'running'::run_state order by started_at asc`;
    return rows.map((r) => this.toRun(r));
  }
  private toRun(r: Record<string, unknown>): Run {
    return {
      id: r['id'] as string, workspace: r['workspace_id'] as string, channelId: r['channel_id'] as string,
      threadId: (r['thread_id'] as string | null) ?? null, taskId: (r['task_id'] as string | null) ?? null,
      agentId: r['agent_id'] as string, parentRunId: (r['parent_run_id'] as string | null) ?? null,
      kind: r['kind'] as Run['kind'], title: r['title'] as string, state: r['state'] as Run['state'],
      step: (r['step'] as string | null) ?? null, seat: (r['seat'] as string | null) ?? null,
      done: Number(r['done'] ?? 0), total: Number(r['total'] ?? 0),
      summary: (r['summary'] as string | null) ?? null,
      startedAt: new Date(r['started_at'] as string).toISOString(),
      endedAt: r['ended_at'] ? new Date(r['ended_at'] as string).toISOString() : null,
      updatedAt: new Date(r['updated_at'] as string).toISOString(),
    };
  }

  async listBeats(taskId: string): Promise<Beat[]> {
    const rows = await this.sql`select * from beats where task_id = ${taskId}::uuid order by created_at asc, seq asc`;
    return rows.map((r) => ({
      id: r['id'], workspace: r['workspace_id'], taskId: r['task_id'], runId: r['run_id'],
      phase: r['phase'], role: r['role'], seq: Number(r['seq']), title: r['title'], status: r['status'],
      startedAt: r['started_at'] ? new Date(r['started_at']).toISOString() : null,
      doneAt: r['done_at'] ? new Date(r['done_at']).toISOString() : null,
      createdAt: new Date(r['created_at']).toISOString(), updatedAt: new Date(r['updated_at']).toISOString(),
    }));
  }

  async listEvents(target: string): Promise<NMEvent[]> {
    const rows = await this.sql`select id, type, source, target, workspace_id, payload, in_reply_to, ts
      from events where target = ${target} order by id`;
    return rows.map((r) => ({
      id: r['id'],
      type: r['type'],
      source: r['source'],
      target: r['target'],
      workspace: r['workspace_id'],
      payload: r['payload'] ?? {},
      in_reply_to: r['in_reply_to'],
      ts: new Date(r['ts']).toISOString(),
    })) as NMEvent[];
  }

  async registerMachine(
    input: { workspace: string; name: string; platform: string; daemonVersion: string; ownerId: string; transfer?: boolean; runtimes?: string[] },
    event: NMEvent,
  ): Promise<{ id: string; inserted: boolean }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ws] = await sql`select plan, primary_machine_id from workspaces where id = ${input.workspace}::uuid`;
      const plan = (ws?.['plan'] as string) ?? 'free';
      // A genuinely NEW machine (this member hasn't registered this name yet) is refused when they
      // already hold one — UNLESS the human explicitly transfers, which re-points to this machine.
      // Re-registering the SAME machine (heartbeat on boot), and any Cloud workspace, always proceed.
      //
      // Free is one machine PER MEMBER (0114), not per workspace.
      //
      // It used to be per workspace, which quietly made the free plan's 3 seats useless: a
      // teammate who accepted an invite could not register their own laptop at all, so the
      // workspace's agents stayed pinned to the owner's machine and every request the teammate
      // made was served by (and billed to) someone else. Shared compute is the whole point of
      // having more than one person in a workspace — each member's agents run on their machine,
      // under their own subscription. The cap that still matters is one machine per PERSON.
      //
      // The local stack lifts it (localmode.ts): every laptop that dials it is the same person's.
      if (plan === 'free' && !input.transfer && !localMode()) {
        const [mine] = await sql`select 1 from machines where workspace_id = ${input.workspace}::uuid and name = ${input.name} and owner_user_id = ${input.ownerId}::uuid`;
        if (!mine) {
          const [other] = await sql`select name from machines
            where workspace_id = ${input.workspace}::uuid and owner_user_id = ${input.ownerId}::uuid limit 1`;
          if (other) throw new DomainError('MACHINE_LIMIT', `You're already running this workspace on "${other['name']}". Transfer it to this machine (the other stops syncing) or upgrade to ${planLabel('cloud')} for unlimited machines.`);
        }
      }
      // `runtimes` is refreshed on every register (boot) so a machine that gains or loses a login
      // stops being waited for — a stale capability list would make failover defer to a host that
      // can no longer serve.
      // sql.json(), not JSON.stringify: the driver serialises for jsonb itself, so stringifying
      // first stores a jsonb STRING containing the array rather than the array
      const runtimes = sql.json((input.runtimes ?? []) as never);
      const [row] = await sql`insert into machines (workspace_id, owner_user_id, name, platform, daemon_version, last_seen_at, runtimes)
        values (${input.workspace}::uuid, ${input.ownerId}::uuid, ${input.name}, ${input.platform}, ${input.daemonVersion}, now(), ${runtimes}::jsonb)
        on conflict (workspace_id, name) do update
          set last_seen_at = now(), daemon_version = excluded.daemon_version, platform = excluded.platform,
              runtimes = case when ${input.runtimes ? true : false} then excluded.runtimes else machines.runtimes end
        returning id, (xmax = 0) as inserted`;
      const id = row!['id'] as string;
      // first machine becomes primary; an explicit transfer re-points the workspace to this machine.
      if (input.transfer || !ws?.['primary_machine_id']) {
        await sql`update workspaces set primary_machine_id = ${id}::uuid where id = ${input.workspace}::uuid`;
      }
      if (row!['inserted']) await this.insertEvent(sql, event, null);
      return { id, inserted: row!['inserted'] };
    }) as Promise<{ id: string; inserted: boolean }>;
  }

  async heartbeatMachine(machineId: string, activity?: { activeSeconds: number; busy: boolean; runtimes?: string[] }): Promise<void> {
    const seconds = activity?.activeSeconds ?? 0;
    const active = seconds > 0 || activity?.busy === true;
    // runtimes ride the beat for cloud machines (they never register): written only when sent
    const [row] = await this.sql<{ workspace_id: string; kind: string }[]>`
      update machines set last_seen_at = now(), last_active_at = case when ${active} then now() else last_active_at end, runtimes = case when ${!!activity?.runtimes} then ${this.sql.json((activity?.runtimes ?? []) as never)}::jsonb else runtimes end
       where id = ${machineId} returning workspace_id, kind`;
    // LOCAL machines beat too, and their time is the user's own hardware — never billed.
    if (row && row.kind !== 'local' && seconds > 0) await chargeMachineActivity(this.sql, row.workspace_id, priceActiveSeconds(seconds), seconds);
  }

  async registerAgent(
    input: { workspace: string; machineId: string; name: string; role: string; model: string; runtime: string; emoji?: string; description?: string; brief?: string; channels: string[] },
    event: NMEvent,
  ): Promise<{ id: string; inserted: boolean }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // re-registering a retired name is an explicit rehire: same row/identity (history
      // stays attached), retired_at clears, the card below re-publishes discovery.
      // description + brief coalesce like emoji: a re-register/rehire that omits either
      // keeps the stored one, so a rehire never silently blanks an agent's remit.
      const [row] = await sql`insert into agents (workspace_id, machine_id, name, role, model, runtime, emoji, description, brief, status)
        values (${input.workspace}::uuid, ${input.machineId}::uuid, ${input.name}, ${input.role}::agent_role, ${input.model}, ${input.runtime}, ${input.emoji ?? null}, ${input.description ?? null}, ${input.brief ?? null}, 'online')
        on conflict (workspace_id, name) do update set machine_id = excluded.machine_id, model = excluded.model, runtime = excluded.runtime, emoji = coalesce(excluded.emoji, agents.emoji), description = coalesce(excluded.description, agents.description), brief = coalesce(excluded.brief, agents.brief), status = 'online', retired_at = null
        returning id, (xmax = 0) as inserted, description`;
      const agentId = row!['id'] as string;
      // resolve each channel ref (id preferred, legacy slug fallback) — throws NOT_FOUND per missing ref
      const ids = await Promise.all(input.channels.map((r) => resolveChannelId(sql, input.workspace, r)));
      for (const channelId of ids) {
        await sql`insert into agent_channels (agent_id, channel_id) values (${agentId}, ${channelId}) on conflict do nothing`;
      }
      // an orchestrator's remit is cross-cutting — it belongs to every channel in the workspace
      if (input.role === 'orchestrator') await this.addOrchestratorsToChannels(sql, input.workspace);
      // generate + store the A2A 1.0 Agent Card (discovery surface) — refreshed on
      // every register so role/model/runtime/channel changes flow into the card.
      const card = buildAgentCard({ agentId, name: input.name, role: input.role, runtime: input.runtime, model: input.model, machine: input.machineId, channels: input.channels, description: row!['description'] as string | null });
      await sql`update agents set card = ${sql.json(card as never)} where id = ${agentId}`;
      if (row!['inserted']) await this.insertEvent(sql, event, null);
      return { id: agentId, inserted: row!['inserted'] as boolean };
    }) as Promise<{ id: string; inserted: boolean }>;
  }

  async updateAgent(
    agentId: string,
    patch: { model?: string; runtime?: string; name?: string; description?: string; brief?: string; modelSource?: 'pack' | 'manual' },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [a] = await sql`select workspace_id, machine_id from agents where id = ${agentId}::uuid`;
      if (!a) throw new DomainError('NOT_FOUND', 'agent not found');
      // description/brief can't ride the coalesce pattern: '' must CLEAR them (the UI's empty
      // field means "none"), and coalesce(null, col) can't tell "leave it" from "clear it".
      // undefined → null sentinel → the case expression keeps the stored value.
      const desc = patch.description === undefined ? null : patch.description.trim() || '';
      const brief = patch.brief === undefined ? null : patch.brief.trim() || '';
      await sql`update agents set
        model = coalesce(${patch.model ?? null}, model),
        runtime = coalesce(${patch.runtime ?? null}, runtime),
        name = coalesce(${patch.name ?? null}, name),
        description = case when ${desc}::text is null then description when ${desc} = '' then null else ${desc} end,
        brief = case when ${brief}::text is null then brief when ${brief} = '' then null else ${brief} end,
        model_source = coalesce(${patch.modelSource ?? null}, model_source)
        where id = ${agentId}::uuid`;
      // refresh the A2A card so model/runtime/name/description changes flow into discovery (mirrors register)
      const [u] = await sql`select name, role, runtime, model, description from agents where id = ${agentId}::uuid`;
      const chans = (await sql`select c.slug from channels c join agent_channels ac on ac.channel_id = c.id where ac.agent_id = ${agentId}::uuid`).map((r) => r['slug'] as string);
      const card = buildAgentCard({ agentId, name: u!['name'] as string, role: u!['role'] as string, runtime: u!['runtime'] as string, model: u!['model'] as string, machine: a['machine_id'] as string, channels: chans, description: u!['description'] as string | null });
      await sql`update agents set card = ${sql.json(card as never)} where id = ${agentId}::uuid`;
      await this.insertEvent(sql, makeEvent(a['workspace_id'] as string), null);
      return { id: agentId };
    }) as Promise<{ id: string }>;
  }

  async retireAgent(agentId: string, makeEvent: (workspace: string, name: string, role: string) => NMEvent): Promise<{ id: string; name: string; alreadyRetired: boolean }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [a] = await sql`select workspace_id, name, role, retired_at from agents where id = ${agentId}::uuid for update`;
      if (!a) throw new DomainError('NOT_FOUND', 'agent not found');
      const name = a['name'] as string;
      if (a['retired_at']) return { id: agentId, name, alreadyRetired: true }; // idempotent — no second event
      // A retiring agent can't leave work stranded: block while it's the assignee or
      // offeree of anything still open (done = finished work awaiting the human accept,
      // which doesn't need the agent — so done/accepted/closed don't block).
      const open = await sql`select number from tasks
        where workspace_id = ${a['workspace_id'] as string}::uuid
          and state not in ('done', 'accepted', 'closed')
          and (assignee_id = ${agentId}::uuid or offered_agent_id = ${agentId}::uuid)
        order by number limit 6`;
      if (open.length) {
        const nums = open.slice(0, 5).map((r) => `#${r['number']}`).join(', ');
        throw new DomainError('CONFLICT', `${name} still has ${open.length >= 6 ? '5+' : open.length} open task(s) (${nums}) — reassign or cancel them first`);
      }
      await sql`update agents set retired_at = now(), status = 'offline' where id = ${agentId}::uuid`;
      await this.insertEvent(sql, makeEvent(a['workspace_id'] as string, name, a['role'] as string), null);
      return { id: agentId, name, alreadyRetired: false };
    }) as Promise<{ id: string; name: string; alreadyRetired: boolean }>;
  }

  async updateMemberProfile(workspace: string, userId: string, displayName: string): Promise<void> {
    // scoped to (workspace, userId) — the caller passes actor.id, so a member only ever
    // edits their own row. display_name resolves at render, so this flows into every
    // past + future message author + the people lists once PowerSync replicates it.
    const rows = await this.sql`update workspace_members set display_name = ${displayName}
      where workspace_id = ${workspace}::uuid and user_id = ${userId}::uuid returning user_id`;
    if (rows.length === 0) throw new DomainError('NOT_FOUND', 'not a member of this workspace');
  }

  async getAgentCard(agentId: string): Promise<unknown | null> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agentId);
    if (!isUuid) return null; // avoid a cast error on a non-uuid path segment
    // retired agents unpublish from A2A discovery (the stored card stays for rehire)
    const [row] = await this.sql`select card from agents where id = ${agentId}::uuid and retired_at is null`;
    const card = row?.['card'] as Record<string, unknown> | undefined;
    return card && Object.keys(card).length ? card : null;
  }

  async connectRemoteAgent(input: { workspace: string; channels: string[]; name: string; role: string; endpointUrl: string; card: unknown }, event: NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // remote agent: no machine, the A2A endpoint to delegate to, their fetched card
      const [row] = await sql`insert into agents (workspace_id, machine_id, name, role, model, runtime, kind, endpoint_url, card, status)
        values (${input.workspace}::uuid, null, ${input.name}, ${input.role}::agent_role, 'external', 'a2a', 'remote', ${input.endpointUrl}, ${sql.json(input.card as never)}, 'online')
        on conflict (workspace_id, name) do update set endpoint_url = excluded.endpoint_url, card = excluded.card, kind = 'remote', status = 'online', retired_at = null
        returning id, (xmax = 0) as inserted`;
      const agentId = row!['id'] as string;
      // resolve each channel ref (id preferred, legacy slug fallback) — throws NOT_FOUND per missing ref
      const ids = await Promise.all(input.channels.map((r) => resolveChannelId(sql, input.workspace, r)));
      for (const channelId of ids) {
        await sql`insert into agent_channels (agent_id, channel_id) values (${agentId}, ${channelId}) on conflict do nothing`;
      }
      if (row!['inserted']) await this.insertEvent(sql, event, null);
      return { id: agentId };
    }) as Promise<{ id: string }>;
  }

  async addAgentToChannel(workspace: string, channel: string, agent: string, makeEvent: (workspace: string) => NMEvent, by?: { kind: string; id: string }): Promise<{ agentId: string; channelId: string }> {
    return this.changeAgentChannel('add', workspace, channel, agent, makeEvent, by);
  }
  async removeAgentFromChannel(workspace: string, channel: string, agent: string, makeEvent: (workspace: string) => NMEvent, by?: { kind: string; id: string }): Promise<{ agentId: string; channelId: string }> {
    return this.changeAgentChannel('remove', workspace, channel, agent, makeEvent, by);
  }
  // channel people roster (0094). Adding requires WORKSPACE membership already — this puts a
  // teammate in a ROOM, it never grants workspace access (that's the seat-costing invite flow).
  async addPersonToChannel(workspace: string, channel: string, person: string, makeEvent: (workspace: string) => NMEvent, by?: string | null): Promise<{ userId: string; channelId: string }> {
    return this.changeChannelPerson('add', workspace, channel, person, makeEvent, by);
  }
  async removePersonFromChannel(workspace: string, channel: string, person: string, makeEvent: (workspace: string) => NMEvent, by?: string | null): Promise<{ userId: string; channelId: string }> {
    return this.changeChannelPerson('remove', workspace, channel, person, makeEvent, by);
  }
  private async changeChannelPerson(op: 'add' | 'remove', workspace: string, channel: string, person: string, makeEvent: (workspace: string) => NMEvent, by?: string | null): Promise<{ userId: string; channelId: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const channelId = await resolveChannelId(sql, workspace, channel);
      const [m] = await sql`select wm.user_id from workspace_members wm
        where wm.workspace_id = ${workspace}::uuid and wm.user_id = ${person}::uuid limit 1`;
      if (!m) throw new DomainError('NOT_FOUND', 'that person is not a member of this workspace');
      const userId = m['user_id'] as string;
      // on conflict do nothing keeps the ORIGINAL attribution — re-adding someone who never
      // left isn't a new membership, so the papertrail must not restamp it (mirrors 0093).
      if (op === 'add') await sql`insert into channel_members (channel_id, user_id, created_by)
        values (${channelId}::uuid, ${userId}::uuid, ${by ?? null}) on conflict do nothing`;
      else await sql`delete from channel_members where channel_id = ${channelId}::uuid and user_id = ${userId}::uuid`;
      await this.insertEvent(sql, { ...makeEvent(workspace), workspace }, null);
      return { userId, channelId };
    }) as Promise<{ userId: string; channelId: string }>;
  }
  private async changeAgentChannel(op: 'add' | 'remove', workspace: string, channel: string, agent: string, makeEvent: (workspace: string) => NMEvent, by?: { kind: string; id: string }): Promise<{ agentId: string; channelId: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const channelId = await resolveChannelId(sql, workspace, channel);
      // agent ref = id (uuid) or name, scoped to the workspace
      const [a] = await sql`select id, name, role, runtime, model, machine_id, description from agents
        where workspace_id = ${workspace}::uuid and (name = ${agent} or id::text = ${agent}) limit 1`;
      if (!a) throw new DomainError('NOT_FOUND', `agent ${agent} not found in this workspace`);
      // The orchestrator is a room's cross-cutting remit: every channel is seeded with one
      // (addOrchestratorsToChannels), and the digest, triage and stall sweep all assume it's
      // there. Removing it would quietly break the room, so it's refused at the store — not
      // merely hidden from the picker that offers Remove.
      if (op === 'remove' && a['role'] === 'orchestrator') {
        throw new DomainError('NOT_PERMITTED', 'the orchestrator cannot be removed from a room');
      }
      const agentId = a['id'] as string;
      // on conflict do nothing keeps the ORIGINAL attribution — a re-add of an agent who never
      // left isn't a new membership, so the trail must not restamp it (0093).
      if (op === 'add') await sql`insert into agent_channels (agent_id, channel_id, created_by_kind, created_by)
        values (${agentId}, ${channelId}, ${by?.kind ?? null}, ${by?.id ?? null}) on conflict do nothing`;
      else await sql`delete from agent_channels where agent_id = ${agentId}::uuid and channel_id = ${channelId}::uuid`;
      // refresh the A2A card so the membership change flows into discovery (mirrors updateAgent)
      const chans = (await sql`select c.slug from channels c join agent_channels ac on ac.channel_id = c.id where ac.agent_id = ${agentId}::uuid`).map((r) => r['slug'] as string);
      const card = buildAgentCard({ agentId, name: a['name'] as string, role: a['role'] as string, runtime: a['runtime'] as string, model: a['model'] as string, machine: a['machine_id'] as string, channels: chans, description: a['description'] as string | null });
      await sql`update agents set card = ${sql.json(card as never)} where id = ${agentId}::uuid`;
      await this.insertEvent(sql, makeEvent(workspace), null);
      return { agentId, channelId };
    }) as Promise<{ agentId: string; channelId: string }>;
  }

  async resolveOffer(workspace: string, channel: string, agentName: string): Promise<string> {
    // resolve the channel ref to its id first (id preferred, legacy slug fallback) — then match
    // by id, since the slug repeats across projects now
    const chId = await resolveChannelId(this.sql, workspace, channel);
    const [row] = await this.sql`select a.id, a.retired_at from agents a
      join agent_channels ac on ac.agent_id = a.id
      where a.workspace_id = ${workspace}::uuid and a.name = ${agentName} and ac.channel_id = ${chId}`;
    if (!row) throw new DomainError('NOT_FOUND', `agent ${agentName} is not registered to #${channel}`);
    // a retired agent keeps its channel rows (rehire restores remit) but can't take work
    if (row['retired_at']) throw new DomainError('NOT_PERMITTED', `agent ${agentName} is retired — rehire it or offer to someone else`);
    return row['id'] as string;
  }

  async setAgentStatus(agentId: string, status: string): Promise<void> {
    await this.sql`update agents set status = ${status} where id = ${agentId}`;
  }

  async createSkill(
    input: { workspace: string; channel: string | null; name: string; description: string; scope: string; body: string; author: ActorRef; packId?: string | null; enabled?: boolean },
    event: NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      let channelId: string | null = null;
      if (input.channel) {
        channelId = await resolveChannelId(sql, input.workspace, input.channel);
      }
      let id: string;
      try {
        const [row] = await sql`insert into skills (workspace_id, channel_id, name, description, scope, body, status, author_kind, author_id, pack_id, enabled)
          values (${input.workspace}::uuid, ${channelId}, ${input.name}, ${input.description}, ${input.scope}, ${input.body}, 'active', ${input.author.kind}::actor_kind, ${input.author.id}::uuid, ${input.packId ?? null}, ${input.enabled ?? true})
          returning id`;
        id = row!['id'] as string;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new DomainError('CONFLICT', `an active skill named "${input.name}" already exists in this scope`);
        throw e;
      }
      await this.insertEvent(sql, { ...event, workspace: input.workspace }, null);
      return { id };
    }) as Promise<{ id: string }>;
  }

  async updateSkill(skillId: string, patch: { description?: string; body?: string; scope?: string }, event: NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [sk] = await sql`select workspace_id from skills where id = ${skillId} for update`;
      if (!sk) throw new DomainError('NOT_FOUND', `skill ${skillId} not found`);
      await sql`update skills set
        description = coalesce(${patch.description ?? null}, description),
        body = coalesce(${patch.body ?? null}, body),
        scope = coalesce(${patch.scope ?? null}, scope),
        channel_id = case when ${patch.scope ?? null} = 'global' then null else channel_id end,
        version = version + 1, updated_at = now()
        where id = ${skillId}`;
      await this.insertEvent(sql, { ...event, workspace: sk['workspace_id'] as string }, null);
      return { id: skillId };
    }) as Promise<{ id: string }>;
  }

  async deprecateSkill(skillId: string, event: NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [sk] = await sql`select workspace_id from skills where id = ${skillId} for update`;
      if (!sk) throw new DomainError('NOT_FOUND', `skill ${skillId} not found`);
      await sql`update skills set status = 'deprecated', updated_at = now() where id = ${skillId}`;
      await this.insertEvent(sql, { ...event, workspace: sk['workspace_id'] as string }, null);
      return { id: skillId };
    }) as Promise<{ id: string }>;
  }

  async proposeSkill(
    input: { workspace: string; channel: string | null; name: string; description: string; scope: string; body: string; author: ActorRef },
    event: NMEvent,
  ): Promise<{ id: string; updated: boolean }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      let channelId: string | null = null;
      if (input.channel) {
        channelId = await resolveChannelId(sql, input.workspace, input.channel);
      }
      // dedup onto an existing DRAFT of the same name+scope rather than spamming
      const [existing] = channelId
        ? await sql`select id from skills where workspace_id = ${input.workspace}::uuid and channel_id = ${channelId} and name = ${input.name} and status = 'draft' for update`
        : await sql`select id from skills where workspace_id = ${input.workspace}::uuid and channel_id is null and name = ${input.name} and status = 'draft' for update`;
      if (existing) {
        await sql`update skills set description = ${input.description}, body = ${input.body}, version = version + 1, updated_at = now() where id = ${existing['id']}`;
        await this.insertEvent(sql, { ...event, workspace: input.workspace }, null);
        return { id: existing['id'] as string, updated: true };
      }
      const [row] = await sql`insert into skills (workspace_id, channel_id, name, description, scope, body, status, author_kind, author_id)
        values (${input.workspace}::uuid, ${channelId}, ${input.name}, ${input.description}, ${input.scope}, ${input.body}, 'draft', ${input.author.kind}::actor_kind, ${input.author.id}::uuid)
        returning id`;
      await this.insertEvent(sql, { ...event, workspace: input.workspace }, null);
      return { id: row!['id'] as string, updated: false };
    }) as Promise<{ id: string; updated: boolean }>;
  }

  async promoteSkill(skillId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string; superseded: string | null }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [sk] = await sql`select id, workspace_id, channel_id, name, version, status from skills where id = ${skillId} for update`;
      if (!sk) throw new DomainError('NOT_FOUND', `skill ${skillId} not found`);
      if (sk['status'] !== 'draft') throw new DomainError('ILLEGAL_TRANSITION', 'only draft skills can be promoted');
      // supersede a same-name active skill in the same scope (versioning)
      const [prior] = sk['channel_id']
        ? await sql`select id, version from skills where workspace_id = ${sk['workspace_id']} and channel_id = ${sk['channel_id']} and name = ${sk['name']} and status = 'active' for update`
        : await sql`select id, version from skills where workspace_id = ${sk['workspace_id']} and channel_id is null and name = ${sk['name']} and status = 'active' for update`;
      let nextVersion = 1;
      if (prior) {
        nextVersion = Number(prior['version']) + 1;
        await sql`update skills set status = 'deprecated', superseded_by = ${skillId}, updated_at = now() where id = ${prior['id']}`;
      }
      await sql`update skills set status = 'active', version = ${nextVersion}, updated_at = now() where id = ${skillId}`;
      await this.insertEvent(sql, { ...makeEvent(sk['workspace_id'] as string), workspace: sk['workspace_id'] as string }, null);
      return { id: skillId, superseded: (prior?.['id'] as string) ?? null };
    }) as Promise<{ id: string; superseded: string | null }>;
  }

  async setSkillEnabled(skillId: string, enabled: boolean, event: NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [sk] = await sql`select workspace_id from skills where id = ${skillId} for update`;
      if (!sk) throw new DomainError('NOT_FOUND', `skill ${skillId} not found`);
      await sql`update skills set enabled = ${enabled}, updated_at = now() where id = ${skillId}`;
      await this.insertEvent(sql, { ...event, workspace: sk['workspace_id'] as string }, null);
      return { id: skillId };
    }) as Promise<{ id: string }>;
  }

  async createSkillPack(
    input: { workspace: string; channel: string; name: string; description: string; sourceUrl: string; sourceRef: string; origin: string; author: ActorRef },
    event: NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const chId = await resolveChannelId(sql, input.workspace, input.channel);
      const status = input.origin === 'bundled' ? 'ready' : 'importing';
      let id: string;
      try {
        const [row] = await sql`insert into skill_packs (workspace_id, channel_id, name, description, source_url, source_ref, origin, status)
          values (${input.workspace}::uuid, ${chId}, ${input.name}, ${input.description}, ${input.sourceUrl}, ${input.sourceRef}, ${input.origin}, ${status})
          returning id`;
        id = row!['id'] as string;
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new DomainError('CONFLICT', `a skill pack named "${input.name}" already exists in this channel`);
        throw e;
      }
      await this.insertEvent(sql, { ...event, workspace: input.workspace }, null);
      return { id };
    }) as Promise<{ id: string }>;
  }

  async commitSkillPack(
    packId: string,
    input: { version: string; skills: Array<{ name: string; description: string; body: string }> },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string; count: number }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [pack] = await sql`select workspace_id, channel_id from skill_packs where id = ${packId} for update`;
      if (!pack) throw new DomainError('NOT_FOUND', `skill pack ${packId} not found`);
      const ws = pack['workspace_id'] as string;
      const chId = pack['channel_id'] as string;
      for (const s of input.skills) {
        // insert-if-absent within this pack (idempotent re-commit; pack-scoped name)
        await sql`insert into skills (workspace_id, channel_id, name, description, scope, body, status, author_kind, author_id, pack_id, enabled)
          select ${ws}::uuid, ${chId}::uuid, ${s.name}, ${s.description}, 'channel', ${s.body}, 'active', 'agent'::actor_kind, '00000000-0000-0000-0000-000000000000'::uuid, ${packId}::uuid, true
          where not exists (select 1 from skills where workspace_id = ${ws}::uuid and channel_id = ${chId}::uuid and pack_id = ${packId}::uuid and name = ${s.name} and status = 'active')`;
      }
      await sql`update skill_packs set version = ${input.version}, status = 'ready', step = 'done', progress = 100, error = '', updated_at = now() where id = ${packId}`;
      await this.insertEvent(sql, { ...makeEvent(ws), workspace: ws }, null);
      return { id: packId, count: input.skills.length };
    }) as Promise<{ id: string; count: number }>;
  }

  async updateSkillPack(packId: string, patch: { status?: string; step?: string; progress?: number; error?: string; description?: string }, event: NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [pack] = await sql`select workspace_id from skill_packs where id = ${packId} for update`;
      if (!pack) throw new DomainError('NOT_FOUND', `skill pack ${packId} not found`);
      await sql`update skill_packs set
        status = coalesce(${patch.status ?? null}, status),
        step = coalesce(${patch.step ?? null}, step),
        progress = coalesce(${patch.progress ?? null}, progress),
        error = coalesce(${patch.error ?? null}, error),
        description = coalesce(${patch.description ?? null}, description),
        updated_at = now() where id = ${packId}`;
      await this.insertEvent(sql, { ...event, workspace: pack['workspace_id'] as string }, null);
      return { id: packId };
    }) as Promise<{ id: string }>;
  }

  async setSkillPackEnabled(packId: string, enabled: boolean, event: NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [pack] = await sql`select workspace_id from skill_packs where id = ${packId} for update`;
      if (!pack) throw new DomainError('NOT_FOUND', `skill pack ${packId} not found`);
      await sql`update skill_packs set enabled = ${enabled}, updated_at = now() where id = ${packId}`;
      await this.insertEvent(sql, { ...event, workspace: pack['workspace_id'] as string }, null);
      return { id: packId };
    }) as Promise<{ id: string }>;
  }

  async removeSkillPack(packId: string, event: NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [pack] = await sql`select workspace_id from skill_packs where id = ${packId} for update`;
      if (!pack) throw new DomainError('NOT_FOUND', `skill pack ${packId} not found`);
      await sql`delete from skill_packs where id = ${packId}`; // skills cascade
      await this.insertEvent(sql, { ...event, workspace: pack['workspace_id'] as string }, null);
      return { id: packId };
    }) as Promise<{ id: string }>;
  }

  async seedDefaultPacks(workspace: string, channel: string, event: NMEvent, kind: 'build' | 'marketing' = 'build'): Promise<{ added: number; refreshed: number }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const chId = await resolveChannelId(sql, workspace, channel);
      const { added, refreshed } = await seedBundledPacksSql(sql, workspace, chId, kind === 'marketing' ? [...MARKETING_SKILL_SEED, ...MARKETING_OS_SKILL_SEED] : SKILL_SEED);
      if (added > 0 || refreshed > 0) await this.insertEvent(sql, { ...event, workspace }, null);
      return { added, refreshed };
    }) as Promise<{ added: number; refreshed: number }>;
  }

  async linkRepo(
    input: { workspace: string; channel: string | null; project: string | null; provider: string; orgName: string; name: string; defaultBranch: string; cloneUrl: string | null; localPath: string | null },
    event: NMEvent,
  ): Promise<{ id: string; inserted: boolean }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [row] = await sql`insert into repos (workspace_id, provider, org_name, name, default_branch, clone_url, local_path)
        values (${input.workspace}::uuid, ${input.provider}, ${input.orgName}, ${input.name}, ${input.defaultBranch}, ${input.cloneUrl}, ${input.localPath})
        on conflict (workspace_id, provider, org_name, name) do update
          set default_branch = excluded.default_branch, clone_url = excluded.clone_url, local_path = excluded.local_path
        returning id, (xmax = 0) as inserted`;
      const repoId = row!['id'] as string;
      // attach to a project — directly (input.project) or via the channel's project
      // (projects own channels, 1:N). mark primary only if that project has no repo yet.
      let projId: string | null = input.project;
      if (!projId && input.channel) {
        const chId = await resolveChannelId(sql, input.workspace, input.channel);
        const [ch] = await sql`select project_id from channels where id = ${chId}`;
        projId = (ch?.['project_id'] as string | undefined) ?? null;
      }
      if (projId) {
        const [primary] = await sql`select 1 from project_repos where project_id = ${projId}::uuid and is_primary = true`;
        await sql`insert into project_repos (project_id, repo_id, is_primary)
          values (${projId}::uuid, ${repoId}, ${!primary})
          on conflict (project_id, repo_id) do nothing`;
      }
      if (row!['inserted']) await this.insertEvent(sql, { ...event, workspace: input.workspace }, null);
      return { id: repoId, inserted: row!['inserted'] as boolean };
    }) as Promise<{ id: string; inserted: boolean }>;
  }

  // Register each agent to every workspace channel whose slug matches a channel it's on in the
  // DEFAULT project (its "home remit"). Idempotent. This is what makes the team usable across every
  // project at once: a new project's rooms (or a recreated room) inherit the same agents as the
  // default's same-named rooms — no manual re-registration, no agent-less project. Agents with no
  // default-project channel are left untouched (explicit scoping stands). Returns NEW rows created.
  private async syncAgentChannels(sql: postgres.Sql, workspace: string): Promise<number> {
    const inserted = await sql`
      insert into agent_channels (agent_id, channel_id)
      select a.id, c.id from agents a
      join channels c on c.workspace_id = a.workspace_id
      where a.workspace_id = ${workspace}::uuid and a.retired_at is null
        and exists (
          select 1 from agent_channels ac0
          join channels c0 on c0.id = ac0.channel_id
          join projects p0 on p0.id = c0.project_id and p0.is_default
          where ac0.agent_id = a.id and c0.slug = c.slug)
      on conflict do nothing
      returning agent_id`;
    return inserted.length;
  }

  // Orchestrator agents belong to EVERY channel in the workspace — their remit is cross-cutting,
  // not engineering-scoped. Idempotent; run wherever a channel is created so a new room always has
  // the orchestrator WITHOUT auto-adding the rest of the team (workspace-scoped agents are brought
  // into a channel explicitly — the live-panel "+" / the orchestrator's add card). This is the
  // isolation default: a fresh room starts with just the orchestrator. Returns NEW rows created.
  private async addOrchestratorsToChannels(sql: postgres.Sql, workspace: string): Promise<number> {
    const inserted = await sql`
      insert into agent_channels (agent_id, channel_id)
      select a.id, c.id from agents a
      join channels c on c.workspace_id = a.workspace_id
      where a.workspace_id = ${workspace}::uuid and a.role = 'orchestrator' and a.retired_at is null
      on conflict do nothing
      returning agent_id`;
    return inserted.length;
  }

  // Manual recovery: re-bind every agent to its home-remit channels across all projects. The same
  // sync that runs on project/channel create, exposed so a human can heal orphaned registrations
  // (a migration or channel-churn cascade that emptied agent_channels — the silent agent-loop death).
  async syncWorkspaceAgents(workspace: string, makeEvent: (workspace: string) => NMEvent): Promise<{ registered: number }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const registered = await this.syncAgentChannels(sql, workspace);
      await this.insertEvent(sql, makeEvent(workspace), null);
      return { registered };
    }) as Promise<{ registered: number }>;
  }

  async createProject(
    input: { workspace: string; name: string; slug: string; description: string; website?: string; logoUrl?: string; channels: string[]; newChannels?: string[] },
    event: NMEvent,
  ): Promise<{ id: string; slug: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // workspace-unique slug (append -2, -3… on collision) so the switcher list is clean
      let slug = input.slug;
      for (let n = 2; (await sql`select 1 from projects where workspace_id = ${input.workspace}::uuid and slug = ${slug}`).length; n++) slug = `${input.slug}-${n}`;
      const [row] = await sql`insert into projects (workspace_id, name, slug, description, website, logo_url, status, is_default)
        values (${input.workspace}::uuid, ${input.name}, ${slug}, ${input.description}, ${input.website || null}, ${input.logoUrl || null}, 'active', false)
        returning id`;
      const projectId = row!['id'] as string;
      // optionally move existing channels into the new project (1:N — reassigns them).
      // input.channels are channel IDS now (a slug repeats across projects — moving by slug would
      // drag every same-slug channel in the workspace), so match by id and validate all exist.
      if (input.channels.length) {
        const ids = [...new Set(input.channels)];
        const moved = await sql`update channels set project_id = ${projectId}::uuid
          where workspace_id = ${input.workspace}::uuid and id = any(${ids}::uuid[]) returning id`;
        if (moved.length !== ids.length) throw new DomainError('NOT_FOUND', 'unknown channel');
      }
      // optionally create fresh starter rooms in the new project (slugs, not ids).
      // A starter `marketing` room is marketing-KIND (2026-08-09) — it used to arrive as a
      // build room wearing the slug, so the HQ, the crew and the setup never existed in it:
      // exactly the invisible-capability trap. The kind also seeds its setup task below.
      if (input.newChannels?.length) {
        for (const chSlug of input.newChannels) {
          const kind = chSlug === 'marketing' ? 'marketing' : 'build';
          const [ch] = await sql`insert into channels (workspace_id, slug, topic, project_id, kind)
            values (${input.workspace}::uuid, ${chSlug}, ${''}, ${projectId}::uuid, ${kind}) returning id`;
          if (kind === 'marketing') await this.ensureSetupTask(sql, input.workspace, ch!['id'] as string);
        }
      }
      // a new project's rooms start with just the orchestrator — the team is brought in per-channel
      // (workspace-scoped agents, channel-scoped membership). Isolation by default.
      await this.addOrchestratorsToChannels(sql, input.workspace);
      await this.insertEvent(sql, { ...event, workspace: input.workspace }, null);
      return { id: projectId, slug };
    }) as Promise<{ id: string; slug: string }>;
  }

  async updateProject(
    projectId: string,
    patch: { name?: string; description?: string; website?: string; logoUrl?: string; autoOpenPr?: boolean; runCiBeforeMerge?: boolean; shipGate?: boolean; modelPack?: string },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [proj] = await sql`select workspace_id from projects where id = ${projectId}::uuid`;
      if (!proj) throw new DomainError('NOT_FOUND', 'project not found');
      // website/logo_url: undefined keeps the column, '' clears it (nullif turns '' into null)
      await sql`update projects set
        name = coalesce(${patch.name ?? null}, name),
        description = coalesce(${patch.description ?? null}, description),
        website = case when ${patch.website ?? null}::text is null then website else nullif(${patch.website ?? null}, '') end,
        logo_url = case when ${patch.logoUrl ?? null}::text is null then logo_url else nullif(${patch.logoUrl ?? null}, '') end,
        auto_open_pr = coalesce(${patch.autoOpenPr ?? null}, auto_open_pr),
        run_ci_before_merge = coalesce(${patch.runCiBeforeMerge ?? null}, run_ci_before_merge),
        ship_gate = coalesce(${patch.shipGate ?? null}, ship_gate),
        -- '' clears the override back to "inherit the workspace pack"
        model_pack = case when ${patch.modelPack ?? null}::text is null then model_pack else nullif(${patch.modelPack ?? null}, '') end
        where id = ${projectId}::uuid`;
      await this.insertEvent(sql, makeEvent(proj['workspace_id'] as string), null);
      return { id: projectId };
    }) as Promise<{ id: string }>;
  }

  async updateWorkspace(
    workspaceId: string,
    patch: { autoFailover?: boolean; activeModelPack?: string; commRules?: { ste100?: boolean; noEmdash?: boolean; custom?: string[] }; videoTier?: string | null },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ws] = await sql`select id from workspaces where id = ${workspaceId}::uuid`;
      if (!ws) throw new DomainError('NOT_FOUND', 'workspace not found');
      // per-column coalesce: sending only autoFailover must not clobber active_model_pack, and vice-versa
      await sql`update workspaces set auto_failover = coalesce(${patch.autoFailover ?? null}, auto_failover), active_model_pack = coalesce(${patch.activeModelPack ?? null}, active_model_pack), comm_rules = coalesce(${patch.commRules ? sql.json(patch.commRules as never) : null}, comm_rules) where id = ${workspaceId}::uuid`;
      if (patch.videoTier !== undefined) await sql`update workspaces set video_tier = ${patch.videoTier} where id = ${workspaceId}::uuid`; // cleared on purpose (null = the default), so not coalesced
      await this.insertEvent(sql, makeEvent(workspaceId), null);
      return { id: workspaceId };
    }) as Promise<{ id: string }>;
  }

  async getCommRules(workspace: string): Promise<unknown> {
    const [r] = await this.sql`select comm_rules from workspaces where id = ${workspace}::uuid`;
    return r?.['comm_rules'] ?? null;
  }
  async getVideoTier(workspace: string): Promise<string | null> { const [r] = await this.sql`select video_tier from workspaces where id = ${workspace}::uuid`; return (r?.['video_tier'] as string | null) ?? null; }

  async listModelPacks(workspace: string): Promise<Array<{ id: string; name: string; roles: Record<string, string>; updatedAt: string }>> {
    const rows = await this.sql`select id, name, roles, updated_at from custom_model_packs where workspace_id = ${workspace}::uuid order by created_at`;
    return rows.map((r) => ({ id: r['id'] as string, name: r['name'] as string, roles: r['roles'] as Record<string, string>, updatedAt: new Date(r['updated_at'] as string).toISOString() }));
  }

  async saveModelPack(
    input: { workspace: string; packId?: string; name: string; roles: Record<string, string>; createdBy: string },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const id = input.packId ?? `custom:${crypto.randomUUID()}`;
      try {
        if (input.packId) {
          const [row] = await sql`update custom_model_packs set name = ${input.name}, roles = ${sql.json(input.roles as never)}, updated_at = now()
            where id = ${input.packId} and workspace_id = ${input.workspace}::uuid returning id`;
          if (!row) throw new DomainError('NOT_FOUND', 'custom brain not found');
        } else {
          await sql`insert into custom_model_packs (id, workspace_id, name, roles, created_by)
            values (${id}, ${input.workspace}::uuid, ${input.name}, ${sql.json(input.roles as never)}, ${input.createdBy})`;
        }
      } catch (e) {
        // the (workspace_id, lower(name)) unique index — surface it as a human-readable conflict
        if ((e as { code?: string }).code === '23505') throw new DomainError('CONFLICT', `a brain named "${input.name}" already exists`);
        throw e;
      }
      await this.insertEvent(sql, makeEvent(input.workspace), null);
      return { id };
    }) as Promise<{ id: string }>;
  }

  async deleteModelPack(workspace: string, packId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [row] = await sql`delete from custom_model_packs where id = ${packId} and workspace_id = ${workspace}::uuid returning id`;
      if (!row) throw new DomainError('NOT_FOUND', 'custom brain not found');
      // never leave a dangling active id: deleting the active brain falls back to the sentinel
      await sql`update workspaces set active_model_pack = 'custom' where id = ${workspace}::uuid and active_model_pack = ${packId}`;
      await this.insertEvent(sql, makeEvent(workspace), null);
      return { id: packId };
    }) as Promise<{ id: string }>;
  }

  async workspacePlan(workspace: string): Promise<string> {
    const [row] = await this.sql`select plan from workspaces where id = ${workspace}::uuid`;
    return (row?.['plan'] as string) ?? 'free';
  }

  async activeProjectCount(workspace: string): Promise<number> {
    const [row] = await this.sql`select count(*)::int as c from projects where workspace_id = ${workspace}::uuid and status = 'active'`;
    return Number(row?.['c'] ?? 0);
  }

  // The sanctioned plan writer — only the Stripe webhook (POST /webhooks/stripe) calls this; it is
  // never reachable from a client command. undefined leaves the column as-is; an explicit null clears
  // it (e.g. clearing the Stripe ids on cancel). plan/seats coalesce to keep the current value.
  async setWorkspacePlan(workspace: string, patch: { plan?: string; seats?: number; subscriptionStatus?: string | null; stripeCustomerId?: string | null; stripeSubscriptionId?: string | null; currentPeriodEnd?: string | null }): Promise<void> {
    const sql = this.sql;
    await sql`update workspaces set
      plan = coalesce(${patch.plan ?? null}, plan),
      seats = coalesce(${patch.seats ?? null}, seats),
      subscription_status = ${patch.subscriptionStatus === undefined ? sql`subscription_status` : patch.subscriptionStatus},
      stripe_customer_id = ${patch.stripeCustomerId === undefined ? sql`stripe_customer_id` : patch.stripeCustomerId},
      stripe_subscription_id = ${patch.stripeSubscriptionId === undefined ? sql`stripe_subscription_id` : patch.stripeSubscriptionId},
      current_period_end = ${patch.currentPeriodEnd === undefined ? sql`current_period_end` : patch.currentPeriodEnd}
      where id = ${workspace}::uuid`;
  }

  async workspaceForBilling(workspace: string): Promise<{ stripeCustomerId: string | null; memberCount: number } | null> {
    const [row] = await this.sql`select w.stripe_customer_id,
        (select count(*) from workspace_members mm where mm.workspace_id = w.id) as member_count
      from workspaces w where w.id = ${workspace}::uuid`;
    if (!row) return null;
    return { stripeCustomerId: (row['stripe_customer_id'] as string | null) ?? null, memberCount: Number(row['member_count'] ?? 1) };
  }

  // move a channel into a project (1:N ownership). Same-workspace only.
  async assignChannel(
    channelId: string,
    projectId: string,
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id from channels where id = ${channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      const [proj] = await sql`select workspace_id from projects where id = ${projectId}::uuid`;
      if (!proj) throw new DomainError('NOT_FOUND', 'project not found');
      if (ch['workspace_id'] !== proj['workspace_id']) throw new DomainError('INVALID_INPUT', 'channel and project are in different workspaces');
      await sql`update channels set project_id = ${projectId}::uuid where id = ${channelId}::uuid`;
      // a task's project is its channel's project — move the channel's tasks with it
      await sql`update tasks set project_id = ${projectId}::uuid where channel_id = ${channelId}::uuid`;
      await this.insertEvent(sql, makeEvent(ch['workspace_id'] as string), null);
      return { id: channelId };
    }) as Promise<{ id: string }>;
  }

  async archiveProject(
    projectId: string,
    archived: boolean,
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [proj] = await sql`select workspace_id, is_default from projects where id = ${projectId}::uuid`;
      if (!proj) throw new DomainError('NOT_FOUND', 'project not found');
      const ws = proj['workspace_id'] as string;
      if (archived && proj['is_default']) throw new DomainError('NOT_PERMITTED', 'the default project cannot be archived');
      // channels stay with the (now-archived) project — slugs are unique PER PROJECT, so returning
      // them to the default would collide with the default's own same-named rooms. They reappear
      // when the project is unarchived; move a room out via settings first if you want to keep it.
      await sql`update projects set status = ${archived ? 'archived' : 'active'}::project_status where id = ${projectId}::uuid`;
      await this.insertEvent(sql, makeEvent(ws), null);
      return { id: projectId };
    }) as Promise<{ id: string }>;
  }

  // Permanently delete an ARCHIVED project + everything in it. Irreversible.
  async deleteProject(
    projectId: string,
    _requestedBy: string,
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [proj] = await sql`select workspace_id, is_default, status from projects where id = ${projectId}::uuid`;
      if (!proj) throw new DomainError('NOT_FOUND', 'project not found');
      if (proj['is_default']) throw new DomainError('NOT_PERMITTED', 'the default project cannot be deleted');
      if (proj['status'] !== 'archived') throw new DomainError('NOT_PERMITTED', 'archive the project before deleting it');
      const ws = proj['workspace_id'] as string;
      // record the deletion in the (append-only) log first — this event carries no channel/task FK,
      // so the purge below leaves it intact.
      await this.insertEvent(sql, { ...makeEvent(ws), workspace: ws }, null);
      // the ONLY sanctioned events purge: transaction-local, reset on commit. The append-only
      // trigger blocks the FK's ON DELETE SET NULL (an UPDATE) even with the GUC, so we DELETE the
      // project's events explicitly (the GUC permits that), THEN drop the channels — by then no
      // event references them, so the cascade (messages/tasks/artifacts/skills/memory/facts) is clean.
      await sql`select set_config('nm.allow_event_purge', 'on', true)`;
      // purge by CHANNEL membership, not task.project_id — a task's project_id can lag its channel's
      // (e.g. the channel was moved between projects), and the channel cascade below will delete
      // every task in these channels regardless, which would otherwise SET NULL their un-purged events.
      await sql`delete from events where channel_id in (select id from channels where project_id = ${projectId}::uuid)
        or task_id in (select id from tasks where channel_id in (select id from channels where project_id = ${projectId}::uuid))`;
      await sql`delete from channels where project_id = ${projectId}::uuid`;
      await sql`delete from projects where id = ${projectId}::uuid`; // cascades project_repos
      return { id: projectId };
    }) as Promise<{ id: string }>;
  }

  // Create a fresh room in a project. Slug is unique PER PROJECT (append -2, -3… on
  // collision so the sidebar list stays clean) — same as createProject's newChannels.
  async createChannel(
    input: { workspace: string; projectId: string; slug: string; topic: string; createdByKind?: string; createdBy?: string },
    event: NMEvent,
  ): Promise<{ id: string; slug: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [proj] = await sql`select workspace_id from projects where id = ${input.projectId}::uuid`;
      if (!proj) throw new DomainError('NOT_FOUND', 'project not found');
      if (proj['workspace_id'] !== input.workspace) throw new DomainError('INVALID_INPUT', 'project is in a different workspace');
      let slug = input.slug;
      for (let n = 2; (await sql`select 1 from channels where project_id = ${input.projectId}::uuid and slug = ${slug}`).length; n++) slug = `${input.slug}-${n}`;
      const [row] = await sql`insert into channels (workspace_id, slug, topic, project_id, created_by_kind, created_by)
        values (${input.workspace}::uuid, ${slug}, ${input.topic}, ${input.projectId}::uuid, ${input.createdByKind ?? null}, ${input.createdBy ?? null}) returning id`;
      // a fresh room starts with just the orchestrator (cross-cutting remit); the rest of the
      // workspace's agents are brought in explicitly via channel.add_agent — isolation by default.
      await this.addOrchestratorsToChannels(sql, input.workspace);
      // ...and just its creator on the human side (0094), so a new room's People list isn't
      // empty and the "Add people" card has something to sit next to. Everyone else is an
      // explicit channel.add_person, same shape as the agent roster.
      if (input.createdByKind === 'human' && input.createdBy) {
        await sql`insert into channel_members (channel_id, user_id) values (${row!['id'] as string}::uuid, ${input.createdBy}::uuid) on conflict do nothing`;
      }
      await this.insertEvent(sql, { ...event, workspace: input.workspace }, null);
      return { id: row!['id'] as string, slug };
    }) as Promise<{ id: string; slug: string }>;
  }

  // Rename a room (slug and/or topic). Identity is the id, so the slug is just a
  // per-project label — changing it is safe (every reference is by id). Slug stays
  // unique within the project.
  async renameChannel(
    channelId: string,
    patch: { slug?: string; topic?: string },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string; slug: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id, project_id, slug from channels where id = ${channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      if (patch.slug !== undefined && patch.slug !== ch['slug']) {
        const [clash] = await sql`select 1 from channels where project_id = ${ch['project_id']}::uuid and slug = ${patch.slug} and id <> ${channelId}::uuid`;
        if (clash) throw new DomainError('INVALID_INPUT', 'a room with that name already exists in this project');
      }
      await sql`update channels set
        slug = coalesce(${patch.slug ?? null}, slug),
        topic = coalesce(${patch.topic ?? null}, topic)
        where id = ${channelId}::uuid`;
      const [after] = await sql`select slug from channels where id = ${channelId}::uuid`;
      await this.insertEvent(sql, makeEvent(ch['workspace_id'] as string), null);
      return { id: channelId, slug: after!['slug'] as string };
    }) as Promise<{ id: string; slug: string }>;
  }

  async setChannelThreadMode(
    channelId: string,
    mode: 'on' | 'off',
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id from channels where id = ${channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      await sql`update channels set thread_mode = ${mode} where id = ${channelId}::uuid`;
      await this.insertEvent(sql, makeEvent(ch['workspace_id'] as string), null);
      return { id: channelId };
    }) as Promise<{ id: string }>;
  }

  async setChannelKind(
    channelId: string,
    kind: 'build' | 'marketing',
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id from channels where id = ${channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      await sql`update channels set kind = ${kind} where id = ${channelId}::uuid`;
      // becoming a marketing room is one of the doors into its setup flow (setupflows.ts)
      if (kind === 'marketing') await this.ensureSetupTask(sql, ch['workspace_id'] as string, channelId);
      await this.insertEvent(sql, makeEvent(ch['workspace_id'] as string), null);
      return { id: channelId };
    }) as Promise<{ id: string }>;
  }

  /**
   * The setup task for a channel whose kind has a flow (shared/setupflows.ts) — the object an
   * abandoned setup RESUMES from, which the card-rendered-from-absence never left behind.
   *
   * Idempotent at the DB (tasks_one_setup_per_channel, 0117): every door into a marketing room
   * — onboarding seed, kind flip, project starter rooms, the release backfill — calls this
   * blindly and exactly one row can ever exist. A completed profile (setup_at) or one mid-flow
   * suppresses creation: the backfill must not ask a configured room to set itself up again.
   * kind='setup' lives the lean finish/cancel life (SETUP_TASK_TRANSITIONS); no agent can
   * offer/claim/plan it, so creating it here routes nothing and wakes nobody.
   */
  private async ensureSetupTask(sql: postgres.Sql, workspace: string, channelId: string): Promise<boolean> {
    const [ch] = await sql`select kind, marketing from channels where id = ${channelId}::uuid`;
    const flow = flowForChannelKind((ch?.['kind'] as string | null) ?? null);
    if (!flow) return false;
    // profile already touched (setup_at complete, or any key mid-flow with the wizard's old
    // card) — the task exists to make an EMPTY room's setup findable, not to re-litigate one
    const profile = (ch?.['marketing'] ?? null) as Record<string, unknown> | null;
    if (profile && Object.keys(profile).length > 0) return false;
    const [n] = await sql`select nm_next_task_number(${workspace}::uuid) as n`;
    // creator: the channel's creator when it is a usable uuid (channels.created_by is TEXT and
    // nullable since 0093 — onboarding/starter rooms carry none), else the workspace OWNER.
    // tasks.creator_id is `uuid not null`, so this coalesce is load-bearing, not cosmetic.
    const inserted = await sql`insert into tasks (workspace_id, channel_id, project_id, number, title, description, state, kind, creator_kind, creator_id)
      select ${workspace}::uuid, ${channelId}::uuid, c.project_id, ${Number(n!['n'])}, ${flow.title},
             ${'Walk the steps below to set this room up — your answers save as you go, so you can leave and finish any time. Closing this task skips setup.'},
             'todo'::task_state, 'setup'::task_kind, 'human'::actor_kind,
             coalesce(
               case when c.created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then c.created_by::uuid end,
               (select wm.user_id from workspace_members wm where wm.workspace_id = c.workspace_id and wm.role = 'owner' limit 1)
             )
        from channels c where c.id = ${channelId}::uuid
      on conflict do nothing
      returning id`;
    return inserted.length > 0;
  }

  /** The release-day backfill (called by the daemon's boot, idempotently): every existing room
   * whose kind has a flow and whose profile is untouched gets its setup task. Returns how many
   * were created so the boot log can say what happened. */
  async backfillSetupTasks(workspace: string): Promise<number> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const rooms = await sql`select id from channels
        where workspace_id = ${workspace}::uuid and kind = 'marketing'
          and (marketing is null or marketing::text = '{}')
          and not exists (select 1 from tasks t where t.channel_id = channels.id and t.kind = 'setup')`;
      let made = 0;
      for (const r of rooms) if (await this.ensureSetupTask(sql, workspace, r['id'] as string)) made += 1;
      return made;
    }) as Promise<number>;
  }

  /** One answered setup step (setupflows.ts), written AS IT LANDS — the whole reason an
   * abandoned wizard is now a pause instead of a loss. Merges the step's write into the
   * profile and stamps `setup_progress` (the resume marker); flips the room's setup task
   * todo → in_progress on the first step so the queue reads "started", not "untouched". */
  async setChannelSetupStep(
    channelId: string,
    input: { flowId: string; stepId: string; patch: Record<string, unknown> },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string; workspace: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id, marketing from channels where id = ${channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      const profile = (ch['marketing'] ?? {}) as Record<string, unknown>;
      const next = { ...profile, ...input.patch, setup_progress: { flow: input.flowId, step: input.stepId } };
      await sql`update channels set marketing = ${sql.json(next as never)} where id = ${channelId}::uuid`;
      await sql`update tasks set state = 'in_progress', updated_at = now()
        where channel_id = ${channelId}::uuid and kind = 'setup' and state = 'todo'`;
      await this.insertEvent(sql, makeEvent(ch['workspace_id'] as string), null);
      return { id: channelId, workspace: ch['workspace_id'] as string };
    }) as Promise<{ id: string; workspace: string }>;
  }

  async setChannelMarketing(
    channelId: string,
    profile: { website: string | null; focus: string[]; goal?: string; bootstrap_thread_id?: string; setup_by: string; setup_at: string },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string; workspace: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id, marketing from channels where id = ${channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      // MERGED, not replaced (2026-08-09): the wizard now writes per step, so by completion the
      // profile can already hold mcp toggles (connect step) and the resume marker — a wholesale
      // replace would wipe a connector toggle set thirty seconds earlier.
      const prior = (ch['marketing'] ?? {}) as Record<string, unknown>;
      await sql`update channels set marketing = ${sql.json({ ...prior, ...profile } as never)} where id = ${channelId}::uuid`;
      // completing the flow FINISHES the room's setup task (todo|in_progress → done, the lean
      // life's one forward edge — both pairs SQL-legal since 0071). The task row is the
      // trackable object George asked for; this is its "complete".
      await sql`update tasks set state = 'done', updated_at = now()
        where channel_id = ${channelId}::uuid and kind = 'setup' and state in ('todo', 'in_progress')`;
      await this.insertEvent(sql, makeEvent(ch['workspace_id'] as string), null);
      return { id: channelId, workspace: ch['workspace_id'] as string };
    }) as Promise<{ id: string; workspace: string }>;
  }

  async setMarketingIntegration(channelId: string, provider: string, enabled: boolean, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id, marketing from channels where id = ${channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      const profile = (ch['marketing'] ?? {}) as Record<string, unknown>;
      const mcp = { ...((profile['mcp'] as Record<string, boolean> | undefined) ?? {}), [provider]: enabled };
      await sql`update channels set marketing = ${sql.json({ ...profile, mcp } as never)} where id = ${channelId}::uuid`;
      await this.insertEvent(sql, makeEvent(ch['workspace_id'] as string), null);
      return { id: channelId };
    }) as Promise<{ id: string }>;
  }

  async channelWorkspace(channelId: string): Promise<{ workspace: string }> {
    const [ch] = await this.sql`select workspace_id from channels where id = ${channelId}::uuid`;
    if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
    return { workspace: ch['workspace_id'] as string };
  }

  // ── schedules (marketing-channel plan §4.6) ──────────────────────────────
  async createSchedule(input: ScheduleInput, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id from channels where id = ${input.channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      const ws = ch['workspace_id'] as string;
      // agent by name, never a retired one (every selection pool filters retired_at)
      let agentId: string | null = null;
      if (input.agentName) {
        const [a] = await sql`select id from agents where workspace_id = ${ws}::uuid and name = ${input.agentName} and retired_at is null`;
        if (!a) throw new DomainError('NOT_FOUND', `no active agent named "${input.agentName}"`);
        agentId = a['id'] as string;
      }
      const [row] = await sql`insert into schedules (workspace_id, channel_id, title, cadence, at_time, tz, weekday, next_run_at, agent_id, payload, created_by_kind, created_by)
        values (${ws}::uuid, ${input.channelId}::uuid, ${input.title}, ${input.cadence}, ${input.atTime}, ${input.tz}, ${input.weekday}, ${input.nextRunAt}, ${agentId}, ${sql.json({ prompt: input.prompt, ...(input.payloadExtra ?? {}) } as never)}, ${input.createdByKind}, ${input.createdBy})
        returning id`;
      await this.insertEvent(sql, makeEvent(ws), null);
      return { id: row!['id'] as string };
    }) as Promise<{ id: string }>;
  }

  async setScheduleStatus(scheduleId: string, status: 'active' | 'paused', makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [row] = await sql`update schedules set status = ${status} where id = ${scheduleId}::uuid returning workspace_id`;
      if (!row) throw new DomainError('NOT_FOUND', 'schedule not found');
      await this.insertEvent(sql, makeEvent(row['workspace_id'] as string), null);
      return { id: scheduleId };
    }) as Promise<{ id: string }>;
  }

  async updateSchedule(scheduleId: string, patch: { title: string; prompt: string; cadence: string; atTime: string; tz: string; weekday: number | null; nextRunAt: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // merge the new prompt into the jsonb payload; run_count is deliberately untouched
      const [row] = await sql`update schedules set
          title = ${patch.title}, cadence = ${patch.cadence}, at_time = ${patch.atTime}, tz = ${patch.tz},
          weekday = ${patch.weekday}, next_run_at = ${patch.nextRunAt},
          payload = coalesce(payload, '{}'::jsonb) || ${sql.json({ prompt: patch.prompt } as never)}
        where id = ${scheduleId}::uuid returning workspace_id`;
      if (!row) throw new DomainError('NOT_FOUND', 'schedule not found');
      await this.insertEvent(sql, makeEvent(row['workspace_id'] as string), null);
      return { id: scheduleId };
    }) as Promise<{ id: string }>;
  }

  async deleteSchedule(scheduleId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [row] = await sql`delete from schedules where id = ${scheduleId}::uuid returning workspace_id`;
      if (!row) throw new DomainError('NOT_FOUND', 'schedule not found');
      await this.insertEvent(sql, makeEvent(row['workspace_id'] as string), null);
      return { id: scheduleId };
    }) as Promise<{ id: string }>;
  }

  async createContentItem(
    input: { channelId: string; taskId?: string | null; threadId?: string | null; platform: string; body: string; scheduleId: string | null; slotAt?: string | null; mediaUrl?: string | null; imageBrief?: string | null; script?: string | null; frame?: string | null; seconds?: number | null; thumb?: string | null; imageError?: string | null; createdByKind: string; createdBy: string },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id from channels where id = ${input.channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      const ws = ch['workspace_id'] as string;
      // a draft born from a schedule carries its intended slot in scheduled_at while
      // status stays 'draft' — the calendar places the chip there, approve keeps it
      const [row] = await sql`insert into content_items (workspace_id, channel_id, task_id, thread_id, schedule_id, platform, body, scheduled_at, media, created_by_kind, created_by)
        values (${ws}::uuid, ${input.channelId}::uuid, ${input.taskId ?? null}, ${input.threadId ?? null}, ${input.scheduleId}, ${input.platform}, ${input.body}, ${input.slotAt ?? null}, ${input.mediaUrl || input.imageBrief || input.script || input.frame || input.seconds || input.thumb || input.imageError ? sql.json({ ...(input.mediaUrl ? { image_url: input.mediaUrl } : {}), ...(input.imageBrief ? { brief: input.imageBrief } : {}), ...(input.script ? { script: input.script } : {}), ...(input.frame ? { frame: input.frame } : {}), ...(input.seconds ? { seconds: input.seconds } : {}), ...(input.thumb ? { thumb: input.thumb } : {}), ...(input.imageError ? { image_error: input.imageError } : {}) } as never) : null}, ${input.createdByKind}, ${input.createdBy})
        returning id`;
      await this.insertEvent(sql, makeEvent(ws), null);
      return { id: row!['id'] as string };
    }) as Promise<{ id: string }>;
  }

  async setContentStatus(
    itemId: string,
    patch: { status: 'draft' | 'scheduled'; scheduledAt: string | null; approvedBy: string | null; keepSlot?: boolean },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // approve without an explicit time keeps the draft's intended slot when it has a
      // FUTURE one (draft-ahead), else falls to the caller's default; unschedule nulls it
      const [row] = await sql`update content_items
        set status = ${patch.status},
            scheduled_at = case
              when ${patch.status} = 'draft' then null
              when scheduled_at is not null and scheduled_at > now() and ${patch.keepSlot ?? false} then scheduled_at
              else ${patch.scheduledAt}
            end,
            approved_by = ${patch.approvedBy}, approved_at = ${patch.approvedBy ? new Date().toISOString() : null},
            -- a re-queued failure starts clean: keeping the old reason would leave the card
            -- reading "failed: no connected X account" while it sits happily scheduled again
            last_error = case when ${patch.status} = 'scheduled' then null else last_error end
        where id = ${itemId}::uuid and status in ('draft', 'scheduled', 'failed')
        returning workspace_id`;
      if (!row) throw new DomainError('NOT_FOUND', 'content item not found (or already published)');
      await this.insertEvent(sql, makeEvent(row['workspace_id'] as string), null);
      return { id: itemId };
    }) as Promise<{ id: string }>;
  }

  async updateContentBody(itemId: string, body: string, mediaUrl: string | null | undefined, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // media is a MERGE, never a replace: the same jsonb also holds the marketer's image brief and
      // the generated image's inline preview, and a human retyping the URL must not delete either.
      const [row] = mediaUrl === undefined
        ? await sql`update content_items set body = ${body} where id = ${itemId}::uuid and status in ('draft', 'scheduled') returning workspace_id`
        : mediaUrl
          ? await sql`update content_items set body = ${body}, media = coalesce(media, '{}'::jsonb) || ${sql.json({ image_url: mediaUrl } as never)}::jsonb where id = ${itemId}::uuid and status in ('draft', 'scheduled') returning workspace_id`
          : await sql`update content_items set body = ${body}, media = nullif(coalesce(media, '{}'::jsonb) - 'image_url', '{}'::jsonb) where id = ${itemId}::uuid and status in ('draft', 'scheduled') returning workspace_id`;
      if (!row) throw new DomainError('NOT_FOUND', 'content item not found (or already published)');
      await this.insertEvent(sql, makeEvent(row['workspace_id'] as string), null);
      return { id: itemId };
    }) as Promise<{ id: string }>;
  }

  async reviseDraft(itemId: string, patch: { body: string | null; imageBrief: string | null; script?: string | null; frame?: string | null; seconds?: number | null; videoPending?: boolean; videoMeta?: VideoMeta | null; videoErrorCode?: 'NO_CREDITS' | 'UNAVAILABLE' | null; thumb: string | null; imageError?: string | null; videoError?: string | null }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // Revisable while a 'draft' OR a proposed 'scheduled' slot — the marketer owns the content
      // flow and a scheduled post has not gone out yet (mirrors updateContentBody/deleteContentItem,
      // which already span both). Published/failed stay off-limits: you cannot rewrite what already
      // shipped. Read-modify-write so the PRIOR version is snapshotted into media.history — the
      // thread shows old versions in place and the new one after the marketer's reply, never a
      // silent overwrite.
      const [cur] = await sql`select workspace_id, body, media, status, created_at from content_items where id = ${itemId}::uuid and status in ('draft', 'scheduled')`;
      if (!cur) throw new DomainError('NOT_FOUND', 'content item not found (already published or gone)');
      const media = { ...((cur['media'] as Record<string, unknown> | null) ?? {}) };
      // A content REVISION (new body or brief) snapshots the prior version + renders as a new card
      // after the reply. An image-only touch (a retry's thumb, or its failure reason) updates the
      // SAME card in place — no version, no re-anchor — so retrying a picture never forks the draft.
      const isRevision = patch.body !== null || patch.imageBrief !== null || !!patch.script;
      if (isRevision) {
        const snapshot = {
          body: cur['body'] as string,
          ...(media['brief'] ? { brief: media['brief'] } : {}),
          ...(media['script'] ? { script: media['script'] } : {}),
          ...(media['thumb'] ? { thumb: media['thumb'] } : {}),
          at: (media['revised_at'] as string) ?? new Date(cur['created_at'] as string).toISOString(),
        };
        media['history'] = [...((media['history'] as unknown[]) ?? []), snapshot].slice(-6);
        media['revised_at'] = new Date().toISOString();
      }
      if (patch.imageBrief !== null) media['brief'] = patch.imageBrief;
      // a new script means the old film is of the old script: it goes, the card films again
      if (patch.script) { media['script'] = patch.script; delete media['video_id']; delete media['video_error']; }   if (patch.frame !== undefined) { if (patch.frame) media['frame'] = patch.frame; else delete media['frame']; delete media['video_id']; delete media['video']; delete media['video_error']; }   if (patch.seconds !== undefined) { if (patch.seconds) media['seconds'] = patch.seconds; else delete media['seconds']; } // a new frame: the old film is of the old frame, it goes; a new length only sets what the NEXT film takes
      if (patch.thumb !== null) { media['thumb'] = patch.thumb; delete media['image_error']; } // an image landed → drop the error
      if (patch.imageError !== undefined) { if (patch.imageError) media['image_error'] = patch.imageError; else delete media['image_error']; }
      if (patch.videoError !== undefined) { if (patch.videoError) media['video_error'] = patch.videoError; else { delete media['video_error']; delete media['video_error_code']; } }   if (patch.videoErrorCode !== undefined) { if (patch.videoErrorCode) media['video_error_code'] = patch.videoErrorCode; else delete media['video_error_code']; }
      // the film in flight on the platform's key (0140): set by the door, cleared by the cron; a film's facts land beside it
      if (patch.videoPending !== undefined) { if (patch.videoPending) media['video_pending'] = true; else delete media['video_pending']; }   if (patch.videoMeta !== undefined) { if (patch.videoMeta) media['video'] = patch.videoMeta; else delete media['video']; }
      const newBody = patch.body ?? (cur['body'] as string);
      // Rewriting the COPY/brief of a SCHEDULED post UNSCHEDULES it back to 'draft' and clears its
      // approval: dueContentItems auto-publishes on status='scheduled' alone, so the changed text
      // must never ride the old slot without a fresh human approve (nothing publishes unreviewed).
      // An image-only touch leaves the slot intact — the approved post text is unchanged.
      if (isRevision && cur['status'] === 'scheduled') {
        await sql`update content_items set body = ${newBody}, media = ${sql.json(media as never)},
          status = 'draft', scheduled_at = null, approved_by = null, approved_at = null
          where id = ${itemId}::uuid and status = 'scheduled'`;
      } else {
        await sql`update content_items set body = ${newBody}, media = ${sql.json(media as never)} where id = ${itemId}::uuid and status in ('draft', 'scheduled')`;
      }
      await this.insertEvent(sql, makeEvent(cur['workspace_id'] as string), null);
      return { id: itemId };
    }) as Promise<{ id: string }>;
  }

  async deleteContentItem(itemId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [row] = await sql`delete from content_items where id = ${itemId}::uuid and status in ('draft', 'scheduled') returning workspace_id`;
      if (!row) throw new DomainError('NOT_FOUND', 'content item not found (published items stay — they are history)');
      await this.insertEvent(sql, makeEvent(row['workspace_id'] as string), null);
      return { id: itemId };
    }) as Promise<{ id: string }>;
  }

  async attachContentMedia(itemId: string, mime: string, bytes: Buffer, actor: { kind: string; id: string }, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [item] = await sql`select workspace_id from content_items where id = ${itemId}::uuid and status in ('draft', 'scheduled')`;
      if (!item) throw new DomainError('NOT_FOUND', 'content item not found (or already published)');
      const ws = item['workspace_id'] as string;
      // one hosted image per draft: replacing it must not leave the old bytes orphaned
      await sql`delete from content_media where content_item_id = ${itemId}::uuid`;
      const [row] = await sql`insert into content_media (workspace_id, content_item_id, mime, bytes, size_bytes, created_by_kind, created_by)
        values (${ws}::uuid, ${itemId}::uuid, ${mime}, ${bytes}, ${bytes.length}, ${actor.kind}, ${actor.id}) returning id`;
      const mediaId = row!['id'] as string;
      // MERGE — the same jsonb carries the marketer's brief and the card's inline thumbnail; a
      // hosted image clears any prior image_error (the card now shows the picture, not the reason).
      // A FILM (video/*) takes the one media slot the same way: video_id in, video_error out, and the
      // picture's keys out with it, because the bytes it pointed at are gone.
      const film = mime.startsWith('video/');
      const patch = film ? { video_id: mediaId } : { image_id: mediaId };
      await sql`update content_items set media = (((coalesce(media, '{}'::jsonb) || ${sql.json(patch as never)}::jsonb) - ${film ? 'video_error' : 'image_error'}) - ${film ? 'image_id' : 'video_id'}) - ${film ? 'thumb' : 'video_error'} where id = ${itemId}::uuid`;
      await this.insertEvent(sql, makeEvent(ws), null);
      return { id: mediaId };
    }) as Promise<{ id: string }>;
  }

  async contentMediaBytes(mediaId: string): Promise<{ mime: string; bytes: Buffer; workspace: string } | null> {
    const [r] = await this.sql`select mime, bytes, workspace_id from content_media where id = ${mediaId}::uuid limit 1`;
    return r ? { mime: r['mime'] as string, bytes: Buffer.from(r['bytes'] as Uint8Array), workspace: r['workspace_id'] as string } : null;
  }

  async createChannelArtifact(
    input: { channelId: string; kind: string; name: string; inlineContent: string; mime: string | null; tags?: string[]; createdByKind: string; createdBy: string },
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id from channels where id = ${input.channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      const ws = ch['workspace_id'] as string;
      const [row] = await sql`insert into artifacts (workspace_id, channel_id, kind, name, mime, inline_content, size_bytes, tags, created_by_kind, created_by)
        values (${ws}::uuid, ${input.channelId}::uuid, ${input.kind}::artifact_kind, ${input.name}, ${input.mime}, ${input.inlineContent}, ${input.inlineContent.length}, ${input.tags ?? []}, ${input.createdByKind}::actor_kind, ${input.createdBy})
        returning id`;
      await this.insertEvent(sql, makeEvent(ws), null);
      return { id: row!['id'] as string };
    }) as Promise<{ id: string }>;
  }

  // jsonb params (docs/38): postgres.js JSON-serializes a STRING bound toward a jsonb column
  // into a jsonb string SCALAR — the brain_override lesson, re-caught live: both lanes wrote
  // scene/source as jsonb strings, which reads fine on the writing machine (its local row is
  // the source of truth) and arrives DOUBLE-ENCODED on every other device. Parse the validated
  // JSON text and hand postgres.js the real value via sql.json.
  private wbJson(text: string | null | undefined, what: string): postgres.Parameter | null {
    if (text == null) return null;
    try {
      return this.sql.json(JSON.parse(text) as never);
    } catch {
      throw new DomainError('INVALID_INPUT', `${what} is not valid JSON`);
    }
  }

  // ── whiteboards (docs/38) ─────────────────────────────────────────────────
  // scene/source arrive as JSON text and are cast ::jsonb at the write. workspace_id is
  // resolved FROM the channel row inside the transaction — the tenant-authz idiom; a payload
  // workspace is never trusted for a channel-scoped write.
  async createWhiteboard(
    input: WhiteboardCreate,
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string; workspace: string }> {
    // boards file by channel ID (both real callers hold one); a non-uuid ref is a caller bug
    // and must read as NOT_FOUND, not as a pg cast error surfacing as a 500
    if (!UUID_RE.test(input.channelId)) throw new DomainError('NOT_FOUND', 'channel not found (whiteboards file by channel id)');
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id from channels where id = ${input.channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      const ws = ch['workspace_id'] as string;
      const id = input.id ?? crypto.randomUUID();
      // idempotent on id: the desktop's local-first PUT replays after a retry/relaunch — the
      // replay returns the existing id and writes NO second event.
      const [ins] = await sql`insert into whiteboards
          (id, workspace_id, channel_id, thread_id, task_id, title, scene, source, snapshot_svg, snapshot_rev, rev, created_by_kind, created_by)
        values (${id}::uuid, ${ws}::uuid, ${input.channelId}::uuid, ${input.threadId ?? null}::uuid, ${input.taskId ?? null}::uuid, ${input.title},
          ${this.wbJson(input.scene, 'scene')}, ${this.wbJson(input.source, 'source')}, ${input.snapshotSvg ?? null}, ${input.snapshotRev ?? 0}, ${input.rev ?? 1},
          ${input.createdByKind}::actor_kind, ${input.createdBy}::uuid)
        on conflict (id) do nothing
        returning id`;
      if (ins) await this.insertEvent(sql, makeEvent(ws), null);
      return { id, workspace: ws };
    }) as Promise<{ id: string; workspace: string }>;
  }

  // the autosave lane: highest rev wins, a stale/unknown row is ACKed as applied:false — a
  // throwing autosave would wedge the desktop's whole upload queue behind one lost race.
  async patchWhiteboardLww(p: WhiteboardLwwPatch): Promise<{ applied: boolean }> {
    const archTouched = p.archivedAt !== undefined;
    const rows = await this.sql`update whiteboards set
        rev = ${p.rev},
        title = coalesce(${p.title ?? null}, title),
        scene = coalesce(${this.wbJson(p.scene, 'scene')}, scene),
        snapshot_svg = coalesce(${p.snapshotSvg ?? null}, snapshot_svg),
        snapshot_rev = coalesce(${p.snapshotRev ?? null}, snapshot_rev),
        archived_at = case when ${archTouched} then ${p.archivedAt ?? null}::timestamptz else archived_at end,
        updated_by_kind = ${p.updatedByKind}::actor_kind,
        updated_by = ${p.updatedBy}::uuid,
        updated_at = now()
      where id = ${p.id}::uuid and rev < ${p.rev}`;
    return { applied: rows.count > 0 };
  }

  // the command lane: strict rev guard — an agent that built on rev N may not overwrite rev N+1.
  async updateWhiteboard(
    input: WhiteboardUpdate,
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string; rev: number }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [w] = await sql`select workspace_id, rev, source, archived_at from whiteboards where id = ${input.id}::uuid for update`;
      if (!w) throw new DomainError('NOT_FOUND', 'whiteboard not found');
      if (w['archived_at']) throw new DomainError('CONFLICT', 'this board is archived — un-archive it first');
      const rev = w['rev'] as number;
      if (rev !== input.baseRev) throw new DomainError('WHITEBOARD_STALE', `the board moved to rev ${rev} — re-read it and reapply your change`);
      if (input.clearSource && !w['source']) throw new DomainError('INVALID_INPUT', 'nothing to materialize — the board has no pending source');
      const next = input.baseRev + 1;
      await sql`update whiteboards set
          rev = ${next},
          title = coalesce(${input.title ?? null}, title),
          source = case when ${!!input.clearSource} then null
                        when ${input.source !== undefined} then ${this.wbJson(input.source, 'source')}
                        else source end,
          scene = coalesce(${this.wbJson(input.scene, 'scene')}, scene),
          snapshot_svg = coalesce(${input.snapshotSvg ?? null}, snapshot_svg),
          snapshot_rev = case when ${input.snapshotSvg !== undefined} then ${next} else snapshot_rev end,
          updated_by_kind = ${input.updatedByKind}::actor_kind,
          updated_by = ${input.updatedBy}::uuid,
          updated_at = now()
        where id = ${input.id}::uuid`;
      await this.insertEvent(sql, makeEvent(w['workspace_id'] as string), null);
      return { id: input.id, rev: next };
    }) as Promise<{ id: string; rev: number }>;
  }

  async getWhiteboard(id: string): Promise<WhiteboardRow | null> {
    const [r] = await this.sql`select id, workspace_id, channel_id, thread_id, task_id, title,
        scene::text as scene, source::text as source, snapshot_svg, snapshot_rev, rev, archived_at,
        created_by_kind, created_by, created_at, updated_at
      from whiteboards where id = ${id}::uuid limit 1`;
    return r ? this.whiteboardRowOf(r) : null;
  }

  async listWhiteboards(q: { workspace?: string; channel?: string; includeArchived?: boolean; limit?: number }): Promise<WhiteboardMeta[]> {
    const limit = Math.min(q.limit ?? 100, 200);
    const rows = q.channel
      ? await this.sql`select id, workspace_id, channel_id, thread_id, task_id, title, snapshot_rev, rev, archived_at,
            created_by_kind, created_by, created_at, updated_at, (scene is not null) as has_scene, (source is not null) as has_source
          from whiteboards where channel_id = ${q.channel}::uuid and (${!!q.includeArchived} or archived_at is null)
          order by updated_at desc limit ${limit}`
      : await this.sql`select id, workspace_id, channel_id, thread_id, task_id, title, snapshot_rev, rev, archived_at,
            created_by_kind, created_by, created_at, updated_at, (scene is not null) as has_scene, (source is not null) as has_source
          from whiteboards where workspace_id = ${q.workspace ?? null}::uuid and (${!!q.includeArchived} or archived_at is null)
          order by updated_at desc limit ${limit}`;
    return rows.map((r) => ({
      id: r['id'] as string,
      workspace: r['workspace_id'] as string,
      channelId: r['channel_id'] as string,
      threadId: (r['thread_id'] as string | null) ?? null,
      taskId: (r['task_id'] as string | null) ?? null,
      title: r['title'] as string,
      snapshotRev: r['snapshot_rev'] as number,
      rev: r['rev'] as number,
      archivedAt: r['archived_at'] ? new Date(r['archived_at'] as string).toISOString() : null,
      createdByKind: r['created_by_kind'] as 'human' | 'agent',
      createdBy: r['created_by'] as string,
      createdAt: new Date(r['created_at'] as string).toISOString(),
      updatedAt: new Date(r['updated_at'] as string).toISOString(),
      hasScene: !!r['has_scene'],
      hasSource: !!r['has_source'],
    }));
  }

  private whiteboardRowOf(r: Record<string, unknown>): WhiteboardRow {
    return {
      id: r['id'] as string,
      workspace: r['workspace_id'] as string,
      channelId: r['channel_id'] as string,
      threadId: (r['thread_id'] as string | null) ?? null,
      taskId: (r['task_id'] as string | null) ?? null,
      title: r['title'] as string,
      scene: (r['scene'] as string | null) ?? null,
      source: (r['source'] as string | null) ?? null,
      snapshotSvg: (r['snapshot_svg'] as string | null) ?? null,
      snapshotRev: r['snapshot_rev'] as number,
      rev: r['rev'] as number,
      archivedAt: r['archived_at'] ? new Date(r['archived_at'] as string).toISOString() : null,
      createdByKind: r['created_by_kind'] as 'human' | 'agent',
      createdBy: r['created_by'] as string,
      createdAt: new Date(r['created_at'] as string).toISOString(),
      updatedAt: new Date(r['updated_at'] as string).toISOString(),
    };
  }

  // ── connectors + the publish pass (marketing-channel plan §4.8) ──────────
  // A connector belongs to a PROJECT (0106), not a workspace. Keying on (workspace, provider)
  // meant connecting X in a second project silently OVERWROTE the first product's account
  // instead of adding one — the same row, its channel_id repointed. The project is derived from
  // the room the OAuth round-trip started in, so callers keep passing a channel.
  async upsertConnector(input: { workspace: string; channelId: string | null; provider: string; handle: string; connectedBy: string; scopes: string }): Promise<{ id: string }> {
    const [row] = await this.sql`insert into connectors (workspace_id, channel_id, project_id, provider, handle, status, scopes, connected_by)
      values (
        ${input.workspace}::uuid, ${input.channelId},
        coalesce(
          (select ch.project_id from channels ch where ch.id = ${input.channelId}),
          (select p.id from projects p where p.workspace_id = ${input.workspace}::uuid and p.is_default limit 1)
        ),
        ${input.provider}, ${input.handle}, 'connected', ${input.scopes}, ${input.connectedBy})
      on conflict (workspace_id, project_id, provider) where project_id is not null do update
        set handle = excluded.handle, status = 'connected', channel_id = excluded.channel_id,
            scopes = excluded.scopes, connected_by = excluded.connected_by
      returning id`;
    return { id: row!['id'] as string };
  }

  async setConnectorSecret(connectorId: string, ciphertext: string): Promise<void> {
    await this.sql`insert into connector_secrets (connector_id, ciphertext) values (${connectorId}::uuid, ${ciphertext})
      on conflict (connector_id) do update set ciphertext = excluded.ciphertext, created_at = now()`;
  }

  // `channelId` names WHICH project's account to publish with. Without it a workspace with two
  // products would post project A's content from project B's handle — an externally visible,
  // unrecallable mistake — so it is resolved through the item's own channel, never guessed.
  // Omitted (legacy callers, one-project workspaces) it falls back to the workspace's single
  // connector, which is exactly what the old behaviour was.
  //
  // A PROJECT-LESS connector stays reachable as a fallback, and the ordering makes the project's
  // own account win when both exist. Excluding it instead made any row without a project silently
  // unpublishable — 0106 backfills them all, but a row can still arrive project-less (the OAuth
  // round-trip carries no channel), and "connected, yet nothing ever posts" is the worst failure
  // shape available here.
  async connectorWithSecret(workspace: string, provider: string, channelId?: string | null): Promise<{ id: string; status: string; handle: string; ciphertext: string | null } | null> {
    const [row] = await this.sql`select c.id, c.status, c.handle, s.ciphertext from connectors c
      left join connector_secrets s on s.connector_id = c.id
      where c.workspace_id = ${workspace}::uuid and c.provider = ${provider}
        and (${channelId ?? null}::uuid is null
             or c.project_id is null
             or c.project_id = (select ch.project_id from channels ch where ch.id = ${channelId ?? null}::uuid))
      order by (c.project_id is not null) desc limit 1`;
    return row ? { id: row['id'] as string, status: row['status'] as string, handle: (row['handle'] as string) ?? '', ciphertext: (row['ciphertext'] as string | null) ?? null } : null;
  }

  async markConnectorReauth(connectorId: string): Promise<void> {
    // status only — the sealed secret stays (see the Store contract): the human's disconnect is
    // the one path that deletes ciphertext. 'reauth_required', NOT the 'revoked' a disconnect
    // writes (0121): the secret never syncs, so this synced word is the only way a client can
    // tell "the grant died under us — offer Reconnect" from "I turned this off — stay quiet".
    await this.sql`update connectors set status = 'reauth_required' where id = ${connectorId}::uuid`;
  }

  async revokeConnector(connectorId: string, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [row] = await sql`update connectors set status = 'revoked' where id = ${connectorId}::uuid returning workspace_id`;
      if (!row) throw new DomainError('NOT_FOUND', 'connector not found');
      await sql`delete from connector_secrets where connector_id = ${connectorId}::uuid`;
      await this.insertEvent(sql, makeEvent(row['workspace_id'] as string), null);
      return { id: connectorId };
    }) as Promise<{ id: string }>;
  }

  async dueContentItems(nowIso: string, limit: number): Promise<DueItem[]> { return dueContentItemsSql(this.sql, nowIso, limit); }
  async upcomingContentItems(fromIso: string, toIso: string, limit: number): Promise<UpcomingItem[]> { return upcomingContentItemsSql(this.sql, fromIso, toIso, limit); }

  async contentItemMedia(itemId: string): Promise<{ platform: string; mediaUrl: string | null; mediaId?: string | null; workspace: string; channel?: string; frame?: string | null; seconds?: number | null } | null> {
    const [r] = await this.sql`select platform, media, workspace_id, channel_id from content_items where id = ${itemId}::uuid limit 1`;
    if (!r) return null;
    const m = r['media'] as { image_url?: string; image_id?: string; frame?: string; seconds?: number } | null;
    return { platform: r['platform'] as string, mediaUrl: m?.image_url ?? null, mediaId: m?.image_id ?? null, workspace: r['workspace_id'] as string, channel: r['channel_id'] as string, frame: m?.frame ?? null, seconds: m?.seconds ?? null };
  }

  async markContentPublished(itemId: string, url: string, publishedAtIso: string): Promise<void> {
    await this.sql`update content_items set status = 'published', external_url = ${url}, published_at = ${publishedAtIso}, last_error = null where id = ${itemId}::uuid`;
  }

  async markContentFailed(itemId: string, error: string): Promise<void> {
    await this.sql`update content_items set status = 'failed', last_error = ${error.slice(0, 500)} where id = ${itemId}::uuid`;
  }

  async claimScheduleRun(scheduleId: string, runCount: number, nextRunAt: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ claimed: boolean }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // the CAS: run_count is the claim token (counter, not timestamp — the ship-stage
      // lesson), so two daemons racing the same due row get exactly one winner.
      const [row] = await sql`update schedules
        set run_count = run_count + 1, next_run_at = ${nextRunAt}, last_run_at = now(),
            status = case when ${nextRunAt}::timestamptz is null then 'done' else status end
        where id = ${scheduleId}::uuid and run_count = ${runCount} and status = 'active'
        returning workspace_id`;
      if (!row) {
        const [exists] = await sql`select 1 from schedules where id = ${scheduleId}::uuid`;
        if (!exists) throw new DomainError('NOT_FOUND', 'schedule not found');
        return { claimed: false };
      }
      await this.insertEvent(sql, makeEvent(row['workspace_id'] as string), null);
      return { claimed: true };
    }) as Promise<{ claimed: boolean }>;
  }

  async markScheduleResult(scheduleId: string, error: string | null, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      await this.insertEvent(sql, makeEvent(await markScheduleResultSql(sql, scheduleId, error)), null);
      return { id: scheduleId };
    }) as Promise<{ id: string }>;
  }

  async setScheduleCursor(scheduleId: string, cursor: { at: string; tag: string | null }, log: { at: string; key: string | null; note: string } | null, makeEvent: (workspace: string) => NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      await this.insertEvent(sql, makeEvent(await setScheduleCursorSql(sql, scheduleId, cursor, log)), null);
      return { id: scheduleId };
    }) as Promise<{ id: string }>;
  }

  // Permanently delete a room + everything in it. Irreversible. Mirrors deleteProject's
  // purge scoped to one channel: record the (FK-free) audit event — insertEvent writes no
  // channel_id, so it survives — then DELETE this channel's events (the GUC permits it; the
  // append-only trigger otherwise blocks the FK's ON DELETE SET NULL), then drop the channel
  // so its cascade (messages/tasks/artifacts/skills/memory/facts) is clean.
  async deleteChannel(
    channelId: string,
    makeEvent: (workspace: string) => NMEvent,
  ): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [ch] = await sql`select workspace_id from channels where id = ${channelId}::uuid`;
      if (!ch) throw new DomainError('NOT_FOUND', 'channel not found');
      const ws = ch['workspace_id'] as string;
      await this.insertEvent(sql, { ...makeEvent(ws), workspace: ws }, null);
      await sql`select set_config('nm.allow_event_purge', 'on', true)`;
      await sql`delete from events where channel_id = ${channelId}::uuid
        or task_id in (select id from tasks where channel_id = ${channelId}::uuid)`;
      await sql`delete from channels where id = ${channelId}::uuid`;
      return { id: channelId };
    }) as Promise<{ id: string }>;
  }

  async setCredential(
    input: { workspace: string; provider: string; scope: 'workspace' | 'agent'; agentId: string | null; token: string | null; authMode: 'apikey' | 'subscription'; setBy: string },
    event: NMEvent,
  ): Promise<void> {
    await this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      if (input.scope === 'workspace') {
        await sql`delete from provider_credentials where workspace_id = ${input.workspace}::uuid and provider = ${input.provider} and scope = 'workspace'`;
      } else {
        await sql`delete from provider_credentials where agent_id = ${input.agentId}::uuid and provider = ${input.provider} and scope = 'agent'`;
      }
      await sql`insert into provider_credentials (workspace_id, scope, agent_id, provider, token, auth_mode, set_by)
        values (${input.workspace}::uuid, ${input.scope}, ${input.agentId}::uuid, ${input.provider}, ${input.token}, ${input.authMode}, ${input.setBy}::uuid)`;
      await this.insertEvent(sql, event, null);
    });
  }

  async resolveCredential(workspace: string, provider: string, agentId: string | null) {
    const [wsRow] = await this.sql`select auto_failover from workspaces where id = ${workspace}::uuid`;
    const autoFailover = !!(wsRow?.['auto_failover']);
    if (agentId) {
      const [a] = await this.sql`select token, auth_mode from provider_credentials where agent_id = ${agentId}::uuid and provider = ${provider} and scope = 'agent'`;
      if (a) return { token: (a['token'] as string | null) ?? null, authMode: a['auth_mode'] as 'apikey' | 'subscription', source: 'agent', autoFailover };
    }
    const [w] = await this.sql`select token, auth_mode from provider_credentials where workspace_id = ${workspace}::uuid and provider = ${provider} and scope = 'workspace'`;
    return w
      ? { token: (w['token'] as string | null) ?? null, authMode: w['auth_mode'] as 'apikey' | 'subscription', source: 'workspace', autoFailover }
      : { token: null, authMode: null, source: 'none', autoFailover };
  }

  async listCredentials(workspace: string) {
    const rows = await this.sql`select provider, scope, agent_id, auth_mode, right(token, 4) as last4, updated_at
      from provider_credentials where workspace_id = ${workspace}::uuid order by updated_at desc`;
    return rows.map((r) => ({
      provider: r['provider'] as string,
      scope: r['scope'] as string,
      agentId: r['agent_id'] as string | null,
      authMode: r['auth_mode'] as 'apikey' | 'subscription',
      last4: (r['last4'] as string | null) ?? null,
      updatedAt: new Date(r['updated_at']).toISOString(),
    }));
  }

  // The set of providers CONFIGURED at the workspace scope (presence-of-row, INCLUDING tokenless
  // subscription markers) — the single predicate the pack-activation gate uses. One round-trip
  // instead of looping resolveCredential per provider.
  async enabledProviders(workspace: string): Promise<Set<string>> {
    const rows = await this.sql`select distinct provider from provider_credentials where workspace_id = ${workspace}::uuid and scope = 'workspace'`;
    return new Set(rows.map((r) => r['provider'] as string));
  }

  async pinMessage(messageId: string, pinned: boolean): Promise<{ id: string }> {
    const rows = await this.sql`update messages set pinned = ${pinned} where id = ${messageId}::uuid returning id`;
    if (!rows[0]) throw new DomainError('NOT_FOUND', 'message not found');
    return { id: messageId };
  }

  async reviseCardMessage(messageId: string, body: string, actor: { kind: string; id: string }): Promise<{ id: string }> {
    // author-scoped in the WHERE clause, so a losing race reads as NOT_PERMITTED rather than
    // silently rewriting somebody else's card
    const rows = await this.sql`update messages set body = ${body}
      where id = ${messageId}::uuid and author_kind = ${actor.kind}::actor_kind and author_id = ${actor.id}
      returning id`;
    if (!rows[0]) throw new DomainError('NOT_PERMITTED', 'a card is revised by the agent that posted it');
    return { id: messageId };
  }

  async updateThread(workspace: string, threadId: string, patch: { title?: string; description?: string }, opts?: { agentTitleOnce?: boolean }): Promise<void> {
    // the titled-once invariant (0124): an agent names a conversation ONCE — the christening
    // stamps titled_at, and later agent renames are refused (a subtask arm must never re-title
    // its parent thread). Humans rename freely; their rename stamps too, closing agent renames.
    if (patch.title !== undefined && opts?.agentTitleOnce) {
      const [cur] = await this.sql<Array<{ titled_at: string | null }>>`select titled_at from threads where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid`;
      if (!cur) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
      if (cur.titled_at) throw new DomainError('THREAD_ALREADY_TITLED', 'this conversation is already named — only the human renames it');
    }
    const [row] = await this.sql<Array<{ id: string }>>`update threads set
        title = coalesce(${patch.title ?? null}, title),
        titled_at = case when ${patch.title ?? null}::text is not null then now() else titled_at end,
        description = coalesce(${patch.description ?? null}, description),
        updated_at = now()
      where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid
      returning id`;
    if (!row) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
  }

  async createThread(workspace: string, channelId: string, threadId: string, title: string, description: string, createdBy: string): Promise<void> {
    await this.sql`insert into threads (id, workspace_id, channel_id, title, description, created_by)
      values (${threadId}::uuid, ${workspace}::uuid, ${channelId}::uuid, ${title}, ${description}, ${createdBy})
      on conflict (id) do nothing`;
  }

  // docs/34: null means the thread doesn't exist here — deliberately distinct from 'tasks', so
  // the server floor can tell "not a chat" from "not a thread" instead of guessing.
  async getThreadMode(workspace: string, threadId: string): Promise<ThreadMode | null> {
    const [row] = await this.sql<Array<{ mode: string }>>`select mode from threads
      where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid`;
    return row ? threadModeOf(row.mode) : null;
  }

  // routines (0119): the automation that opened this thread — the server floor that makes a
  // routine-born task hands-off reads it (createtask.ts, 2026-08-19)
  async getThreadScheduleId(workspace: string, threadId: string): Promise<string | null> {
    const [row] = await this.sql<Array<{ schedule_id: string | null }>>`select schedule_id from threads
      where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid`;
    return row?.schedule_id ?? null;
  }

  /** the room's setup task (docs/39) — the bootstrap anchors its whole flow to THIS thread
   * (round 3): wizard, docs, close and playbook subtasks live in one session, not five */
  async getSetupTaskId(channelId: string): Promise<string | null> {
    const [row] = await this.sql<Array<{ id: string }>>`select id from tasks
      where channel_id = ${channelId}::uuid and kind = 'setup' order by created_at desc limit 1`;
    return row?.id ?? null;
  }

  async threadTaskId(workspace: string, threadId: string): Promise<string | null | undefined> { return threadTaskIdSql(this.sql, workspace, threadId); }

  async setThreadArchived(workspace: string, threadId: string, archived: boolean): Promise<void> {
    const [row] = await this.sql<Array<{ id: string }>>`update threads
      set archived_at = ${archived ? this.sql`now()` : null}, updated_at = now()
      where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid returning id`;
    if (!row) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
  }

  async setThreadSettled(workspace: string, threadId: string, settled: boolean): Promise<void> { return setThreadSettledSql(this.sql, workspace, threadId, settled); }
  async latestHumanWord(taskId: string): Promise<{ id: string; createdAt: string } | null> { return latestHumanWordSql(this.sql, taskId); }

  // Auto-filing (0109) — the three reads/writes behind thread.move.
  async threadFiling(workspace: string, threadId: string) {
    const [row] = await this.sql<Array<{ task_id: string | null; filed_at: string | null; channel_id: string; project_id: string | null }>>`
      select t.task_id, t.filed_at, t.channel_id, c.project_id
        from threads t left join channels c on c.id = t.channel_id
       where t.id = ${threadId}::uuid and t.workspace_id = ${workspace}::uuid`;
    return row ? { taskId: row.task_id, filedAt: row.filed_at, channelId: row.channel_id, projectId: row.project_id } : null;
  }

  async channelProject(workspace: string, channelId: string) {
    const [row] = await this.sql<Array<{ project_id: string | null; slug: string }>>`
      select project_id, slug from channels
       where id = ${channelId}::uuid and workspace_id = ${workspace}::uuid`;
    return row ? { projectId: row.project_id, slug: row.slug } : null;
  }

  /**
   * The move itself: the thread AND every message in it, in ONE transaction. A message left
   * behind carries the old channel_id and would render in the room the conversation just left —
   * the room's own message watch reads `channel_id`, not the thread's.
   *
   * `stamp` writes `filed_at`, which is the agent's one-move gate. A human's correction
   * deliberately does not stamp: their move is not the agent's move, and burning the gate on a
   * human edit would mean rex could never file a thread the human had touched.
   */
  async moveThread(workspace: string, threadId: string, channelId: string, reason: string | null, stamp: boolean): Promise<void> {
    await this.sql.begin(async (sql) => {
      const [row] = await sql<Array<{ id: string }>>`update threads
           set channel_id = ${channelId}::uuid,
               filed_reason = ${reason},
               filed_at = ${stamp ? sql`now()` : sql`filed_at`},
               updated_at = now()
         where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid
       returning id`;
      if (!row) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
      await sql`update messages set channel_id = ${channelId}::uuid
                 where thread_id = ${threadId}::uuid and workspace_id = ${workspace}::uuid`;
    });
  }

  async shareCompute(workspace: string, userId: string, member: string, on: boolean): Promise<void> {
    const sql = this.sql;
    // roster and current grant read TOGETHER, so expanding '*' can never be based on a partial
    // view — which is exactly what the client-side version did
    const rows = await sql<Array<{ user_id: string; compute: { shares?: string[] } | null }>>`
      select user_id, compute from workspace_members where workspace_id = ${workspace}::uuid`;
    const ids = rows.map((r) => r.user_id);
    if (!ids.includes(userId)) throw new DomainError('NOT_FOUND', `not a member of ${workspace}`);
    if (!ids.includes(member)) throw new DomainError('NOT_FOUND', `member ${member} is not in this workspace`);
    const shares = applyShare(rows.find((r) => r.user_id === userId)?.compute?.shares, ids, userId, member, on);
    await sql`update workspace_members
        set compute = jsonb_set(coalesce(compute, '{}'::jsonb), '{shares}', ${sql.json(shares as never)}, true)
      where workspace_id = ${workspace}::uuid and user_id = ${userId}::uuid`;
  }

  async setMemberCompute(workspace: string, userId: string, prefs: { machine?: string | null; agents?: Record<string, string>; shares?: string[]; desktopSessions?: 'here' | 'auto' }): Promise<void> {
    const sql = this.sql;
    // every named id must belong to THIS workspace — a pref naming a foreign machine 404s at
    // set time rather than silently mis-routing at claim time
    const machineIds = [prefs.machine, ...Object.values(prefs.agents ?? {})].filter((x): x is string => !!x);
    if (machineIds.length) {
      const found = await sql<Array<{ id: string }>>`select id from machines where workspace_id = ${workspace}::uuid and id in ${sql(machineIds)}`;
      const ok = new Set(found.map((r) => r.id));
      const missing = machineIds.find((id) => !ok.has(id));
      if (missing) throw new DomainError('NOT_FOUND', `machine ${missing} is not in this workspace`);
    }
    const agentIds = Object.keys(prefs.agents ?? {});
    if (agentIds.length) {
      const found = await sql<Array<{ id: string }>>`select id from agents where workspace_id = ${workspace}::uuid and id in ${sql(agentIds)}`;
      const ok = new Set(found.map((r) => r.id));
      const missing = agentIds.find((id) => !ok.has(id));
      if (missing) throw new DomainError('NOT_FOUND', `agent ${missing} is not in this workspace`);
    }
    // consent (0119): you may only lend to people who are actually in this workspace
    const grantees = (prefs.shares ?? []).filter((x) => x !== '*');
    if (grantees.length) {
      const found = await sql<Array<{ user_id: string }>>`select user_id from workspace_members where workspace_id = ${workspace}::uuid and user_id in ${sql(grantees)}`;
      const ok = new Set(found.map((r) => r.user_id));
      const missing = grantees.find((id) => !ok.has(id));
      if (missing) throw new DomainError('NOT_FOUND', `member ${missing} is not in this workspace`);
    }
    // MERGE, never replace: only the keys the caller actually sent are written, so a partial
    // update cannot clobber a field it never mentioned. `||` on jsonb is a shallow merge, which
    // is exactly right here — the three keys are independent.
    const patch: Record<string, unknown> = {};
    if (prefs.machine !== undefined) patch['machine'] = prefs.machine;
    if (prefs.agents !== undefined) patch['agents'] = prefs.agents;
    if (prefs.shares !== undefined) patch['shares'] = prefs.shares;
    if (prefs.desktopSessions !== undefined) patch['desktopSessions'] = prefs.desktopSessions;
    // sql.json, not JSON.stringify — the house idiom for jsonb (a stringified bind double-encodes)
    const [row] = await sql<Array<{ user_id: string }>>`update workspace_members
        set compute = coalesce(compute, '{}'::jsonb) || ${sql.json(patch as never)}
      where workspace_id = ${workspace}::uuid and user_id = ${userId}::uuid
      returning user_id`;
    if (!row) throw new DomainError('NOT_FOUND', `not a member of ${workspace}`);
  }

  /** rule D9 (0134): a conversation's designated machine — store/thread-machine.ts */
  async setThreadMachine(workspace: string, threadId: string, machineId: string | null): Promise<void> { await setThreadMachineSql(this.sql, workspace, threadId, machineId); }

  async setThreadMode(workspace: string, threadId: string, mode: ThreadMode): Promise<void> {
    const [row] = await this.sql<Array<{ id: string }>>`update threads
        set mode = ${mode}, updated_at = now()
      where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid
      returning id`;
    if (!row) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
  }

  async setThreadBrain(workspace: string, threadId: string, override: BrainOverride | null): Promise<void> {
    // serializeBrainOverride is the same gate the daemon reads through, so the column can never
    // hold a shape the resolver would refuse — and an emptied override lands as NULL, not `{}`.
    // `sql.json` is load-bearing: binding the SERIALIZED STRING to a `::jsonb` cast makes
    // postgres.js encode it as a json *scalar* (`"{\"developer\":…}"`), which the column's
    // `jsonb_typeof = 'object'` check rejected on the first live write. The check constraint
    // existed exactly for this, and earned itself within a minute of being deployed.
    const clean = serializeBrainOverride(override) ? (parseBrainOverride(override) as BrainOverride) : null;
    const [row] = await this.sql<Array<{ id: string }>>`update threads
        set brain_override = ${clean ? this.sql.json(clean as never) : null}, updated_at = now()
      where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid
      returning id`;
    if (!row) throw new DomainError('NOT_FOUND', `thread ${threadId} not found`);
  }

  async linkThreadTask(workspace: string, threadId: string, taskId: string): Promise<void> {
    // only an unlinked thread links (partial unique on task_id backs this up); a stale or
    // foreign thread id is a no-op rather than a task-creation failure — the task matters more
    await this.sql`update threads set task_id = ${taskId}::uuid, updated_at = now()
      where id = ${threadId}::uuid and workspace_id = ${workspace}::uuid and task_id is null`;
  }

  async postMessage(msg: NMMessage, event: NMEvent, decisions?: DecisionSeed[]): Promise<NMMessage> {
    try {
      await this.sql.begin(async (_tx) => {
        const sql = asSql(_tx);
        const chId = await resolveChannelId(sql, msg.workspace, msg.channel);
        // conversation threads: the first message carrying an unknown thread id births
        // the thread (title = heuristic over the body) in this same transaction; every
        // later message just touches updated_at so history sorts by freshness.
        if (msg.threadId) {
          // docs/34: `mode` is written on INSERT only. The conflict branch touches updated_at
          // and nothing else, so a later message carrying threadMode can never re-mode the
          // conversation — that move belongs to thread.set_mode, and only to a human.
          // root_message_id is deliberately NOT set here — see the update below. It references
          // messages(id), and at this point in the transaction no message row exists yet, so
          // naming ANY root here is an FK violation waiting to happen.
          // …and the composer's brain draft rides the same birth-only contract (docs/10 §15):
          // written on INSERT, never in the conflict branch. `sql.json`, not a string + ::jsonb —
          // binding the serialized string encodes a json SCALAR, which 0101's check rejects.
          // …and 0119's schedule_id joins the birth-only set: the automation that fired this
          // slot owns the conversation it opened, and no later reply into it may re-attribute that.
          const bornBrain = parseBrainOverride(msg.brainOverride);
          // 0134: a designation naming a machine outside THIS workspace is dropped rather than mis-routing at claim time
          await sql`insert into threads (id, workspace_id, channel_id, title, created_by, mode, brain_override, schedule_id, machine_id, origin)
            values (${msg.threadId}::uuid, ${msg.workspace}::uuid, ${chId}, ${threadTitle(msg.body)}, ${`${msg.author.kind}:${msg.author.id}`}, ${threadModeOf(msg.threadMode)}, ${bornBrain ? sql.json(bornBrain as never) : null}, ${msg.scheduleId ?? null}::uuid, ${msg.threadMachineId ? await workspaceMachine(sql, msg.workspace, msg.threadMachineId) : null}::uuid, ${msg.threadOrigin ?? null})
            on conflict (id) do update set updated_at = now()`;
        }
        await sql`insert into messages (id, workspace_id, channel_id, task_id, thread_id, author_kind, author_id, body, reply_to)
          values (${msg.id}, ${msg.workspace}::uuid, ${chId}, ${msg.taskId ?? null}, ${msg.threadId ?? null},
            ${msg.author.kind}::actor_kind, ${msg.author.id}::uuid, ${msg.body}, ${msg.replyTo ?? null})`;
        // A thread's opening message IS its root (docs/31) unless the client named a different
        // one (the reply flow, where the root is an older message that stays in the feed). Rootless
        // threads are the bug shape: the feed shows a thread's root and hides its replies, so a
        // thread with no root swallows its own opener. Enforced here rather than in the composer so
        // every client — desktop, mobile, an agent posting via the API — is correct by construction.
        // Post-insert because threads.root_message_id references messages: the row must exist
        // first. That rule applies to the CLIENT-NAMED root too, which is the outage this
        // coalesce exists to prevent: the thread INSERT above used to write msg.rootMessageId
        // directly, one statement before the message it pointed at existed, so
        //   - a composer send (rootMessageId = its own id, docs/31) violated the FK outright, and
        //   - a reply into a thread whose root had since been PURGED (channel delete) violated it
        //     forever — the client retried the same POST, got the same 500, and every later send
        //     from that machine queued behind the poison op. That is what took rex down.
        // Written as a subquery so this statement can only ever set an id that EXISTS in messages:
        // the named root when it is really there, otherwise this message. FK-safe by construction,
        // and a vanished root degrades to "the thread roots on its own opener" instead of 500ing.
        if (msg.threadId) {
          await sql`update threads
                       set root_message_id = coalesce((select m.id from messages m where m.id = ${msg.rootMessageId ?? null}::uuid), ${msg.id}::uuid)
                     where id = ${msg.threadId}::uuid and root_message_id is null`;
        }
        await sql`insert into events (id, workspace_id, type, source, target, channel_id, task_id, payload, in_reply_to)
          values (${event.id}, ${event.workspace}::uuid, ${event.type}, ${event.source}, ${event.target},
            ${chId}, ${msg.taskId ?? null}, ${sql.json(event.payload as never)}, ${event.in_reply_to})`;
        // decisions (docs/12 slice 2): the body's nmq cards, transactional with the message.
        // A re-asked question supersedes its older OPEN card in the same channel/thread, so
        // re-emitted cards (plan re-review rounds) never pile up as stale needs-you entries.
        for (const d of decisions ?? []) {
          await sql`update decisions set status = 'dismissed', answered_at = now()
            where workspace_id = ${msg.workspace}::uuid and channel_id = ${chId}
              and task_id is not distinct from ${msg.taskId ?? null}
              and question = ${d.question} and status = 'open'`;
          await sql`insert into decisions (id, workspace_id, channel_id, task_id, message_id, asker_kind, asker_id, question, options, allow_other)
            values (${d.id}::uuid, ${msg.workspace}::uuid, ${chId}, ${msg.taskId ?? null}, ${msg.id}::uuid,
              ${msg.author.kind}::actor_kind, ${msg.author.id}::uuid, ${d.question}, ${sql.json(d.options as never)}, ${d.allowOther})`;
        }
        // Authoritative auto-resolve: a human reply carrying `**question** → answer` lines flips
        // the matching OPEN card to answered — so Mission Control / the Home needs-you list (which
        // trust the synced `status`) agree with the thread's string-match floor. Covers the answer
        // whose explicit decision.answer flip never landed (the transient-failure fallback that
        // posts the reply but leaves the row open, mobile, an older client). Idempotent: the card
        // click flips first, so by the time its reply arrives the row is already answered (skipped).
        if (msg.author.kind === 'human') {
          for (const [question, answer] of readAnswers([msg.body])) {
            await sql`update decisions set status = 'answered', answer = ${answer},
                answered_by_kind = ${msg.author.kind}::actor_kind, answered_by_id = ${msg.author.id}::uuid, answered_at = now()
              where workspace_id = ${msg.workspace}::uuid and channel_id = ${chId}
                and task_id is not distinct from ${msg.taskId ?? null}
                and question = ${question} and status = 'open'`;
          }
        }
      });
    } catch (err) {
      // 0060's partial unique (author_id, reply_to): a concurrent daemon already answered
      // this trigger — surface CONFLICT so the losing daemon stands down instead of duping.
      if ((err as { code?: string }).code === '23505' && String((err as Error).message).includes('messages_one_reply_per_trigger')) {
        throw new DomainError('CONFLICT', 'this agent already replied to that message');
      }
      // Duplicate id = a retried delivery, not new activity. PowerSync clients (mobile)
      // re-send a message whose response was lost (phone locked mid-POST); before this,
      // the retry 500'd on the pkey and the client retried forever — wedging its upload
      // queue behind the poison op. Ack with the row that already landed, but ONLY for
      // the identical logical message (same workspace/author/thread/body); anything else
      // is id-squatting and stays CONFLICT. Event + decisions were written by the first
      // delivery, so the retry writes nothing.
      if ((err as { code?: string }).code === '23505' && String((err as Error).message).includes('messages_pkey')) {
        const [existing] = await this.sql<
          Array<{ workspace_id: string; task_id: string | null; thread_id: string | null; author_kind: string; author_id: string; body: string; reply_to: string | null; created_at: Date }>
        >`select workspace_id, task_id, thread_id, author_kind, author_id, body, reply_to, created_at from messages where id = ${msg.id}`;
        const sameDelivery =
          existing &&
          existing.workspace_id === msg.workspace &&
          existing.author_kind === msg.author.kind &&
          existing.author_id === msg.author.id &&
          existing.task_id === (msg.taskId ?? null) &&
          existing.thread_id === (msg.threadId ?? null) &&
          existing.body === msg.body;
        if (!sameDelivery) throw new DomainError('CONFLICT', 'a different message with this id already exists');
        return {
          id: msg.id,
          workspace: msg.workspace,
          channel: msg.channel,
          taskId: existing.task_id,
          author: msg.author,
          body: existing.body,
          createdAt: existing.created_at.toISOString(),
          replyTo: existing.reply_to,
        };
      }
      throw err;
    }
    // semantic leg fills in behind the write — never blocks the send path
    void embed([msg.body]).then((vecs) => {
      if (!vecs?.[0]) return;
      return this.sql`update messages set embedding = ${JSON.stringify(vecs[0])}::vector where id = ${msg.id}`;
    }).catch(() => {});
    return msg;
  }

  // Decisions (docs/12 slice 2): the open → answered/dismissed flip is exactly-once by
  // construction — the conditional UPDATE only wins while status='open', so the second
  // machine's answer gets CONFLICT and stands down (the 0060 lesson, applied here).
  async answerDecision(
    id: string,
    input: { status: 'answered' | 'dismissed'; answer: string | null; by: ActorRef },
    makeEvent: (workspace: string) => NMEvent,
    resolveTaskMutation?: (decision: { taskId: string | null; question: string; options: DecisionRow['options'] }) => ((task: Task) => MutationResult) | null,
  ): Promise<{ id: string; taskId: string | null; question: string; options: DecisionRow['options'] }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [row] = await sql`select workspace_id, task_id, question, options, status
        from decisions where id = ${id}::uuid for update`;
      if (!row) {
        throw new DomainError('NOT_FOUND', `decision ${id} not found`);
      }
      if (row['status'] !== 'open') throw new DomainError('CONFLICT', `decision already ${row['status']}`);
      const decision = {
        taskId: (row['task_id'] as string | null) ?? null,
        question: row['question'] as string,
        options: (row['options'] ?? []) as DecisionRow['options'],
      };
      const taskMutation = resolveTaskMutation?.(decision) ?? null;
      if (taskMutation && decision.taskId) {
        const taskRows = await sql`select t.*, c.slug as channel_slug, p.slug as project_slug
          from tasks t join channels c on c.id = t.channel_id
          left join projects p on p.id = t.project_id where t.id = ${decision.taskId} for update of t`;
        if (!taskRows.length) throw new DomainError('NOT_FOUND', `task ${decision.taskId} not found`);
        const out = taskMutation(this.rowToTask(taskRows[0]!));
        // Provider selection deliberately leaves the state unchanged; this update
        // advances version/updated_at through the normal task trigger so open
        // clients observe the choice without waiting for design_review.
        await sql`update tasks set updated_at = now() where id = ${decision.taskId}`;
        for (const e of out.events) await this.insertEvent(sql, e, decision.taskId);
      }
      await sql`update decisions set status = ${input.status}::decision_status, answer = ${input.answer},
          answered_by_kind = ${input.by.kind}::actor_kind, answered_by_id = ${input.by.id}::uuid, answered_at = now()
        where id = ${id}::uuid`;
      await this.insertEvent(sql, makeEvent(row['workspace_id'] as string), null);
      return {
        id,
        ...decision,
      };
    }) as Promise<{ id: string; taskId: string | null; question: string; options: DecisionRow['options'] }>;
  }

  async listDecisions(workspace: string): Promise<DecisionRow[]> {
    const rows = await this.sql`select * from decisions where workspace_id = ${workspace}::uuid order by created_at asc`;
    return rows.map((r) => ({
      id: r['id'],
      workspace: r['workspace_id'],
      channel: r['channel_id'],
      taskId: r['task_id'],
      messageId: r['message_id'],
      asker: { kind: r['asker_kind'], id: r['asker_id'] },
      question: r['question'],
      options: (r['options'] ?? []) as DecisionRow['options'],
      allowOther: Boolean(r['allow_other']),
      status: r['status'],
      answer: r['answer'],
      answeredBy: r['answered_by_kind'] ? { kind: r['answered_by_kind'], id: r['answered_by_id'] } : null,
      createdAt: new Date(r['created_at']).toISOString(),
      answeredAt: r['answered_at'] ? new Date(r['answered_at']).toISOString() : null,
    }));
  }

  async setPolicy(input: PolicyInput, event: NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      let id: string;
      if (input.id) {
        const [row] = await sql`update policies set
          scope = ${input.scope}, project_id = ${input.projectId ?? null}, channel_id = ${input.channelId ?? null},
          agent_id = ${input.agentId ?? null}, capability = ${input.capability}, selector = ${sql.json(input.selector as never)},
          verdict = ${input.verdict}, rationale = ${input.rationale ?? ''}, locked = ${input.locked ?? false}, updated_at = now()
          where id = ${input.id}::uuid and workspace_id = ${input.workspace}::uuid returning id`;
        if (!row) throw new DomainError('NOT_FOUND', `policy ${input.id} not found`);
        id = row['id'] as string;
      } else {
        const [row] = await sql`insert into policies
          (workspace_id, scope, project_id, channel_id, agent_id, capability, selector, verdict, rationale, locked, created_by_kind, created_by_id)
          values (${input.workspace}::uuid, ${input.scope}, ${input.projectId ?? null}, ${input.channelId ?? null}, ${input.agentId ?? null},
            ${input.capability}, ${sql.json(input.selector as never)}, ${input.verdict}, ${input.rationale ?? ''}, ${input.locked ?? false},
            ${input.author.kind}::actor_kind, ${input.author.id}::uuid)
          returning id`;
        id = row!['id'] as string;
      }
      await this.insertEvent(sql, { ...event, workspace: input.workspace }, null);
      return { id };
    }) as Promise<{ id: string }>;
  }

  async deletePolicy(policyId: string, event: NMEvent): Promise<{ id: string }> {
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      const [row] = await sql`delete from policies where id = ${policyId}::uuid returning workspace_id`;
      if (!row) throw new DomainError('NOT_FOUND', `policy ${policyId} not found`);
      await this.insertEvent(sql, { ...event, workspace: row['workspace_id'] as string }, null);
      return { id: policyId };
    }) as Promise<{ id: string }>;
  }

  async listPolicies(workspace: string): Promise<PolicyRow[]> {
    const rows = await this.sql`select * from policies where workspace_id = ${workspace}::uuid order by created_at asc`;
    return rows.map((r) => ({
      id: r['id'],
      workspace: r['workspace_id'],
      scope: r['scope'],
      projectId: r['project_id'] ?? null,
      channelId: r['channel_id'] ?? null,
      agentId: r['agent_id'] ?? null,
      capability: r['capability'],
      selector: r['selector'],
      verdict: r['verdict'],
      rationale: r['rationale'] ?? '',
      locked: Boolean(r['locked']),
      createdBy: { kind: r['created_by_kind'], id: r['created_by_id'] },
      createdAt: new Date(r['created_at']).toISOString(),
      updatedAt: new Date(r['updated_at']).toISOString(),
    }));
  }

  // Boot-time catch-up for the semantic legs: rows written while NM_EMBED was off
  // have NULL embeddings and are invisible to vector recall until embedded. One
  // call = one batch per table (the maintenance loop drives it); oldest-first so
  // history heals deterministically. Empty bodies stay NULL (nothing to embed).
  async backfillEmbeddings(batch: number): Promise<{ messages: number; facts: number }> {
    const fill = async (rows: Row[], update: (ids: string[], vecs: string[]) => Promise<unknown>): Promise<number> => {
      if (!rows.length) return 0;
      const vecs = await embed(rows.map((r) => String(r['text'])));
      if (!vecs) return 0; // embedder off or failed — stop cleanly, resume next boot
      await update(rows.map((r) => r['id'] as string), vecs.map((v) => JSON.stringify(v)));
      return rows.length;
    };
    const msgRows = await this.sql`select id, body as text from messages where embedding is null and body <> '' order by created_at limit ${batch}`;
    const messages = await fill(msgRows, (ids, vecs) => this.sql`update messages m set embedding = u.vec::vector
      from unnest(${ids}::uuid[], ${vecs}::text[]) as u(id, vec) where m.id = u.id`);
    const factRows = await this.sql`select id, content as text from facts where embedding is null order by created_at limit ${batch}`;
    const facts = await fill(factRows, (ids, vecs) => this.sql`update facts f set embedding = u.vec::vector
      from unnest(${ids}::uuid[], ${vecs}::text[]) as u(id, vec) where f.id = u.id`);
    return { messages, facts };
  }

  async createAttachment(input: AttachmentInput, limits: { maxPerMessage: number; maxBytes: number }): Promise<{ id: string }> {
    // size guard is cheap + needs no row read
    if ((input.sizeBytes ?? 0) > limits.maxBytes) throw new DomainError('PLAN_LIMIT', attachmentUpgradeReason('size'));
    return this.sql.begin(async (_tx) => {
      const sql = asSql(_tx);
      // idempotent: PowerSync retries the upload, so a re-POST of the same id is a no-op success
      const [existing] = await sql`select 1 from artifacts where id = ${input.id}::uuid`;
      if (existing) return { id: input.id };
      const countRows = await sql`select count(*)::int as n from artifacts where message_id = ${input.messageId}::uuid`;
      if (Number(countRows[0]?.['n'] ?? 0) >= limits.maxPerMessage) throw new DomainError('PLAN_LIMIT', attachmentUpgradeReason('count'));
      const chId = await resolveChannelId(sql, input.workspace, input.channel);
      await sql`insert into artifacts
        (id, workspace_id, channel_id, task_id, message_id, kind, name, mime, inline_content, size_bytes, width, height, created_by_kind, created_by)
        values (${input.id}::uuid, ${input.workspace}::uuid, ${chId}, ${input.taskId ?? null}, ${input.messageId}::uuid,
          ${input.kind}::artifact_kind, ${input.name}, ${input.mime ?? null}, ${input.inlineContent ?? null},
          ${input.sizeBytes ?? null}, ${input.width ?? null}, ${input.height ?? null},
          ${input.author.kind}::actor_kind, ${input.author.id}::uuid)`;
      return { id: input.id };
    }) as Promise<{ id: string }>;
  }

  async channelMemory(workspace: string, channel: string) {
    const chId = await resolveChannelId(this.sql, workspace, channel);
    const [blk] = await this.sql`select content, basis_count, updated_at from memory_blocks
      where channel_id = ${chId} and kind = 'channel_summary'`;
    const facts = await this.sql`(select f.id, f.content, f.kind, t.number as task_number, f.valid_from, f.valid_until, f.superseded_by
        from facts f left join tasks t on t.id = f.task_id
        where f.channel_id = ${chId} and f.valid_until is null order by f.valid_from desc limit 30)
      union all
      (select f.id, f.content, f.kind, t.number as task_number, f.valid_from, f.valid_until, f.superseded_by
        from facts f left join tasks t on t.id = f.task_id
        where f.channel_id = ${chId} and f.valid_until is not null order by f.valid_until desc limit 8)`;
    return {
      block: blk
        ? { content: blk['content'] as string, basisCount: Number(blk['basis_count']), updatedAt: new Date(blk['updated_at']).toISOString() }
        : null,
      facts: facts.map((f) => ({
        id: f['id'] as string,
        content: f['content'] as string,
        kind: f['kind'] as string,
        taskNumber: f['task_number'] == null ? null : Number(f['task_number']),
        validFrom: new Date(f['valid_from']).toISOString(),
        validUntil: f['valid_until'] ? new Date(f['valid_until']).toISOString() : null,
        // distinguishes a superseded lesson (has a successor) from a retired one
        supersededBy: (f['superseded_by'] as string | null) ?? null,
      })),
    };
  }

  // Hybrid recall: FTS + vector legs in parallel, fused with reciprocal-rank
  // (1/(60+rank)). Without the embedder the vector leg is empty and FTS wins.
  async recall(
    workspace: string,
    channel: string | null,
    query: string,
    k: number,
  ): Promise<Array<{ id: string; kind: 'fact' | 'message'; body: string; channel: string; createdAt: string; score: number }>> {
    // TODO(channel-id): every caller today passes either null or a channel slug (the /v1/recall
    // endpoint, the agents.ts recall tool, the sync e2e all omit it or send a slug) — never an id.
    // Once desktop callers pass a channel id here, switch this filter to `${alias}.channel_id = ${channel}`.
    const chFilter = (alias: string) => (channel ? this.sql`and ${this.sql(alias)}.slug = ${channel}` : this.sql``);
    const qvecs = await embed([query]);
    const [fts, vec, factFts, factVec] = await Promise.all([
      this.sql`select m.id, m.body, c.slug as channel, m.created_at
        from messages m join channels c on c.id = m.channel_id
        where m.workspace_id = ${workspace}::uuid
          and m.fts @@ websearch_to_tsquery('english', ${query}) ${chFilter('c')}
        order by ts_rank(m.fts, websearch_to_tsquery('english', ${query})) desc limit 20`,
      qvecs?.[0]
        ? this.sql`select m.id, m.body, c.slug as channel, m.created_at
            from messages m join channels c on c.id = m.channel_id
            where m.workspace_id = ${workspace}::uuid and m.embedding is not null ${chFilter('c')}
            order by m.embedding <=> ${JSON.stringify(qvecs[0])}::vector limit 20`
        : Promise.resolve([] as Row[]),
      this.sql`select f.id, f.content as body, c.slug as channel, f.created_at
        from facts f join channels c on c.id = f.channel_id
        where f.workspace_id = ${workspace}::uuid and f.valid_until is null
          and f.fts @@ websearch_to_tsquery('english', ${query}) ${chFilter('c')}
        order by ts_rank(f.fts, websearch_to_tsquery('english', ${query})) desc limit 10`,
      qvecs?.[0]
        ? this.sql`select f.id, f.content as body, c.slug as channel, f.created_at
            from facts f join channels c on c.id = f.channel_id
            where f.workspace_id = ${workspace}::uuid and f.valid_until is null and f.embedding is not null ${chFilter('c')}
            order by f.embedding <=> ${JSON.stringify(qvecs[0])}::vector limit 10`
        : Promise.resolve([] as Row[]),
    ]);
    const factIds = new Set([...factFts, ...factVec].map((r) => r['id']));
    const scores = new Map<string, { row: Row; score: number }>();
    for (const [leg, rows] of [['fts', fts], ['vec', vec], ['ffts', factFts], ['fvec', factVec]] as const) {
      void leg;
      rows.forEach((row, rank) => {
        const prev = scores.get(row['id']);
        const score = (prev?.score ?? 0) + 1 / (60 + rank);
        scores.set(row['id'], { row, score });
      });
    }
    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(({ row, score }) => ({
        id: row['id'],
        kind: factIds.has(row['id']) ? ('fact' as const) : ('message' as const),
        body: row['body'],
        channel: row['channel'],
        createdAt: new Date(row['created_at']).toISOString(),
        score: Number(score.toFixed(5)),
      }));
  }
}
