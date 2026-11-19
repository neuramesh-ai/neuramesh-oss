// The intake plan rides the coding agent's instructions (round 9), in both lanes through provider.instructions.
//   node --import tsx --test apps/desktop/src/main/relay/engineering-intake.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { engineeringIntakeBrief, resolveBrainWithIntake, withIntakeBrief } from './engineering-intake';
import { intakeNoteFor } from '../host/intake-note';
import type { EngineeringMachineOpenMeta } from '../../engineering-protocol';

const DECISION = JSON.stringify({
  v: 1, kind: 'coding', confidence: 0.93, title: 'Palindrome checker web app', name: 'palindrome-checker',
  plan: ['Create index.html with an input and a Check button', 'Write the palindrome check', 'Test it in the preview'],
  subtasks: [], workspace: 'repo', repoId: 'r1', source: 'starter',
});
const db = (thread: Record<string, unknown> | null, agents = 0) => ({
  async getAll<T>(sql: string): Promise<T[]> {
    if (sql.includes('from repos')) return [{ org_name: 'flowe', name: 'app' } as T];
    if (sql.includes('from messages')) return [{ n: agents } as T];
    return thread ? [thread as T] : [];
  },
});

test('the brief names the workspace repository and numbers the plan', async () => {
  const brief = await engineeringIntakeBrief(db({ intake: DECISION, task_id: null }), 'w1', 't1');
  assert.ok(brief);
  assert.match(brief!, /kind coding/);
  assert.match(brief!, /workspace: repo flowe\/app/);
  assert.match(brief!, /1\. Create index\.html/);
});

test('no brief for a task thread, a thread with no decision, or an older replica', async () => {
  assert.equal(await engineeringIntakeBrief(db({ intake: DECISION, task_id: 'k1' }), 'w1', 't1'), null);
  assert.equal(await engineeringIntakeBrief(db({ intake: null, task_id: null }), 'w1', 't1'), null);
  assert.equal(await engineeringIntakeBrief(db(null), 'w1', 't1'), null);
  assert.equal(await engineeringIntakeBrief({ getAll: async () => { throw new Error('no such column: intake'); } }, 'w1', 't1'), null);
});

test('the seat\'s own instructions come first, and no brief leaves the brain as it was', () => {
  type Brain = { modelId: string; instructions?: string };
  const seat: Brain = { modelId: 'm', instructions: 'Prefer small diffs.' };
  const plain: Brain = { modelId: 'm' };
  assert.deepEqual(withIntakeBrief<Brain>(seat, 'PLAN'), { modelId: 'm', instructions: 'Prefer small diffs.\n\nPLAN' });
  assert.deepEqual(withIntakeBrief<Brain>(plain, 'PLAN'), { modelId: 'm', instructions: 'PLAN' });
  assert.equal(withIntakeBrief<Brain>(plain, null), plain);
});

test('resolveBrain keeps its model and agent, and adds the plan', async () => {
  const resolve = resolveBrainWithIntake(db({ intake: DECISION, task_id: null }), 'w1', async (): Promise<{ modelId: string; agentId: string; instructions?: string }> => ({ modelId: 'gemini-4-argon', agentId: 'a1' }));
  const brain = await resolve({ threadId: 't1' } as EngineeringMachineOpenMeta);
  assert.equal(brain.modelId, 'gemini-4-argon');
  assert.equal(brain.agentId, 'a1');
  assert.match(brain.instructions ?? '', /Plan of action:/);
});

test('the orchestrator reads the decision on the first turn only, and knows the thread is named', async () => {
  const first = await intakeNoteFor(db({ intake: DECISION }), 't1');
  assert.equal(first.named, true);
  assert.match(first.note, /Intake \(decided on the first message\)/);
  const later = await intakeNoteFor(db({ intake: DECISION }, 1), 't1');
  assert.deepEqual(later, { note: '', named: true });
  assert.deepEqual(await intakeNoteFor(db({ intake: null }), 't1'), { note: '', named: false });
  assert.deepEqual(await intakeNoteFor(db({ intake: DECISION }), null), { note: '', named: false });
});
