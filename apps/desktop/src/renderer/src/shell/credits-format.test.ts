import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fmtCredits } from './credits-format';

test('the ring\'s figure: three characters wide at most, never negative, never a decimal below a thousand', () => {
  assert.equal(fmtCredits(0), '0');
  assert.equal(fmtCredits(479), '479');
  assert.equal(fmtCredits(999), '999');
  assert.equal(fmtCredits(1000), '1k');
  assert.equal(fmtCredits(1500), '1.5k');
  assert.equal(fmtCredits(1549), '1.5k');
  assert.equal(fmtCredits(9950), '10k');
  assert.equal(fmtCredits(12_400), '12k');
  assert.equal(fmtCredits(-5), '0');
  assert.equal(fmtCredits(479.6), '480');
});
