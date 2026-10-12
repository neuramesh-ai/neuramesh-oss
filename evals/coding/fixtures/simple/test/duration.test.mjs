import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDuration } from '../src/duration.mjs';
test('zero seconds', () => assert.equal(formatDuration(0), '0:00:00'));
