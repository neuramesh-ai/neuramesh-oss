/** Real provider smoke for the review flow. Uses an isolated repository and local model profile. */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyRemoteEngineeringEvent, beginRemoteEngineeringPrompt, canContinueEngineering, createEngineeringSession, type EngineeringRuntimeEvent } from '@neuramesh/shared';
import { createClineEngineeringHost } from '../src/main/relay/engineering-host';

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'nm-code-review-real-'));
  const cwd = join(root, 'repo');
  await mkdir(cwd);
  await writeFile(join(cwd, 'greeting.mjs'), "export const greeting = () => 'hello world';\n");
  await writeFile(join(cwd, 'README.md'), '# Greeting service\nA small JavaScript module.\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd });
  execFileSync('git', ['add', '.'], { cwd });
  execFileSync('git', ['-c', 'user.name=Review Test', '-c', 'user.email=review@test.local', 'commit', '-qm', 'fixture'], { cwd });
  process.env['CLINE_DATA_DIR'] = join(root, 'cline');
  process.env['NM_USERDATA'] = join(root, 'userdata');
  const model = process.env['NM_REVIEW_MODEL'] ?? 'claude-haiku-4-5-20251001';
  const events: EngineeringRuntimeEvent[] = [];
  let ui = createEngineeringSession({ id: 'review-proof', name: 'greeting-service', owner: 'test', branch: 'main', root: null });
  let resolveTurn: (() => void) | undefined;
  let rejectTurn: ((error: Error) => void) | undefined;
  const captures: unknown[] = [];
  console.log(JSON.stringify({ root, phase: 'starting' }));
  const session = await createClineEngineeringHost({
    apiUrl: 'http://127.0.0.1:8898', machineToken: '', workspaceId: 'a0000000-0000-0000-0000-00000000000a', brainSync: false,
    authHeaders: async () => ({ 'x-nm-actor': JSON.stringify({ kind: 'human', id: '00000000-0000-0000-0000-000000000001' }) }),
    resolveCwd: async () => ({ cwd, repoRoot: cwd }), resolveBrain: async () => ({ modelId: model }), log: () => {},
  }).open({ threadId: 'isolated-review-proof', actorId: '00000000-0000-0000-0000-000000000001', repoId: 'review-proof', repoName: 'greeting-service', branch: 'main', modelId: model, mode: 'plan',
    permissions: ui.permissions, policy: ui.policy,
  }, (event) => {
    events.push(event);
    if (event.type !== 'agent_event') console.log(JSON.stringify({ event: event.type, ...('status' in event ? { status: event.status } : {}) }));
    ui = applyRemoteEngineeringEvent(ui, event);
    if (event.type === 'approval') {
      captures.push(structuredClone(ui));
      // Only this smoke's own file edits are authorized. No command or network execution.
      queueMicrotask(() => session.command({ type: 'approval', approvalId: event.approvalId, approved: event.category === 'edit' || event.category === 'read' }));
    }
    if (event.type === 'ended') resolveTurn?.();
    if (event.type === 'error') rejectTurn?.(new Error(event.message));
  });
  const turn = async (prompt: string) => {
    ui = beginRemoteEngineeringPrompt(ui, prompt);
    const settled = new Promise<void>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject; });
    const timer = setTimeout(() => rejectTurn?.(new Error('Provider turn timed out')), 150_000);
    session.command({ type: 'prompt', prompt });
    try { await settled; await new Promise((resolve) => setTimeout(resolve, 250)); } finally { clearTimeout(timer); }
    captures.push(structuredClone(ui));
    console.log(JSON.stringify({ phase: 'turn_completed', state: ui.state }));
  };
  try {
    await turn('Use the read_files tool to read the repository files greeting.mjs and README.md. Do not use run_commands. What does this project do? Answer briefly. Do not propose changes or create a plan.');
    assert.equal(ui.pendingModeHandoff, null); assert.equal(canContinueEngineering(ui), false);
    await turn('Plan a small requested change: change the greeting to hello engineering and document that exact greeting in README.md. Do not implement yet. Record the implementation plan with propose_work_plan.');
    assert.equal(canContinueEngineering(ui), true, 'The typed plan must offer Act only after completion');
    ui = { ...ui, mode: 'act', pendingModeHandoff: null };
    session.command({ type: 'controls', controls: { mode: 'act', permissions: ui.permissions, policy: ui.policy } });
    await turn('Implement the approved plan using apply_patch. Read the resulting files to verify. Do not run shell commands.');
    const approvals = events.filter((event) => event.type === 'approval' && event.category === 'edit');
    assert.ok(approvals.length > 0);
    assert.ok(approvals.every((event) => event.changes?.length && event.changes.every((change) => !change.previewError)));
    assert.ok(approvals.some((event) => event.changes?.some((change) => change.before.includes('hello world') && change.after.includes('hello engineering'))));
    await writeFile(join(root, 'result.json'), JSON.stringify({ model, captures, events }, null, 2));
    console.log(JSON.stringify({ root, model, turns: 3, approvals: approvals.length, result: 'passed' }));
  } finally { session.close(); }
}
main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
