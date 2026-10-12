import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OPEN_ENGINEERING_POLICY, RECOMMENDED_ENGINEERING_PERMISSIONS } from '@neuramesh/shared';
import type { ToolApprovalRequest } from '@cline/sdk';
import { requestEngineeringApproval } from './engineering-approvals';

test('records exact review bytes before asking and never treats the receipt as permission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nm-record-review-'));
  const pending = new Map<string, (approved: boolean) => void>();
  const records: Array<{ type: string; payload: unknown }> = [];
  try {
    await writeFile(join(root, 'file.txt'), 'old\n');
    const request = { toolCallId: 'edit-1', toolName: 'apply_patch', input: { input: '*** Begin Patch\n*** Update File: file.txt\n@@\n-old\n+new\n*** End Patch' } } as ToolApprovalRequest;
    const result = await requestEngineeringApproval(request,
      { mode: 'act', permissions: RECOMMENDED_ENGINEERING_PERMISSIONS, policy: OPEN_ENGINEERING_POLICY }, [], pending,
      event => {
        assert.equal(event.type, 'approval');
        const review = records.find(r => r.type === 'review.proposed')?.payload as { changes: Array<{ before: string; after: string }> };
        assert.equal(review.changes[0]?.before, 'old\n');
        assert.equal(review.changes[0]?.after, 'new\n');
        pending.get('edit-1')!(false);
      }, (type, payload) => records.push({ type, payload }), root);
    assert.equal(result.approved, false);
    assert.equal(await readFile(join(root, 'file.txt'), 'utf8'), 'old\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});
