import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preparedEngineeringPatch, previewEngineeringChanges } from './engineering-preview';
import { engineeringPlanTool } from './engineering-plan';

test('previews show exact per-file snapshots without writing, including delete-add replacement and rename', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nm-review-test-'));
  try {
    await writeFile(join(root, 'a.ts'), 'keep\nold\n');
    await writeFile(join(root, 'gone.ts'), 'remove\n');
    const patch = '*** Begin Patch\n*** Delete File: a.ts\n*** Add File: a.ts\n+keep\n+new\n*** Delete File: gone.ts\n*** Add File: new.ts\n+added\n*** End Patch';
    const files = await previewEngineeringChanges(root, 'apply_patch', { input: patch });
    assert.equal(files.length, 3);
    assert.equal(files[0]?.previewError, undefined);
    assert.deepEqual(files.map(({ path, kind }) => [path, kind]), [['a.ts', 'modified'], ['gone.ts', 'deleted'], ['new.ts', 'added']]);
    assert.equal(files[0]?.before, 'keep\nold\n'); assert.equal(files[0]?.after, 'keep\nnew\n');
    assert.match(files[0]!.diff, / keep\n-old\n\+new/);
    assert.equal(await readFile(join(root, 'a.ts'), 'utf8'), 'keep\nold\n');
    const { createApplyPatchExecutor } = await import('@cline/sdk');
    await createApplyPatchExecutor()({ input: await preparedEngineeringPatch(root, patch) }, root, { agentId: 'test', conversationId: 'test', iteration: 0 });
    assert.equal(await readFile(join(root, 'a.ts'), 'utf8'), files[0]?.after);
    const rename = await previewEngineeringChanges(root, 'apply_patch', { input: '*** Begin Patch\n*** Update File: a.ts\n*** Move to: moved.ts\n@@\n keep\n-new\n+renamed\n*** End Patch' });
    assert.equal(rename[0]?.path, 'moved.ts'); assert.equal(rename[0]?.previousPath, 'a.ts');
    assert.equal(rename[0]?.after, 'keep\nrenamed\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('invalid patches and symlink escapes never claim a complete snapshot or leak file contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nm-review-test-'));
  const outside = await mkdtemp(join(tmpdir(), 'nm-review-outside-'));
  try {
    await writeFile(join(outside, 'private'), 'do-not-read-this\n');
    await symlink(join(outside, 'private'), join(root, 'link'));
    const patch = '*** Begin Patch\n*** Delete File: link\n*** End Patch';
    const files = await previewEngineeringChanges(root, 'apply_patch', { input: patch });
    assert.ok(files[0]?.previewError); assert.doesNotMatch(JSON.stringify(files), /do-not-read-this/);
    await assert.rejects(preparedEngineeringPatch(root, patch));
    await writeFile(join(root, 'a'), 'real\n');
    const invalid = await previewEngineeringChanges(root, 'apply_patch', { input: '*** Begin Patch\n*** Update File: a\n@@\n-missing\n+new\n*** End Patch' });
    assert.ok(invalid[0]?.previewError);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('plan tool records only structured actionable proposals and executes no work', () => {
  const events: unknown[] = [];
  const tool = engineeringPlanTool((event) => events.push(event));
  assert.throws(() => tool.execute({ summary: 'This is a web app', steps: [] }));
  const plan = { summary: 'Fix the greeting', steps: [{ action: 'edit', target: 'a.ts', description: 'Correct the greeting' }] };
  const result = tool.execute(plan);
  assert.equal(result.recorded, true);
  assert.match(result.planProgress.id, /^[a-f0-9-]{36}$/);
  assert.deepEqual(events, [{ type: 'work_plan', planId: result.planProgress.id, plan }]);
});

test('plan tool requests an authored overview and preserves its decision points', () => {
  const events: unknown[] = [];
  const tool = engineeringPlanTool((event) => events.push(event));
  assert.ok(tool.inputSchema.required.includes('report'));
  assert.ok(tool.inputSchema.required.includes('considerations'));
  const plan = { report: { investigation: 'I inspected the existing greeting and its tests.', decisions: ['Reuse the current structure to preserve callers.'], nextStep: 'Continue in Act to implement and verify.' }, summary: 'Add a welcome greeting.', keyPoints: ['Preserve the existing greeting.', 'Check missing and invalid names.'], considerations: ['Confirm the default language.'], steps: [{ action: 'edit', target: 'a.ts', description: 'Add welcome()' }] };
  const result = tool.execute(plan);
  assert.match(result.message, /one short readiness sentence only/);
  assert.deepEqual(events, [{ type: 'work_plan', planId: result.planProgress.id, plan }]);
  assert.throws(() => tool.execute({ ...plan, keyPoints: ['invalid\nheading'] }));
});
