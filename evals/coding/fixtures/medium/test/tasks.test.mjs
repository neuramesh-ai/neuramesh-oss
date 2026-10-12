import test from 'node:test';
import assert from 'node:assert/strict';
import { addTask } from '../src/tasks.mjs';
test('adds trimmed title', () => assert.equal(addTask([], ' Buy milk ', 'a')[0].title, 'Buy milk'));
