import { test } from 'vitest';
import assert from 'node:assert/strict';
import { codingDeliveryPolicy } from '../src/coding-delivery';

test('screenshot cleanup does not create a fresh capture requirement', () => {
  assert.equal(codingDeliveryPolicy({}, ['Remove .nm-artifacts/validation before and after folders from the PR', 'Old screenshots are removed from Git tracking.']).visualEvidence, false);
  assert.equal(codingDeliveryPolicy({}, ['Remove stale screenshots and capture new screenshots of the page.']).visualEvidence, true);
  assert.equal(codingDeliveryPolicy({}, ['No database migration. Provide screenshots in both themes.']).visualEvidence, true);
  assert.equal(codingDeliveryPolicy({ visualEvidence: true }, ['Remove stale screenshots']).visualEvidence, true);
});
