// THE ORCHESTRATOR'S TURN — picking a transport and running one.
//
// Split out of startAgentHost to sit beside the four transports it dispatches to (orchturn.ts).
// This half assembles the turn — the seat, the registry, the credential, the budget — and then
// hands it to whichever transport the agent's provider needs. The transports stayed separate
// because their failure modes differ; this stayed separate from them because choosing is not
// the same job as running.
import { styled } from '../housestyle';
import type { LogFn } from '../agentlog';
import { xResearchNote } from '../agents';
import type { HostedAgent, SkillRef } from '../agents';
import { contractFor } from '../contracts';
import { HIRE_CARD_SPEC } from '../hirecards';
import { type AgentAttachment } from '../runtime/adapter';
import { type OrchTransportArgs } from './orchturn';
import { type RunHandle } from './runs';
import { composePrompt } from '@neuramesh/shared';
import type { PowerSyncDatabase } from '@powersync/node';
import type { makeRuns } from './runs';
import type { makeOrchTools } from './orchtools';
import type { makeContent } from './content';
import type { makeWorkspace } from './workspace';

export function makeOrchTurn(ctx: {
  db: PowerSyncDatabase;
  NO_RUN: ReturnType<typeof makeRuns>['NO_RUN'];
  buildOrchestratorTools: ReturnType<typeof makeOrchTools>['buildOrchestratorTools'];
  draftsForAnchor: ReturnType<typeof makeContent>['draftsForAnchor'];
  ensureChatWorkspace: ReturnType<typeof makeWorkspace>['ensureChatWorkspace'];
  orchSpawnFor: ReturnType<typeof makeContent>['orchSpawnFor'];
  /** the four transports, one signature — see orchturn.ts */
  dispatchOrchestrator: (agent: HostedAgent, args: OrchTransportArgs) => Promise<string>;
}) {
  const { db, NO_RUN, buildOrchestratorTools, draftsForAnchor, ensureChatWorkspace,
          orchSpawnFor, dispatchOrchestrator } = ctx;

  async function orchestratorTurn(
    agent: HostedAgent,
    ch: { id: string; slug: string; workspace_id: string },
    transcript: string,
    token: string,
    thread?: { id: string; number: number; title: string; state: string },
    log?: LogFn,
    skills: SkillRef[] = [],
    attachments: AgentAttachment[] = [],
    // the conversation thread this wake continues (channel wakes only): tasks the turn
    // creates link back to it, upgrading the chat thread into the task's thread in place
    convoThreadId: string | null = null,
    // the wake's run (docs/29): legs parent onto it, so a fan-out renders as a tree rather than
    // as unrelated top-level runs. Absent on a sweep, which is why spawn is absent there too.
    run: RunHandle = NO_RUN,
    // live tokens to the renderer's bubble — the orchestrator NEVER streamed before this (the
    // transport had no onDelta), which is why rex's replies always appeared all at once
    onDelta?: (t: string) => void,
  ): Promise<string> {
    const actor = { kind: 'agent', id: agent.id, role: 'orchestrator' };

    const otools = await buildOrchestratorTools({
      ch, agent, actor, skills, log, thread, convoThreadId, token,
      // a turn holding a task OWNS it (docs/harness §OWNING_KINDS); a room message is triage
      kind: thread ? 'own' : 'triage',
      // THE fix: the orchestrator can finally fan out. TOOL_KINDS.spawn has always listed 'triage',
      // but this registry never read the bus, so the capability was granted and never delivered.
      // a turn that OWNS a task funds its fan-out from the owning budget; a routing turn from triage
      spawn: orchSpawnFor(agent, ch, convoThreadId ?? thread?.id ?? null, run, log, thread ? 'own' : 'triage'),
    });

    // the room's project is ambient context, not a lookup: channels → projects is 1:N
    // (channels.project_id), and a task's project is derived from its channel — so the
    // orchestrator must never guess "the default project" for a scoped room.
    const [chProj] = await db.getAll<{ name: string; slug: string }>(
      `select p.name, p.slug from projects p join channels c on c.project_id = p.id where c.id = ?`,
      [ch.id],
    );
    const projLine = chProj ? ` This room belongs to the project “${chProj.name}” (slug: ${chProj.slug}) — tasks created here file under it.` : '';

    // CONTENT IS ANSWERED, NOT FILED (founder, 2026-08-08).
    //
    // This note used to say the opposite — "PHASE 2: propose_task with kind:'content', then
    // offer_task to the MARKETER" — and it was the loudest instruction in the prompt, so it beat
    // the general rule two paragraphs above it ("THE DEFAULT IS TO SOLVE IT HERE"). Every "draft
    // me some posts" became a proposal card. Declining it left rex with nothing to do, because
    // the only surface that rendered a post card was a content task, so there was genuinely no
    // other move. `draft_posts` (0115) is that move: the cards live in the thread now.
    //
    // No longer gated on channels.kind either. A post publishes through the connector its
    // channel's PROJECT owns (0106), so the room's type was never what made this possible — it
    // only decided who got told they could. What a marketing room still adds is CONTEXT (brand
    // docs, calendar, crew), which is the paragraph below, not the capability.
    const [chMeta] = await db.getAll<{ kind: string }>('select kind from channels where id = ?', [ch.id]);
    // The room's publish connectors + this anchor's drafts, resolved ONCE — they decide whether
    // the content context below is injected at all, and feed the scheduling block that follows.
    // (0106: connectors belong to the PROJECT; channel_id only records where OAuth happened.)
    const conns = await db.getAll<{ provider: string; handle: string | null }>(
      `select k.provider, k.handle from connectors k
        where k.workspace_id = ? and k.status = 'connected'
          and (k.project_id is null
               or k.project_id = (select project_id from channels where id = ?))
        order by (k.project_id is not null) desc`,
      [ch.workspace_id, ch.id],
    ).catch(() => [] as Array<{ provider: string; handle: string | null }>);
    const draftsNow = (await draftsForAnchor(thread?.id ?? null, convoThreadId ?? null))?.posts ?? [];
    // CONDITIONAL since 2026-08-18 (the diet): this rider was injected into EVERY channel wake in
    // EVERY room kind — 2.3K chars of content doctrine in rooms with no connector, no drafts and
    // no marketing kind, restating what draft_posts' own description already carries at the point
    // of use. It now rides only where content work is live, exactly like its scheduling sibling
    // below. The capability itself is ungated as ever — the tools exist in every room.
    const contentLive = chMeta?.kind === 'marketing' || conns.length > 0 || draftsNow.length > 0;
    const marketingNote = !contentLive ? '' : `

  CONTENT ASKS ARE ANSWERED HERE, NOT FILED. "Draft me three posts for X", "write captions for this", "a LinkedIn version of that" — these are DELIVERABLES you produce in this thread, not board work. Do NOT create_task for them, in any room. The flow is:
  - Draft them and hand them over with **draft_posts**, which renders each as a platform-native card the human approves, schedules, or asks you to change right here. That IS the deliverable. Never write a posts.json file and never paste the posts as markdown — a file gives them nothing to click and pasted prose gives them nothing to approve.
  - If a MARKETER is in this room (check list_agents), spawn it as a subagent to write the copy — it opens with this room's brand docs, guidelines and connected accounts staged, which you do not. Take what it returns and call draft_posts yourself. Draft them directly only when no marketer is here.
  - Ask FIRST only what genuinely changes the copy — which networks, how many, the angle — and only when you cannot infer it. One nmq card, prefilled from the room's brand goal. A reasonable guess you can revise beats a card that stalls the ask; drafts are cheap to redo (**revise_posts** rewrites one in place, keeping its letter and its history).
  - When the human asks to change a draft, use revise_posts, never draft_posts — a second card beside the old one is the wrong answer to "change this". Scheduling is schedule_posts, whose card is the human's approval gate; you can never publish.
  - YOU CAN DRAW. A picture is **generate_image** (re-runs the brief already on the card) or **revise_posts** with a new imageBrief (different art direction, redraws on its own). Never tell the human to press a button — if they asked for an image, make it. Give a post an imageBrief when it should carry a visual; Instagram and TikTok always need one.
  - A content ask becomes a TASK only on the normal bar: they asked for tracked work, or it is a campaign that must outlive this conversation across sessions and owners. Then create_task with kind:'content' (a lean plan — legs [build] with the drafting approach; born in plan review) and offerTo the marketer — never request_design or request_plan (drafting posts has no mockup gate and no plan step), and its Definition of Done is publish-readiness, never a pull request.${
      chMeta?.kind === 'marketing'
        ? `
  THIS IS A MARKETING ROOM — the work here is CONTENT by default (social posts, captions, threads, campaigns for X / LinkedIn / Instagram / TikTok), and it carries the brand docs, calendar, library and crew for it. A genuinely non-content request here (e.g. a bug in the website's own code) still triages normally.
  MARKETING FLOWS HAVE PLAYBOOKS. An audit / GEO / teardown / positioning / launch / ads / ASO shaped ask routes through **list_playbooks** first, then **run_playbook** — the run STARTS immediately from the registry's templated plan (the ask is the consent; no plan-review stop), and in a task thread it lands as that task's subtask so the flow keeps one session. Hooks, copy variants and email sequences are chat playbooks: load their skill and answer here. Never improvise a flow the catalog already carries.`
        : ''
    }`;

    // Scheduling context — WHY rex kept telling people it needed Buffer / Hootsuite: it had no
    // idea NeuraMesh schedules + publishes natively, and no live view of what was already
    // scheduled. Give it both, in BOTH the channel and thread prompts, plus the live connector +
    // per-post slot state so "can you schedule them?" gets a real answer, not a guess.
    //
    // Carried wherever the tools are, which is everywhere now — a #build room whose project owns
    // an X account could always have published, and rex being told otherwise was the whole
    // problem. It stays SILENT in a room with neither a connector nor a draft, so an engineering
    // room that never touches content pays nothing for it.
    let marketingSchedulingContext = '';
    const xPublishConnected = conns.some((c) => c.provider === 'x');
    {
      const here = draftsNow;
      // nothing to schedule and nothing to schedule WITH → say nothing at all
      if (contentLive) {
        // "Connected accounts" was doing two jobs and only one was true: a connector is a
        // PUBLISHING credential, and rex read it as "I can see this account" — which is how a
        // research run reported reach numbers it had no way to fetch. Name the capability.
        const connLine = conns.length
          ? `Accounts connected FOR PUBLISHING (posting only — a connector grants no ability to read or search these platforms): ${conns.map((c) => `${c.provider}${c.handle ? ` (${c.handle})` : ''}`).join(', ')}.`
          : `No social accounts are connected yet — the human connects one from a room's settings before anything can publish; you can still draft and schedule (it publishes once an account is connected).`;
        let postsLine = '';
        if (here.length) {
          const fmt = (s: string | null): string => {
            if (!s) return '—';
            const d = new Date(s);
            return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
          };
          postsLine = `\n\nThe ${here.length} post${here.length === 1 ? '' : 's'} already drafted ${thread ? 'on this task' : 'in this conversation'}, and their LIVE state right now:\n` + here.map((it, i) =>
            `${String.fromCharCode(97 + i)}) [${it.platform}] ${it.status}${it.status === 'scheduled' ? ` → ${fmt(it.scheduled_at)}` : ''} — "${it.body.slice(0, 60)}${it.body.length > 60 ? '…' : ''}"`,
          ).join('\n');
        }
        // the human's clock, not UTC: a "9am" ask must land at 9am LOCAL. Hand the model today's date
        // AND the local offset so the ISO it passes carries the right zone (the live test caught rex
        // scheduling "9am" as 09:00Z → 2am on the card).
        const nowD = new Date();
        const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const offMin = nowD.getTimezoneOffset(); // minutes to ADD to local to reach UTC (e.g. 420 for UTC-7)
        const offStr = `${offMin <= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offMin) / 60)).padStart(2, '0')}:${String(Math.abs(offMin) % 60).padStart(2, '0')}`;
        const todayStr = nowD.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        marketingSchedulingContext = `\n\n[SOCIAL POSTS — NeuraMesh drafts, schedules AND publishes natively. You do NOT need Buffer, Hootsuite, Zapier, or any external scheduler, and you must never tell the human to use one. How it works: you hand over drafts with draft_posts (they render as review cards right in the thread); a post is SCHEDULED when the human approves its card (that sets its slot); NeuraMesh's publish pass then posts it at that slot through the connected account, with no human at publish time. ${connLine}${postsLine}\n\nToday is ${todayStr} in the workspace's LOCAL timezone ${localTz} (UTC${offStr}). Times are LOCAL, never UTC: to turn a request like "9am tomorrow" into the ISO schedule_posts expects, attach THIS local offset — e.g. a 9am slot is \`...T09:00:00${offStr}\`, so 9am means 9am for the human, not 9am UTC. When the human asks you to schedule / re-time / move / unschedule posts, USE the schedule_posts (sets or changes slots) or unschedule_posts (pulls from the queue) tools — each PROPOSES the change as a confirmation card the human approves (nothing publishes without their approval, so the card is the gate). To move an already-scheduled post to a new time, call schedule_posts with its letter + the new local ISO time. If posts are already scheduled, tell the human their current slots (listed above) instead of claiming you can't schedule.]`;
      }
    }

    // X RESEARCH — the other half of the capability split, and the one that has to say NO out
    // loud. A live run fanned four legs at "X engagement research for @handle" with nothing but
    // WebSearch/WebFetch, hit x.com's 402 login wall, and filed follower-count guesses labelled
    // "high reach". Reads are a SEPARATE credential from the publish connector (BYOK, this
    // machine only), so the prompt states which one exists rather than letting the agent infer
    // capability from the word "connected". Silent when neither is set up — an engineering room
    // that never touches X pays nothing for this.
    // The connected account IS the read capability now — `search_x` is an nm tool on every
    // orchestrator transport (it calls our own API), so unlike the retired MCP path this needs
    // no runtime gate: a codex/agy orchestrator gets the same tool the anthropic one does.
    const xResearchContext = xResearchNote(xPublishConnected);

    // ROUTINE wakes (0119 · 2026-08-19, founder report): a thread an automation opened runs
    // HANDS-OFF — the server births any task from it pre-approved (no plan gate, auto-accept on
    // done, a "finished" push). The turn must know, or rex phrases its digest as "awaiting your
    // review" for a gate that will never exist. Appended, not a ${var}, same contract-age rule
    // as xResearchContext above.
    const [routineRow] = convoThreadId
      ? await db.getAll<{ schedule_id: string | null }>('select schedule_id from threads where id = ?', [convoThreadId]).catch(() => [] as Array<{ schedule_id: string | null }>)
      : [];
    const routineContext = routineRow?.schedule_id
      ? `\n\n[ROUTINE RUN — this conversation was opened by a scheduled automation, and it runs HANDS-OFF: any task you create here starts immediately (the plan is auto-approved, a declared design round is auto-approved the moment the designer proposes it, review still runs, and the human is notified when it finishes — they are NOT in the loop). Create the tracked work with a full plan and a pre-named owner, phrase your reply as "started", and never ask for approval or say you are waiting on review.]`
      : '';

    // THE CONTRACT, not a literal. defaults/agents/orchestrator.yaml is the authoritative
    // statement of this agent's behaviour; this reads it. A machine-local copy overrides it
    // (contracts.ts). If the file is missing or unreadable the turn still runs — composePrompt
    // gets an empty block rather than the process dying over a prompt file.
    const contract = contractFor(agent.name, 'orchestrator');
    const powers = contract?.prompt?.['powers'] ?? '';

    const style = contract?.prompt?.['style'] ?? '';

    // conversation threads carry a provisional heuristic title until the orchestrator
    // names them — the instruction rides only on convo wakes (the tool is gated the same)
    const convoNamer = convoThreadId
      ? `\n\nThis exchange lives in a conversation thread whose provisional title is the human's first message, near-verbatim. Once you understand the topic — normally in this first reply — call set_thread_title ONCE with a clean 2–6 word title (what it's ABOUT, e.g. "Backlog check-in", never their words echoed back), plus a one-line description when the title alone is thin. Don't rename it again unless the human asks.`
      : '';

    // team skills the orchestrator can fold into how it scopes/routes work — the LIST only
    // (load_skill returns the full body on demand). One tight line each, capped: the uncapped
    // list ran to ~8.5K chars in a seeded #build room — the 3rd-largest item in every turn —
    // and a 300-char description is a pitch, not an index entry (2026-08-18 diet).
    const skillsNote = skills.length
      ? `\n\nTeam skills in #${ch.slug} — scan; when one fits, load_skill it and fold its guidance into what you write:\n${skills
          .slice(0, 24)
          .map((s) => `- ${s.name}${s.pack_name ? ` (${s.pack_name})` : ''} — ${(s.description ?? '').slice(0, 90)}`)
          .join('\n')}${skills.length > 24 ? `\n(+${skills.length - 24} more via load_skill)` : ''}`
      : '';

    // APPENDED, not a ${var}: the channel template can come from a synced baseline or a
    // machine-local overlay (agentcontract precedence), and composePrompt leaves an unknown
    // placeholder in the prompt as literal text — so a new var would either render nothing or
    // leak "${xResearchContext}" on any machine whose contract predates it. A capability
    // statement has to be true on every machine, so it rides outside the template.
    const channelPrompt = composePrompt(contract?.prompt?.['channel'] ?? '', {
      'agent.name': agent.name, 'ch.slug': ch.slug, projLine, powers, style,
      skillsNote, convoNamer, marketingNote, marketingSchedulingContext,
      HIRE_CARD_SPEC,
    }) + xResearchContext + routineContext;

    // the task-thread turn is a contract block too (2026-08-18) — behaviour that cannot be read
    // cannot be reviewed, which is how the old literal kept a retired tool name for a week.
    // xResearchContext is APPENDED for the same contract-age reason as the channel prompt above.
    const threadPrompt = thread
      ? composePrompt(contract?.prompt?.['thread'] ?? '', {
          'agent.name': agent.name, 'ch.slug': ch.slug, projLine,
          'thread.number': String(thread.number), 'thread.title': thread.title, 'thread.state': thread.state,
          powers, style, skillsNote, marketingSchedulingContext,
        }) + xResearchContext
      : channelPrompt;

    // Decoupled by provider: dispatch the SAME tool registry to the matching in-process transport.
    // The token is whatever resolveToken returned for the agent's provider (our free GEMINI_API_KEY
    // by default for a Gemini orchestrator; the user's subscription/key once they change the model).
    const args: OrchTransportArgs = {
      model: agent.model, token, systemPrompt: styled(threadPrompt), transcript, tools: otools, log, attachments, onDelta,
      // The turn used to run in os.tmpdir() with no file tools at all, which is why an
      // orchestrator asked to write a document truthfully said it could not. This is the SAME
      // directory its subagents work in (ensureChatWorkspace), so a file a leg produces is one
      // the orchestrator can read back and save with write_library_doc.
      cwd: ensureChatWorkspace(convoThreadId ?? thread?.id ?? ch.id),
    };
    return dispatchOrchestrator(agent, args);
  }

  return { orchestratorTurn };
}
