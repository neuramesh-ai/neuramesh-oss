// A RECORDED CODING THREAD in the harness (#716, the twin of apps/hq/preview/mock-coding-history.ts): the brain's snapshot of the harness's coding thread,
// so the no-machine reader restores real turns instead of the catch-all's empty answer, and the
// thread's artifacts, an edited file among them (two rows with one name: the newer row wins). Kept
// apart from mock-nm.ts and mock-fixtures.ts (both at their size caps) and spread into them; the
// entries are runtime keys, so the drift guard still counts them.
import { engineeringUnifiedDiff, type BrainConversationEvent, type BrainThreadSnapshot, type EngineeringChange } from '@neuramesh/shared';
import { CODING_THREAD_ID, mockThreadArts } from './mock-fixtures';

const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const svg = (label: string) => `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><rect width="360" height="120" rx="12" fill="#26303d"/><text x="28" y="72" font-family="Geist, sans-serif" font-size="30" fill="#eef2f7">${label}</text></svg>`)))}`;

export const codingArts = [
  { id: 'ca-welcome-1', kind: 'file', name: 'welcome.svg', mime: 'image/svg+xml', inline_content: svg('Welcome'), size_bytes: 516, promoted: 0, message_id: null, task_id: null, created_at: at(380_000) },
  { id: 'ca-notes', kind: 'doc', name: 'sync-notes.md', mime: 'text/markdown', inline_content: '# Sync notes\n\nThe watch resumes from its last cursor after a reconnect, so no reply is lost.', size_bytes: 88, promoted: 0, message_id: null, task_id: null, created_at: at(300_000) },
  { id: 'ca-welcome-2', kind: 'file', name: 'welcome.svg', mime: 'image/svg+xml', inline_content: svg('Welcome, Zoë!'), size_bytes: 518, promoted: 0, message_id: null, task_id: null, created_at: at(120_000) },
];
mockThreadArts[CODING_THREAD_ID] = codingArts;

const agent = { id: 'a-rex', name: 'rex', role: 'orchestrator' };
const event = (type: string, payload: unknown, id: string, msAgo: number): BrainConversationEvent => ({ id, type, payload, timestamp: at(msAgo) });
const core = (body: Record<string, unknown>, id: string, msAgo: number) => event('runtime.event', { type: 'agent_event', payload: { event: body } }, id, msAgo);
const before = 'export function watch(cursor: string) {\n  return subscribe({ from: "now" });\n}\n';
const after = 'export function watch(cursor: string) {\n  return subscribe({ from: cursor });\n}\n';
const change: EngineeringChange = { path: 'src/sync.ts', kind: 'modified', before, after, diff: engineeringUnifiedDiff({ path: 'src/sync.ts', kind: 'modified', before, after }) };
const plan = {
  summary: 'Resume the sync watch from its last cursor after a reconnect.',
  report: { investigation: 'The watch subscribes from now on each reconnect, so replies sent while it was down never arrive.', decisions: ['Keep the fix inside sync.ts.'], nextStep: 'Continue in Act to edit sync.ts and run the tests.' },
  steps: [{ action: 'edit', target: 'src/sync.ts', description: 'Subscribe from the saved cursor' }, { action: 'command', target: 'npm test', description: 'Run the tests' }],
};

const snapshot = (workspace: string): BrainThreadSnapshot => ({
  workspace, threadId: CODING_THREAD_ID, revision: 7,
  metadata: { mode: 'act', selection: { agentId: 'a-rex', modelId: 'gpt-6-astra', reasoningEffort: 'medium' }, agent },
  events: [
    event('user.message', { text: 'The sync watch drops thread replies after a reconnect. Find why and fix it. Keep the fix inside sync.ts.', agent, mode: 'plan' }, 'e1', 420_000),
    core({ type: 'content_end', contentType: 'tool', toolName: 'propose_work_plan', toolCallId: 'plan' }, 'e2', 400_000),
    event('user.message', { text: 'Continue', agent, mode: 'act' }, 'e3', 360_000),
    event('tool.approval', { toolCallId: 'patch', toolName: 'apply_patch', input: {} }, 'e4', 340_000),
    event('review.proposed', { approvalId: 'patch', changes: [change] }, 'e5', 339_000),
    event('approval.resolved', { approvalId: 'patch', approved: true }, 'e6', 330_000),
    core({ type: 'content_end', contentType: 'tool', toolName: 'apply_patch', toolCallId: 'patch' }, 'e7', 329_000),
    core({ type: 'content_end', contentType: 'text', text: 'The watch now resumes from its saved cursor. The tests pass. I left [the notes](.nm-artifacts/sync-notes.md) and the [welcome card](.nm-artifacts/welcome.svg).' }, 'e8', 110_000),
    // the runtime's checkpoint history: the Checkpoints tab lists a row for each run
    event('runtime.event', { type: 'session_snapshot', payload: { snapshot: { checkpoint: { history: [{ runCount: 1, createdAt: Date.now() - 415_000 }, { runCount: 2, createdAt: Date.now() - 355_000 }] } } } }, 'e8b', 105_000),
    event('runtime.event', { type: 'ended', payload: { reason: 'completed' } }, 'e9', 100_000),
  ],
  runtimeMessages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'plan', name: 'propose_work_plan', input: plan }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'plan', content: JSON.stringify({ recorded: true }) }] },
  ],
});

export const codingHistoryLanes = {
  // the bridge with no machine (the web build with no relay, web/webnm-local.ts): a handle that refuses work.
  // The catch-all answers an empty promise, and a restore's close on unmount calls close on it.
  openEngineering: () => ({ subId: '', send: async () => { throw new Error('No machine is available for this workspace yet.'); }, close: () => {} }),
  engineeringHistory: async (threadId: string, workspace: string): Promise<BrainThreadSnapshot> => {
    if (threadId !== CODING_THREAD_ID) throw new Error('The harness records one coding thread.');
    return snapshot(workspace);
  },
};
