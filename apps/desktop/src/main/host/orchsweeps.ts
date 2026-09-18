// THE ORCHESTRATOR'S SWEEPS — the periodic tick that notices what nobody reported (docs/19).
//
// Split out of startAgentHost. Three functions, one job: gather what LOOKS stuck in a channel
// (stall.ts, pure and deterministic), decide whether that is worth an orchestrator turn, and
// run the two cadences — the cheap 5-minute watchdog and the 15-minute full pass that also
// carries the digests.
//
// Detection is code and action is judgment, which is exactly why they are one module and not
// two: the whole point of the design is that the deterministic half never speaks and the
// judgment half never scans.
//
// As with the berth sweep, THE INTERVALS STAY IN startAgentHost. This module says what a sweep
// does; the boot sequence says when.
import { classifyRoutineStalls, classifyStalls, routineStallKey, stallKey, type RoutineStall, type Stall, type StallCandidate } from '../stall';
import { gateMonitor } from '../sweepgate';
import { executing, resolveToken } from '../agents';
import { isStandDown } from '../replypolicy';
import { composePrompt } from '@neuramesh/shared';
import { contractFor } from '../contracts';
import type { MonitorSignals } from '../sweepgate';
import type { OrchTransportArgs } from './orchturn';
import type { PowerSyncDatabase } from '@powersync/node';
import type { HostedAgent, SkillRef } from '../agents';
import type { LogFn } from '../agentlog';
import type { HostGuards } from './guards';
import type { makeOrchTools } from './orchtools';
import type { makeRoutineResume } from './routineresume';

export function makeOrchSweeps(ctx: {
  db: PowerSyncDatabase;
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
  agents: Map<string, HostedAgent>;
  claimed: { has: (id: string) => boolean };
  /** the shared registries (Sets/Maps) — passed WHOLE, by reference, exactly as HostCtx does */
  guards: HostGuards;
  apiUrl: string;
  ownerActorId: string;
  /** boot time; the sweep's own cursor starts here and never leaves this module */
  startedAt: string;
  buildOrchestratorTools: ReturnType<typeof makeOrchTools>['buildOrchestratorTools'];
  SUMMARY_MARKER: Record<string, string>;
  sweepPeriod: (d: Date) => 'morning' | 'midday' | 'evening' | null;
  summaryPostedToday: (chId: string, period: string, day: string) => Promise<boolean>;
  channelMonitorSignals: (chId: string, since: string, nowMs: number) => Promise<MonitorSignals>;
  sweepTranscript: (ch: { id: string; slug: string }) => Promise<string>;
  dispatchOrchestrator: (agent: HostedAgent, args: OrchTransportArgs) => Promise<string>;
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
  arun: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null) => { log: LogFn; runId: string };
  /** the routine resume (host/routineresume.ts) — deterministic, rides both cadences */
  resumeStrandedRoutines: ReturnType<typeof makeRoutineResume>['resumeStrandedRoutines'];
}) {
  const { db, post, agents, claimed, guards, apiUrl, ownerActorId, startedAt, buildOrchestratorTools,
          SUMMARY_MARKER, sweepPeriod,
          summaryPostedToday, channelMonitorSignals, sweepTranscript,
          dispatchOrchestrator, discoverSkills, arun, resumeStrandedRoutines } = ctx;
  const { firedStalls, sweptSummaries, monitorSince, designed, planned, reviewed } = guards;

  // The sweep's own cursor: only these three functions ever read or write it, so it lives here
  // rather than as one more `let` in a 1,500-line boot function.
  let lastSweepAt = startedAt;

  const gatherChannelStalls = async (ch: { id: string }): Promise<Array<{ stall: Stall; tail: string }>> => {
    const rows = await db.getAll<{
      id: string; number: number; title: string; state: string; created_at: string | null; updated_at: string | null; plan_approved_at: string | null;
      assignee: string | null; offered: string | null; last_msg_at: string | null; last_human_msg_at: string | null;
      last_beat_at: string | null; last_run_at: string | null; open_runs: number; host_seen_at: string | null; open_decisions: number;
    }>(
      `select t.id, t.number, t.title, t.state, t.created_at, t.updated_at, t.plan_approved_at,
         (select name from agents a where a.id = t.assignee_id) as assignee,
         (select name from agents a where a.id = t.offered_agent_id) as offered,
         (select max(m.created_at) from messages m where m.task_id = t.id) as last_msg_at,
         (select max(m.created_at) from messages m where m.task_id = t.id and m.author_kind = 'human') as last_human_msg_at,
         (select max(b.updated_at) from beats b where b.task_id = t.id) as last_beat_at,
         (select max(r.updated_at) from runs r where r.task_id = t.id) as last_run_at,
         (select count(*) from runs r where r.task_id = t.id and r.state = 'running') as open_runs,
         (select mc.last_seen_at from machines mc join agents a2 on a2.machine_id = mc.id where a2.id = coalesce(t.assignee_id, t.offered_agent_id)) as host_seen_at,
         (select count(*) from decisions d where d.task_id = t.id and d.status = 'open') as open_decisions
       from tasks t
       where t.channel_id = ? and t.state in ('todo','designing','design_review','planning','plan_review','in_progress','in_review','blocked','done','shipping','ship_review','releasing','verifying')
         -- setup tasks (setupflows.ts) are the HUMAN's checklist: unassigned todo by design,
         -- so the 'unrouted' class would flag every one forever and the orchestrator would
         -- nag about work no agent can take. The needs-you queue is their watchdog.
         and (t.kind is null or t.kind != 'setup')`,
      [ch.id],
    );
    const nowMs = Date.now();
    const ms = (v: string | null): number | null => { const p = v ? Date.parse(v) : NaN; return Number.isFinite(p) ? p : null; };
    const candidates: StallCandidate[] = rows.map((r) => ({
      id: r.id, number: r.number, title: r.title, state: r.state,
      assignee: r.assignee, offered: r.offered,
      createdAtMs: ms(r.created_at) ?? nowMs,
      updatedAtMs: ms(r.updated_at) ?? ms(r.created_at) ?? nowMs,
      planApprovedAtMs: ms(r.plan_approved_at),
      lastMsgAtMs: ms(r.last_msg_at), lastHumanMsgAtMs: ms(r.last_human_msg_at), lastBeatAtMs: ms(r.last_beat_at),
      lastRunAtMs: ms(r.last_run_at), runOpen: (r.open_runs ?? 0) > 0,
      hostSeenAtMs: ms(r.host_seen_at),
      hasOpenDecision: (r.open_decisions ?? 0) > 0,
      // a flow this host is running (or has claimed the guard for) is alive by definition
      liveLocal: executing.has(r.id) || claimed.has(r.id) || designed.has(r.id) || planned.has(r.id) || reviewed.has(r.id),
    }));
    const stalls = classifyStalls(candidates, nowMs).filter((s) => !firedStalls.has(stallKey(s, nowMs)));
    if (!stalls.length) return [];
    // remember firings up front: a failed turn waits for the next signal/bucket instead of nagging
    for (const s of stalls) firedStalls.add(stallKey(s, nowMs));
    if (firedStalls.size > 800) firedStalls.clear(); // bounded; a rare full re-arm just re-triages
    const out: Array<{ stall: Stall; tail: string }> = [];
    for (const s of stalls) {
      const tail = await db.getAll<{ author_kind: string; body: string | null; name: string | null }>(
        `select m.author_kind, m.body, (select name from agents a where a.id = m.author_id) as name
         from messages m where m.task_id = ? order by m.created_at desc limit 4`,
        [s.taskId],
      ).catch(() => [] as Array<{ author_kind: string; body: string | null; name: string | null }>);
      out.push({
        stall: s,
        tail: tail.reverse().map((m) => `    · ${m.author_kind === 'human' ? 'human' : `@${m.name ?? 'agent'}`}: ${(m.body ?? '').replace(/\s+/g, ' ').slice(0, 180)}`).join('\n'),
      });
    }
    return out;
  };
  // Routines are not tasks, so they ride the SAME watchdog turn as their own section rather
  // than wearing a StallCandidate: schedules.last_error is the code-detected signal (the fire
  // path writes it), the shared firedStalls set is the no-nag memory, and the classifier's
  // settle window keeps rex out of the human's way while the attention bar is doing its job.
  const gatherRoutineStalls = async (ch: { id: string }): Promise<RoutineStall[]> => {
    const rows = await db.getAll<{ id: string; title: string; status: string; last_error: string | null; last_run_at: string | null }>(
      `select id, title, status, last_error, last_run_at from schedules where channel_id = ? and status = 'active' and last_error is not null`,
      [ch.id],
    ).catch(() => [] as Array<{ id: string; title: string; status: string; last_error: string | null; last_run_at: string | null }>);
    const ms = (v: string | null): number | null => { const p = v ? Date.parse(v) : NaN; return Number.isFinite(p) ? p : null; };
    const stalls = classifyRoutineStalls(
      rows.map((r) => ({ id: r.id, title: r.title, status: r.status, lastError: r.last_error, lastRunAtMs: ms(r.last_run_at) })),
      Date.now(),
    ).filter((s) => !firedStalls.has(routineStallKey(s)));
    for (const s of stalls) firedStalls.add(routineStallKey(s));
    return stalls;
  };
  async function orchestratorSweep(orch: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, kind: 'monitor' | { period: 'morning' | 'midday' | 'evening' } | { stalls: Array<{ stall: Stall; tail: string }>; routines?: RoutineStall[] }): Promise<boolean> {
    const actor = { kind: 'agent', id: orch.id, role: 'orchestrator' };
    const label = typeof kind === 'object' ? ('period' in kind ? kind.period : 'stall') : 'monitor';
    // The docs/20 digest hush is GONE with the lens it served (docs/35 §4.1). It skipped the
    // scheduled summary in a thread_mode='off' room because the feed there already carried the
    // thread traffic inline; under the sessions shell the digest is not an echo of anything — it
    // is the room brief. Any channel row still holding 'off' from the docs/20 era would have
    // silently suppressed that room's brief forever, which is a data value quietly disabling a
    // surface. The READ is deleted, not the column: nothing consults it now, so a stale value is
    // inert (docs/35 §12/§13).
    try {
      const cred = await resolveToken(apiUrl, ch.workspace_id, orch, ownerActorId);
      if ((cred.blocked || cred.authMode === 'none') && process.env['NM_AGENT_MODE'] !== 'echo') return false; // no usable creds → skip quietly
      const token = cred.token ?? '';
      const { log } = arun(orch, null, ch.slug);
      const skills = await discoverSkills(ch.id, ch.workspace_id);
      const otools = await buildOrchestratorTools({
        ch, agent: orch, actor, skills, log, token, kind: 'sweep',
        // each sweep gets the toolset its prompt instructs — see SWEEP_TOOLSETS (orchtools.ts)
        sweepScope: typeof kind === 'object' ? ('period' in kind ? 'digest' : 'watchdog') : 'monitor',
      });
      let transcript = await sweepTranscript(ch);
      if (typeof kind === 'object' && 'stalls' in kind) {
        if (kind.stalls.length) {
          transcript += `\n\nWATCHDOG — stalled work on #${ch.slug} (deterministic scan; ages are absolute):\n` + kind.stalls
            .map(({ stall, tail }) => `- #${stall.number} ${stall.title} [${stall.state}${stall.assignee ? ` · @${stall.assignee}` : ''}] — ${stall.detail}${tail ? `\n  thread tail (oldest → newest):\n${tail}` : '\n  (no thread messages yet)'}`)
            .join('\n');
        }
        if (kind.routines?.length) {
          transcript += `\n\nWATCHDOG — failing routines on #${ch.slug} (deterministic scan; each reason is the routine's own last error, already on the human's attention bar):\n` + kind.routines
            .map((r) => `- Routine “${r.title}” — ${r.detail}`)
            .join('\n');
        }
      }
      // the sweep prompts are contract blocks (2026-08-18) — the monitor literal cited the
      // retired feed for a week because nothing reviewed it; now defaults/agents/orchestrator.yaml
      // carries all three, and the prompt meter + ratchet measure them.
      const scontract = contractFor(orch.name, 'orchestrator')?.prompt ?? {};
      const sweepNote = scontract['sweep.note'] ?? '';
      const svars = { 'agent.name': orch.name, 'ch.slug': ch.slug, sweepNote };
      const systemPrompt = typeof kind === 'object' && 'period' in kind
        ? composePrompt(scontract['sweep.digest'] ?? '', { ...svars, period: kind.period, heading: SUMMARY_MARKER[kind.period] })
        : typeof kind === 'object'
          ? composePrompt(scontract['sweep.watchdog'] ?? '', svars)
          : composePrompt(scontract['sweep.monitor'] ?? '', svars);
      const reply = (await dispatchOrchestrator(orch, { model: orch.model, token, systemPrompt, transcript, tools: otools, log })).trim();
      // isStandDown, not exact equality: models wrap the sentinel in narrative
      // ("Board is empty; ... NO_REPLY") and posting that chatter re-armed the
      // next monitor tick off its own message — the every-15-min loop.
      if (!reply || isStandDown(reply)) { log({ kind: 'wake', phase: 'stood_down', summary: `sweep (${label}) — nothing to post` }); return false; }
      // enforced anti-repeat (not prompted): a body this channel already carries
      // today never posts twice, whatever the model decided
      const dupSince = `${new Date().toISOString().slice(0, 10)}T00:00:00`;
      const dup = await db.getAll<{ id: string }>(`select id from messages where channel_id = ? and author_kind = 'agent' and body = ? and created_at >= ? limit 1`, [ch.id, reply, dupSince]);
      if (dup.length) { log({ kind: 'wake', phase: 'stood_down', summary: `sweep (${label}) — duplicate of a note already posted today` }); return false; }
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, body: reply });
      log({ kind: 'wake', phase: 'replied', summary: `${typeof kind === 'object' && 'period' in kind ? `${label} summary` : label === 'stall' ? 'stall triage note' : 'monitor note'} posted in #${ch.slug}` });
      console.log(`orch_sweep agent=${orch.name} channel=${ch.slug} kind=${label} posted=ok`);
      return true;
    } catch (err) {
      console.error(`orch_sweep agent=${orch.name} channel=${ch.slug} kind=${label} failed:`, err);
      return false;
    }
  }
  /**
   * The orchestrator's two cadences.
   *
   * `watchdog` (every 5 min) is the cheap one: a deterministic scan of every open task's
   * activity feed (stall.ts over messages/beats/runs). It costs ONE SQL query per channel
   * and spends an orchestrator turn only when something is actually flagged — which is what
   * replaced agents narrating "still working" into their own threads. Execution has no time
   * cap any more, so this is how a wedged run gets noticed.
   *
   * `full` (every 15 min) adds the scheduled digests and the periodic self-check monitor —
   * judgment turns that cost tokens whether or not anything is wrong, so they stay rationed.
   */
  async function runOrchestratorSweeps(mode: 'full' | 'watchdog' = 'full'): Promise<void> {
    if (process.env['NM_AGENT_MODE'] === 'echo') return; // live-only
    const now = new Date();
    const period = mode === 'full' ? sweepPeriod(now) : null;
    const day = now.toISOString().slice(0, 10);
    const since = lastSweepAt;
    if (mode === 'full') lastSweepAt = now.toISOString();
    for (const orch of [...agents.values()].filter((a) => a.role === 'orchestrator')) {
      // Pull the orchestrator's channels from the DB — the in-memory `channels` Set lags the agent
      // load just after boot, which would silently skip the sweep (the message watch only works once
      // it's populated). agent_channels is synced, so this is reliable from the first tick.
      const chans = await db.getAll<{ id: string; slug: string; workspace_id: string }>(
        `select c.id, c.slug, c.workspace_id from channels c join agent_channels ac on ac.channel_id = c.id where ac.agent_id = ?`,
        [orch.id],
      );
      for (const ch of chans) {
        if (period) {
          const key = `${ch.id}:${period}:${day}`;
          // Attempt a summary only for a channel with an open task — an empty board just stands down,
          // wasting an orchestrator turn every tick. And mark the period done only when a summary
          // actually POSTS, so a stood-down attempt (empty at the time) doesn't burn the slot and a
          // later sweep can still summarize once work shows up.
          if (!sweptSummaries.has(key) && !(await summaryPostedToday(ch.id, period, day))) {
            // gate on LIVE work only — a channel holding nothing but parked backlog
            // ideas gets no daily post (the tally rides along when real work reports)
            const [bc] = await db.getAll<{ n: number }>(`select count(*) as n from tasks where channel_id = ? and state not in ('accepted','closed','backlog')`, [ch.id]);
            if ((bc?.n ?? 0) > 0 && (await orchestratorSweep(orch, ch, { period }))) sweptSummaries.add(key);
          }
        }
        // the routine resume (host/routineresume.ts): a routine's ask that died on no-compute is
        // re-asked here, before either judgment turn could triage it flat — detection is code
        await resumeStrandedRoutines(orch, ch).catch((err) => console.error(`routine_resume channel=${ch.slug} failed:`, err));
        // stall triage outranks the generic monitor for the tick: its context supersets the
        // monitor's (board + channel tail + the stall report with thread tails), so nothing
        // the monitor would have seen is lost — and it fires on QUIET channels too, which
        // the needs-monitor gate never does (the overnight-stall blindspot).
        const stalls = await gatherChannelStalls(ch).catch(() => [] as Array<{ stall: Stall; tail: string }>);
        const routines = await gatherRoutineStalls(ch).catch(() => [] as RoutineStall[]);
        if (stalls.length || routines.length) {
          console.log(`orch_stall channel=${ch.slug} mode=${mode} flagged=${[...stalls.map(({ stall }) => `#${stall.number}:${stall.cls}`), ...routines.map((r) => `routine:${r.title}`)].join(',')}`);
          await orchestratorSweep(orch, ch, { stalls, routines });
          // stall-turn context supersets the monitor's (docs/19 §3) — the window is consumed
          monitorSince.set(ch.id, lastSweepAt);
        } else if (mode === 'full') {
          const chSince = monitorSince.get(ch.id) ?? since;
          const gate = gateMonitor(await channelMonitorSignals(ch.id, chSince, Date.now()));
          if (gate.defer) {
            // a live (or just-landed, possibly not-yet-dispatched) wake is triaging this
            // window — defer WITHOUT advancing the watermark so the same window re-arms
            // next tick against the settled board. This is the #1015/#1016 double-triage fix.
            console.log(`orch_monitor defer channel=${ch.slug} reason=${gate.reason}`);
          } else {
            monitorSince.set(ch.id, lastSweepAt);
            if (gate.run) await orchestratorSweep(orch, ch, 'monitor');
          }
        }
      }
    }
  }

  // only the cadence leaves: the other two are how it works, not what it offers
  return { runOrchestratorSweeps };
}
