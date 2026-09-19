// THE TOOLS A CONVERSATION GETS (docs/34).
//
// Everything board-shaped is absent BY CONSTRUCTION: there is no create_task here to call, so
// "never file work uninvited" is a fact about the inventory rather than an instruction in a
// prompt. The orchestrator alone carries the backlog trio, for the human's explicit "create the
// task" — park-then-promote, the same sanctioned path its triage turns already walk.
//
// Turn-scoped like the orchestrator's registry, and for the same reason: a tool that closed over
// a previous turn's seat or thread would answer in the wrong place. Split out of host/chatturn.ts.




import { type WhiteboardToolClosures } from '../harness/toolbus';
import { WB_CREATE_DESC, WB_LIST_DESC, WB_READ_DESC, WB_UPDATE_DESC } from '../harness/tooldesc';
import { normalizeDraft, parseDraftRevisions } from '@neuramesh/shared';
import { shareChatTools } from './chattools-share';
import { playbookCatalogText } from './tools-playbooks';
import { searchXText } from './searchx';
import { newGrounding, ungrounded, type LibraryReader } from './grounding';
import { unpicked } from './ugcflow';
import { libraryChatTools, ugcChatTools } from './chattools-library';

import type { HostedAgent } from '../agents';
import type { LogFn } from '../agentlog';

import type { HostCtx } from './ctx';
import type { DraftRow } from './orchtools';


type PowerSyncDatabase = import('@powersync/node').PowerSyncDatabase;

export interface ChatToolCtx {
  z: typeof import('zod')['z'];
  tool: typeof import('@anthropic-ai/claude-agent-sdk')['tool'];
  createSdkMcpServer: typeof import('@anthropic-ai/claude-agent-sdk')['createSdkMcpServer'];
  text: (t: string) => { content: Array<{ type: 'text'; text: string }> };
  agent: HostedAgent;
  ch: { id: string; slug: string; workspace_id: string };
  threadId: string;
  log: LogFn;
  // the host services the registry calls — passed, never closed over, so the module is a
  // function of its turn and its dependencies and nothing else
  db: PowerSyncDatabase;
  post: HostCtx['post'];
  apiGet: (path: string, actor: { kind: string; id: string; role?: string }) => Promise<any>;
  recallFor: (workspaceId: string, channelId: string, query: string) => Promise<string>;
  loadSkillBody: (channelId: string, workspaceId: string, name: string) => Promise<string>;
  whiteboardClosures: (actor: { kind: string; id: string; role?: string }, ch: { id: string; workspace_id: string }, at: { taskId?: string; threadId?: string }) => WhiteboardToolClosures;
  draftsForAnchor: (taskId: string | null, threadId: string | null) => Promise<{ posts: DraftRow[]; msgAnchor: { taskId: string } | { threadId: string } } | null>;
  generateDraftImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, itemId: string) => Promise<string>;
  generateShareImage: (agent: HostedAgent, ch: { id: string; slug: string; workspace_id: string }, brief: string) => Promise<{ thumb?: string; error?: string }>;
  /** the room's shelf (host/workspace.ts): the conversation had no way to read it before 2026-09-19 */
  libraryDocs: LibraryReader;
}

export function makeChatTools(t: ChatToolCtx) {
  const { z, tool, createSdkMcpServer, text, agent, ch, threadId, log,
          db, post, apiGet, recallFor, loadSkillBody, whiteboardClosures, draftsForAnchor, generateDraftImage } = t;
  // what this turn has read from the shelf: draft_posts asks it before it writes (host/grounding.ts)
  const grounding = newGrounding();
// The nm tools a CONVERSATION gets. Everything board-shaped is absent by construction for
// every seat but one — there is no create_task here (or anywhere) to call, so "never file
// work uninvited" is a fact, not an instruction. The ORCHESTRATOR carries the backlog trio
// below for the human's explicit "create the task" (docs/34 §14 as amended 2026-08-10);
// park-then-promote is the same sanctioned path its triage turns already walk.
// Whiteboards are NOT board-shaped (docs/38): a sketch is content, and "sol, draw the
// pipeline" is exactly a conversation's ask — so the four board tools ride along.
const wb = whiteboardClosures({ kind: 'agent', id: agent.id, ...(agent.role ? { role: agent.role } : {}) }, ch, { threadId });
const nm = createSdkMcpServer({
  name: 'nm',
  tools: [
    tool(
      'recall',
      'Search this workspace\'s memory — past decisions, people, and work in this room. Use it whenever the question touches something the team has already settled, so you answer from the record instead of from guesswork.',
      { query: z.string().min(1).describe('what you are trying to remember, in plain words') },
      async (i) => text(await recallFor(ch.workspace_id, ch.id, String(i.query))),
    ),
    tool(
      'load_skill',
      'Load a team skill\'s full procedure by name — how this team likes a particular kind of work done.',
      { name: z.string().min(1) },
      async (i) => text(await loadSkillBody(ch.id, ch.workspace_id, String(i.name))),
    ),
    ...libraryChatTools(t, grounding),
    ...ugcChatTools(t, grounding),
    tool(
      'list_playbooks',
      'The marketing playbook catalog (marketing-os) joined to this room\'s state — consult it before improvising on a marketing ask. Light flows you answer here after load_skill; heavy ones you describe and let the human ask rex to run.',
      {},
      async () => text(await playbookCatalogText(db, ch.id)),
    ),
    tool(
      'create_whiteboard',
      WB_CREATE_DESC,
      {
        title: z.string().min(1).max(200).describe('a short name for the board'),
        mermaid: z.string().min(1).max(100_000).optional().describe('mermaid source — flowchart/sequence/class arrive as EDITABLE shapes'),
        elements: z.string().min(1).max(200_000).optional().describe('an Excalidraw element-skeleton JSON array AS A STRING'),
      },
      async (i) => {
        if (!i.mermaid === !i.elements) return text('provide exactly one of `mermaid` or `elements`');
        const r = await wb.create({ title: String(i.title), ...(i.mermaid ? { mermaid: String(i.mermaid) } : {}), ...(i.elements ? { elements: String(i.elements) } : {}) });
        log({ kind: 'tool', phase: 'call', summary: `create_whiteboard "${String(i.title).slice(0, 60)}"${r.ok ? '' : ' (failed)'}`, level: r.ok ? 'info' : 'warn' });
        return text(r.ok ? `whiteboard "${i.title}" created (id ${r.id}) — its card is in this conversation; humans can open and edit it` : `create failed: ${r.error ?? 'error'}`);
      },
    ),
    tool(
      'update_whiteboard',
      WB_UPDATE_DESC,
      {
        id: z.string().min(1),
        baseRev: z.number().int().min(1).describe('the rev you READ this turn'),
        title: z.string().min(1).max(200).optional(),
        mermaid: z.string().min(1).max(100_000).optional(),
        elements: z.string().min(1).max(200_000).optional(),
      },
      async (i) => {
        if (i.mermaid && i.elements) return text('provide at most one of `mermaid` or `elements`');
        const r = await wb.update({ id: String(i.id), baseRev: Number(i.baseRev), ...(i.title ? { title: String(i.title) } : {}), ...(i.mermaid ? { mermaid: String(i.mermaid) } : {}), ...(i.elements ? { elements: String(i.elements) } : {}) });
        return text(r.ok ? `whiteboard updated to rev ${r.rev}` : `update refused: ${r.error ?? 'error'}`);
      },
    ),
    tool(
      'list_whiteboards',
      WB_LIST_DESC,
      { all: z.boolean().optional() },
      async (i) => {
        const r = await wb.list({ all: i.all === true });
        return text(r.ok ? r.lines ?? '(none)' : `list failed: ${r.error ?? 'error'}`);
      },
    ),
    tool(
      'read_whiteboard',
      WB_READ_DESC,
      { id: z.string().min(1) },
      async (i) => {
        const r = await wb.read({ id: String(i.id) });
        return text(r.ok ? r.text ?? '(empty board)' : `read failed: ${r.error ?? 'error'}`);
      },
    ),
    // The BOARD trio — ORCHESTRATOR seat only (the prose-consent round, 2026-08-10; docs/34
    // §14 amended). "yes create the task" typed in a chat used to dead-end in another
    // proposal card, because the conversation registry had no road to the board at all.
    // The road that opens is the SAME one every agent creation already walks: park on the
    // backlog (task.create backlog:true — the one agent creation path) and promote (the
    // privilege only rex and humans hold), so the board-side triage takes it from there.
    // What has NOT changed: create_task still exists nowhere, no other role gets these in a
    // conversation, and the server's CHAT_THREAD floor still refuses any task pinned to this
    // thread — a chat can carry an instruction to the board; it cannot BECOME the board.
    ...(agent.role === 'orchestrator' ? [
      tool(
        'list_backlog',
        'Parked ideas on this channel\'s backlog. Check it before parking a new one — duplicates waste a human\'s promote.',
        {},
        async () => {
          const rows = await db.getAll(`select t.number, t.title, substr(t.description, 1, 200) as description from tasks t where t.channel_id = ? and t.state = 'backlog' order by t.number desc limit 50`, [ch.id]);
          return text(rows.length ? JSON.stringify(rows) : 'the backlog is empty');
        },
      ),
      tool(
        'add_backlog_item',
        'Park an idea from this conversation on the channel backlog — ONLY when the human explicitly asks for work to be captured or created ("create the task", "put it on the board", "add it to the backlog"). Distill the conversation into the title/description; the item stays parked until promoted. Never call this on your own initiative in a conversation — an unasked capture is what the proposal card is for.',
        {
          title: z.string().min(1).max(200).describe('short imperative title'),
          description: z.string().max(4000).optional().describe('what/why, distilled from this conversation — enough to pick up cold'),
        },
        async (i) => {
          const res = await post('/v1/commands', { kind: 'agent', id: agent.id, ...(agent.role ? { role: agent.role } : {}) }, { type: 'task.create', workspace: ch.workspace_id, channel: ch.id, title: String(i.title), backlog: true, ...(i.description ? { description: String(i.description) } : {}) });
          const body = (await res.json().catch(() => ({}))) as { task?: { id: string; number: number; title: string }; error?: string; code?: string };
          log({ kind: 'tool', phase: 'call', summary: `add_backlog_item "${String(i.title).slice(0, 80)}"${res.ok ? ` → #${body.task?.number}` : ' (failed)'}`, level: res.ok ? 'info' : 'warn' });
          if (!res.ok || !body.task) return text(`error ${res.status}: ${body.error ?? body.code ?? 'task.create failed'}`);
          return text(`parked #${body.task.number} “${body.task.title}” on the backlog — promote_backlog_item(${body.task.number}) starts it now that the human asked`);
        },
      ),
      tool(
        'promote_backlog_item',
        'Release a parked backlog item into todo — ONLY on the human\'s explicit say-so in this conversation ("create the task", "start it"). The board-side triage routes it from todo; link the task as #N in your reply so the human can open it.',
        { taskNumber: z.number().int().describe('the backlog item\'s task number') },
        async (i) => {
          const t = (await db.getAll<{ id: string }>(`select id from tasks where channel_id = ? and number = ? and state = 'backlog' limit 1`, [ch.id, Number(i.taskNumber)]))[0];
          if (!t) return text(`error: no parked #${i.taskNumber} in #${ch.slug} (list_backlog shows what is there)`);
          const res = await post('/v1/commands', { kind: 'agent', id: agent.id, ...(agent.role ? { role: agent.role } : {}) }, { type: 'task.promote', taskId: t.id });
          log({ kind: 'tool', phase: 'call', summary: `promote_backlog_item #${i.taskNumber}${res.ok ? ' → todo' : ' (failed)'}`, level: res.ok ? 'info' : 'warn' });
          if (!res.ok) { const b = (await res.json().catch(() => ({}))) as { error?: string; code?: string }; return text(`error ${res.status}: ${b.error ?? b.code ?? 'task.promote failed'}`); }
          return text(`promoted #${i.taskNumber} to todo — it is on the board and triage takes it from here. Name it as #${i.taskNumber} in your reply.`);
        },
      ),
    ] : []),
    // Reading X on the room's connected account — a conversation is exactly where "what are
    // people saying about X on X" gets asked, and the honest answer needs real posts.
    tool(
      'search_x',
      'Search X (Twitter) for recent posts — the LAST 7 DAYS of public posts with their real author handles and real engagement numbers (likes, reposts, replies). Use it for ANY question about what is on X: finding posts to reply to, gauging a topic, checking whether a handle is active. It reads through this room\'s connected X account. Do NOT answer X questions with WebSearch/WebFetch instead — x.com blocks unauthenticated reads, so those produce guesses; this returns facts or an honest failure. Reads are metered, so use a specific query.',
      {
        query: z.string().min(2).max(400).describe('an X search query — supports X operators, e.g. `"ai agents" -is:retweet lang:en` or `from:handle`'),
        max: z.number().int().min(10).max(25).optional().describe('how many posts to return (10–25, default 10)'),
      },
      async (i) => {
        log({ kind: 'tool', phase: 'call', summary: `search_x ${String(i.query).slice(0, 60)}` });
        // ONE implementation (host/searchx.ts) — the orchestrator registry and worker legs read the same
        return text(await searchXText(apiGet, { kind: 'agent', id: agent.id, ...(agent.role ? { role: agent.role } : {}) },
          { workspaceId: ch.workspace_id, channelId: ch.id }, String(i.query), i.max as number | undefined));
      },
    ),
    // Social drafts are content, not board work — the same reasoning whiteboards ride on.
    // A conversation is exactly where "write me three posts for X" is asked, and before this
    // the only honest answer was a file the human could not act on.
    tool(
      'draft_posts',
      'Hand over drafted social posts as REVIEWABLE CARDS in this conversation — the platform-native preview the human approves, schedules, or asks you to change, right here. Use it for ANY "draft/write me posts / captions / a thread" ask. NEVER write a posts.json file and never paste the posts as markdown — a file gives them nothing to click and pasted prose gives them nothing to approve. `body` is ONLY the text that goes on the wire: no character count, no "(draft only)" footer, no image brief inside it — that text would publish verbatim. Put art direction in `imageBrief`, and only when the post should carry a visual. A VIDEO post (a UGC or creator script) puts the script in `script` and the caption that posts with the video in `body`. Draft for the platform the ask names, else for the connected accounts.',
      {
        posts: z.array(z.object({
          platform: z.enum(['x', 'instagram', 'linkedin', 'tiktok', 'email']).describe('the network: the one asked for, else a connected account'),
          body: z.string().min(1).max(10_000).describe('the post text exactly as it would publish, within the network\'s limit. For a video post: the caption that posts with the video.'),
          imageBrief: z.string().max(2000).optional().describe('art direction for this post\'s picture — omit for a text-only post. For a video post: the shot direction the film follows.'),
          script: z.string().max(10_000).optional().describe('a VIDEO post only: the creator\'s script, timestamped beats ([0:00-0:03] direction, Spoken: "…"). The card folds it and can film its hook. Never inside body or imageBrief.'),
        })).min(1).max(20),
      },
      async (i) => {
        // the grounding gate (host/grounding.ts): a marketing room's brand docs are read before a draft is written
        const gate = await ungrounded(db, ch.id, grounding);
        if (gate) { log({ kind: 'tool', phase: 'result', summary: 'draft_posts refused: the brand docs were not read this turn' }); return text(gate); }
        // the angle gate (host/ugcflow.ts): a VIDEO post drafts only after the human picked an angle on the card
        if ((i.posts as Array<{ script?: string }>).some((p) => p.script)) {
          const pick = await unpicked(db, { threadId });
          if (pick) { log({ kind: 'tool', phase: 'result', summary: 'draft_posts refused: no answered angle card in this thread' }); return text(pick); }
        }
        const drafts = (i.posts as Array<{ platform: string; body: string; imageBrief?: string; script?: string }>)
          .map((p) => normalizeDraft(p)).filter((p): p is NonNullable<typeof p> => !!p);
        if (!drafts.length) return text('none of those entries were usable posts — each needs a supported platform and a body that is more than working notes');
        let made = 0;
        for (const d of drafts) {
          const r = await post('/v1/commands', { kind: 'agent', id: agent.id }, {
            type: 'content.create', channel: ch.id, thread: threadId, platform: d.platform, body: d.body,
            ...(d.imageBrief ? { imageBrief: d.imageBrief } : {}), ...(d.script ? { script: d.script } : {}),
          }).catch(() => null);
          if (r?.ok) made += 1;
        }
        log({ kind: 'tool', phase: 'call', summary: `draft_posts — ${made} draft${made === 1 ? '' : 's'}`, level: made ? 'info' : 'warn' });
        if (!made) return text('the drafts could not be saved — say so plainly rather than pasting the posts into your reply');
        const letters = drafts.slice(0, made).map((_, n) => String.fromCharCode(97 + n)).join('/');
        return text(`${made} draft${made === 1 ? '' : 's'} delivered as cards in this conversation (${letters}) — the human approves, schedules or asks for changes there. Do NOT repeat the posts in your reply: one short line naming what you drafted.`);
      },
    ),
    tool(
      'revise_posts',
      'Rewrite drafts already on screen here, in place — use this whenever the human asks to change a post ("make b punchier"). Name each by its card letter. The card keeps its letter and its earlier version stays readable beneath it. Calling draft_posts instead would leave the old draft there and add a second one beside it.',
      {
        revisions: z.array(z.object({
          letter: z.string().describe('the card letter to rewrite: a, b, c…'),
          body: z.string().max(10_000).optional().describe('the replacement post text, in full (a video post: its caption)'),
          imageBrief: z.string().max(2000).optional().describe('replacement art direction (a video post: its shot direction)'),
          script: z.string().max(10_000).optional().describe('a video post: the replacement script, in full. The next Generate video films it.'),
        })).min(1).max(20),
      },
      async (i) => {
        const here = await draftsForAnchor(null, threadId);
        if (!here?.posts.length) return text('there are no drafts in this conversation to revise — draft_posts first');
        const byLetter = new Map(here.posts.map((p) => [p.letter, p]));
        const done: string[] = [];
        const missed: string[] = [];
        const drew: string[] = [];
        for (const r of i.revisions as Array<{ letter: string; body?: string; imageBrief?: string; script?: string }>) {
          const target = byLetter.get(r.letter.trim().toLowerCase());
          // ONE cleaner for a revision (parseDraftRevisions, the posts-file path's): the caption
          // stripped of notes, a script filed under a heading in the brief or the body lifted out
          const [rev] = parseDraftRevisions(JSON.stringify([r]));
          if (!target || target.status === 'published' || !rev) { missed.push(r.letter); continue; }
          const { body, imageBrief: brief, script } = rev;
          const res = await post('/v1/commands', { kind: 'agent', id: agent.id }, {
            type: 'content.revise', item: target.id,
            ...(body ? { body } : {}), ...(brief ? { imageBrief: brief } : {}), ...(script ? { script } : {}),
          }).catch(() => null);
          if (res?.ok) { done.push(target.letter); if (brief) drew.push(target.letter); } else missed.push(r.letter);
        }
        if (!done.length) return text(`nothing was revised (${missed.join(', ') || 'no matching cards'}) — say so rather than pasting the new copy into your reply`);
        // new art direction ⇒ a new picture, same as the orchestrator path (see there for why)
        const redrew: string[] = [];
        for (const letter of drew) {
          const target = byLetter.get(letter);
          if (target && await generateDraftImage(agent, ch, target.id).catch(() => null)) redrew.push(letter);
        }
        return text(`revised ${done.join(', ')} in place — the updated card${done.length === 1 ? '' : 's'} and the earlier version are in the thread.${redrew.length ? ` Redrew the image on ${redrew.join(', ')}.` : ''}${missed.length ? ` Could not revise: ${missed.join(', ')} — say why.` : ''} One short line on what you changed; do not repeat the copy.`);
      },
    ),
    ...shareChatTools(t),
  ],
});

  return nm;
}
