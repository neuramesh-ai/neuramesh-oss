// the run step words (docs/26, docs/29): what the ghost pill and the run card say an agent does.
// a person reads them, so they are the simple present with the agent as the subject (2026-10-05),
// and no identifier, JSON or model id ever reaches them.
// run from packages/shared:
//   pnpm test runverbs
import { describe, expect, it } from 'vitest';
import { NM_TOOLS } from '../src/harness';
import { NM_VERBS, toolVerb } from '../src/runs';

const call = (summary: string) => ({ kind: 'tool', phase: 'call' as string | null, summary });
// the house exception is "Thinking…", and a step names files and commands the person wrote
const STE_BREAK = /[—;]|\b\w{2,}ing\b/;
// a verb a person may never read: raw JSON, an identifier's underscore, a model id
const RAW = /[{_]|gemini|claude|gpt-|sonnet|opus|flash/i;

describe('the step words are the simple present', () => {
  it('names the file, the command and the search', () => {
    expect(toolVerb(call('Read src/pages/pricing/PricingPage.tsx'))?.verb).toBe('reads PricingPage.tsx');
    expect(toolVerb(call('Edit src/pages/pricing/PlanToggle.tsx'))?.verb).toBe('edits PlanToggle.tsx');
    expect(toolVerb(call('Bash: pnpm test pricing --run'))?.verb).toBe('runs pnpm test pricing');
    // the codex lane logs its commands as "bash cmd" (runtime/codexsdk.ts)
    expect(toolVerb(call('bash pnpm test --run'))).toEqual({ verb: 'runs pnpm test --run', cat: 'cmd' });
    expect(toolVerb(call('Grep annual src'))?.verb).toBe('searches the repository');
    expect(toolVerb(call('WebSearch annual plan pricing'))?.verb).toBe('searches “annual plan pricing”');
    expect(toolVerb(call('WebFetch https://www.neuramesh.app/pricing'))?.verb).toBe('reads neuramesh.app/pricing');
  });

  it('no platform tool word breaks the house rules or points at nothing', () => {
    for (const [tool, v] of Object.entries(NM_VERBS)) {
      expect(v.verb, tool).not.toMatch(STE_BREAK);
      // alone on a run card, "it" and "its" point at nothing (the review of round 2)
      expect(v.verb, tool).not.toMatch(/\bits?\b/);
    }
  });

  it('every tool in the shared catalogue has its words', () => {
    for (const tool of NM_TOOLS) expect(NM_VERBS[tool]?.verb, tool).toBeTruthy();
  });
});

// a turn row is the reply only when it is the model's own words (the review of round 2): the context
// line every wake logs and the CLI's opening inventory read "writes the reply" before the agent wrote any
describe('a turn row', () => {
  const turn = (summary: string, phase: string | null = null) => toolVerb({ kind: 'turn', phase, summary });
  it('is the reply when the model wrote it', () => {
    expect(turn('Here is the plan for the annual toggle.')?.verb).toBe('writes the reply');
    expect(turn('')?.verb).toBe('writes the reply');
  });
  it('is nothing when it is the context, a round or an inventory', () => {
    expect(turn('context 41k of 200k · transcript 12 · lessons 3', 'inject')).toBeNull();
    expect(turn('planner draft ready', 'moa')).toBeNull();
    expect(turn("reviewing the architect's plan for #12", 'review')).toBeNull();
    expect(turn('tools: mcp servers: nm=connected · nm tools in the prompt: 41')).toBeNull();
    expect(turn('claude: mcp server nm failed to start')).toBeNull();
  });
});

describe('a tool logged by its bare name speaks its words, never its name or its JSON', () => {
  it('the NeuraMesh brain logs `name {json}` and the harness tools log `name args`', () => {
    expect(toolVerb(call('create_task {"title":"Add an annual price toggle","legs":["build","review"]}'))?.verb).toBe('creates the task');
    expect(toolVerb(call('read_repo_file src/pages/pricing/PricingPage.tsx'))).toEqual({ verb: 'reads a repository file', cat: 'file' });
    expect(toolVerb(call('draft_posts — 3 drafts'))?.verb).toBe('drafts the posts');
    expect(toolVerb(call('spawn marketer · three drafts'))?.verb).toBe('starts a subagent');
    expect(toolVerb(call('accept_task #1064 on the human\'s word'))?.verb).toBe('accepts the task');
    expect(toolVerb(call('park {"until":"ci","prNumber":212}'))?.verb).toBe('pauses the work');
    expect(toolVerb(call('write_file report.md (2311b)'))).toEqual({ verb: 'writes a file', cat: 'file' });
    expect(toolVerb(call('web_open {"url":"https://neuramesh.app/pricing"}'))?.verb).toBe('opens a page');
    // an unmapped tool still speaks its underscores rather than show them
    expect(toolVerb(call('brand_new_tool {"a":1}'))?.verb).toBe('brand new tool');
  });

  it('a Claude Code tool named bare gets words, and its plumbing gets none', () => {
    expect(toolVerb(call('Task'))?.verb).toBe('starts a subagent');
    expect(toolVerb(call('MultiEdit'))?.verb).toBe('edits a file');
    expect(toolVerb(call('ToolSearch'))).toBeNull();
    expect(toolVerb(call('SomeNewTool'))?.verb).toBe('some new tool');
  });

  it('a subagent start never shows its model id', () => {
    const v = toolVerb(call('leg "three drafts" · marketer · gemini-3.5-flash-lite · 4m'))?.verb ?? '';
    expect(v).toBe('starts a subagent');
    expect(v).not.toMatch(RAW);
  });

  it('the nm. lane is unchanged, a plain sentence still passes through, and a key the table inherits is no tool', () => {
    expect(toolVerb(call('nm.task_status'))?.verb).toBe('checks the board');
    expect(toolVerb(call('nm.some_new_tool'))?.verb).toBe('some new tool');
    expect(toolVerb(call('attached repo https://github.com/acme/web'))?.verb).toBe('attached repo https://github.com/acme/web');
    expect(toolVerb(call('nm.constructor'))?.verb).toBe('constructor');
    expect(toolVerb(call('mystery {"a":1}'))?.verb).toBe('mystery');
  });
});

// the daemon's own log lines (each `kind: 'tool', phase: 'call'` summary in apps/desktop/src/main, with
// values filled in): whatever a lane logs, the step line holds no JSON, no identifier and no model id
describe('the daemon\'s real log lines', () => {
  const LINES = [
    'create_task {"title":"Add an annual price toggle","kind":"feature"}',
    'offer_task {"taskNumber":1064,"agentName":"patch","checklist":["a toggle"]}',
    'set_thread_title {"title":"Annual price toggle"}',
    'accept_task #1064 on the human\'s word',
    'accept_task #1064 (refused)',
    'add_backlog_item "Try a yearly coupon" → #1065',
    'add_subtask "Write the docs" → #1066',
    'advance_beat 2',
    'create_whiteboard "Pricing flow"',
    'declare_beats (4 steps)',
    'draft_article — launch-notes.md',
    'draft_posts — 3 drafts',
    'draft_replies (2)',
    'generate_image — a/b',
    'list_library room',
    'list_repo_changes since 2026-10-01',
    'list_repo_files src/pages',
    'load_skill frontend-ui-engineering (agent-skills)',
    'make_product_image hero.png',
    'promote_backlog_item #1065 → todo',
    'propose_angles — 3 angles, platforms x, lengths 15/30',
    'propose_design_round #1064 · round 1 · 3 mockup(s)',
    'propose_impl_plan #1064 · legs build→review',
    'propose_library_doc brand-guidelines.md',
    'propose_skill release-notes',
    'read_drafts — 3 drafts',
    'read_library_doc brand-guidelines.md',
    'read_repo_file src/pages/pricing/PricingPage.tsx',
    'read_workspace_file notes.md',
    'record_lesson "Run the pricing tests before a push"',
    'revise_posts — a/b',
    'revise_replies — a',
    'run_playbook launch → #1070',
    'screenshot http://localhost:5173 → shot.png (212KB)',
    'search_x annual pricing',
    'share_images — 2/3',
    'spawn developer · build the toggle · 4m',
    'take_task #1064 — owning it',
    'update_whiteboard 3f9c2a1d… → rev 4',
    'write_file report.md (2311b)',
    'read_file {"path":"brand-guidelines.md"}',
    'list_files {}',
    'park {"until":"ci","prNumber":212}',
    'web_open {"url":"https://neuramesh.app"}',
    'web_click {"ref":"ref_12"}',
    'leg "three drafts" · marketer · 4m',
    'leg "three drafts" · marketer · gemini-3.5-flash-lite · 4m',
    'bash pnpm test --run',
    'request_verdict {"taskNumber":1064}',
    'list_workspace {}',
    'open_code_session {}',
    'file_conversation {"room":"build"}',
    'schedule_posts {"slots":[]}',
    'unschedule_posts {"letters":["a"]}',
    'propose_routine {"goal":"a weekly digest"}',
    'offer_routine_session {}',
  ];
  it('every one reads as words', () => {
    for (const line of LINES) {
      const v = toolVerb(call(line))?.verb ?? '';
      expect(v, line).not.toMatch(RAW);
      expect(v, line).not.toMatch(STE_BREAK);
    }
  });
});
