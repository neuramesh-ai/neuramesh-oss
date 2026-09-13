// THE WAKE PATH — a message arrives, and some agent answers it.
//
// Six functions split out of startAgentHost, and the largest single unit in it: the gate that
// decides whether a wake is even allowed, the feed and thread routers that pick who answers,
// the dead-letter sweep for messages a crashed run left unanswered, and `wake` itself — the
// daemon's entry point for every conversational turn.
//
// They are one module because they are one path, and the path only makes sense read end to
// end: handleFeedMessage picks a responder, wakeGate says whether it may run, wakeThread or
// wake runs the turn, and sweepDeadLetters is what catches the ones that never got that far.
//
// As everywhere else in this round, the TIMERS and WATCHES that drive this stayed in
// startAgentHost. This module says what a wake does; the boot sequence says when one starts.
// The value edge back to agents.ts. A cycle, and a deliberate one: host/flows.ts already
// imports the same helpers the same way, and every use here is inside a function body, so the
// bindings resolve at call time rather than at module init.
import { SKILL_MARKER, authBlockedCard, echoTurn, emitStream, loadMessageAttachments, parseSkillMarker, resolveToken, runtimeFor } from '../agents';
import { isLimitNotice } from '../execpolicy';
import { assemble, assemblyLine, contextBudget, transcriptBlock } from '../harness/assemble';
import { type RunHandle } from './runs';
import type { AgentAttachment } from '../runtime/adapter';
import { foLabel } from './staffing';
import { withTimeout } from './turnkit';
import { postWithRetry } from '../presence';
import { isStandDown } from '../replypolicy';
import { TURN_BUDGETS, genImageItemId, isChatThread, parseModeMarker } from '@neuramesh/shared';
import type { PowerSyncDatabase } from '@powersync/node';
import type { HostedAgent, SkillRef, ThreadTask } from '../agents';
import type { LogFn } from '../agentlog';
import type { SubjectRef } from '../harness/brain';
import type { makeRuns } from './runs';
import type { makeBlock } from './block';
import type { makeChatTurn } from './chatturn';
import type { makeStaffing } from './staffing';
import type { makeEcho } from './echo';
import type { makeContent } from './content';

/** the orchestrator's turn — a host closure, so its shape is named here once */
type OrchestratorTurn = (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, transcript: string, token: string, thread?: { id: string; number: number; title: string; state: string }, log?: LogFn, skills?: SkillRef[], attachments?: AgentAttachment[], convoThreadId?: string | null, run?: RunHandle, onDelta?: (t: string) => void) => Promise<string>;

// FORTY-THREE dependencies. That number is the finding, not an accident of the split: the wake
// path touches nearly everything the host does, and until now that was true but invisible.
// Every type here is INFERRED from the maker that produces it — never restated.
export function makeWake(ctx: {
  db: PowerSyncDatabase;
  NO_RUN: ReturnType<typeof makeRuns>['NO_RUN'];
  alog: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null, runId?: string | null) => LogFn;
  apiUrl: string;
  arun: (agent: HostedAgent, t?: { id: string; number: number; channel_id?: string } | null, channelSlug?: string | null) => { log: LogFn; runId: string };
  blockFor: ReturnType<typeof makeBlock>['blockFor'];
  brainNotes: (subject: SubjectRef, cap?: number, perNote?: number) => string;
  brainResults: (subject: SubjectRef, cap?: number, per?: number) => string;
  chatTurn: ReturnType<typeof makeChatTurn>['chatTurn'];
  discoverSkills: (channelId: string, workspaceId: string) => Promise<SkillRef[]>;
  echoOrchestrate: ReturnType<typeof makeEcho>['echoOrchestrate'];
  echoPlanReview: ReturnType<typeof makeEcho>['echoPlanReview'];
  echoThreadOrchestrate: ReturnType<typeof makeEcho>['echoThreadOrchestrate'];
  generateDraftImage: ReturnType<typeof makeContent>['generateDraftImage'];
  handleExhaustion: ReturnType<typeof makeStaffing>['handleExhaustion'];
  openWakeRun: (agent: HostedAgent, where: { workspace: string; channelId: string; threadId?: string | null; taskId?: string | null }, prompt: string, triggerMessageId?: string | null) => Promise<RunHandle>;
  orchestratorTurn: OrchestratorTurn;
  ownerActorId: string;
  post: (path: string, actor: { kind: string; id: string; role?: string }, body: unknown) => Promise<Response>;
  rearmWake: (messageId: string) => boolean;
  reviseContentDrafts: ReturnType<typeof makeContent>['reviseContentDrafts'];
  seatFor: ReturnType<typeof makeStaffing>['seatFor'];
  setStatus: (agent: HostedAgent, status: 'online' | 'thinking' | 'working') => void;
  threadModeFor: ReturnType<typeof makeChatTurn>['threadModeFor'];
  threadTranscript: ReturnType<typeof makeContent>['threadTranscript'];
  wakeEnded: (chId: string) => void;
  wakeStarted: (chId: string) => void;
}) {
  const { db } = ctx;
  const { NO_RUN, alog, apiUrl, arun, blockFor, brainNotes, brainResults, chatTurn, discoverSkills, echoOrchestrate, echoPlanReview, echoThreadOrchestrate, generateDraftImage, handleExhaustion, openWakeRun, orchestratorTurn, ownerActorId, post, rearmWake, reviseContentDrafts, seatFor, setStatus, threadModeFor, threadTranscript, wakeEnded, wakeStarted } = ctx;





  async function wakeThread(agent: HostedAgent, m: { id: string; body: string }, t: ThreadTask) {
    agent = await seatFor(agent, t.channel_id, { taskId: t.id }); // per-project + per-thread brains (docs/10)
    setStatus(agent, 'thinking');
    // open the thread's stream with NO text: presence, so the surface where the reply will
    // land shows this agent working from the first moment — the only reliable attribution
    // for a non-assignee wake (rex answering in someone else's thread), since agent status
    // is global. The `finally` below closes it on every exit path.
    emitStream(`${t.channel_id}:${t.id}`, agent.name, '', false);
    // the run is the ghost's synced twin (docs/29) — declared out here so every exit settles it
    let wakeRun: RunHandle = NO_RUN;
    try {
      const ch = await db.get<{ id: string; slug: string; workspace_id: string }>(
        'select id, slug, workspace_id from channels where id = ?',
        [t.channel_id],
      );
      wakeRun = await openWakeRun(agent, { workspace: ch.workspace_id, channelId: ch.id, taskId: t.id }, m.body, m.id);
      // another member's machine holds the lease — it is answering, so we generate nothing (0114)
      if (wakeRun.lost) return;
      const cred = await resolveToken(apiUrl, ch.workspace_id, agent, ownerActorId);
      if (cred.blocked && process.env['NM_AGENT_MODE'] !== 'echo') {
        await post('/v1/messages', { kind: 'agent', id: agent.id }, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: authBlockedCard(agent, cred.blocked, t.number) }).catch(() => {});
        console.log(`agent_thread_wake agent=${agent.name} task=${t.number} auth_blocked=${cred.blocked.provider}`);
        return;
      }
      const token = cred.token ?? ''; // apikey → the key; subscription → '' (providerEnv strips keys)
      const mode = process.env['NM_AGENT_MODE'] === 'echo' ? 'echo' : cred.authMode !== 'none' ? 'claude' : 'echo';

      let reply: string;
      if (agent.role === 'orchestrator') {
        const { log: tlog } = arun(agent, t, ch.slug);
        const skills = await discoverSkills(ch.id, ch.workspace_id);
        if (skills.length) tlog({ kind: 'tool', phase: 'inject', summary: `${skills.length} skill${skills.length === 1 ? '' : 's'} available in #${ch.slug}` });
        if (mode === 'claude') {
          const att = await loadMessageAttachments(db, m.id);
          reply = await withTimeout(
            orchestratorTurn(agent, ch, (await threadTranscript(agent, t)) + att.manifest, token, t, tlog, skills, att.list, null, NO_RUN,
              (t2) => emitStream(`${t.channel_id}:${t.id}`, agent.name, t2, false)),
            TURN_BUDGETS.triage.wallMs,
            'thread orchestration timed out after 4m',
          );
        } else {
          reply = t.state === 'todo'
            ? await echoThreadOrchestrate(agent, t, ch)
            : t.state === 'plan_review'
              ? await echoPlanReview(agent, t, ch, m.body)
              : `[echo · ${agent.name}] noted in #${t.number}: “${m.body.slice(0, 80)}”`;
        }
      } else if (t.kind === 'content' && t.assignee_kind === 'agent' && t.assignee_id === agent.id && genImageItemId(m.body)) {
        // the card's "Generate image" / "Try again" — draw ONE draft from its EXISTING brief, no LLM turn
        reply = await generateDraftImage(agent, ch, genImageItemId(m.body)!);
      } else if (t.kind === 'content' && t.assignee_kind === 'agent' && t.assignee_id === agent.id) {
        // a content-task reply asks the marketer to REVISE its drafts, not just chat — it produces
        // a revised.json, the daemon applies it to the flagged cards, and the reply reports it (§4.5)
        const revised = await reviseContentDrafts(agent, ch, t, m, mode, token);
        if (revised === null) {
          // no drafts to revise (nothing delivered yet) — fall back to a plain reply
          reply = mode === 'claude'
            ? await withTimeout(runtimeFor(agent.runtime).streamTurn(agent, ch.slug, await threadTranscript(agent, t), token, undefined, (t2) => emitStream(`${t.channel_id}:${t.id}`, agent.name, t2, false)), TURN_BUDGETS.triage.wallMs, 'thread chat turn timed out')
            : `[echo · ${agent.name}] noted in #${t.number}: “${m.body.slice(0, 80)}”`;
        } else {
          reply = revised;
        }
      } else if (mode === 'claude') {
        const att = await loadMessageAttachments(db, m.id);
        // same wall as the orchestrator turn: a hung runtime must not hold 'thinking' forever
        reply = await withTimeout(
          runtimeFor(agent.runtime).streamTurn(agent, ch.slug, (await threadTranscript(agent, t)) + att.manifest, token, undefined, (t2) => emitStream(`${t.channel_id}:${t.id}`, agent.name, t2, false), att.list),
          TURN_BUDGETS.triage.wallMs,
          'thread chat turn timed out after 4m',
        );
      } else {
        reply = `[echo · ${agent.name}] noted in #${t.number}: “${m.body.slice(0, 80)}”`;
      }

      // a cap that arrives as REPLY TEXT (subscription runtimes end the turn cleanly)
      // must raise the failover card, not be posted as if the agent said it
      if (isLimitNotice(reply)) {
        console.warn(`agent_thread_wake agent=${agent.name} task=${t.number} capped — raising the failover card`);
        await post('/v1/messages', { kind: 'agent', id: agent.id }, {
          workspace: ch.workspace_id, channel: ch.id, taskId: t.id, replyTo: m.id,
          body: `I'm capped on ${foLabel(agent.model)} and can't answer here until I'm re-seated — the switch card is in #${ch.slug}.`,
        }).catch(() => {});
        await handleExhaustion(agent, null, ch);
        return;
      }
      // replyTo = the triggering message: the server holds ONE reply per (agent, trigger)
      // (0060), so a second live daemon racing this wake gets 409 and stands down — the
      // #1010 double-reply class is impossible regardless of how many hosts are running.
      // The same index makes the retry safe: an attempt that failed after committing
      // 409s on the next try instead of double-posting.
      const sent = await postWithRetry(
        () => post('/v1/messages', { kind: 'agent', id: agent.id }, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: reply, replyTo: m.id }).then((r) => r.status),
        { onRetry: (attempt, delayMs, why) => console.error(`agent_thread_wake agent=${agent.name} task=${t.number} reply post failed (${why}) — retry ${attempt} in ${Math.round(delayMs / 1000)}s`) },
      );
      if (sent.outcome === 'conflict') {
        console.log(`agent_thread_wake agent=${agent.name} task=${t.number} stood_down=duplicate (another host already replied)`);
        return;
      }
      if (sent.outcome !== 'ok') {
        if (sent.outcome === 'gave_up') rearmWake(m.id); // the sweep re-answers once the server is back
        throw new Error(`thread reply post failed ${sent.httpStatus ?? '(network)'} after ${sent.tries} tries`);
      }
      console.log(`agent_thread_wake agent=${agent.name} task=${t.number} mode=${mode} replied=ok${sent.tries > 1 ? ` tries=${sent.tries}` : ''}`);
    } catch (err) {
      console.error(`agent_thread_wake agent=${agent.name} task=${t.number} failed:`, err);
      await wakeRun.settle('failed', err instanceof Error ? err.message.slice(0, 200) : 'the turn failed');
    } finally {
      emitStream(`${t.channel_id}:${t.id}`, agent.name, '', true); // clear the live bubble on every exit (wake() already does)
      setStatus(agent, 'online');
      await wakeRun.settle('done'); // an unsettled run is an eternal spinner on every machine
    }
  }

  async function wake(agent: HostedAgent, m: { id: string; channel_id: string; thread_id?: string | null; body: string }) {
    agent = await seatFor(agent, m.channel_id, { threadId: m.thread_id }); // per-project + per-thread brains (docs/10)
    setStatus(agent, 'thinking');
    // registered before any awaits: the monitor self-check defers while a wake is live in
    // this channel (gateMonitor) — two concurrent triage turns once created duplicate tasks
    wakeStarted(m.channel_id);
    const runId = crypto.randomUUID(); // one activity run per channel wake → response
    const log = alog(agent, null, null, runId);
    log({ kind: 'wake', phase: 'channel', summary: `woke on: ${m.body.replace(/\s+/g, ' ').slice(0, 120)}` });
    // the live bubble paints wherever the reply will land: the channel feed, and — when
    // the trigger rode a conversation thread — that thread's sheet too
    const emitChat = (text: string, done: boolean) => {
      emitStream(`${m.channel_id}:`, agent.name, text, done);
      if (m.thread_id) emitStream(`${m.channel_id}:${m.thread_id}`, agent.name, text, done);
    };
    emitChat('', false); // presence from the wake — the ghost mounts before the first token
    // the run is the ghost's synced twin (docs/29): same story, durable and cross-machine.
    // Declared out here so every exit path below can settle it.
    let wakeRun: RunHandle = NO_RUN;
    try {
      const ch = await db.get<{ id: string; slug: string; workspace_id: string }>(
        'select id, slug, workspace_id from channels where id = ?',
        [m.channel_id],
      );
      wakeRun = await openWakeRun(agent, { workspace: ch.workspace_id, channelId: ch.id, threadId: m.thread_id ?? null }, m.body, m.id);
      // another member's machine holds the lease — it is answering, so we generate nothing (0114)
      if (wakeRun.lost) { emitChat('', true); return; }
      const cred = await resolveToken(apiUrl, ch.workspace_id, agent, ownerActorId);
      // Preferred subscription is down + failover is Manual → reply with an actionable auth card
      // instead of silently billing a key or faking an echo reply. (Skipped in global echo dev.)
      if (cred.blocked && process.env['NM_AGENT_MODE'] !== 'echo') {
        emitChat('', true);
        // the card must land where the human is looking: reply-to their message and ride
        // its thread when the trigger came from a conversation sheet, exactly like a real
        // reply does below. Otherwise it lands only in the feed and the open thread hangs.
        await post('/v1/messages', { kind: 'agent', id: agent.id }, { workspace: ch.workspace_id, channel: ch.id, body: authBlockedCard(agent, cred.blocked), replyTo: m.id, ...(m.thread_id ? { threadId: m.thread_id } : {}) }).catch(() => {});
        log({ kind: 'wake', phase: 'stood_down', summary: `auth blocked — ${cred.blocked.provider} subscription not usable (failover manual)` });
        setStatus(agent, 'online');
        return;
      }
      const token = cred.token ?? ''; // apikey → the key; subscription → '' (providerEnv strips keys)
      const mode = process.env['NM_AGENT_MODE'] === 'echo' ? 'echo' : cred.authMode !== 'none' ? 'claude' : 'echo';

      let reply: string;
      // ── The draft-card image button, in a CONVERSATION ─────────────────────────────────
      // Same intercept the task wake carries: draw one draft from the brief already on it, no
      // LLM turn, whatever the thread's mode. It sits ABOVE the chat-mode branch because it is
      // not a conversation — it is a button, and routing it through a model turn would have the
      // agent narrate the request instead of answering it. Ungating this from content tasks is
      // the reported half of the wider "features must not be gated on a thread's kind" ruling.
      const genImage = m.thread_id ? genImageItemId(m.body) : null;
      // ── Chat mode (docs/34) ────────────────────────────────────────────────────────────
      // The thread decides, not the agent's role: a conversation with Tasks off runs the chat
      // turn for WHOEVER was woken. Read straight from the replica — the mode is a synced
      // column, so this is the same answer on every machine.
      const chatMode = m.thread_id ? isChatThread(await threadModeFor(m.thread_id)) : false;
      if (genImage) {
        const glog = alog(agent, null, ch.slug, runId);
        glog({ kind: 'wake', phase: 'channel', summary: `generating the image for one draft` });
        reply = await generateDraftImage(agent, ch, genImage);
      } else if (chatMode && mode === 'claude') {
        const clog = alog(agent, null, ch.slug, runId);
        clog({ kind: 'wake', phase: 'channel', summary: `chat turn (Tasks off) — answering in the thread, nothing reaches the board` });
        const recent = await db.getAll<{ author_kind: string; author_id: string; body: string }>(
          `select author_kind, author_id, body from messages where thread_id = ? order by created_at desc limit 24`,
          [m.thread_id],
        );
        const att = await loadMessageAttachments(db, m.id);
        // a chat carries MORE history than a board wake (24 turns): the conversation IS the
        // context, and a chat that forgets what it said four messages ago is not a chat.
        // ── Assembled to budget (docs/harness/05 §3.7) ───────────────────────────────────────
        // The `limit 24` above is now a generous CEILING on rows fetched, not the decision about how
        // much history the turn gets: the assembler fills to the chat budget and trims the transcript
        // tail first, so a terse conversation keeps more turns than a verbose one — which is what
        // "fits" actually means. Before this, three flows each picked their own row cap (8 / 14 / 24)
        // and none of them knew the cost.
        const ctx = assemble([
          transcriptBlock(
            recent.reverse().filter((r) => !parseModeMarker(r.body)).map((r) => ({ ...r, body: r.body.replace(SKILL_MARKER, '').trim() })),
            { selfId: agent.id },
          ),
          { source: 'attachments', text: att.manifest },
        ], contextBudget('chat'));
        clog({ kind: 'turn', phase: 'inject', summary: assemblyLine(ctx) }); // context spend is measured, not asserted
        const transcript = ctx.text;
        reply = await withTimeout(
          chatTurn({ agent, ch, threadId: m.thread_id!, transcript, token, log: clog, onDelta: (t2) => emitChat(t2, false), attachments: att.list, run: wakeRun }),
          TURN_BUDGETS.chat.wallMs, // docs/harness/05 §3.6 — a chat may research + write + run code
          'the chat turn timed out after 12m',
        );
      } else if (agent.role === 'orchestrator') {
        // the orchestrator considers team skills too (to scope/route work). Logged
        // for both echo + claude so "skills considered" is visible in the activity
        // log; passed into the claude turn for load_skill + the prompt.
        const olog = alog(agent, null, ch.slug, runId);
        const skills = await discoverSkills(ch.id, ch.workspace_id);
        if (skills.length) olog({ kind: 'tool', phase: 'inject', summary: `${skills.length} skill${skills.length === 1 ? '' : 's'} available in #${ch.slug}` });
        // a `/`-attached skill is an explicit steer from the human
        const attached = parseSkillMarker(m.body);
        if (attached) olog({ kind: 'tool', phase: 'inject', summary: `human attached skill "${attached.name}" via /` });
        if (mode === 'claude') {
          // deeper context than chat agents: requirements gathering spans turns. A
          // conversation-thread trigger scopes the transcript to ITS thread — the
          // exchange being continued — instead of the room's interleaved feed.
          const recent = m.thread_id
            ? await db.getAll<{ author_kind: string; author_id: string; body: string }>(
                `select author_kind, author_id, body from messages where thread_id = ? order by created_at desc limit 14`,
                [m.thread_id],
              )
            : await db.getAll<{ author_kind: string; author_id: string; body: string }>(
                `select author_kind, author_id, body from messages where channel_id = ? and task_id is null order by created_at desc limit 14`,
                [m.channel_id],
              );
          const block = await blockFor(m.channel_id);
          const att = await loadMessageAttachments(db, m.id);
          // assembled to the TRIAGE budget (docs/harness/05 §3.7) — deliberately tighter than chat's:
          // routing is a decision, not a conversation, and its budget says so
          // the thread's own brain, in the two blocks the assembler already declares and this turn
          // never filled: what earlier agents wrote down here, and what its own subagents reported.
          // Injected rather than left to a tool call because an orchestrator that has to REMEMBER to
          // look does not — which is how a fan-out got re-commissioned for ground already covered.
          const oSubject: SubjectRef | null = m.thread_id ? { kind: 'thread', id: m.thread_id } : null;
          const octx = assemble([
            { source: 'facts', text: block ? `[channel summary block]\n${block}` : '' },
            { source: 'notes', text: oSubject ? brainNotes(oSubject) : '' },
            { source: 'results', text: oSubject ? brainResults(oSubject) : '' },
            transcriptBlock(
              recent.reverse().filter((r) => !parseModeMarker(r.body)).map((r) => ({ ...r, body: r.body.replace(SKILL_MARKER, '').trim() })),
              { selfId: agent.id },
            ),
            { source: 'skills', text: attached ? `[The human attached the skill "${attached.name}"${attached.pack ? ` from pack ${attached.pack}` : ''} via "/" — strongly consider load_skill on it and folding its guidance into how you scope/route this work.]` : '' },
            { source: 'attachments', text: att.manifest },
          ], contextBudget('triage'));
          olog({ kind: 'turn', phase: 'inject', summary: assemblyLine(octx) });
          const transcript = octx.text;
          reply = await withTimeout(orchestratorTurn(agent, ch, transcript, token, undefined, olog, skills, att.list, m.thread_id ?? null, wakeRun, (t) => emitChat(t, false)), TURN_BUDGETS.triage.wallMs, 'orchestration timed out');
        } else {
          reply = await echoOrchestrate(agent, m.body, ch);
        }
      } else if (mode === 'claude') {
        // a conversation-thread trigger reads ITS thread, not the interleaved room feed
        const recent = m.thread_id
          ? await db.getAll<{ author_kind: string; body: string }>(
              `select author_kind, body from messages where thread_id = ? order by created_at desc limit 8`,
              [m.thread_id],
            )
          : await db.getAll<{ author_kind: string; body: string }>(
              `select author_kind, body from messages where channel_id = ? and task_id is null order by created_at desc limit 8`,
              [m.channel_id],
            );
        const block = await blockFor(m.channel_id);
        const transcript =
          (block ? `[channel summary block]\n${block}\n\n` : '') +
          recent
            .reverse()
            .map((r) => `${r.author_kind === 'agent' ? 'agent' : 'human'}: ${r.body}`)
            .join('\n');
        const att = await loadMessageAttachments(db, m.id);
        // same wall as the orchestrator turn: a hung runtime must not hold 'thinking' forever
        reply = await withTimeout(
          runtimeFor(agent.runtime).streamTurn(agent, ch.slug, transcript + att.manifest, token, alog(agent, null, ch.slug, runId), (t2) => emitChat(t2, false), att.list),
          TURN_BUDGETS.triage.wallMs,
          'chat turn timed out',
        );
      } else {
        reply = echoTurn(agent, m.body);
      }
      emitChat('', true); // clear the live bubble; the synced message lands next
      if (isStandDown(reply)) {
        console.log(`agent_wake agent=${agent.name} mode=${mode} stood_down=ok`);
        log({ kind: 'wake', phase: 'stood_down', summary: 'stood down (NO_REPLY)' });
        return;
      }
      // a cap that arrives as REPLY TEXT (subscription runtimes end the turn cleanly)
      // raises the failover card instead of being posted as the agent's own words
      if (isLimitNotice(reply)) {
        console.warn(`agent_wake agent=${agent.name} capped — raising the failover card`);
        log({ kind: 'wake', phase: 'error', summary: `capped on ${foLabel(agent.model)} — raising the failover card`, level: 'warn' });
        await handleExhaustion(agent, null, ch);
        return;
      }
      // The reply goes to the thread's CURRENT room, which after auto-filing (0109) is not
      // necessarily the room this wake arrived on: `ch` is where the message landed, and
      // file_conversation may have moved the whole conversation mid-turn. Posting to `ch.id`
      // would write the answer into the room the conversation just left — the reply in one
      // room, the conversation it answers in another. Re-read rather than assume; a thread
      // that did not move resolves to the same id it always had.
      const replyChannel = m.thread_id
        ? (await db.get<{ channel_id: string }>('select channel_id from threads where id = ?', [m.thread_id]).catch(() => null))?.channel_id ?? ch.id
        : ch.id;
      // replyTo: the server holds ONE reply per (agent, trigger) — a racing second
      // daemon (or our own earlier attempt that failed after committing) gets 409
      // and stands down instead of double-posting (0060). That index is what makes
      // retrying this post safe by construction; a generated reply is minutes of
      // work, so one transient 5xx must not discard it.
      const sent = await postWithRetry(
        () => post('/v1/messages', { kind: 'agent', id: agent.id }, { workspace: ch.workspace_id, channel: replyChannel, body: reply, replyTo: m.id, ...(m.thread_id ? { threadId: m.thread_id } : {}) }).then((r) => r.status),
        { onRetry: (attempt, delayMs, why) => log({ kind: 'wake', phase: 'retry', summary: `reply post failed (${why}) — retry ${attempt} in ${Math.round(delayMs / 1000)}s`, level: 'warn' }) },
      );
      if (sent.outcome === 'conflict') {
        console.log(`agent_wake agent=${agent.name} stood_down=duplicate (another host already replied)`);
        log({ kind: 'wake', phase: 'stood_down', summary: 'another host already replied to that message' });
        return;
      }
      if (sent.outcome !== 'ok') {
        if (sent.outcome === 'gave_up' && rearmWake(m.id))
          log({ kind: 'wake', phase: 'retry', summary: 'reply undelivered — re-armed for the dead-letter sweep once the server is reachable', level: 'warn' });
        throw new Error(`reply post failed ${sent.httpStatus ?? '(network)'} after ${sent.tries} tries`);
      }
      console.log(`agent_wake agent=${agent.name} mode=${mode} cred=${cred.source} replied=ok${sent.tries > 1 ? ` tries=${sent.tries}` : ''}`);
      log({ kind: 'wake', phase: 'replied', summary: `replied in #${ch.slug}${sent.tries > 1 ? ` (after ${sent.tries} tries)` : ''}` });
    } catch (err) {
      console.error(`agent_wake agent=${agent.name} failed:`, err);
      log({ kind: 'wake', phase: 'error', summary: `wake failed: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`, level: 'error' });
      await wakeRun.settle('failed', err instanceof Error ? err.message.slice(0, 200) : 'the turn failed');
    } finally {
      wakeEnded(m.channel_id);
      emitChat('', true);
      setStatus(agent, 'online');
      // every exit path settles: an unsettled run is an eternal spinner on every machine,
      // which is strictly worse than the dead air it replaced
      await wakeRun.settle('done');
    }
  }

  // wakeThread leaves now: routing calls it (host/wakerouting.ts), which is the one edge
  // between the two halves and the reason they could separate at all.
  return { wake, wakeThread };
}
