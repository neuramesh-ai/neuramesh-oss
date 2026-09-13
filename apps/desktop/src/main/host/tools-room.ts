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


import type { OrchTool, ToolCtx } from './orchtools';

export function roomTools(tc: ToolCtx): OrchTool[] {
  const { z, db, post, ch, agent, actor, thread, convoThreadId, log,
          filed, roomMenu, siblings,
          executeHire } = tc;
  return [
    ...(convoThreadId ? [{
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
    // Auto-filing (0109). Offered ONLY on a conversation that could actually be filed, so the
    // model never sees a tool that would refuse it: a task thread's room is bound, and one
    // agent move per thread is the cap (a second is two triage turns disagreeing, and rex wakes
    // on every message). The server re-checks all of it through the same pure gate.
    ...(convoThreadId && !thread && siblings.length > 1 ? [{
      name: 'file_conversation',
      description: `Move THIS conversation into the room it belongs in — at most once, as your FIRST action, and only on a clear match; unsure means leave it (staying put is a correct answer, and you cannot re-file later). Any task you create afterwards files into the room you moved to. This project's rooms: ${roomMenu || `#${ch.slug}`}. You are currently in #${ch.slug}.`,
      schema: {
        channel: z.string().min(1).describe('the destination room\'s slug from the list in this tool\'s description — it must be in this project'),
        reason: z.string().min(1).max(200).describe('ONE clause, for the human, saying why this room — e.g. "a bug in the channel watch, and #dev owns the sync surface". It shows next to Undo, so write something they can disagree with.'),
      },
      run: async (input: { channel: string; reason: string }) => {
        const want = String(input.channel).replace(/^#/, '').trim().toLowerCase();
        // resolve within THIS project only — every project is seeded with the same starter
        // slugs, so a bare `dev` names two rooms across a workspace (the docs/32 collision)
        const [target] = await db.getAll<{ id: string; slug: string }>(
          `select c.id, c.slug from channels c
            where c.workspace_id = ?
              and lower(c.slug) = ?
              and c.project_id is not distinct from (select project_id from channels where id = ?)`,
          [ch.workspace_id, want, ch.id],
        );
        if (!target) return `error: no room called #${want} in this project — call list_channels and use a slug from it, or leave the conversation where it is`;
        const res = await post('/v1/commands', actor, {
          type: 'thread.move', workspace: ch.workspace_id, threadId: convoThreadId, channel: target.id, reason: input.reason,
        });
        const body = (await res.json()) as any;
        if (!res.ok) {
          // SAME_CHANNEL is an answer, not a failure — say so plainly so the model moves on
          // rather than retrying a move that already holds
          if (body.code === 'SAME_CHANNEL') return `already in #${target.slug} — nothing to file, carry on`;
          return `error ${res.status}: ${body.message ?? body.code ?? 'thread.move failed'} — leave it where it is and carry on`;
        }
        filed.to = { id: target.id, slug: target.slug };   // rebinds the turn (see `here()`)
        log?.({ kind: 'lifecycle', phase: 'triage', summary: `filed the conversation into #${target.slug} — ${input.reason}` });
        return `filed into #${target.slug}. Any task you create now lands there too. Tell the human WHERE you filed it and why, in one clause, as part of your reply.`;
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
    { name: 'create_project', description: 'Create a project — an initiative with its own board, tasks, repos, and channels (each channel belongs to exactly one project; a new project starts with its own fresh general/dev/research/marketing rooms). ALWAYS CONFIRM FIRST: post an nmq card ("Start a new project “XYZ”?" → Create / Not now) and call this ONLY after the human approves it; if they decline, file the work in an existing project.', schema: {
      name: z.string().min(1).describe('the project name — a big initiative, e.g. "XYZ mobile app" (not a single page)'),
      rooms: z.array(z.string()).optional().describe('room names to create FRESH in the new project (default: general, dev, research, marketing) — each project gets its OWN rooms; nothing is moved out of other projects'),
      description: z.string().optional().describe('a short description of the initiative'),
    }, run: async (input) => {
      const rooms = input.rooms?.length ? input.rooms : ['general', 'dev', 'research', 'marketing'];
      const res = await post('/v1/commands', actor, { type: 'project.create', workspace: ch.workspace_id, name: input.name, ...(input.description ? { description: input.description } : {}), channels: [], newChannels: rooms });
      const body = (await res.json()) as any;
      if (!res.ok) return `error ${res.status}: ${body.message ?? body.code ?? 'project.create failed'}`;
      for (let i = 0; i < 20; i++) {
        const [p] = await db.getAll<{ id: string }>(`select id from projects where id = ?`, [body.projectId]);
        if (p) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      return `created project “${input.name}” (slug "${body.slug}") with fresh rooms ${rooms.map((c: string) => `#${c}`).join(', ')} — tasks in its rooms roll up to it`;
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
