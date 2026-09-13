// The READ tools — what the orchestrator can look up before it decides (docs/harness/04).
//
// Read before you decide. list_library outranks the open web for anything about this product,
// which is why its description says so at the point of use.
//
// Split out of host/orchtools.ts. Each group is a function of the TURN's context — the room, the
// agent, the thread it is answering in, the seat it was granted — because a tool that closed over
// a previous turn's seat would spend the wrong credential.

import { MAX_LEGS, normalizeLegs } from '../runs';

import type { OrchTool, ToolCtx } from './orchtools';
import { searchXText } from './searchx';

export function contextTools(tc: ToolCtx): OrchTool[] {
  const { z, db, post, ch, agent, actor, thread, convoThreadId, deepWorkToken, log, skills,
          
          apiGet, brain, libraryDocs,
          startDeepWork, subjectFor, workspaceListing, workspaceRead } = tc;
  return [
    // `description` is what makes this a STAFFING picture rather than a headcount: without it
    // every developer in the workspace looks identical and the ladder can only reason about
    // role names, so "does anyone here fit?" was unanswerable and hiring looked cheap. It is
    // the agent's own routing string (0110), capped at 280 server-side precisely because it
    // rides this list on every staffing turn.
    { name: 'list_agents', description: 'The staffing picture: agents registered to this channel (your fan-out scope), workspace agents in OTHER rooms (prefer ADDING one of these — the add card — over hiring a duplicate), and retired names (re-registering one of those REHIRES that agent with its history). Each carries a `description` saying what it does and when to route work to it — READ THOSE before you decide: a hire is only justified when no existing agent\'s description covers the work. Check this before proposing any hire.', schema: {}, run: async () => {
      const inChannel = await db.getAll(`select a.name, a.role, a.model, a.status, a.description from agents a join agent_channels ac on ac.agent_id = a.id where ac.channel_id = ? and a.id != ? and a.retired_at is null`, [ch.id, agent.id]);
      const elsewhere = await db.getAll(
        `select a.name, a.role, a.description from agents a where a.workspace_id = ? and a.id != ? and a.retired_at is null and a.id not in (select agent_id from agent_channels where channel_id = ?) order by a.name`,
        [ch.workspace_id, agent.id, ch.id],
      );
      const retired = await db.getAll(`select a.name, a.role, a.description from agents a where a.workspace_id = ? and a.retired_at is not null order by a.name limit 20`, [ch.workspace_id]);
      // drop null descriptions rather than shipping `"description": null` on every row — an
      // agent that predates 0110 (or whose backfill found nothing) lists as role alone, which
      // is exactly the old behaviour and never a broken-looking field
      const trim = <T extends { description?: string | null }>(rows: T[]): Array<Omit<T, 'description'> & { description?: string }> =>
        rows.map(({ description, ...rest }) => ({ ...rest, ...(description ? { description } : {}) }));
      return JSON.stringify({ in_channel: trim(inChannel as never), workspace_not_in_this_channel: trim(elsewhere as never), retired_names: trim(retired as never) });
    } },
    { name: 'list_repos', description: 'Repositories in this workspace that tasks can target. `checked_out_at` is a path on THIS machine when the repo has a local checkout — the code is readable there, so answer questions about what the product actually does from it rather than guessing or searching the web for a same-named product.', schema: {}, run: async () => {
      // local_path is what makes "check the repo" answerable rather than a shrug: the column
      // already exists and the daemon already resolves it for the marketing bootstrap.
      const rows = await db.getAll<{ org_name: string; name: string; default_branch: string; local_path: string | null }>(
        `select org_name, name, default_branch, local_path from repos where workspace_id = ?`, [ch.workspace_id],
      );
      const { existsSync } = await import('node:fs');
      return JSON.stringify(rows.map((r) => ({
        org_name: r.org_name, name: r.name, default_branch: r.default_branch,
        ...(r.local_path && existsSync(r.local_path) ? { checked_out_at: r.local_path } : {}),
      })));
    } },
    { name: 'list_library', description: 'The documents in a room\'s library \u2014 brand guidelines, business profile, market research, strategy notes, reports the team has produced. Check this BEFORE answering anything about what the product is, who it is for, or how the team talks about it, and before routing work that depends on any of that. Defaults to THIS room; widen with scope when the record you need was written elsewhere (brand voice lives in #marketing even when you are working in #build). Returns names, rooms and sizes; read one with read_library_doc.', schema: {
      scope: z.enum(['room', 'project', 'workspace']).optional().describe("'room' (default) = this room's shelf \u2014 the ACL you are registered to. 'project' = every room in this project. 'workspace' = everything the team keeps. Widen only when you actually need it: a wider list is a longer list, not a better one."),
    }, run: async (input) => {
      const scope = (input?.scope as 'room' | 'project' | 'workspace' | undefined) ?? 'room';
      const docs = await libraryDocs(ch.id, 60, scope);
      if (!docs.length) return scope === 'room' ? 'this room\'s library is empty \u2014 try scope:\'project\' or scope:\'workspace\'' : `no documents in this ${scope}`;
      return JSON.stringify(docs.map((d) => ({
        name: d.name, kind: d.kind, promoted: !!d.promoted,
        ...(scope === 'room' ? {} : { room: d.room, project: d.project }),
        // an image has no words to count — saying so here stops a model asking to read it as text
        ...((d.mime ?? '').startsWith('image/')
          ? { readable: false, note: 'image \u2014 not readable as text' }
          : { words: (d.inline_content ?? '').split(/\s+/).filter(Boolean).length }),
        added: d.created_at,
      })));
    } },
    { name: 'list_workspace', description: 'What THIS conversation (or task thread) has already accumulated in its own working directory: the files agents produced here, the working notes earlier agents left for whoever came next, and what your subagents already reported. Check it before answering "what have we got", before re-running research, and before fanning out — the answer is often already on disk. Room-wide documents are a different shelf: use list_library for those.', schema: {}, run: async () => {
      const subject = subjectFor({ thread, convoThreadId });
      if (!subject) return 'this turn is not inside a conversation or task thread, so it has no working directory — use list_library for the room\'s documents';
      const b = brain.open(subject);
      const files = workspaceListing(subject);
      const notes = b.notes().map((n) => n.name);
      const results = b.messages().filter((m) => m.kind === 'result').length;
      if (!files.length && !notes.length && !results) return 'nothing here yet — this subject has produced no files, notes or subagent results';
      return JSON.stringify({
        files: files.map((f) => ({ name: f.name, bytes: f.bytes, modified: f.modified })),
        notes,
        subagent_results: results,
        turns_run: b.index().turns.length,
      });
    } },
    { name: 'read_workspace_file', description: 'Read a file this conversation produced, by name (get the names from list_workspace). Use it to answer from what the team actually wrote rather than from the transcript\'s summary of it — and before asking a teammate to redo work that is already sitting here.', schema: {
      name: z.string().min(1).describe('the exact file name from list_workspace'),
    }, run: async (input) => {
      const subject = subjectFor({ thread, convoThreadId });
      if (!subject) return 'this turn is not inside a conversation or task thread, so it has no working directory';
      const r = workspaceRead(subject, String(input.name));
      if (!r.ok) return r.error;
      log?.({ kind: 'tool', phase: 'call', summary: `read_workspace_file ${String(input.name)}` });
      return r.body;
    } },
    { name: 'read_library_doc', description: 'Read a document from a room\'s library by name (get the names from list_library). This is the team\'s OWN record \u2014 it outranks anything you find on the open web, so when a question is about this product or brand, read the doc rather than searching for a same-named product elsewhere. Pass the same scope you listed with.', schema: {
      name: z.string().min(1).describe('the exact document name from list_library, e.g. brand-guidelines.md'),
      scope: z.enum(['room', 'project', 'workspace']).optional().describe('the scope you found the name in \u2014 must match the list_library call, or the name will not resolve'),
    }, run: async (input) => {
      const want = String(input.name);
      const scope = (input.scope as 'room' | 'project' | 'workspace' | undefined) ?? 'room';
      const docs = await libraryDocs(ch.id, 60, scope);
      const hit = docs.find((d) => d.name === want) ?? docs.find((d) => d.name.toLowerCase() === want.toLowerCase());
      if (!hit) return `no document named "${want}" in this ${scope} \u2014 call list_library${scope === 'room' ? ' (or widen it with scope)' : ` with scope:'${scope}'`} for the names`;
      log?.({ kind: 'tool', phase: 'call', summary: `read_library_doc ${hit.name}` });
      const body = hit.inline_content ?? '';
      // An image's `inline_content` is a data URI, not prose. Returning it raw spent the turn's
      // context on base64; returning '' let the model report the document as empty. Say what it
      // is instead, so the agent reports the limit rather than inventing the contents.
      if ((hit.mime ?? '').startsWith('image/') || body.startsWith('data:image')) {
        return `"${hit.name}" is an image (${hit.mime ?? 'image'}), not a text document \u2014 it cannot be read as text. It is in the library and a human can view it.`;
      }
      if (!body.trim()) return `"${hit.name}" is in the library but has no readable text body.`;
      // capped so one long report cannot eat the turn's context; the model is TOLD it was cut
      return body.length > 24_000 ? `${body.slice(0, 24_000)}\n\n\u2026(truncated \u2014 this document is ${body.length} characters)` : body;
    } },
    // The library was READ-ONLY to every agent: list_library + read_library_doc and no writer,
    // and no library command on the server either. So an orchestrator asked to update
    // brand-guidelines.md correctly reported it had no way to — and then proposed ADDING a
    // developer to the room, which would not have helped, because nobody had a write path.
    //
    // Writing is a PROPOSAL, not a save. `artifact.create` leaves the row unpromoted, and
    // `promoted` is what the human's Library view actually shows — so a draft lands in chat as a
    // readable card and only the human's Approve promotes it. The agent gets the pen; the human
    // keeps the shelf.
    { name: 'propose_library_doc', description: 'Write a document and PROPOSE it for this room\'s library — anything the room should keep (guidelines, frameworks, research, conventions). It posts the full document into the thread with an Approve button; nothing shelves until the human approves. The SAME name REPLACES that document on approval — to extend one, read_library_doc first and propose the FULL merged text, never a fragment. Producing documents is yours to do directly. NOT for a diagram — that is create_whiteboard, a real board, not a mermaid fence on a shelf.', schema: {
      name: z.string().min(1).max(200).describe('the document name, e.g. messaging-framework.md — an existing name REPLACES that document on approval'),
      title: z.string().min(1).max(80).describe('a short human title for the card, e.g. "Messaging framework"'),
      content: z.string().min(1).max(300_000).describe('the FULL markdown body. When updating, this must be the complete merged document, not just the new section.'),
    }, run: async (input) => {
      const name = String(input.name).trim();
      const existing = (await libraryDocs(ch.id)).find((d) => d.name.toLowerCase() === name.toLowerCase());
      log?.({ kind: 'tool', phase: 'call', summary: `propose_library_doc ${name}${existing ? ' (replaces)' : ''}` });
      const res = await post('/v1/commands', actor, {
        type: 'artifact.create', channel: ch.id, kind: 'doc', name,
        inlineContent: String(input.content), mime: 'text/markdown',
      }).catch(() => null);
      if (!res?.ok) {
        const body = (await res?.json().catch(() => ({}))) as { error?: string; code?: string } | undefined;
        return `error: could not draft "${name}" — ${body?.error ?? body?.code ?? 'the write was rejected'}`;
      }
      // the doc-drop card shape (docDropParts in App.tsx): header line, blank line, full body.
      // "proposed for" rather than "saved to" is what makes the card render its Approve button.
      await post('/v1/messages', actor, {
        workspace: ch.workspace_id, channel: ch.id,
        // `thread` here is the TASK ({id, number, title, state}), not a thread row — every other
        // tool in this registry posts to it with taskId (see schedule_posts). Passing its id as
        // threadId named a thread that does not exist, and the server CREATES a missing thread
        // and titles it from the message body (pgstore.ts) — so every proposal spawned its own
        // session named after the document, which is what looked like duplicate threads per task.
        ...(convoThreadId ? { threadId: convoThreadId } : thread?.id ? { taskId: thread.id } : {}),
        body: `📄 **${String(input.title).trim()}** — proposed for the library as \`${name}\`.\n\n${String(input.content)}`,
      }).catch(() => {});
      log?.({ kind: 'tool', phase: 'result', summary: `proposed ${name} (${String(input.content).length} chars)` });
      return `"${name}" is drafted and posted in the thread as a card for approval${existing ? ` — it REPLACES the current version (${existing.inline_content?.length ?? 0} characters) once approved` : ''}. Do NOT claim it is in the library: say it is waiting for their approval, and keep your reply to one line since the document itself is already on screen.`;
    } },
    { name: 'list_projects', description: 'The project this room belongs to (this_room: 1 — a task created here files under it automatically) with its rooms, plus the workspace\'s other active projects for context.', schema: {}, run: async () => {
      // channels → projects is 1:N (channels.project_id); the old per-channel projects.channel_id
      // column no longer exists in the model, so resolve through the channel row.
      const rows = await db.getAll(
        `select p.name, p.slug, p.is_default, case when p.id = c.project_id then 1 else 0 end as this_room,
                (select group_concat('#' || c2.slug, ' ') from channels c2 where c2.project_id = p.id) as rooms
           from projects p join channels c on c.id = ?
           where p.workspace_id = c.workspace_id and coalesce(p.status, 'active') != 'archived'
           order by this_room desc, p.is_default desc, p.name`,
        [ch.id],
      );
      return JSON.stringify(rows);
    } },
    { name: 'recall', description: 'Search workspace memory — channel history by meaning and keywords.', schema: { query: z.string().min(2).describe('what to look for') }, run: async (input) => {
      const res = await post('/v1/recall', actor, { workspace: ch.workspace_id, query: input.query, k: 6 });
      if (!res.ok) return `recall failed (${res.status})`;
      const { hits } = (await res.json()) as { hits: Array<{ body: string; channel: string; createdAt: string }> };
      if (!hits.length) return 'no matches in workspace memory';
      return hits.map((h) => `[#${h.channel} ${h.createdAt.slice(0, 10)}] ${h.body.slice(0, 240)}`).join('\n---\n');
    } },
    // Reading X on the room's own connection (2026-08-09). The numbers this returns are the
    // REAL ones from X — which is the point: the run this replaced hit x.com's 402 login wall
    // and filed follower-count guesses labelled "high reach". No connection, no tool result
    // to launder: it says so, and the agent must say so too.
    { name: 'search_x', description: 'Search X (Twitter) for recent posts — the LAST 7 DAYS of public posts, with their real author handles and real engagement numbers (likes, reposts, replies). Use this for ANY question about what is being said on X: finding posts to reply to, gauging a topic, checking whether a handle is active. It reads through the room\'s connected X account, server-side. Do NOT answer X questions from WebSearch/WebFetch instead — x.com blocks unauthenticated reads, so those produce guesses; this returns facts or an honest failure. Reads are metered against the connected account, so search deliberately, with a specific query.', schema: {
      query: z.string().min(2).max(400).describe('an X search query — supports X operators, e.g. `"ai agents" -is:retweet lang:en` or `from:handle`'),
      max: z.number().int().min(10).max(25).optional().describe('how many posts to return (10–25, default 10)'),
    }, run: async (input) => {
      log?.({ kind: 'tool', phase: 'call', summary: `search_x ${input.query.slice(0, 60)}` });
      // ONE implementation (host/searchx.ts) — the chat registry and worker legs read the same
      return searchXText(apiGet, actor, { workspaceId: ch.workspace_id, channelId: ch.id }, input.query, input.max);
    } },
    { name: 'load_skill', description: 'Load the full body of a team Agent Skill by name — call it when a skill listed for this channel looks relevant to how the work should be scoped or routed, then fold it into the task description / checklist you create.', schema: { name: z.string().describe('the skill name from the available-skills list') }, run: async (input) => {
      const sk = skills.find((x) => x.name === input.name);
      if (!sk) return `no active skill named "${input.name}" — check the available-skills list`;
      log?.({ kind: 'tool', phase: 'call', summary: `load_skill ${input.name}` });
      return `# Skill: ${sk.name}\n${sk.description}\n\n${sk.body}`;
    } },
    { name: 'start_deep_work', description: 'Start research that OUTLIVES this reply — the only way to keep working after your turn ends. Use it when the human asks for something that genuinely needs searching and reading around (market/competitor research, "what does the evidence say", a landscape scan), and NOT for anything you can answer now or that belongs to a teammate (if a worker in this room fits the ask, create_task with offerTo instead — that gets a board card, a plan gate, beats and review). Fans out 2–6 named angles in parallel, shows every angle live in the thread while it works, and POSTS THE REPORT HERE ITSELF when done — you do not have to be alive for that. Never claim background work without calling this.', schema: {
      title: z.string().min(1).describe('what this work IS, in the human\'s words — it becomes the card they watch, e.g. "Research: how to improve Flowe"'),
      legs: z.array(z.object({
        name: z.string().min(1).describe('the angle in 2–5 human words, e.g. "user reviews & complaints" — never an identifier'),
        prompt: z.string().min(1).describe('the full standalone brief for this angle: what to find out, and what a useful answer contains. The researcher sees ONLY this.'),
      })).min(1).max(MAX_LEGS).describe(`2–${MAX_LEGS} angles that genuinely differ — searching the same thing five ways is five times the cost and one answer`),
    }, run: async (input) => {
      const legs = normalizeLegs(input.legs);
      if (!legs.length) return 'error: no usable angles — each leg needs a short name and a standalone prompt';
      const id = await startDeepWork(agent, ch, { threadId: convoThreadId ?? null, taskId: thread?.id ?? null }, input.title, legs, deepWorkToken);
      if (!id) return 'error: could not open the run — do NOT tell the human work is running; answer with what you know now';
      log?.({ kind: 'tool', phase: 'inject', summary: `deep work opened: ${input.title} (${legs.length} legs)` });
      return `deep work started — ${legs.length} angle${legs.length === 1 ? '' : 's'} running (${legs.map((l) => l.name).join(', ')}). The card is live in this thread and the report posts here automatically when it lands. Tell the human it's running and what the angles are; do NOT invent an ETA, and never mention run ids or tooling.`;
    } },
  ];
}
