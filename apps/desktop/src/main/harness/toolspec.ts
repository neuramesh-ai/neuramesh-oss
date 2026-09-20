// THE ONE TOOL TABLE — name + description + input schema for the worker nm tools, consumed by
// BOTH transports: the Claude in-process MCP server (runtime/nmtools.ts) and the CLI loopback
// bus (harness/tooldefs.ts).
//
// Why (2026-08-18 audit, P4): the two files each hand-carried all ten specs, and they had
// already drifted — the bus `spawn` grew the budget-floor sentence and `park` the stall warning
// while the Claude copies kept neither, so what a model was told depended on which runtime seated
// it. Execution stays split (SDK closures vs ToolHost) because the CONTEXTS differ; the words
// and shapes cannot, so they live here once. The whiteboard four already single-source their
// descriptions in tooldesc.ts; their schemas stay beside their closures.
//
// `params` is a builder taking zod, because nmtools imports zod dynamically (the SDK stays out
// of the main bundle) while the bus imports it statically — the builder serves both without
// forcing either import style.
import type { z as Zod } from 'zod';
import { REPO_CHANGES_DESC, REPO_FILE_DESC, REPO_TREE_DESC } from './tooldesc';

type Shape = Record<string, Zod.ZodTypeAny>;
export interface ToolSpec { description: string; params: (z: typeof Zod) => Shape }

export const TOOL_SPECS = {
  screenshot: {
    description:
      'Capture a PNG into your workspace (it attaches to the task as a screenshot artifact for the human reviewer, and is returned so you see your own render). TWO modes: pass `file` to render a static .html file, OR pass `url` to capture a RUNNING app route in a real browser — build & start the app on a port (e.g. `next build && next start -p 4123`, or the dev server) then screenshot `http://localhost:4123/<route>`. Use `url` mode whenever the Definition of Done asks for screenshots of app pages. Do NOT hand-roll a separate headless-browser/CDP harness — this IS that, with a real Chromium that runs the app\'s JS.',
    params: (z) => ({
      file: z.string().optional().describe('path to a static .html file in your working directory (keep mock/scratch HTML under .nm-evidence/ so it never ships in the commit)'),
      url: z.string().optional().describe('http(s) URL of a running app route, e.g. http://localhost:3000/updates'),
      name: z.string().optional().describe('output PNG name (default derived from file/url)'),
      width: z.number().optional().describe('viewport width px (default 1280)'),
      height: z.number().optional().describe('viewport height px (default 800)'),
    }),
  },
  load_skill: {
    description:
      'Load the full body of a team Agent Skill (a reusable procedure) by name — call it when a skill listed for this channel looks relevant to the task, then follow it.',
    params: (z) => ({ name: z.string().describe('the skill name from the available-skills list') }),
  },
  propose_skill: {
    description:
      'Propose a reusable procedure you discovered (a "skill") so future tasks reuse it instead of rediscovering. It lands as a DRAFT for the team to curate — only propose genuinely reusable, non-obvious procedures (not task-specific notes, never secrets). Channel scope by default.',
    params: (z) => ({
      name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).describe('kebab-case skill name'),
      description: z.string().max(300).describe('one line: when should an agent use this?'),
      body: z.string().max(40_000).describe('the procedure in markdown: steps, snippets, gotchas'),
      scope: z.enum(['channel', 'global']).optional().describe('channel (default) or global/workspace'),
    }),
  },
  record_lesson: {
    description:
      'Record a durable lesson in this channel\'s team memory — the norm a correction or gotcha just taught you (e.g. "mock evidence HTML is review evidence, never committed — renders attach as artifacts"). It is recalled into every future task here, so the mistake is not repeated. One concrete, general sentence — not a task narrative, never secrets. For a full multi-step procedure, use propose_skill instead.',
    params: (z) => ({ lesson: z.string().min(12).max(500).describe('the lesson as one concrete sentence, generalized beyond this task') }),
  },
  add_backlog_item: {
    description:
      'Park a follow-up you DISCOVERED on the channel backlog — work that is real but OUTSIDE this task\'s scope: tech debt you had to step around, a missing test or doc, a concrete improvement idea. It lands as a parked idea (never live work): only a human or the orchestrator can promote it, and nothing runs from it automatically. Use it INSTEAD of expanding your task\'s scope. Do NOT park what this task itself requires, vague observations, or duplicates of items you already parked this run.',
    params: (z) => ({
      title: z.string().min(1).max(200).describe('short imperative title for the discovered work'),
      description: z.string().max(4000).optional().describe('what and why — enough context that a teammate can pick it up cold (file paths, the constraint you hit)'),
    }),
  },
  add_subtask: {
    description:
      'Spin up a SUBTASK of the task you are working — minor companion work that is PART of delivering it (a cross-check, an analysis, a doc note another teammate should do). It rides this task: same thread, deliverables attach here, and the task cannot pass review/accept while a subtask is open — so only add what delivering this task genuinely needs. For out-of-scope discoveries use add_backlog_item; never create a peer task for companion work.',
    params: (z) => ({
      title: z.string().min(1).max(200).describe('short imperative title for the companion work'),
      description: z.string().max(4000).optional().describe('what and why — enough for a teammate to pick it up cold'),
    }),
  },
  spawn: {
    // the bus copy — the richer of the two drifted variants (budget-floor + refusal semantics)
    description:
      'Fan out a SUBAGENT to do one piece of this work in parallel, and wait for its result. Use it when the work genuinely splits — three design directions, five files to audit, two competing approaches — not to delegate a single linear task. Pick the ROLE whose skills fit (designer, developer, reviewer, architect, marketer); the subagent is seated on the model this workspace assigns that role. It gets your tools MINUS anything that touches the board: it cannot submit, accept, or file a task, because YOU own this workflow and answer for everything it produces. Its budget is carved out of what YOURS has left, so spawning many shallow helpers costs you the room to think — and a spawn is refused outright once too little remains. Call it several times in parallel for a real fan-out.',
    params: (z) => ({
      role: z.enum(['designer', 'developer', 'reviewer', 'architect', 'marketer', 'curator']).describe('which role\'s model + lens this subagent is seated with'),
      prompt: z.string().min(12).max(8_000).describe('the ONE piece of work for this subagent, stated so it can act without seeing your whole task'),
      label: z.string().max(80).optional().describe('short name for the human watching the run tree, e.g. "direction B"'),
    }),
  },
  park: {
    // the bus copy — carries the stall warning and the continue-from-there promise
    description:
      'Stop and WAIT for something outside your control, without burning your remaining time. Use it when you genuinely cannot proceed until an external thing resolves — CI finishing on a PR you just pushed, or a fixed delay before a re-check. Your turn ends immediately and costs nothing while parked; you are called back with what you were waiting for as soon as it resolves, and you continue from there. Do NOT park to wait for your own subagents (they are awaited for you), and do NOT park instead of finishing work you could do now — an unresolved park is reported as a stall.',
    params: (z) => ({
      until: z.enum(['ci', 'delay']).describe("'ci' waits on a PR's checks; 'delay' waits a fixed time"),
      prNumber: z.number().int().positive().optional().describe('the PR whose checks you are waiting on (required for until:ci)'),
      afterMinutes: z.number().int().min(1).max(60).optional().describe('how long to wait (required for until:delay, max 60)'),
      note: z.string().min(8).max(600).describe('what you are waiting for and what you will do when it resolves — you are handed this back'),
    }),
  },
  declare_beats: {
    description:
      'Declare your ordered plan for THIS task before you start editing: the 3–7 high-level steps you will actually take (real steps, not micro-tasks). They render live for the human as your progress tracker, so make them legible and honest. Call ONCE per run, then advance_beat as each step completes. If you already maintain a TodoWrite list, use one or the other — not both.',
    params: (z) => ({ steps: z.array(z.string().min(1).max(200)).min(1).max(12).describe('the ordered, human-legible steps for this task') }),
  },
  advance_beat: {
    description:
      'Mark a declared step complete THE MOMENT it lands (the human watches these tick off live) — or blocked if you cannot finish it. Steps are 1-based, in the order you declared them.',
    params: (z) => ({
      step: z.number().int().min(1).describe('the 1-based step number from your declare_beats plan'),
      blocked: z.boolean().optional().describe('true if this step is stuck instead of done — explain why in your summary'),
    }),
  },
  search_x: {
    // the leg copy (marketing-os round) — research legs read X through the room's connector,
    // same honesty rules as the orchestrator/chat copies (host/searchx.ts is the ONE impl)
    description:
      'Search X (Twitter) for the LAST 7 DAYS of public posts, with real author handles and real engagement numbers. Use it for ANY question about what is being said on X — x.com blocks unauthenticated reads, so WebSearch/WebFetch produce guesses; this returns facts or an honest failure. Reads are metered against the room\'s connected account: search deliberately, with a specific query, and never fill a failure with guessed posts or numbers.',
    params: (z) => ({
      query: z.string().min(2).max(400).describe('an X search query — supports X operators, e.g. `"ai agents" -is:retweet lang:en` or `from:handle`'),
      max: z.number().int().min(10).max(25).optional().describe('how many posts to return (10–25, default 10)'),
    }),
  },
  draft_replies: {
    // the worker/leg copy (reply-radar round) — the turn that FOUND the conversations hands
    // them over; host/tools-replies.ts is the ONE card writer behind both copies
    description:
      'Hand over REPLY OPPORTUNITIES as one card in the thread — each row carries the post being answered (author, link, its text, its reach) AND your drafted reply. Use it for every "what should we reply to" ask, on any network. NEVER hand replies over as a markdown list or a file — the card is the delivery. Only a target you actually found and can link; a row found by web research (no connector read) MUST set source:"web" with NO numbers.',
    params: (z) => ({
      report: z.string().max(200).optional().describe('the report artifact these came from, e.g. engage-report-2026-08-22.md'),
      baseline: z.string().max(200).optional().describe('one honest line on the brand\'s own reach, so the ranking means something'),
      replies: z.array(z.object({
        target: z.object({
          platform: z.enum(['x', 'linkedin', 'instagram', 'tiktok']),
          source: z.enum(['connector', 'web']).describe('"connector" = the room\'s connected account (real metrics); "web" = public research (no numbers)'),
          handle: z.string().min(1).max(40).describe('the author handle, without the @'),
          name: z.string().max(60).optional(),
          url: z.string().min(8).max(500).describe('the real permalink — never constructed'),
          age: z.string().max(12).optional(),
          text: z.string().min(1).max(2000).describe('the post being answered, verbatim'),
          metrics: z.object({ impressions: z.number().optional(), likes: z.number().optional(), reposts: z.number().optional(), replies: z.number().optional() }).optional(),
        }),
        draft: z.string().min(1).max(1000).describe('the reply exactly as it would post'),
        why: z.string().max(160).optional(),
        imageBrief: z.string().max(2000).optional().describe('art direction — only when a picture genuinely helps; it is drawn for the human to download'),
      })).min(1).max(8),
    }),
  },
  // The repository reads (docs/design/github-connector-2026-09): host/reporead.ts is the ONE
  // implementation behind the orchestrator, chat and worker copies; the words live in tooldesc.ts
  // so the three registries cannot drift.
  list_repo_changes: {
    description: REPO_CHANGES_DESC,
    params: (z) => ({
      since: z.string().optional().describe('an ISO date; the window starts here (default: the last 30 days)'),
    }),
  },
  read_repo_file: {
    description: REPO_FILE_DESC,
    params: (z) => ({
      path: z.string().min(1).max(500).describe('the file path from the repository root, e.g. CHANGELOG.md or src/app/page.tsx'),
      ref: z.string().max(200).optional().describe('a branch, tag or commit (default: the default branch)'),
    }),
  },
  list_repo_files: {
    description: REPO_TREE_DESC,
    params: (z) => ({
      path: z.string().max(500).optional().describe('a directory to list (default: the whole repository, capped)'),
      ref: z.string().max(200).optional().describe('a branch, tag or commit (default: the default branch)'),
    }),
  },
} satisfies Record<string, ToolSpec>;

export type SpeccedTool = keyof typeof TOOL_SPECS;
