// The ROOM tools — filing a conversation, naming it, and standing up what it needs (docs/harness/04).
//
// Three of these are CONDITIONAL spreads — a tool that does not apply to this turn must not
// exist rather than exist and refuse, because a model reads the inventory, not the guard.
//
// Split out of host/orchtools.ts. Each group is a function of the TURN's context — the room, the
// agent, the thread it is answering in, the seat it was granted — because a tool that closed over
// a previous turn's seat would spend the wrong credential.
import { HIRE_CARD_SPEC } from '../hirecards';
import { AGENT_NAME_RE, HIREABLE_ROLES } from '../hire';
import { kindMarker } from '@neuramesh/shared';


import type { OrchTool, ToolCtx } from './orchtools';

export function roomTools(tc: ToolCtx): OrchTool[] {
  const { z, db, post, ch, agent, actor, convoThreadId, log,
          filed, codeDoor, namedBySchedule,
          executeHire } = tc;
  const repoLabel = codeDoor ? (codeDoor.repo.org_name === 'local' ? codeDoor.repo.name : `${codeDoor.repo.org_name}/${codeDoor.repo.name}`) : '';
  return [
    // THE CODE DOOR (0144, door 2 — docs/design/coding-threads-2026-09 §5.1, ruling 1): a conversation
    // that wants hands on the project's repository becomes a CODING thread, and the coding runtime
    // takes its turns from that message on. Offered only while the gates hold (orchtools.ts codeDoor),
    // so the model never sees a tool that would refuse it; the server re-checks every gate
    // (handler/thread.ts thread.set_kind: a task thread and a project with no repository are refused).
    ...(codeDoor && convoThreadId ? [{
      name: 'open_code_session',
      description: `Turn THIS conversation into a coding thread on ${repoLabel}: the coding runtime (Plan mode first; every edit and command asks the human) works on the repository from the human's message on, in this same thread. Use it when the request wants hands on this project's code NOW (read or change it, run its tests) and nothing about the board's bar is true: they did not ask for tracked work, it does not need a PR, review and merge, and it need not outlive this conversation. Call it once, then reply in ONE line saying the code work starts here. Do not answer the request yourself, and never create a task for the same ask.`,
      schema: { reason: z.string().min(1).max(160).describe('ONE clause on why this is code work, for the activity log') },
      run: async (input: { reason: string }) => {
        const res = await post('/v1/commands', actor, { type: 'thread.set_kind', workspace: ch.workspace_id, threadId: convoThreadId, kind: 'coding' });
        const body = (await res.json()) as any;
        if (!res.ok) return `error ${res.status}: ${body.message ?? body.code ?? 'thread.set_kind failed'} — answer the request here instead`;
        // the divider (a record, never a message anyone answers: the daemon skips it, both transcript builders strip it)
        await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: filed.to?.id ?? ch.id, threadId: convoThreadId, body: kindMarker('coding') }).catch(() => null);
        log?.({ kind: 'lifecycle', phase: 'triage', summary: `opened code work on ${repoLabel} — ${input.reason}` });
        return `this is a coding thread on ${repoLabel} now. The coding runtime takes it from here: reply in ONE line saying so, and stop.`;
      },
    }] : []),
    // a schedule's session wears its schedule's title: the server names it and refuses an agent's name
    ...(convoThreadId && !namedBySchedule ? [{
      name: 'set_thread_title',
      description: 'Rename THIS conversation thread. Its provisional title is the human\'s first message, near-verbatim — call this once, early, with a clean 2–6 word topic title: what the conversation is ABOUT, never their words echoed back. Optionally add a one-line description.',
      schema: {
        title: z.string().min(1).max(60).describe('2–6 words, the topic — e.g. "Backlog check-in", "Mobile-nav bug intake"; no trailing punctuation. Plain text only: no markdown, no emoji, no quotes'),
        description: z.string().max(200).optional().describe('one line on what this conversation covers'),
      },
      run: async (input: { title: string; description?: string }) => {
        const res = await post('/v1/commands', actor, { type: 'thread.update', workspace: ch.workspace_id, threadId: convoThreadId, title: input.title, ...(input.description ? { description: input.description } : {}) });
        const body = (await res.json()) as any;
        if (!res.ok) return `error ${res.status}: ${body.error ?? body.message ?? body.code ?? 'thread.update failed'}`;
        log?.({ kind: 'tool', phase: 'result', summary: `thread titled “${input.title}”` });
        return `thread renamed to “${input.title}”`;
      },
    }] : []),
    { name: 'register_repo', description: 'Register a GitHub repo to this workspace WITHOUT proposing/offering a task in the same step (when you are, pass repoUrl to create_task/offer_task instead — it registers + binds atomically). Only register a repo the human actually named (a URL or <org>/<repo>) — never invent one. No tokens are stored — the executing machine\'s own git credentials authenticate at push.', schema: {
      url: z.string().min(1).describe('the public GitHub URL exactly as confirmed by the human, e.g. https://github.com/acme/web'),
      defaultBranch: z.string().optional().describe('default branch (defaults to main)'),
    }, run: async (input) => {
      const res = await post('/v1/commands', actor, { type: 'repo.link', workspace: ch.workspace_id, channel: ch.id, url: input.url, ...(input.defaultBranch ? { defaultBranch: input.defaultBranch } : {}) });
      const body = (await res.json()) as any;
      if (!res.ok) return `error ${res.status}: ${body.message ?? body.code ?? 'repo.link failed'}`;
      let repo: { name: string; org_name: string } | undefined;
      for (let i = 0; i < 20; i++) {
        [repo] = await db.getAll<{ name: string; org_name: string }>(`select org_name, name from repos where id = ?`, [body.repoId]);
        if (repo) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      const m = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(input.url.trim());
      const label = repo ? `${repo.org_name}/${repo.name}` : m ? `${m[1]}/${m[2]}` : input.url;
      const bindName = repo?.name ?? m?.[2] ?? '';
      return `registered ${label}${body.inserted ? '' : ' (already registered)'} — now bind it with repoName "${bindName}" in create_task / offer_task`;
    } },
    { name: 'create_project', description: 'Create a project — an initiative holding threads, tasks, repositories and shared context. ALWAYS CONFIRM FIRST: post an nmq card ("Start a new project “XYZ”?" → Create / Not now) and call this ONLY after the human approves it; if they decline, file the work in an existing project.', schema: {
      name: z.string().min(1).describe('the project name — a big initiative, e.g. "XYZ mobile app" (not a single page)'),
      description: z.string().optional().describe('a short description of the initiative'),
    }, run: async (input) => {
      const res = await post('/v1/commands', actor, { type: 'project.create', workspace: ch.workspace_id, name: input.name, ...(input.description ? { description: input.description } : {}) });
      const body = (await res.json()) as any;
      if (!res.ok) return `error ${res.status}: ${body.message ?? body.code ?? 'project.create failed'}`;
      for (let i = 0; i < 20; i++) {
        const [p] = await db.getAll<{ id: string }>(`select id from projects where id = ?`, [body.projectId]);
        if (p) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      return `created project “${input.name}” (slug "${body.slug}") and it is ready for new threads`;
    } },
    { name: 'add_agent_to_channel', description: 'Register an existing workspace agent into THIS channel so it can see the room and be offered work (agents only see rooms they were added to). When the human EXPLICITLY NAMES who to add → call this directly, once per agent. When YOU are proactively suggesting it → do NOT call this: post an nmq card whose question is EXACTLY "Add @<name> to #<channel>?" with an "Add @<name>" option — a click registers the agent for you, no further call.', schema: {
      agent: z.string().min(1).describe('the agent NAME (or id) to add — a workspace agent not already in this channel'),
    }, run: async (input) => {
      const res = await post('/v1/commands', actor, { type: 'channel.add_agent', workspace: ch.workspace_id, channel: ch.id, agent: input.agent });
      const body = (await res.json()) as any;
      if (!res.ok) {
        // help the model self-correct: list workspace agents not yet in this room (excludes the orchestrator itself)
        const addable = await db.getAll<{ name: string; role: string }>(
          `select a.name, a.role from agents a where a.workspace_id = ? and a.id != ? and a.retired_at is null and a.id not in (select agent_id from agent_channels where channel_id = ?) order by a.name`,
          [ch.workspace_id, agent.id, ch.id],
        ).catch(() => []);
        const hint = addable.length ? ` — agents you can add: ${addable.map((a) => `@${a.name} (${a.role})`).join(', ')}` : '';
        return `could not add @${input.agent}: ${body.message ?? body.code ?? res.status}${hint}`;
      }
      return `added @${input.agent} to #${ch.slug} — it can now see this room and be offered work here`;
    } },
    { name: 'create_agent', description: `Hire a NEW specialist agent into this channel — the LAST rung of the staffing ladder, only when the specialist exists nowhere in the workspace. ALWAYS CONFIRM FIRST: do NOT call this yet — post the hire card and wait. ${HIRE_CARD_SPEC}\n\nCall create_agent ONLY if the human approves in their own words (free text); a clicked accept is executed by the system — if the card already shows its accept answer, the hire is done, do not call this. A retired name rehires that agent with its history intact (say so in the card). Never propose an orchestrator or curator.`, schema: {
      name: z.string().regex(AGENT_NAME_RE).describe('agent name — lowercase letters/digits with . _ -, e.g. "seo-analyst"'),
      role: z.enum(HIREABLE_ROLES).describe('role class: developer for code, worker for research/analysis/reports, reviewer/architect/designer/sales for those functions'),
      // Written for the DISPATCHER, not for a human reader — this is the string YOU will read
      // in list_agents on every future staffing turn. Capability first, then the trigger.
      description: z.string().max(280).optional().describe('ROUTING description (≤280): third person, what this agent does and WHEN to route work to it — e.g. "SEO and competitive analysis with report-style deliverables. Route keyword research, SERP audits and competitor teardowns here." You read this back in list_agents to pick an agent, so write the situations that should reach it, not a job title.'),
      brief: z.string().max(2000).optional().describe("INSTRUCTIONS (≤2000): second person, HOW this agent works — the standing rules injected into every turn it takes, e.g. 'Always cite the source for a ranking claim. Never present an estimate as measured data.'"),
      offerTaskNumber: z.number().int().optional().describe('the waiting task to hand them after the hire (you then call offer_task yourself)'),
    }, run: async (input) => {
      const hired = await executeHire(agent, ch.id, { name: input.name, role: input.role, description: input.description ?? null, brief: input.brief ?? null });
      if (!hired.ok) return `could not hire @${input.name}: ${hired.detail}`;
      const next = input.offerTaskNumber ? ` Now offer_task #${input.offerTaskNumber} to @${input.name.trim().toLowerCase()} with the resolved checklist.` : ' Offer them work with offer_task when ready.';
      if (hired.degradedToAdd) return `@${input.name} (${input.role}) already existed elsewhere in this workspace — added them to #${ch.slug} instead of hiring a duplicate.${next}`;
      return `hired @${input.name.trim().toLowerCase()} (${input.role}) into #${ch.slug}${hired.model ? ` — ${hired.model} via ${hired.runtime}` : ''}${hired.rehired ? ' (rehired — their history is intact)' : ''}.${next}`;
    } },
  ];
}
