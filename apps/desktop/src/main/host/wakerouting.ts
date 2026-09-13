// WHO ANSWERS — routing a message to an agent, and the gate that says whether it may run.
//
// Split from wake.ts (state-ownership round, 2026-08-16). The dependency is one-way and that is
// the whole justification: routing calls `wakeThread`, and running never calls back. Choosing a
// responder and running its turn are different jobs with different failure modes — a wake that
// picks the wrong agent looks nothing like a turn that dies mid-run.
//
// sweepDeadLetters lives here rather than with the runner because it is the same question asked
// late: these messages should have been answered and were not, so who answers them now?
import type { HostedAgent, ThreadTask } from '../agents';
import { pickDeadLetters, type SweepCandidate } from '../chatsweep';
import { HIRE_CONFIRM_RE } from '../hirecards';
import { type RunHandle } from './runs';
import { addressedIn, genImageItemId, mentionRe, nobodyCanServe, parseCard, parseModeMarker, unaddressedWake } from '@neuramesh/shared';
import type { PowerSyncDatabase } from '@powersync/node';
import type { ClaimVerdict, MachineCapability, SessionOrigin } from '@neuramesh/shared';
import type { HostGuards } from './guards';
import type { HostQueue } from '../harness/hostqueue';
import type { makeRuns } from './runs';
import type { makeChatTurn } from './chatturn';
import type { makeStaffing } from './staffing';
import type { makeMarketing } from './marketing';
import type { makeSchedules } from './schedules';
import type { makeWake } from './wake';
import { makeSleeperWake } from './sleepers';

export function makeWakeRouting(ctx: {
  db: PowerSyncDatabase;
  LEASE_LOST: ReturnType<typeof makeRuns>['LEASE_LOST'];
  SWEEP_LOOKBACK_MS: number;
  agents: Map<string, HostedAgent>;
  claimVerdict: (runtime: string, model: string | null, originUserId: string | null, elapsedMs: number, extra?: { agentId?: string; priorMachineId?: string | null; threadMachineId?: string | null; origin?: SessionOrigin | null; modelFree?: boolean }) => Promise<ClaimVerdict>;
  confirmAddAgent: ReturnType<typeof makeStaffing>['confirmAddAgent'];
  confirmCreateAgent: ReturnType<typeof makeStaffing>['confirmCreateAgent'];
  confirmFailover: ReturnType<typeof makeStaffing>['confirmFailover'];
  defaultResponder: ReturnType<typeof makeChatTurn>['defaultResponder'];
  execQueue: HostQueue;
  offerAddAgents: ReturnType<typeof makeStaffing>['offerAddAgents'];
  ownerActorId: string;
  peerMachines: () => Promise<MachineCapability[]>;
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
  priorMachineFor: (threadId?: string | null, taskId?: string | null) => Promise<string | null>;
  processed: HostGuards["processed"];
  queueWake: (agent: HostedAgent, m: { id: string; channel_id: string; thread_id?: string | null; body: string }) => void;
  runDueSchedules: ReturnType<typeof makeSchedules>['runDueSchedules'];
  runMarketingBootstrap: ReturnType<typeof makeMarketing>['runMarketingBootstrap'];
  /** the runner half — the one edge between the two, and it points this way only */
  wakeThread: ReturnType<typeof makeWake>['wakeThread'];
  saidNoCompute: HostGuards["saidNoCompute"];
}) {
  const { db, LEASE_LOST, SWEEP_LOOKBACK_MS, agents, claimVerdict, confirmAddAgent, confirmCreateAgent, confirmFailover, defaultResponder, execQueue, offerAddAgents, ownerActorId, peerMachines, post, priorMachineFor, processed, queueWake, runDueSchedules, runMarketingBootstrap, saidNoCompute, wakeThread } = ctx;
  const { requestSleeperWake } = makeSleeperWake({ peerMachines, post });

  /**
   * The routing ladder in front of the WAKE (0118). Until now only task claims consulted the
   * policy — a chat wake went straight to the lease insert, so routing was "first watcher wins"
   * and a warm long-running daemon beat a freshly joined member's machine every time (George,
   * 2026-08-12). Same claimVerdict as claimFlow, same inputs, plus the wake's own two: the
   * trigger's author is the origin, and the thread's prior machine is the continuity rung.
   *
   * `wait` is served INLINE (bounded by the grace window — elapsed grows monotonically, so the
   * loop always terminates in a claim). If the better-placed machine answers during the sleep,
   * our own lease insert below loses and we stand down having spent nothing.
   */
  /** one no-compute notice per trigger, so a sweep re-processing the same message cannot nag */
  async function wakeGate(agent: HostedAgent, where: { workspace: string; channelId: string; threadId?: string | null; taskId?: string | null }, triggerMessageId: string): Promise<RunHandle | null> {
    const msg = await db.get<{ author_kind: string; author_id: string | null; created_at: string; body: string }>(
      'select author_kind, author_id, created_at, body from messages where id = ? and workspace_id = ?', [triggerMessageId, where.workspace],
    ).catch(() => null);
    // THE DRAW BUTTON IS NOT A CONVERSATION. `‹gen-image:…›` runs no model turn (wake.ts draws
    // the draft from the brief already on it), so the runtime rung must not gate it — a cloud
    // machine with no CLI can draw perfectly well, and before this it skipped every one.
    const modelFree = genImageItemId(msg?.body ?? '') !== null;
    const originUserId = msg?.author_kind === 'human' ? msg.author_id : null;
    const priorMachineId = await priorMachineFor(where.threadId, where.taskId);
    // the session's own designation and origin (0134, rule D9): the composer's chip or the desktop
    // default, and which client bore the thread — read from the replica the way continuity is
    const bornThread = where.threadId
      ? await db.get<{ machine_id: string | null; origin: string | null }>('select machine_id, origin from threads where id = ? and workspace_id = ?', [where.threadId, where.workspace]).catch(() => null)
      : null;
    const origin = bornThread?.origin === 'desktop' || bornThread?.origin === 'web' || bornThread?.origin === 'routine' ? bornThread.origin : null;
    // elapsed counts from the message's birth, not from first sight: a host that syncs late has
    // already consumed its share of the window, so a stalled designated machine is a bounded
    // delay for everyone rather than a fresh 8s per late arrival
    const born = msg ? Date.parse(msg.created_at) : Date.now();
    for (;;) {
      const verdict = await claimVerdict(agent.runtime, agent.model ?? null, originUserId, Math.max(0, Date.now() - born), { agentId: agent.id, modelFree, priorMachineId , threadMachineId: bornThread?.machine_id ?? null, origin });
      if (verdict.act === 'claim') return null;
      if (verdict.act === 'skip') {
        // echo dev daemons answer regardless of capability — the gate must not change what the
        // harness exercised before it existed. A missing GRANT is different: it is the whole
        // point of 0119, so echo honours it too or the consent story is untestable locally.
        if (process.env['NM_AGENT_MODE'] === 'echo' && verdict.why !== 'not-granted') return null;
        console.log(`wake_skip agent=${agent.name} trigger=${triggerMessageId.slice(0, 8)} — ${verdict.why === 'not-granted' ? 'this member has not been lent this machine' : `this machine cannot serve ${agent.runtime}`}`);
        // THE SLEEPER RUNG (member-machines plan §4.3): nobody awake can serve, but a cloud machine
        // that published this runtime — the origin's own, one lent to them, or one lent to the whole
        // workspace — is asleep. Ask the fleet to wake it and stand down: the sleeper's daemon boots
        // and its dead-letter sweep answers this message. The host that ASKED says so, once, from
        // the runner (always awake) or the origin's own machine — never two hosts for one message.
        if (verdict.why === 'incapable') {
          const sleeper = await requestSleeperWake({ runtime: agent.runtime, model: agent.model ?? null, originUserId, workspace: where.workspace, actor: { kind: 'agent', id: agent.id, role: agent.role } });
          if (sleeper) {
            if (sleeper.asked && !saidNoCompute.has(triggerMessageId) && (process.env['NM_MACHINE_KIND'] === 'runner' || ownerActorId === originUserId)) {
              saidNoCompute.add(triggerMessageId);
              const ch = await db.get<{ id: string; workspace_id: string }>('select id, workspace_id from channels where id = ?', [where.channelId]).catch(() => null);
              const whose = sleeper.ownerUserId === originUserId ? 'your cloud machine' : "a teammate's cloud machine";
              if (ch) {
                await post('/v1/messages', { kind: 'agent', id: agent.id }, {
                  workspace: ch.workspace_id, channel: ch.id, replyTo: triggerMessageId,
                  ...(where.threadId ? { threadId: where.threadId } : {}), ...(where.taskId ? { taskId: where.taskId } : {}),
                  body: `Waking ${whose} — it holds the ${agent.runtime} login this needs. Your message is answered once it is up, usually within a couple of minutes.`,
                }).catch((e) => console.error('sleeper notice failed:', e));
              }
            }
            return LEASE_LOST;
          }
        }
        // A REQUEST MUST NEVER VANISH (George, live 2026-08-14). Each host decides only about
        // itself, so when they all skip the human gets silence: no ghost, no reply, no reason.
        // The ORIGIN's own machine is the one host guaranteed awake here, so it answers for the
        // workspace — and only when the ladder says NOBODY can, or a machine that merely wasn't
        // chosen would speak over the one about to work.
        if (originUserId && ownerActorId === originUserId && !saidNoCompute.has(triggerMessageId)
            && nobodyCanServe(await peerMachines(), agent.runtime, originUserId, Date.now(), agent.model ?? null)) {
          saidNoCompute.add(triggerMessageId);
          const ch = await db.get<{ id: string; workspace_id: string }>('select id, workspace_id from channels where id = ?', [where.channelId]).catch(() => null);
          if (ch) {
            await post('/v1/messages', { kind: 'agent', id: agent.id }, {
              workspace: ch.workspace_id, channel: ch.id, replyTo: triggerMessageId,
              ...(where.threadId ? { threadId: where.threadId } : {}), ...(where.taskId ? { taskId: where.taskId } : {}),
              body: `I can't run this right now — no machine available to me can serve ${agent.runtime}. Sign in to a provider on this machine, or ask a teammate to lend you theirs in Settings → Compute → Sharing.`,
            }).catch((e) => console.error('no-compute notice failed:', e));
          }
        }
        return LEASE_LOST;
      }
      await new Promise((r) => setTimeout(r, verdict.retryInMs));
    }
  }

  // One human feed message → the wake decision. Shared verbatim by the live watch
  // below and the boot dead-letter sweep (sweepDeadLetters) — same rules, one path.
  function handleFeedMessage(m: { id: string; channel_id: string; thread_id?: string | null; author_kind: string; author_id: string; body: string }): void {
    if (processed.has(m.id)) return;
    // human-authored only — same law as threads: agent messages never
    // wake agents (a digest mentioning @tracy is information, not a
    // summons; work moves agent→agent through board offers)
    if (m.author_kind !== 'human') return;
    const orch = [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(m.channel_id));
    const live = process.env['NM_AGENT_MODE'] !== 'echo';
    // B3: the human clicked "Add @agent" on the orchestrator's add-to-channel card. The
    // QuestionFlow posts "**Add @agent to #ch?** → Add @agent" — register the agent here.
    const addConfirm = /\*\*Add @?([a-z0-9][a-z0-9._-]*) to #[^*\n]+\?\*\*\s*(?:→|->)\s*Add\b/i.exec(m.body);
    if (addConfirm && orch && live) { processed.add(m.id); void confirmAddAgent(orch, m.channel_id, addConfirm[1]!); return; }
    // the human clicked the hire card's accept — execute deterministically
    // (register → bind → offer), no LLM turn. Unlike addConfirm this is NOT
    // gated on `live`: echo mode drives the same path (the e2e hire gate),
    // which is safe because 2793 already guarantees a human author and every
    // mutation is an enforced server command. Free-text replies fall through
    // to the normal wake, where the LLM's create_agent tool is the fallback.
    const hireConfirm = HIRE_CONFIRM_RE.exec(m.body);
    if (hireConfirm && orch) {
      processed.add(m.id);
      // [3] is the raw parenthesized text — confirmCreateAgent resolves it to a
      // hireable role (card-JSON role, then worker) so a drifted label still lands
      void confirmCreateAgent(orch, m.channel_id, hireConfirm[2]!.toLowerCase(), hireConfirm[3]!, hireConfirm[1] ? Number(hireConfirm[1]) : undefined);
      return;
    }
    // the human answered a capacity-failover card (docs/22) — apply the confirmed switch/hold
    // deterministically (agent.update / pack switch → resume the parked work), no LLM turn.
    const foConfirm = /\*\*[^*\n]*(?:usage limit|is exhausted)[^*\n]*\?\*\*\s*(?:→|->)\s*(.+?)\s*$/im.exec(m.body);
    if (foConfirm && orch) { processed.add(m.id); void confirmFailover(orch, m.channel_id, foConfirm[1]!); return; }
    // the marketing setup card's submit (round 4): the human's answers open the bootstrap
    // conversation thread — the one-shot bootstrap SCHEDULE is the response path, so no
    // LLM wake here (a wake would re-triage the setup into a board task, the exact bug).
    // Nudge the tick so the analysis starts seconds after submit, not on the next minute.
    if (/^\*\*Marketing HQ setup\*\*/.test(m.body)) {
      processed.add(m.id);
      setTimeout(() => { void runDueSchedules().catch(() => {}); }, 1500); // grace for the schedule row to reach the replica
      return;
    }
    // docs/34: the Tasks toggle's own line in the transcript. It is a RECORD of the flip, not a
    // message to anyone — waking on it would answer a divider.
    if (parseModeMarker(m.body)) { processed.add(m.id); return; }
    // round 9: "nudge me here" is WIRED — a human reply in a marketing room's bootstrap
    // thread finishes any MISSING brand docs instead of a generic chat turn. With the set
    // complete, the reply falls through to the ordinary wake (post-bootstrap Q&A).
    if (m.thread_id && live && orch) {
      processed.add(m.id);
      void (async () => {
        try {
          const [mkch] = await db.getAll<{ workspace_id: string; marketing: string | null }>(
            `select workspace_id, marketing from channels where id = ? and kind = 'marketing' limit 1`, [m.channel_id],
          ).catch(() => [] as Array<{ workspace_id: string; marketing: string | null }>);
          const btid = ((): string | null => { try { return (JSON.parse(mkch?.marketing ?? '{}') as { bootstrap_thread_id?: string }).bootstrap_thread_id ?? null; } catch { return null; } })();
          if (mkch && btid === m.thread_id) {
            const CANON = ['business-profile.md', 'brand-guidelines.md', 'market-research.md', 'social-strategy.md'];
            const have = await db.getAll<{ name: string }>(
              `select name from artifacts where channel_id = ? and name in ('business-profile.md','brand-guidelines.md','market-research.md','social-strategy.md')`,
              [m.channel_id],
            ).catch(() => [] as Array<{ name: string }>);
            const missing = CANON.filter((n) => !have.some((h) => h.name === n));
            const runner = [...agents.values()].find((a) => a.role === 'marketer' && a.channels.has(m.channel_id))
              ?? [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(m.channel_id)) ?? null;
            if (missing.length && runner) {
              await runMarketingBootstrap(runner, { id: `nudge-${m.id.slice(0, 8)}`, workspace_id: mkch.workspace_id, channel_id: m.channel_id }, { threadId: m.thread_id! }, { only: missing });
              return;
            }
          }
        } catch { /* fall through to the ordinary wake */ }
        const addressed = [...agents.values()].filter((a) => a.id !== orch.id && a.channels.has(m.channel_id) && addressedIn(m.body, a.name));
        if (addressed.length) { for (const a of addressed) queueWake(a, m); }
        else queueWake(await defaultResponder(orch, m.channel_id, m.thread_id!), m);
      })();
      return;
    }
    const orchMentioned = orch ? addressedIn(m.body, orch.name) : false;
    // A human can @mention a teammate — or open the message with its bare name
    // ("patch can you profile it?") — to address it directly; that agent answers
    // in the channel IF it's within its remit (it stands down with NO_REPLY otherwise). The
    // orchestrator stays the channel owner; its monitor sweeps up anything left unhandled.
    // Live-only: echo stays orchestrator-mention-only so the gates remain deterministic.
    const mentioned = orch && live
      ? [...agents.values()].filter((a) => a.id !== orch.id && a.channels.has(m.channel_id) && addressedIn(m.body, a.name))
      : [];
    // B3: a human tagged a workspace agent NOT in this channel → the orchestrator offers to add
    // it (the agent never saw the message, so it can't respond — that's the isolation guarantee).
    // Explicit-@ only: a bare leading name never reaches OUTSIDE the room (the composer doesn't
    // highlight it either — recognition and reach stay in lockstep).
    // …and never off a card: the offer's own copy names the agent ("@plume isn't in #marketing
    // yet"), so a card that came back under a human's name re-triggered this offer ~300 times in
    // three minutes on 2026-09-07. A person never types a card.
    const absent = orch && live && !parseCard(m.body)
      ? [...agents.values()].filter((a) => a.role !== 'orchestrator' && !a.channels.has(m.channel_id) && mentionRe(a.name).test(m.body))
      : [];
    let handled = false;
    if (absent.length && orch) { processed.add(m.id); handled = true; void offerAddAgents(orch, m.channel_id, absent); }
    if (mentioned.length && !orchMentioned) { processed.add(m.id); handled = true; for (const a of mentioned) queueWake(a, m); }
    if (handled) return;
    if (!orch) return;
    if (orchMentioned || live) { processed.add(m.id); queueWake(orch, m); }
  }

  async function routeThreadMessage(m: { id: string; task_id: string; channel_id: string; body: string }) {
    // the marketing setup card's submit, task-anchored (round 3: the setup TASK's thread owns
    // the whole first-run) — same law as the conversation shape in handleFeedMessage: the
    // one-shot bootstrap SCHEDULE is the response path, so no LLM wake answers the wizard
    // summary; just nudge the tick so the analysis starts seconds after submit.
    if (/^\*\*Marketing HQ setup\*\*/.test(m.body)) {
      setTimeout(() => { void runDueSchedules().catch(() => {}); }, 1500); // grace for the schedule row to reach the replica
      return;
    }
    const [t] = await db.getAll<ThreadTask>(
      `select id, number, title, description, state, channel_id, assignee_kind, assignee_id, kind from tasks where id = ?`,
      [m.task_id],
    );
    if (!t) {
      processed.delete(m.id); // task row not synced yet — the watch refires
      return;
    }
    let target: HostedAgent | undefined;
    const liveThread = process.env['NM_AGENT_MODE'] !== 'echo';
    // round 9's "nudge me here", task-anchored (round 3): a human reply in the setup task's
    // thread while brand docs are MISSING resumes the bootstrap deterministically — the same
    // law as the conversation-anchored branch in handleFeedMessage. Gated on the profile's
    // setup_at (the wizard writes per step, so `marketing` is non-null from the FIRST answer —
    // presence would fire the bootstrap mid-wizard). Docs complete → ordinary wake (Q&A).
    if (t.kind === 'setup' && liveThread) {
      try {
        const [mkch] = await db.getAll<{ workspace_id: string; marketing: string | null }>(
          `select workspace_id, marketing from channels where id = ? and kind = 'marketing' limit 1`, [t.channel_id],
        ).catch(() => [] as Array<{ workspace_id: string; marketing: string | null }>);
        const prof = ((): { setup_at?: string } => { try { return JSON.parse(mkch?.marketing ?? '{}') as { setup_at?: string }; } catch { return {}; } })();
        if (mkch && prof.setup_at) {
          const CANON = ['business-profile.md', 'brand-guidelines.md', 'market-research.md', 'social-strategy.md'];
          const have = await db.getAll<{ name: string }>(
            `select name from artifacts where channel_id = ? and name in ('business-profile.md','brand-guidelines.md','market-research.md','social-strategy.md')`,
            [t.channel_id],
          ).catch(() => [] as Array<{ name: string }>);
          const missing = CANON.filter((n) => !have.some((h) => h.name === n));
          const runner = [...agents.values()].find((a) => a.role === 'marketer' && a.channels.has(t.channel_id))
            ?? [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(t.channel_id)) ?? null;
          if (missing.length && runner) {
            await runMarketingBootstrap(runner, { id: `nudge-${m.id.slice(0, 8)}`, workspace_id: mkch.workspace_id, channel_id: t.channel_id }, { taskId: t.id }, { only: missing });
            return;
          }
        }
      } catch { /* fall through to the ordinary wake */ }
    }
    for (const a of agents.values()) {
      if (!a.channels.has(t.channel_id)) continue;
      if (!addressedIn(m.body, a.name)) continue;
      // An @mention — or the bare name opening the reply ("rex can we make a pdf…") — summons
      // that teammate to answer in the thread within its remit (it stands down with NO_REPLY
      // otherwise). Without this, a bare-name reply in a review-stage thread woke nobody: a
      // silent dead letter. Echo keeps the deterministic rule — only the orchestrator (channel
      // coordinator) or the task's assignee is summoned.
      if (liveThread || a.role === 'orchestrator' || (t.assignee_kind === 'agent' && t.assignee_id === a.id)) {
        target = a;
        break;
      }
    }
    if (!target) {
      // policy lives in shared/threadwake.ts so a missing state is a failing test, not a
      // silently dropped human message (that is how the design gate went unanswered)
      const who = unaddressedWake(t.state, t.kind);
      if (who === 'orchestrator') target = [...agents.values()].find((a) => a.role === 'orchestrator' && a.channels.has(t.channel_id));
      else if (who === 'assignee' && t.assignee_kind === 'agent' && t.assignee_id) target = agents.get(t.assignee_id);
    }
    if (!target) return;
    execQueue.run({ key: `thread:${m.id}:${target.id}`, kind: 'chat', cause: 'message', agentId: target.id, subject: { kind: 'task', number: t.number } }, () => wakeThread(target, m, t));
  }

  async function sweepDeadLetters(): Promise<void> {
    const cutoff = new Date(Date.now() - SWEEP_LOOKBACK_MS).toISOString();
    const humans = await db.getAll<SweepCandidate>(
      `select id, channel_id, task_id, thread_id, author_kind, author_id, body, created_at from messages
       where author_kind = 'human' and created_at > ? order by created_at asc limit 40`,
      [cutoff],
    ).catch(() => [] as SweepCandidate[]);
    if (!humans.length) return;
    // newest agent post per conversation (task thread → task, chat thread → thread, feed →
    // channel). It MUST group exactly as conversationKey keys, or the two sides disagree about
    // what a conversation is and the lookup clears the wrong candidates. An agent post
    // OLDER than the window can never clear a candidate, so the same cutoff bounds it.
    const agentRows = await db.getAll<{ k: string; at: string }>(
      `select coalesce(task_id, thread_id, channel_id) as k, max(created_at) as at from messages
       where author_kind = 'agent' and created_at > ? group by coalesce(task_id, thread_id, channel_id)`,
      [cutoff],
    ).catch(() => [] as Array<{ k: string; at: string }>);
    const letters = pickDeadLetters(humans, new Map(agentRows.map((r) => [r.k, r.at])));
    for (const m of letters) {
      if (m.task_id === null) {
        handleFeedMessage(m);
      } else if (!processed.has(m.id)) {
        processed.add(m.id);
        void routeThreadMessage({ id: m.id, task_id: m.task_id, channel_id: m.channel_id, body: m.body });
      }
    }
  }

  return { wakeGate, handleFeedMessage, routeThreadMessage, sweepDeadLetters };
}
