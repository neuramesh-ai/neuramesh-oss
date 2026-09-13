// The ROUTING tools — where work goes, and who is asked to move it next (docs/harness/04).
//
// Routing is the judgment these support: offer_task is the lightest path, request_plan the
// exception you justify. The descriptions ARE the behaviour — an agent reads them, so editing one
// is a product change, not a comment.
//
// Split out of host/orchtools.ts. Each group is a function of the TURN's context — the room, the
// agent, the thread it is answering in, the seat it was granted — because a tool that closed over
// a previous turn's seat would spend the wrong credential.



import type { OrchTool, ToolCtx } from './orchtools';
export function routeTools(tc: ToolCtx): OrchTool[] {
  const { z, db, post, ch, agent, actor, thread, convoThreadId, spawnLeg, log,
          kindField, taskByNumber, resolveRepoBinding,
          ensureChatWorkspace } = tc;
  return [
    { name: 'propose_design_round', description: 'Post the mockups your designer subagents just drew, for the HUMAN to approve. Call it once the design legs have finished: it collects the .html files they wrote, attaches them to the task as design artifacts, and moves the task into design_review so the human gets the Approve button. You can NEVER approve a design yourself — whoever drew it. If they ask for changes, spawn another design round and call this again; each round edits the last rather than starting over.', schema: {
      taskNumber: z.number().describe('the task whose design round this is'),
      summary: z.string().optional().describe('one or two lines on what the directions explore and how they differ'),
    }, run: async (input) => {
      const t = await taskByNumber(Number(input.taskNumber));
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      // the legs wrote into the SUBJECT's workspace — the same directory they were briefed on
      const dir = convoThreadId || thread ? ensureChatWorkspace(convoThreadId ?? thread!.id) : null;
      if (!dir) return 'error: this turn has no working directory, so there are no mockups to collect';
      const { join: j } = await import('node:path');
      const fs = await import('node:fs/promises');
      const outDir = j(dir, '.nm-evidence', 'design');
      const files = (await fs.readdir(outDir).catch(() => [] as string[])).filter((f) => /\.html?$/i.test(f)).sort().slice(0, 6);
      const mockups: Array<{ name: string; html: string }> = [];
      for (const f of files) {
        const html = await fs.readFile(j(outDir, f), 'utf8').catch(() => '');
        if (html.trim() && html.length <= 300_000) mockups.push({ name: f, html });
      }
      // an empty round is a FAILED round, not a proposal — saying so beats moving the task into
      // design_review with nothing for the human to look at
      if (!mockups.length) return `no mockups found in ${outDir} — your design legs produced no .html files. Spawn the round again, or say what blocked it; do not propose an empty round.`;
      const prior = await db.getAll<{ name: string }>(`select name from artifacts where task_id = ? and kind = 'design'`, [t.id]).catch(() => [] as Array<{ name: string }>);
      const round = prior.length ? Math.max(...prior.map((a) => Number(/-v(\d+)-/.exec(a.name)?.[1] ?? 1))) + 1 : 1;
      const res = await post('/v1/commands', actor, { type: 'task.propose_design', taskId: t.id, round, ...(input.summary ? { summary: String(input.summary) } : {}), mockups });
      if (!res.ok) return `error ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
      log?.({ kind: 'tool', phase: 'call', summary: `propose_design_round #${input.taskNumber} · round ${round} · ${mockups.length} mockup(s)` });
      return `round ${round} proposed for #${input.taskNumber} — ${mockups.length} mockup${mockups.length === 1 ? '' : 's'} attached and the task is in design_review. The human approves it in the thread; you cannot.`;
    } },
    { name: 'take_task', description: 'TAKE a task yourself instead of handing it to a teammate — you own it, you decide each phase, and you fan out subagents to do the work. This is the DEFAULT for most work now: you stay accountable for the deliverable end to end, the human talks to one agent throughout, and you can spin up as many specialists as the job needs (spawn) rather than being limited to who happens to sit in this room. Offer it to a named teammate instead only when the work genuinely wants a durable owner of its own — a long repo-backed build that lives in a worktree across many days. You cannot review your own work: when it reaches review the board dispatches an independent reviewer, and you act on their feedback.', schema: {
      taskNumber: z.number().describe('the task you are taking'),
      checklist: z.array(z.string()).describe('the resolved requirements — what "done" means, from the thread'),
      definitionOfDone: z.string().optional().describe('the acceptance contract the reviewer will gate on'),
      kind: kindField,
    }, run: async (input) => {
      const t = await taskByNumber(Number(input.taskNumber));
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      // taking is an offer to YOURSELF plus the claim: it reuses the same two enforced commands a
      // hand-off uses, so ownership is a normal board fact rather than a private side channel.
      const res = await post('/v1/commands', actor, {
        type: 'task.offer', taskId: t.id, offerTo: agent.name, checklist: input.checklist,
        ...(input.definitionOfDone ? { definitionOfDone: input.definitionOfDone } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) return `error ${res.status}: ${body.error ?? body.code ?? 'could not take the task'}`;
      log?.({ kind: 'tool', phase: 'call', summary: `take_task #${input.taskNumber} — owning it` });
      return `you now own #${input.taskNumber}. Your owning turn starts on its own — decide the phase, fan out what it needs, and report back in the task thread.`;
    } },
    // The ONE way to keep working past your own reply (docs/29). Everything else about a
    // turn ends when the turn ends — so "I'll get back to you" is either backed by this row
    // or it is a promise the system cannot keep.
    ...(spawnLeg ? [{
      name: 'spawn',
      description: 'Fan out a SUBAGENT to do one piece of THIS turn\'s work in parallel, and wait for its result. It runs with FULL working tools — reads, writes and edits real files in your shared workspace — so it PRODUCES (a document, a schedule, a draft) as readily as it thinks; if a job needs a file written, spawn — never staff for it. Pick the ROLE whose lens fits; it seats on that role\'s model. Call several in one message for a real fan-out. A subagent cannot create, offer or route board work — you own and report for everything it produces.',
      schema: {
        role: z.enum(['designer', 'developer', 'reviewer', 'architect', 'marketer', 'curator']).describe('whose lens and model this subagent gets'),
        prompt: z.string().min(12).max(8_000).describe('the ONE piece for this subagent, stated so it can act without seeing your whole turn'),
        label: z.string().max(80).optional().describe('short name for the human watching the run tree, e.g. "option B"'),
      },
      run: async (input: { role: string; prompt: string; label?: string }) => {
        const label = (input.label ?? input.role).slice(0, 80);
        const r = await spawnLeg({ role: input.role, prompt: input.prompt, label });
        return r.ok
          ? `subagent "${label}" (${input.role}) finished:\n\n${r.summary ?? '(no summary)'}`
          : `could not fan out "${label}": ${r.error ?? 'error'} — do this piece yourself or narrow the fan-out`;
      },
    }] : []),
    // The human's verdict, ASKED FOR rather than permanently offered (2026-08-05). The thread
    // used to dock an Approve/Request-changes bar on every in_review/done task; it is gone, and
    // this card is what replaced it. The card is a real gate, not a prompt: the human's click
    // fires task.approve/task.accept from THEIR client, which is the only way those can move
    // (approve is reviewer|human, accept is human-only — an orchestrator holds neither, and the
    // old prose card silently did nothing when clicked).
    { name: 'request_verdict', description: 'Ask the human for their verdict on a task that is in_review, as a CARD they can act on. Use it when work is waiting on a human decision and nobody else can move it — e.g. the room has no reviewer. The card carries a real Approve button (their click applies it) and a Request-changes option that arms their reply. A DONE task gets no card: its accept is the human\'s WORD in the thread (accept_task), so ask for the word in one plain line instead. Name the specific artifacts the verdict is about when the task produced several, so they know what they are signing off. Post ONE per task and do not re-ask while it sits unanswered.', schema: {
      taskNumber: z.number().int().describe('the task number awaiting a verdict'),
      artifacts: z.array(z.string()).optional().describe('artifact FILE NAMES this verdict is about (exact names from the task), when it produced more than one'),
      note: z.string().max(200).optional().describe('ONE line of context under the headline — why this needs them, or what signing off means here. Do NOT name the transition ("accept", "approve", "close"): the card writes its own headline from what the button will actually DO, and a note that disagrees with it is how a human ends up believing they closed a task they only approved.'),
    }, run: async (input: { taskNumber: number; artifacts?: string[]; note?: string }) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      const [row] = await db.getAll<{ id: string; state: string; number: number; title: string }>(
        'select id, state, number, title from tasks where id = ?', [t.id],
      ).catch(() => [] as Array<{ id: string; state: string; number: number; title: string }>);
      if (!row) return `error: no task #${input.taskNumber}`;
      if (row.state !== 'in_review' && row.state !== 'done') {
        return `#${row.number} is ${row.state} — a verdict card only applies to in_review or done. Nothing posted.`;
      }
      // resolve the named artifacts against what the task ACTUALLY attached, so a hallucinated
      // filename can never appear on a card the human is about to sign off
      const known = await db.getAll<{ name: string; kind: string }>(
        'select name, kind from artifacts where task_id = ?', [t.id],
      ).catch(() => [] as Array<{ name: string; kind: string }>);
      const named = (input.artifacts ?? [])
        .map((n) => known.find((k) => k.name === n || k.name.endsWith(`/${n}`)))
        .filter((a): a is { name: string; kind: string } => !!a)
        .slice(0, 8);
      // The headline is COMPOSED from the action, never authored — see VerdictCardData. rex once
      // wrote "Accept #1043 …?" over a button that fired approve, and the human read the word
      // Accept and believed the task was closed while the real accept still sat in the queue.
      // The card renders its own from title + LIVE state; this stored question only has to
      // match it so the answered-state key lines up.
      const act = row.state === 'done' ? `Accept & close #${row.number}` : `Approve #${row.number}`;
      const card = {
        question: `${act} — ${row.title}?`,
        options: [{ label: act }, { label: 'Request changes' }],
        allowOther: true,
        verdict: {
          task: t.id, number: row.number, title: row.title, state: row.state,
          ...(named.length ? { artifacts: named.map((a) => ({ name: a.name, kind: a.kind })) } : {}),
          ...(input.note ? { note: input.note.trim() } : {}),
        },
      };
      const res = await post('/v1/messages', actor, {
        workspace: ch.workspace_id, channel: ch.id, taskId: t.id,
        body: `\`\`\`nmq\n${JSON.stringify(card)}\n\`\`\``,
      });
      return res.ok
        ? `verdict card posted on #${row.number} — "${act}"${named.length ? `, naming ${named.map((a) => a.name).join(', ')}` : ''}`
        : `error ${res.status}: could not post the verdict card`;
    } },
    { name: 'offer_task', description: 'Offer an open todo task DIRECTLY to a registered agent — the LIGHTEST path, for well-scoped work that needs no design or plan first: most bug fixes — INCLUDING hard or recurring ones where earlier fixes did not hold (that means investigate deeper HERE, not escalate to the architect) — where the developer root-causes with the investigate skill, adds a regression guard, ships a PR; plus small, well-understood changes. Set the task kind. Carries the resolved checklist — workers execute it instead of inventing their own; claiming stays voluntary. Bind the repo here if the thread settled on one.', schema: {
      taskNumber: z.number().int().describe('the task number to offer'),
      agentName: z.string().min(1).describe('agent name from list_agents'),
      checklist: z.array(z.string().min(1)).min(1).describe('the requirement checks resolved in the thread — what done looks like'),
      kind: kindField.optional().describe('work-type label (docs/16) — set it so this routed task is categorized (a bug goes direct with a root-cause-first DoD); omit only if the task already carries a kind.'),
      definitionOfDone: z.string().optional().describe('the Definition of Done — a short, concrete acceptance contract the reviewer gates on. For code work, phrase it as the PR flow: opens a pull request against the base branch, CI passes, merged only after approval — NEVER "commit to main".'),
      repoName: z.string().optional().describe('repo from list_repos when the task changes code and was created without one'),
      repoUrl: z.string().optional().describe('a github.com URL or <org>/<repo> the human named — attach it automatically (registers if new, then binds) when the task changes code and isn\'t bound to a repo yet'),
      baseRef: z.string().optional().describe('base branch (defaults to the repo default)'),
    }, run: async (input) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      const { repo, label: repoLabel, error: repoErr } = await resolveRepoBinding(input.repoName, input.repoUrl);
      if (repoErr) return `error: ${repoErr}`;
      const res = await post('/v1/commands', actor, { type: 'task.offer', taskId: t.id, offerTo: input.agentName, checklist: input.checklist, ...(input.definitionOfDone ? { definitionOfDone: input.definitionOfDone } : {}), ...(input.kind ? { kind: input.kind } : {}), ...(repo ? { repo: { id: repo.id, baseRef: input.baseRef ?? repo.default_branch } } : {}) });
      const body = (await res.json()) as any;
      if (!res.ok) return `error ${res.status}: ${body.error ?? body.code ?? 'task.offer failed'}`;
      return `offered #${input.taskNumber} to @${input.agentName}${repo ? ` on ${repoLabel}` : ''}`;
    } },
    { name: 'propose_impl_plan', description: 'Draft the implementation plan for an EXISTING todo task that has none — promoted backlog items and board-created tasks. Plan-first is the law of the board (2026-08-17): every unit starts with a plan the HUMAN reviews in the task\'s thread before work is offered or claimed. This does both halves in one call: routes the task into planning as yourself and proposes your plan — declared journey legs + proposed subtasks + the approach — landing it in plan_review for the human\'s sign-off. Draft the plan FROM the conversation and the task description; spawn an architect subagent first when the approach genuinely needs deeper design. Do NOT use this on a task that already carries a plan (revise via the human\'s feedback instead), and never on a subtask or setup task.', schema: {
      taskNumber: z.number().int().describe('the todo task to plan'),
      kind: kindField.optional().describe('work-type label — required if the task has none yet'),
      legs: z.array(z.enum(['design', 'build', 'review'])).min(1).describe('the DECLARED journey in causal order — review is REQUIRED for repo-backed work (the server floors it); a lean research unit is just [build]'),
      subtasks: z.array(z.string().min(1).max(200)).max(8).optional().describe('proposed companion work, minted when the human approves'),
      approach: z.string().min(40).max(20_000).describe('the plan the human reviews, in markdown — what, in what order, risks, what done means'),
    }, run: async (input: { taskNumber: number; kind?: string; legs: string[]; subtasks?: string[]; approach: string }) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      const rp = await post('/v1/commands', actor, { type: 'task.request_plan', taskId: t.id, ...(input.kind ? { kind: input.kind } : {}) });
      if (!rp.ok) {
        const body = (await rp.json().catch(() => ({}))) as { error?: string; code?: string };
        return `error ${rp.status}: ${body.error ?? body.code ?? 'task.request_plan failed'} — is #${input.taskNumber} still in todo with a kind set?`;
      }
      const pp = await post('/v1/commands', actor, { type: 'task.propose_plan', taskId: t.id, plan: input.approach, legs: input.legs, ...(input.subtasks ? { subtasks: input.subtasks } : {}) });
      const body = (await pp.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!pp.ok) return `error ${pp.status}: ${body.error ?? body.code ?? 'task.propose_plan failed'}`;
      log?.({ kind: 'tool', phase: 'call', summary: `propose_impl_plan #${input.taskNumber} · legs ${input.legs.join('→')}` });
      return `#${input.taskNumber} is in plan_review carrying your plan (journey: ${input.legs.join(' → ')} → accept). The human approves it in the task thread — work is offered only after that; you cannot approve it yourself.`;
    } },
    { name: 'request_plan', description: 'Route a LEGACY/board-born task to the channel architect for an implementation plan (a plan-first unit already carries its plan — revise_plan is the tool there, and this cannot fire from plan_review). The bar: a genuinely non-obvious APPROACH after requirements are clear — the exception you justify, never the default. Never for finding a bug\'s cause: the architect plans from known requirements, it cannot debug. The drafted plan returns for the human\'s approval before anything builds. Set the task kind.', schema: {
      taskNumber: z.number().int().describe('the task number to route into planning'),
      checklist: z.array(z.string().min(1)).min(1).describe('the requirement checks resolved in the thread — the architect plans against these'),
      kind: kindField.optional().describe('work-type label (docs/16) — set it so the planned task is categorized; omit only if the task already carries a kind.'),
    }, run: async (input) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      await post('/v1/commands', actor, { type: 'task.confirm_requirements', taskId: t.id, checklist: input.checklist }).catch(() => {});
      // resolve THIS channel's architect so the task is assigned to a named agent (the board shows
      // it instead of "unassigned") and we can tell the human exactly who is planning it.
      const [arch] = await db.getAll<{ id: string; name: string }>(`select a.id, a.name from agents a join agent_channels ac on ac.agent_id = a.id where ac.channel_id = ? and a.role = 'architect' and a.retired_at is null order by a.name limit 1`, [ch.id]); // order by a SYNCED column — the PowerSync replica doesn't carry created_at
      const res = await post('/v1/commands', actor, { type: 'task.request_plan', taskId: t.id, architect: arch?.id, ...(input.kind ? { kind: input.kind } : {}) });
      const body = (await res.json()) as any;
      if (!res.ok) return `error ${res.status}: ${body.error ?? body.code ?? 'task.request_plan failed'}`;
      return arch
        ? `routed #${input.taskNumber} to ${arch.name} (the #${ch.slug} architect) — it's assigned to ${arch.name}, who will draft the plan and post it for review. Name ${arch.name} in your reply.`
        : `routed #${input.taskNumber} into planning, but #${ch.slug} has NO architect registered — the plan can't be drafted until one is. If a workspace architect exists (list_agents), propose ADDING them (the add card); if none exists anywhere, propose HIRING one (the hire card — human approval required).`;
    } },
    { name: 'request_design', description: 'Route a task to the channel designer for mockups BEFORE the architect plans — when the request CREATES OR CHANGES a user-facing visual surface with no agreed look (new pages, new UI, redesigns, visual modifications). Ask this of ANY kind: a bug or chore whose real fix is a redesign routes here too, not only a feature. The designer studies the repo\'s existing design system, drafts mockups, and they return to the thread for the HUMAN\'s approval (you cannot approve a design); only after approval does the architect plan. Requires resolved requirements, like request_plan. Set the task kind.', schema: {
      taskNumber: z.number().int().describe('the task number to route into design'),
      checklist: z.array(z.string().min(1)).min(1).describe('the requirement checks resolved in the thread — the designer works against these'),
      kind: kindField.optional().describe('work-type label (docs/16) — usually feature or design, but any kind may route to design (a bug whose fix is a redesign); set it so the task is categorized.'),
      provider: z.enum(['iris', 'claude-design']).optional().describe('a mockup engine the human already chose; normally omit it so Iris asks after pickup with the inline HTML-vs-Claude-Design choice card'),
    }, run: async (input) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      await post('/v1/commands', actor, { type: 'task.confirm_requirements', taskId: t.id, checklist: input.checklist }).catch(() => {});
      // A task I already hold stays MINE through its design phase (docs/29 §4d) — the round is a leg
      // of the flow I own, drawn by designer SUBAGENTS that inherit the seated designer's seat. The
      // `designer` field is what reassigns the task server-side (handler.ts), so an owned round must
      // not send it: otherwise request_design silently undoes the take_task that came before it.
      const [own] = await db.getAll<{ assignee_id: string | null }>(`select assignee_id from tasks where id = ?`, [t.id]);
      if (own?.assignee_id === agent.id) {
        const res = await post('/v1/commands', actor, { type: 'task.request_design', taskId: t.id, ...(input.kind ? { kind: input.kind } : {}), ...(input.provider ? { provider: input.provider } : {}) });
        const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        if (!res.ok) return `error ${res.status}: ${body.error ?? body.code ?? 'task.request_design failed'}`;
        return `#${input.taskNumber} is in designing and still YOURS. Spawn your designers now — one per direction, each inheriting the #${ch.slug} designer's seat and design flow — then propose_design_round to put what they drew in front of the human. Your reply names no other owner: you are running this round.`;
      }
      // resolve THIS channel's designer so the task is assigned to a named agent (mirrors request_plan)
      const [des] = await db.getAll<{ id: string; name: string }>(`select a.id, a.name from agents a join agent_channels ac on ac.agent_id = a.id where ac.channel_id = ? and a.role = 'designer' and a.retired_at is null order by a.name limit 1`, [ch.id]);
      if (!des) return `error: #${ch.slug} has NO designer registered — mockups can't be drafted until one is. If a workspace designer exists (list_agents), propose ADDING them (the add card); if none exists anywhere, propose HIRING one (the hire card — human approval required); or route straight to planning with request_plan if the human prefers to skip design.`;
      const res = await post('/v1/commands', actor, { type: 'task.request_design', taskId: t.id, designer: des.id, ...(input.kind ? { kind: input.kind } : {}), ...(input.provider ? { provider: input.provider } : {}) });
      const body = (await res.json()) as any;
      if (!res.ok) return `error ${res.status}: ${body.error ?? body.code ?? 'task.request_design failed'}`;
      return `routed #${input.taskNumber} to ${des.name} (the #${ch.slug} designer)${input.provider === 'claude-design' ? ' through Claude Design' : input.provider === 'iris' ? ' for an Iris HTML mockup' : ''} — it's assigned to ${des.name}, who ${input.provider ? 'will use the chosen canvas' : 'will ask the human to choose an Iris HTML mockup or an editable Claude Design project'} and bring the result back for approval. Name ${des.name} in your reply.`;
    } },
    { name: 'revise_design', description: 'Send proposed design mockups (a task in design_review) BACK to the designer with the human\'s feedback — use this when a human in the thread describes what to change about the mockups. The designer reworks them and a new round returns for approval. You can NEVER approve a design yourself — approval is the human\'s button in the thread.', schema: {
      taskNumber: z.number().int().describe('the task in design_review to send back'),
      feedback: z.string().min(1).describe('what to change — the human\'s design feedback, stated concretely'),
    }, run: async (input) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      const res = await post('/v1/commands', actor, { type: 'task.revise_design', taskId: t.id, feedback: input.feedback });
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as any; return `error ${res.status}: ${b.error ?? b.code ?? 'revise_design failed'}`; }
      return `sent #${input.taskNumber} back to the designer with the change notes — a reworked round will return for approval`;
    } },
    { name: 'revise_plan', description: 'Send a proposed implementation plan (a task in plan_review) BACK to the architect with the human\'s feedback — use this when a human in the thread describes what to change about the plan. The architect redrafts it and a new version returns for approval.', schema: {
      taskNumber: z.number().int().describe('the task in plan_review to send back'),
      feedback: z.string().min(1).describe('what to change — the human\'s plan feedback, stated concretely'),
    }, run: async (input) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      const res = await post('/v1/commands', actor, { type: 'task.revise_plan', taskId: t.id, feedback: input.feedback });
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as any; return `error ${res.status}: ${b.error ?? b.code ?? 'revise_plan failed'}`; }
      return `sent #${input.taskNumber} back to the architect with the review notes — a redrafted plan will return for approval`;
    } },
    { name: 'revise_ship_plan', description: 'Send a proposed release plan (a task in ship_review) BACK to the shipper with the human\'s feedback — use this when a human in the thread describes what to change about the release plan or its checklist. The shipper redrafts it and a new round returns for approval. You can NEVER approve a release plan yourself — approval is the human\'s button in the thread (docs/23).', schema: {
      taskNumber: z.number().int().describe('the task in ship_review to send back'),
      feedback: z.string().min(1).describe('what to change — the human\'s release-plan feedback, stated concretely'),
    }, run: async (input) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      // the thread packet carries the feedback for the shipper's redraft (the events log is not replicated)
      await post('/v1/messages', actor, { workspace: ch.workspace_id, channel: ch.id, taskId: t.id, body: `📦 Release-plan changes requested: ${input.feedback}` }).catch(() => {});
      const res = await post('/v1/commands', actor, { type: 'task.revise_ship_plan', taskId: t.id, feedback: input.feedback });
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as any; return `error ${res.status}: ${b.error ?? b.code ?? 'revise_ship_plan failed'}`; }
      return `sent #${input.taskNumber} back to the shipper with the release-plan notes — a reworked plan will return for approval`;
    } },
    { name: 'request_changes', description: 'On the human\'s explicit request, send a task that is in review or already approved (done, awaiting acceptance) BACK to its assignee for changes — a developer, or the marketer on a content task ("send the drafts back to plume"). Use this when a human in the thread says the work is not ready or does not meet the requirements. The task returns to in_progress and the assignee is re-engaged. Provide the human\'s reason as feedback. You cannot touch accepted or closed tasks.', schema: {
      taskNumber: z.number().int().describe('the task to send back to its assignee'),
      feedback: z.string().min(1).describe('what needs to change — the human\'s reason, stated concretely'),
    }, run: async (input) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      const res = await post('/v1/commands', actor, { type: 'task.request_changes', taskId: t.id, feedback: input.feedback });
      if (!res.ok) { const b = (await res.json().catch(() => ({}))) as any; return `error ${res.status}: ${b.error ?? b.code ?? 'request_changes failed'}`; }
      return `sent #${input.taskNumber} back to its assignee with the change request`;
    } },
    // ACCEPT ON THE HUMAN'S WORD (George, 2026-09-08). The Accept button left every surface; this is
    // the road that replaced it. The server proves a human spoke in the thread after the verdict
    // (handler.ts: HUMAN_ONLY otherwise); reading what they meant is this seat's judgment.
    { name: 'accept_task', description: 'Accept a DONE task (review passed) ON THE HUMAN\'S WORD: only when a human in THIS thread has just told you to, in their own words ("merge it", "accept", "land it", "ship it"). Acceptance closes the task, and a repo task squash-merges its pull request, which cannot be undone. The server refuses (HUMAN_ONLY) unless a human message newer than the review verdict exists in the thread, so a guess cannot merge anything — but a misread can: never call it on a maybe, a question, praise without an instruction, or a message about something else. Never suggest the word to them. In your reply, say what happened and name the message you acted on.', schema: {
      taskNumber: z.number().int().describe('the done task the human told you to accept or merge'),
    }, run: async (input) => {
      const t = await taskByNumber(input.taskNumber);
      if (!t) return `error: no task #${input.taskNumber} in #${ch.slug}`;
      const res = await post('/v1/commands', actor, { type: 'task.accept', taskId: t.id });
      const b = (await res.json().catch(() => ({}))) as any;
      log?.({ kind: 'tool', phase: 'call', summary: `accept_task #${input.taskNumber}${res.ok ? ' on the human\'s word' : ' (refused)'}`, level: res.ok ? 'info' : 'warn' });
      if (!res.ok) return `error ${res.status}: ${b.error ?? b.code ?? 'accept failed'}`;
      const at = typeof b.onWord?.createdAt === 'string' ? new Date(b.onWord.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
      const pr = b.task?.prNumber ?? b.task?.pr_number;
      return `accepted #${input.taskNumber}${at ? ` on the human's message at ${at}` : ''}${pr ? ` — PR #${pr} squash-merges now` : ''}. Say so in one line, naming that message.`;
    } },
  ];
}
