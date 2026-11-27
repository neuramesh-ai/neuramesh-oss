import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationBrain } from './brain-sync';
import { withConversationBrain, conversationContext, conversationToolsThrough, setConversationHistoryBoundary, withoutConversationBrain, recordConversationEvent } from './brain-sync-context';

test('compacted tool events stay in the journal but no longer inflate model input', async () => {
  const events = [
    { id: 'old', type: 'tool.result', timestamp: '2026-10-01T00:00:00Z', payload: { output: 'historical-file-content' } },
    { id: 'recent', type: 'assistant.message', timestamp: '2026-10-02T00:00:00Z', payload: { text: 'Recent finding' } },
  ];
  let writes = 0;
  const brain = { events: () => events, record: () => { writes++; } } as unknown as ConversationBrain;
  await withConversationBrain(brain, async () => {
    assert.match(conversationToolsThrough('2026-10-01T12:00:00Z'), /historical-file-content/);
    setConversationHistoryBoundary('2026-10-01T12:00:00Z');
    assert.doesNotMatch(conversationContext(), /historical-file-content/);
    assert.match(conversationContext(), /Recent finding/);
    await withoutConversationBrain(async () => { assert.equal(conversationContext(), ''); recordConversationEvent('assistant.message', { text: 'Derived summary' }); });
    assert.equal(writes, 0);
    assert.equal(events.length, 2);
  });
  await withConversationBrain(brain, async () => { assert.match(conversationContext(), /historical-file-content/); });
});
