// The orchestrator registry MANIFEST — asserted against the BUILT registry, never source text.
//
// Why this exists (2026-08-18 audit): the #272 domain split dropped the whiteboard spread from
// buildOrchestratorTools' return. Every test stayed green for five days because the existing
// guard greps the FILE for `name: 'create_whiteboard'` — and the dead definitions still sat in
// the file. Meanwhile the orchestrator's contract commanded "never say you cannot draw" at a
// registry with no drawing tool, the exact prompt-loses-to-tool-inventory failure the codebase
// documents twice. A manifest over the built registry cannot be fooled that way: what this test
// sees is what a turn is handed.
//
// EDITING: a deliberate registry change updates the pinned sets IN THE SAME COMMIT — the same
// contract as the byte fingerprints in contracts.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NM_VERBS, toolAvailable, toolVerb, type NmTool } from '@neuramesh/shared';
import { buildStubOrchestratorRegistry } from '../promptmeter';
import { fileTools } from '../runtime/starter';

// The tools every orchestrator turn kind carries today. Kind differences ride on top.
const BASE = [
  // accept_task (2026-09-08): accept on the human's WORD — the Accept button's replacement, routeTools
  'accept_task', 'add_agent_to_channel', 'add_backlog_item', 'add_subtask', 'create_agent', 'create_project',
  'create_task', 'draft_article', 'draft_posts', 'draft_replies', 'generate_image', 'list_agents', 'list_backlog', 'list_library',
  // the repository reads (2026-09-19, docs/design/github-connector-2026-09): what shipped, a file, the tree (host/tools-repo.ts)
  // shelve_repo_screenshot (2026-10-06): a real app screenshot taken from the repository for a video beat's SHOW line (host/chattools-product.ts); it replaced make_product_image
  'list_playbooks', 'list_projects', 'list_repo_changes', 'list_repo_files', 'list_repos', 'list_tasks', 'list_workspace', 'load_skill', 'offer_task',
  // propose_angles (2026-09-19): the UGC playbook's angle card, before any creator script is drafted (host/ugcflow.ts)
  'post_thread', 'promote_backlog_item', 'propose_angles', 'propose_design_round', 'propose_impl_plan',
  // read_drafts (2026-09-19): the cards on screen, read before revise_posts rewrites one (host/chattools-drafts.ts)
  'propose_library_doc', 'read_drafts', 'read_library_doc', 'read_repo_file', 'read_workspace_file', 'recall', 'register_repo',
  'request_changes', 'request_design', 'request_plan', 'request_verdict', 'revise_design',
  'revise_plan', 'revise_posts', 'revise_replies', 'revise_ship_plan', 'run_playbook', 'schedule_posts', 'search_x',
  'share_images', 'shelve_repo_screenshot', 'start_deep_work', 'take_task', 'task_status', 'unschedule_posts', 'update_backlog_item',
];
const WB_ALL = ['create_whiteboard', 'update_whiteboard', 'list_whiteboards', 'read_whiteboard'];

const MANIFEST: Record<string, string[]> = {
  // a conversation wake: full board powers + fan-out + drawing + the thread-title tool, and the routine writer's two
  // (2026-10-01, host/tools-routine.ts): the draft card in this session, or the offer of a new session for one
  triage: [...BASE, ...WB_ALL, 'spawn', 'set_thread_title', 'propose_routine', 'offer_routine_session'].sort(),
  // advancing an owned task: same minus the conversation-only namer
  own: [...BASE, ...WB_ALL, 'spawn'].sort(),
  // Sweeps are SCOPED (2026-08-18 diet): each gets exactly what its prompt instructs. Before,
  // every 15-minute tick carried all 41 tools to usually answer NO_REPLY.
  'sweep.digest': ['list_backlog', 'list_tasks', 'post_thread', 'recall', 'task_status'].sort(),
  'sweep.watchdog': ['list_agents', 'list_tasks', 'offer_task', 'post_thread', 'recall', 'request_changes',
    'request_verdict', 'revise_design', 'revise_plan', 'revise_ship_plan', 'task_status'].sort(),
  // no create_task, no propose_impl_plan (2026-09-19): a self-check routes existing work, it never mints a unit
  'sweep.monitor': ['list_agents', 'list_backlog', 'list_tasks', 'offer_task', 'post_thread',
    'recall', 'request_changes', 'request_design', 'request_plan', 'request_verdict',
    'revise_design', 'revise_plan', 'task_status'].sort(),
};

const BUILDS: Array<['triage' | 'own' | 'sweep', ('digest' | 'watchdog' | 'monitor')?]> =
  [['triage'], ['own'], ['sweep', 'digest'], ['sweep', 'watchdog'], ['sweep', 'monitor']];

for (const [kind, scope] of BUILDS) {
  const label = scope ? `${kind}.${scope}` : kind;
  test(`built ${label} registry matches its manifest exactly`, async () => {
    const tools = await buildStubOrchestratorRegistry(kind, scope);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, MANIFEST[label],
      `the BUILT ${label} registry diverged from the manifest — a dropped spread or an undeclared new tool`);
    // no duplicate registrations — two tools with one name means one silently shadows the other
    assert.equal(new Set(names).size, names.length, `duplicate tool names in the ${label} registry`);
  });
}

test('every catalogue-governed tool obeys TOOL_KINDS in the built registry', async () => {
  const governed: NmTool[] = ['spawn', 'create_whiteboard', 'update_whiteboard', 'list_whiteboards', 'read_whiteboard'];
  for (const [kind, scope] of BUILDS) {
    const names = new Set((await buildStubOrchestratorRegistry(kind, scope)).map((t) => t.name));
    for (const t of governed) {
      assert.equal(names.has(t), toolAvailable(t, kind),
        `'${t}' ${names.has(t) ? 'delivered to' : 'withheld from'} a ${kind} turn against the shared catalogue`);
    }
  }
});

// THE STEP WORDS (2026-10-05, the review of the homepage words round 2): a tool with no row in the shared
// NM_VERBS spoke its underscores on the run card ("accept task", "write file"), and the NeuraMesh brain logs
// every call by its bare name. so every tool a built registry hands a turn, and the brain worker's own
// file tools, has words, and the words are never an identifier, JSON or a model id.
test('every tool a registry hands a turn has its step words', async () => {
  const names = new Set<string>();
  for (const [kind, scope] of BUILDS) for (const t of await buildStubOrchestratorRegistry(kind, scope)) names.add(t.name);
  for (const t of fileTools('/tmp/nm-step-words', undefined)) names.add(t.name);
  for (const name of names) {
    assert.ok(Object.hasOwn(NM_VERBS, name), `'${name}' has no row in shared NM_VERBS: a run card would read its name`);
    // the line the NeuraMesh brain logs for a call (host/orchturn.ts: the name, then the JSON arguments)
    const verb = toolVerb({ kind: 'tool', phase: 'call', summary: `${name} {"taskNumber":1064}` })?.verb ?? '';
    assert.doesNotMatch(verb, /[{_]|gemini|claude|gpt-/i, `'${name}' reads "${verb}"`);
  }
});
