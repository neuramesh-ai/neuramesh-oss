import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  engineeringActivePresentation,
  engineeringActivityPresentation,
  engineeringPlanItems,
  engineeringReasoningSeconds,
  groupEngineeringTranscript,
  streamingEngineeringText,
} from '../src/engineering/activity';
import type { EngineeringMessage } from '../src/engineering/domain';

const message = (id: string, role: EngineeringMessage['role'], body: string, tone: EngineeringMessage['tone'] = 'plain'): EngineeringMessage => ({
  id, role, body, tone, createdAt: '2026-08-30T12:00:00.000Z',
});

test('consecutive machine receipts form one activity run without swallowing conversation messages', () => {
  const blocks = groupEngineeringTranscript([
    message('a', 'tool', 'read_files completed', 'success'),
    message('b', 'tool', 'search_codebase completed', 'success'),
    message('c', 'assistant', 'I found the affected module.'),
    message('d', 'tool', 'run_commands completed', 'success'),
  ]);

  assert.equal(blocks.length, 3);
  assert.equal(blocks[0]?.kind, 'activity');
  assert.equal(blocks[0]?.kind === 'activity' ? blocks[0].messages.length : 0, 2);
  assert.equal(blocks[1]?.kind, 'message');
  assert.equal(blocks[2]?.kind, 'activity');
});

test('tool receipts use product language and preserve warning detail', () => {
  assert.deepEqual(engineeringActivityPresentation(message('a', 'tool', 'read_files completed', 'success')), {
    kind: 'read', title: 'Read repository files', detail: 'Completed', status: 'success',
  });
  assert.deepEqual(engineeringActivityPresentation(message('b', 'tool', 'run_commands failed · tests failed', 'warning')), {
    kind: 'command', title: 'Ran commands', detail: 'tests failed', status: 'warning',
  });
  assert.deepEqual(engineeringActivityPresentation(message('c', 'tool', 'Engineering connected · openai-native · gpt-5.5')), {
    kind: 'runtime', title: 'Runtime connected', detail: 'OpenAI · gpt-5.5', status: 'info',
  });
});

test('live narration reflects the real tool and falls back to the selected mode', () => {
  assert.equal(engineeringActivePresentation({ phase: 'tool', toolName: 'search_codebase', startedAt: 'now' }, 'act').title, 'Searching the codebase');
  assert.equal(engineeringActivePresentation({ phase: 'composing', startedAt: 'now' }, 'plan').title, 'Writing the response');
  assert.equal(engineeringActivePresentation(null, 'plan').title, 'Investigating the repository');
  assert.equal(engineeringActivePresentation(null, 'act').title, 'Working in the repository');
});

test('partial streamed prose hides presentation markers until final Markdown rendering', () => {
  assert.equal(streamingEngineeringText('**Planning**\n\n### Check `src/app.ts`'), 'Planning\n\nCheck src/app.ts');
});

test('reasoning duration comes from relay timestamps rather than a presentation timer', () => {
  const thought = message('thought', 'reasoning', 'Inspect the repository.');
  const answer = { ...message('answer', 'assistant', 'I found it.'), createdAt: '2026-08-30T12:00:04.400Z' };
  assert.equal(engineeringReasoningSeconds(thought, answer), 4);
  assert.equal(engineeringReasoningSeconds({ ...thought, streaming: true }, undefined, Date.parse('2026-08-30T12:00:02.200Z')), 2);
  assert.equal(engineeringReasoningSeconds({ ...thought, createdAt: 'invalid' }, answer), null);
});

test('work plan todos preserve explicit status and never infer completion from numbering', () => {
  assert.deepEqual(engineeringPlanItems(`## Work Plan
1. Inspect the repository.
- [~] 2. Implement the fix.
- [x] Add regression coverage.
- [ ] Run verification.

**Guardrail:** keep the API stable.`), [
    { text: 'Inspect the repository.', status: 'pending' },
    { text: 'Implement the fix.', status: 'active' },
    { text: 'Add regression coverage.', status: 'complete' },
    { text: 'Run verification.', status: 'pending' },
  ]);
});
