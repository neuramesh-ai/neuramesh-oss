// The BOARD tools — everything that files, routes or moves work, plus the fan-out (docs/harness/04).
//
// Routing is the judgment these support: offer_task is the lightest path, request_plan the
// exception you justify. The descriptions ARE the behaviour — an agent reads them, so editing one
// is a product change, not a comment.
//
// Split out of host/orchtools.ts. Each group is a function of the TURN's context — the room, the
// agent, the thread it is answering in, the seat it was granted — because a tool that closed over
// a previous turn's seat would spend the wrong credential.


import { TASK_KINDS } from '@neuramesh/shared';
import type { OrchTool, ToolCtx } from './orchtools';

export function boardTools(tc: ToolCtx): OrchTool[] {
  const { z, db, post, ch, actor, convoThreadId,
          here, known, taskByNumber } = tc;
  return [
    { name: 'list_tasks', description: 'OPEN tasks on this channel board (excludes accepted/closed, and parked backlog ideas — those live in list_backlog) — check before creating to avoid duplicates. For the status of a specific task, use task_status, not this.', schema: {}, run: async () => {
      const rows = await db.getAll(`select t.number, t.title, t.state, (select name from agents where id = t.offered_agent_id) as offered_to, (select name from agents a where a.id = t.assignee_id) as assignee from tasks t where t.channel_id = ? and t.state not in ('closed', 'accepted', 'backlog') order by t.number desc limit 30`, [ch.id]);
      return JSON.stringify(rows);
    } },
    { name: 'list_backlog', description: 'Parked ideas on this channel\'s backlog — the scratch column BEFORE todo. Use it to answer "what\'s in the backlog / how many", to check for duplicates before parking a new one, and to pick items worth promoting. Backlog items are NOT open work: nothing runs until one is promoted (promote_backlog_item).', schema: {}, run: async () => {
      const rows = await db.getAll(`select t.number, t.title, substr(t.description, 1, 200) as description, case when t.creator_kind = 'agent' then coalesce((select name from agents where id = t.creator_id), 'agent') else 'human' end as added_by from tasks t where t.channel_id = ? and t.state = 'backlog' order by t.number desc limit 50`, [ch.id]);
      return rows.length ? JSON.stringify(rows) : 'the backlog is empty';
    } },
    { name: 'add_backlog_item', description: 'Park an idea on this channel\'s backlog — the scratch column BEFORE todo for work the team wants to remember but is NOT ready to start (a human saying "add X to the backlog", or a promising idea from discussion worth keeping). No intake, no routing, no offer — a parked item just sits until a human or you promote it. Check list_backlog first to avoid duplicates. For work the human wants STARTED, use create_task instead.', schema: {
      title: z.string().min(1).describe('short imperative title for the idea'),
      description: z.string().optional().describe('what/why plus any context worth keeping — the item stays editable, and its thread can hold deeper context later'),
    }, run: async (input) => {
      const res = await post('/v1/commands', actor, { type: 'task.create', workspace: ch.workspace_id, channel: ch.id, title: input.title, backlog: true, ...(input.description ? { description: input.description } : {}) });
      const body = (await res.json()) as any;
      if (!res.ok) return `error ${res.status}: ${body.error ?? body.code ?? 'task.create failed'}`;
      known.set(Number(body.task.number), body.task.id as string);
      return `parked #${body.task.number} “${body.task.title}” on the backlog — it stays there until promoted (promote_backlog_item)`;
    } },
    { name: 'add_subtask', description: 'Create a SUBTASK under an existing open task — minor companion work that is PART of delivering it (a readiness analysis, a cross-check, a doc note). It rides the parent: same thread, deliverables attach to the parent, no card of its own on the board — and the parent cannot pass review/accept/ship while a subtask is open. Use this — NEVER create_task — whenever the work only exists in service of an open task (the server bounces such creates with MAKE_IT_A_SUBTASK). Optionally offer it to a channel agent by name.', schema: {
      parentNumber: z.number().int().describe('the open task this work serves'),
      title: z.string().min(1).max(200).describe('short imperative title for the companion work'),
      description: z.string().max(4000).optional().describe('what and why — enough for the assignee to pick it up cold'),
      assignee: z.string().min(1).optional().describe('channel agent NAME to offer it to (it claims and runs like normal work)'),
    }, run: async (input) => {
      const parent = await taskByNumber(input.parentNumber);
      if (!parent) return `error: no task #${input.parentNumber} in #${ch.slug}`;
      const res = await post('/v1/commands', actor, { type: 'task.create', workspace: ch.workspace_id, channel: ch.id, title: input.title, parent: parent.id, ...(input.description ? { description: input.description } : {}), ...(input.assignee ? { offerTo: input.assignee } : {}) });
      const body = (await res.json()) as any;
      if (!res.ok) return `error ${res.status}: ${body.error ?? body.code ?? 'task.create failed'}`;
      known.set(Number(body.task.number), body.task.id as string);
      return `subtask #${body.task.number} “${body.task.title}” created under #${input.parentNumber}${input.assignee ? ` and offered to ${input.assignee}` : ''} — it rides that task's thread, and #${input.parentNumber} can't pass its next gate until every subtask finishes (a human can check one off any time). Name the subtask in your reply.`;
    } },
    { name: 'promote_backlog_item', description: 'Release a parked backlog item into todo — when a human says to start it (or approves your suggestion to). Plan-first applies to promoted work exactly like new work: call propose_impl_plan in the SAME turn, so the plan lands in the task\'s thread for the human\'s sign-off before anything runs. Only humans and you can promote.', schema: {
      taskNumber: z.number().int().describe('the backlog item\'s task number'),
    }, run: async (input) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      const res = await post('/v1/commands', actor, { type: 'task.promote', taskId: t.id });
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as any; return `error ${res.status}: ${b.error ?? b.code ?? 'task.promote failed'}`; }
      return `promoted #${input.taskNumber} to todo — now triage it (request_design / request_plan / offer_task)`;
    } },
    { name: 'update_backlog_item', description: 'Rewrite a parked item\'s title and/or description when the human refines the idea in chat ("add X to that backlog item", "rename it to…"). The text you pass REPLACES the field — fold the existing text in (list_backlog shows it). Works while the item is pre-work (backlog/todo); for context that reads like conversation, post_thread into the item\'s thread instead.', schema: {
      taskNumber: z.number().int().describe('the backlog item\'s task number'),
      title: z.string().optional().describe('the replacement title'),
      description: z.string().optional().describe('the replacement description (full text — it overwrites)'),
    }, run: async (input) => {
      if (!input.title && !input.description) return 'error: pass a title and/or description';
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      const res = await post('/v1/commands', actor, { type: 'task.update_details', taskId: t.id, ...(input.title ? { title: input.title } : {}), ...(input.description ? { description: input.description } : {}) });
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as any; return `error ${res.status}: ${b.error ?? b.code ?? 'task.update_details failed'}`; }
      return `updated #${input.taskNumber}${input.title ? ` — now “${input.title}”` : ''}`;
    } },
    { name: 'task_status', description: 'CURRENT state of a specific task by number or title — includes done/accepted/closed (list_tasks does not). Use this for any "status of X?" question; the board is the source of truth, never channel history.', schema: { number: z.number().optional().describe('exact task number, e.g. 1004'), query: z.string().optional().describe('title substring when the number is unknown') }, run: async (input) => {
      const where: string[] = ['t.channel_id = ?'];
      const args: unknown[] = [ch.id];
      if (typeof input.number === 'number') { where.push('t.number = ?'); args.push(input.number); }
      else if (input.query) { where.push('lower(t.title) like ?'); args.push(`%${input.query.toLowerCase()}%`); }
      const rows = await db.getAll(`select t.number, t.title, t.state, t.branch, (select name from agents where id = t.offered_agent_id) as offered_to, (select name from agents a where a.id = t.assignee_id) as assignee from tasks t where ${where.join(' and ')} order by t.number desc limit 8`, args);
      return rows.length ? JSON.stringify(rows) : 'no matching task on this board — say so; do NOT guess from memory';
    } },
    { name: 'create_task', description: 'CREATE a board task directly: the unit is born in PLAN REVIEW carrying your implementation plan, its ‹task:id› card lands in this conversation, and the human approves the plan in the task\'s thread before any work starts — creating is never starting. The server refuses a plan-less agent create and bounces same-title duplicates. Work riding an OPEN task is add_subtask; an idea nobody is starting is add_backlog_item.', schema: {
      title: z.string().min(1).max(72).describe('SHORT imperative task title, 72 chars max — the smallest shippable unit. NOT the human\'s ask restated: the ask belongs in description.'),
      description: z.string().min(1).describe('the request as stated plus key details extracted — this becomes the unit\'s intake record'),
      kind: z.enum(TASK_KINDS).describe('the work type (docs/16) — required: a created unit is routed work'),
      legs: z.array(z.enum(['design', 'build', 'review'])).min(1).describe('the DECLARED journey, in causal order — design only when a user-facing look must be agreed; review whenever the work merits an independent check (REQUIRED for anything repo-backed — the server floors it); ship derives from the project gate and accept is always the human. A lean research unit is just [build].'),
      subtasks: z.array(z.string().min(1).max(200)).max(8).optional().describe('proposed companion work, minted as real subtask rows when the human approves the plan'),
      approach: z.string().min(40).max(20_000).describe('the implementation plan the human will review, in markdown: what you will do, in what order, what could go wrong, what done means. Concrete and short beats long.'),
      offerTo: z.string().min(1).optional().describe('pre-offer the build to a named agent from list_agents — on the human\'s plan approval the claim releases itself. Omit for design-first units (the designer routes automatically) and for work you will take yourself.'),
    }, run: async (input: { title: string; description: string; kind: string; legs: string[]; subtasks?: string[]; approach: string; offerTo?: string }) => {
      const res = await post('/v1/commands', actor, {
        type: 'task.create',
        workspace: ch.workspace_id,
        // here(), not ch.id — file_conversation may have moved this conversation mid-turn, and
        // the task belongs in the room the human was just told it was filed into.
        channel: here(),
        title: input.title.trim(),
        description: input.description,
        kind: input.kind,
        plan: { legs: input.legs, subtasks: input.subtasks ?? [], approach: input.approach },
        ...(input.offerTo ? { offerTo: input.offerTo } : {}),
        // BIND IT TO THIS CONVERSATION (thread-owned work): the unit card lands here and the
        // conversation owns the unit. A task-thread turn has no conversation to anchor —
        // companion work there is add_subtask, never a top-level create.
        ...(convoThreadId ? { originThread: convoThreadId } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as { task?: { number?: number }; error?: string; code?: string };
      if (!res.ok) return `error ${res.status}: ${body.error ?? body.code ?? 'task.create failed'}`;
      const n = body.task?.number;
      const createdId = (body.task as { id?: string } | undefined)?.id;
      if (n && createdId) known.set(n, createdId); // the create→offer/route chain must not depend on sync latency
      return `#${n} created, born in PLAN REVIEW carrying your plan (journey: ${input.legs.join(' → ')} → accept). Its card is in this conversation; the human approves the plan in the task's thread — work is offered only after that, and you can never approve it yourself. Link #${n} in your reply and say the plan awaits their review.`;
    } },
    { name: 'post_thread', description: 'Post a message into a task\'s thread — intake questions, plan notes, scope confirmations. The thread is the task\'s conversation record.', schema: {
      taskNumber: z.number().int().describe('the task number, e.g. 1042'),
      body: z.string().min(1).describe('the message to post in the thread'),
    }, run: async (input) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      const res = await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: input.body });
      return res.ok ? `posted to the #${input.taskNumber} thread` : `error ${res.status}: post failed`;
    } },
  ];
}
