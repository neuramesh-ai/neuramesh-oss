// THE MINUTE-TICK — the executor for armed routines (Automations › Routines).
//
// Split out of agents.ts, where it sat inside startAgentHost. One concern, one entry point:
// find the schedules whose next run has arrived, and wake the right agent for each.
//
// The tick itself does NOT arm here. Its interval lives in startAgentHost's boot sequence with
// the other timers, for the same reason the berth sweep's does: when a timer fires is a boot
// fact, and a timer buried in a maker is one nobody can find when it stops firing.
import { authBlockedCard, resolveToken, runtimeFor } from '../agents';
import { isStandDown } from '../replypolicy';
import { isReleasePayload, isRoutineSchedule, nextScheduleRun, type ReleasePayload } from '@neuramesh/shared';
import { makeReleaseWatch, type Preflight } from './releasewatch';
import { postDraftRun } from './draftrun';
import { continueSession } from './runsession';
import { ghLive, githubConnected, readSignalsViaConnector } from './reporead';
import type { ApiGetFn } from './searchx';
import type { PowerSyncDatabase } from '@powersync/node';
import type { HostedAgent } from '../agents';
import type { LogFn } from '../agentlog';

export function makeSchedules(ctx: {
  db: PowerSyncDatabase;
  apiUrl: string;
  ownerActorId: string;
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
  /** the release watch's connector read (host/reporead.ts): GET /v1/repo/changes as the owner */
  apiGet: ApiGetFn;
  agents: Map<string, HostedAgent>;
  /** one auth card per bootstrap schedule — a Set, so it passes by reference and stays shared */
  bootstrapAuthCardPosted: Set<string>;
  arun: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null) => { log: LogFn; runId: string };
  /** the marketing bootstrap flow. A THUNK at the call site: makeMarketing takes runDueSchedules
   *  in turn, so the two makers are a cycle and one of them has to be built first. */
  runMarketingBootstrap: (runner: HostedAgent, s: { id: string; workspace_id: string; channel_id: string }, anchor: { threadId?: string; taskId?: string }, opts?: { only?: string[] }) => Promise<void>;
}) {
  const { db, apiUrl, ownerActorId, post, apiGet, agents, bootstrapAuthCardPosted, arun, runMarketingBootstrap } = ctx;
  // the release routine (docs/design/release-drafts-2026-09): a schedule whose payload carries
  // `release` watches a repository with this machine's gh, and each window with news is one run
  const owner = { kind: 'human', id: ownerActorId };
  // one session per routine (docs/design/routine-sessions-2026-09, PR 2): each run continues the
  // schedule's newest session, in that session's room (host/runsession.ts)
  const session = (s: { id: string; channel_id: string }, sameRoom = false) => continueSession({ db, post, ownerActorId }, s, { sameRoom });
  const releaseWatch = makeReleaseWatch({
    db, ownerActorId, post, session,
    connected: (channelId) => githubConnected(db, channelId),
    readViaConnector: (channelId, since) => readSignalsViaConnector(apiGet, owner, channelId, since),
    capable: ghLive,   // a gh login made after boot counts (the readers' own check)
  });

  // ── schedules (marketing-channel plan §4.6): the minute-tick ─────────────────────────
  // Claim each due row via the run_count CAS (the server refuses the loser), then run the
  // drafting turn and post the result into the room AS A DRAFT. Claim-first even when no
  // agent is hosted here — the advance is what stops a dead schedule refiring every minute.
  // Echo mode stays inert (watchdog doctrine: detection is code, action is judgment).
  async function runDueSchedules(): Promise<void> {
    if (process.env['NM_AGENT_MODE'] === 'echo') return;
    // draft-ahead (round 12): the tick claims a slot up to 30 minutes EARLY, so the
    // draft is on the calendar (chip at the slot) with review room before it's due —
    // approve keeps the slot, and the publish cron fires at the slot itself.
    const due = await db.getAll<{ id: string; workspace_id: string; channel_id: string; title: string; cadence: string; at_time: string; tz: string; weekday: number | null; run_count: number; agent_id: string | null; payload: string | null; next_run_at: string; last_error: string | null }>(
      `select id, workspace_id, channel_id, title, cadence, at_time, tz, weekday, run_count, agent_id, payload, next_run_at, last_error from schedules where status = 'active' and next_run_at is not null and next_run_at <= ? order by next_run_at limit 5`,
      [new Date(Date.now() + 30 * 60_000).toISOString()],
    ).catch(() => []);
    for (const s of due) {
      // THE FIRE'S OUTCOME reaches the row (failure-alerts round): schedules.last_error is what
      // the attention bar renders, and it had NO writer — a failed routine was console.error and
      // nothing else. Write-on-change only: the tick refires every minute, and a persistent
      // pre-claim stall would otherwise post the same command sixty times an hour.
      const writeResult = async (error: string | null): Promise<void> => {
        if ((error ?? null) === (s.last_error ?? null)) return;
        const lane = s.agent_id && agents.get(s.agent_id)
          ? { kind: 'agent', id: s.agent_id, role: agents.get(s.agent_id)!.role }
          : { kind: 'human', id: ownerActorId };
        await post('/v1/commands', lane, { type: 'schedule.mark_result', schedule: s.id, error: error ? error.slice(0, 480) : null }).catch(() => {});
        s.last_error = error;
      };
      // a pre-claim bail is a RETRY, not a failure, until the slot itself is well past: the tick
      // claims up to 30 minutes early, and a daemon still seating its agents should not flash an
      // alert it will clear two ticks later. 10 minutes past the slot = genuinely stuck.
      const overdue = Date.now() - new Date(s.next_run_at).getTime() > 10 * 60_000;
      // advance from AFTER the claimed slot (not from now): an early draft-ahead claim
      // computing from `now` would land on the same slot and re-draft every tick
      const next = s.cadence === 'once'
        ? null
        : nextScheduleRun({ cadence: s.cadence as 'daily' | 'weekdays' | 'weekly', atTime: s.at_time, tz: s.tz, weekday: s.weekday, after: new Date(Math.max(Date.now(), new Date(s.next_run_at).getTime() + 60_000)) })?.toISOString() ?? null;
      const payload = ((): { prompt?: string; bootstrap?: boolean; threadId?: string; taskId?: string; routine?: boolean; release?: ReleasePayload } => {
        try { return JSON.parse(s.payload ?? '{}') as { prompt?: string; bootstrap?: boolean; threadId?: string; taskId?: string; release?: ReleasePayload }; } catch { return {}; }
      })();
      // round 3: a bootstrap anchors to the setup TASK's thread (one owning session); the
      // threadId shape survives for pre-flows rooms that never had a setup task
      const isBootstrap = payload.bootstrap === true && (typeof payload.taskId === 'string' || typeof payload.threadId === 'string');
      // the schedule's own agent if hosted here, else the room's hosted marketer; the
      // bootstrap conversation may also fall back to the orchestrator (mirrors the setup
      // card's fronting rule — the room greets even before a marketer is seated)
      const runner = (s.agent_id && agents.get(s.agent_id))
        || [...agents.values()].find((a) => a.role === 'marketer' && a.channels.has(s.channel_id))
        || (isBootstrap ? [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(s.channel_id)) ?? null : null)
        || null;
      // a one-shot bootstrap must NOT claim until it can actually run — a claim settles it
      // 'done' and the conversation would never happen. No runner, or a creds probe that
      // fails (provider outage windows fail the subscription probe): leave the row due and
      // let the next tick retry. Both dead-ends were hit live before this guard.
      if (isBootstrap && !runner) { console.warn(`mk_bootstrap id=${s.id} waiting: no hosted marketer/orchestrator for the room`); continue; }
      if (isBootstrap && runner) {
        const cred = await resolveToken(apiUrl, s.workspace_id, runner, ownerActorId).catch(() => null);
        if (!cred || cred.blocked || cred.authMode === 'none') {
          console.warn(`mk_bootstrap id=${s.id} waiting: no usable creds for ${runner.name}`);
          // surface the fix IN the conversation: the nmauth card (reconnect button runs the
          // CLI login in a PTY + opens the OAuth page; copyable command beside it). Once per
          // session — the row stays unclaimed, so the run self-starts the tick after login.
          if (cred?.blocked && (payload.taskId || payload.threadId) && !bootstrapAuthCardPosted.has(s.id)) {
            bootstrapAuthCardPosted.add(s.id);
            await post('/v1/messages', { kind: 'agent', id: runner.id, role: runner.role }, {
              workspace: s.workspace_id, channel: s.channel_id,
              ...(payload.taskId ? { taskId: payload.taskId } : { threadId: payload.threadId }),
              body: authBlockedCard(runner, cred.blocked),
            }).catch(() => {});
          }
          continue;
        }
      }
      // WHICH PATH this slot takes has to be known BEFORE the claim, because the claim CONSUMES the
      // slot — it advances run_count AND rolls next_run_at to the following occurrence. Deciding
      // afterwards is what silently ate scheduled marketing posts: the row was already settled, then
      // the run bailed on `no hosted agent` / `no usable creds` with nothing but a console.warn, so
      // the calendar cell simply stayed empty until the next week. The bootstrap guard above had this
      // right all along ("must NOT claim until it can actually run"); the drafting path did not.
      //
      // Which of the two things sharing this table is firing? A ROUTINE says so on the row
      // (payload.routine, set by the launcher). Channel kind is the fallback for rows armed before
      // that marker existed — and it was the whole test until 2026-08-01, which is why a routine
      // armed in a marketing room took the drafting path and landed as a scheduled-draft card in the
      // room brief instead of opening its own conversation. A marketing CONTENT schedule (rex's card)
      // carries no marker, so it still drafts. The test is @neuramesh/shared isRoutineSchedule, the one the
      // hands-off readers share (2026-09-27): a draft's session keeps its person.
      const [chk] = isBootstrap ? [] : await db.getAll<{ kind: string | null }>(`select kind from channels where id = ? limit 1`, [s.channel_id]).catch(() => [] as Array<{ kind: string | null }>);
      const isRoutine = !isBootstrap && isRoutineSchedule(payload, chk?.kind);
      // a release routine decides BEFORE the claim whether this machine can read the repository:
      // no repository, no remote or no gh login leaves the row due for another machine, and says so
      // on the bar once the slot is well past
      const isRelease = !isBootstrap && isReleasePayload(payload as Record<string, unknown>);
      let releasePre: Preflight | null = null;
      if (isRelease) {
        releasePre = await releaseWatch.preflight(s, payload.release!);
        if (!releasePre.ok) {
          console.warn(`schedule_run id=${s.id} waiting: ${releasePre.reason} — slot left due`);
          if (overdue) await writeResult(releasePre.reason);
          continue;
        }
      }
      // Only DRAFTING needs a seat and a key: a routine just posts a message as the owner, so
      // demanding a hosted marketer for it would strand routines in rooms that have none. Checking
      // here means a host that cannot draft leaves the row due — the next tick, or another machine,
      // picks it up, and a blocked credential self-heals after login instead of eating the slot.
      if (!isBootstrap && !isRoutine && !isRelease) {
        if (!runner) {
          console.warn(`schedule_run id=${s.id} waiting: no hosted agent for the room — slot left due`);
          if (overdue) await writeResult('no hosted agent for this room — the run cannot start until one is online');
          continue;
        }
        const pre = await resolveToken(apiUrl, s.workspace_id, runner, ownerActorId).catch(() => null);
        if (!pre || pre.blocked || pre.authMode === 'none') {
          console.warn(`schedule_run id=${s.id} waiting: no usable creds for ${runner.name} — slot left due`);
          if (overdue) await writeResult(`no usable credentials for ${runner.name}${pre?.blocked ? ` — ${pre.blocked}` : ' — reconnect its provider login'}`);
          continue;
        }
      }
      const actor = { kind: 'agent', id: runner?.id ?? 'schedule', role: runner?.role ?? 'marketer' };
      const claimRes = await post('/v1/commands', runner ? actor : { kind: 'human', id: ownerActorId }, { type: 'schedule.claim_run', schedule: s.id, runCount: s.run_count, nextRunAt: next }).catch(() => null);
      const claim = claimRes?.ok ? ((await claimRes.json().catch(() => null)) as { claimed?: boolean } | null) : null;
      if (!claim?.claimed) continue; // another machine won, or the row moved — never double-fire
      // general-channel routines (the universal launcher): outside marketing HQs the
      // slot fires the PROMPT into the room as the owner's scheduled message — the
      // orchestrator triages it exactly like a composer send. Marketing keeps the
      // drafting turn below (content items, calendar chips, publish gate).
      {
        if (isRelease && releasePre?.ok) {
          const out = await releaseWatch.fire(s, payload.release!, releasePre);
          console.log(`schedule_run id=${s.id} release watch ${out.outcome}${out.error ? `: ${out.error}` : ''}`);
          await writeResult(out.error);
          continue;
        }
        if (isRoutine) {
          const routinePrompt = payload.prompt ?? s.title;
          // one session per routine (2026-09-28, George: runs flooded the rail): the fire continues the
          // schedule's newest session, or opens the first one, and the orchestrator's wake — and
          // everything downstream — lands in that thread. `scheduleId` marks this message as the run's
          // opener (0145), which is how every client splits the session into runs, and it stamps a
          // newborn thread with the automation that opened it (0119). The server names the session
          // after the schedule (store/session-title.ts), and the first line stays PLAIN text (2026-09-12).
          try {
            const at = await session(s);
            const r = await post('/v1/messages', { kind: 'human', id: ownerActorId }, { workspace: s.workspace_id, channel: at.channelId, threadId: at.threadId, scheduleId: s.id, body: `Routine · ${s.title}\n\n${routinePrompt}` });
            if (!r.ok) throw new Error(`the server refused the routine's message (${r.status})`);
            console.log(`schedule_run id=${s.id} routine fired into the room`);
            await writeResult(null);
          } catch (e) {
            console.warn(`schedule_run id=${s.id} routine post failed`, e);
            await writeResult(`the routine failed to post its prompt — ${e instanceof Error ? e.message : String(e)}`);
          }
          continue;
        }
      }
      if (!runner) { console.warn(`schedule_run id=${s.id} skipped: no hosted agent for the room`); continue; }
      if (isBootstrap) { await runMarketingBootstrap(runner, s, payload.taskId ? { taskId: payload.taskId } : { threadId: payload.threadId! }); continue; }
      try {
        // subscription auth carries no bearer token (the runtime CLI holds its own OAuth) —
        // tolerate a null token exactly like the orchestrator sweep does
        const cred = await resolveToken(apiUrl, s.workspace_id, runner, ownerActorId);
        if (cred.blocked || cred.authMode === 'none') {
          console.warn(`schedule_run id=${s.id} skipped: no usable creds`);
          // the pre-claim guard normally catches this; racing it here means the slot was
          // CONSUMED with nothing produced — that is a failed run, not a retry
          await writeResult(`the run was claimed but ${runner.name} had no usable credentials — reconnect its provider login`);
          continue;
        }
        const [ch] = await db.getAll<{ slug: string }>(`select slug from channels where id = ? limit 1`, [s.channel_id]).catch(() => [] as Array<{ slug: string }>);
        const prompt = payload.prompt ?? s.title;
        const { log } = arun(runner, null, ch?.slug ?? 'marketing');
        const system = `You are ${runner.name}, the ${runner.role} for #${ch?.slug ?? 'marketing'} in a NeuraMesh workspace.${runner.brief ? ` Your specialty: ${runner.brief}.` : ''} This is a SCHEDULED DRAFTING RUN ("${s.title}") — not a human message. Produce the draft the schedule asks for, platform-native and in the room's brand voice. Output ONLY the draft content as tight markdown (no preamble, no meta-commentary). You never publish anything — drafts wait for a human.`;
        const reply = (await runtimeFor(runner.runtime).complete(system, prompt, cred.token ?? '', runner.model)).trim();
        // a stand-down is the agent's judgment, not a failure — the run happened and chose no-op
        if (!reply || isStandDown(reply)) { log({ kind: 'wake', phase: 'stood_down', summary: `scheduled run "${s.title}" — nothing produced` }); await writeResult(null); continue; }
        // the slot this draft is FOR (normalized ISO — replica timestamps vary), spoken
        // in the schedule's own timezone
        const slotIso = new Date(s.next_run_at).toISOString();
        const slotLabel = ((): string => {
          try { return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: s.tz }).format(new Date(slotIso)); } catch { return s.at_time; }
        })();
        // the run continues the schedule's session in its room, or opens the first one (2026-09-27): the
        // message opens the run, then the draft names the thread, so the card renders there. the draft is
        // also the calendar's atom: its chip sits on the slot and waits for a human approve, which keeps the
        // slot. host/draftrun.ts. the session stays in the schedule's room: the run posts as its agent
        const { threadId } = await session(s, true);
        await postDraftRun(post, runner, { schedule: s, threadId, reply, slotAt: slotIso, slotLabel });
        log({ kind: 'wake', phase: 'replied', summary: `scheduled draft posted — ${s.title}` });
        console.log(`schedule_run id=${s.id} agent=${runner.name} posted=ok`);
        await writeResult(null);
      } catch (err) {
        console.error(`schedule_run id=${s.id} failed:`, err);
        await writeResult(`the drafting run failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return { runDueSchedules };
}
