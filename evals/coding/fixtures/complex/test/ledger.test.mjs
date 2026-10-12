import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../src/ledger.mjs';
test('empty state', () => assert.deepEqual(migrate(null), {version:2,expenses:[]}));
