import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineeringAttachmentAcknowledgements } from './webnm-relay';

test('Engineering attachment acknowledgements resolve the matching upload chunk', async () => {
  const acknowledgements = createEngineeringAttachmentAcknowledgements(100);
  const pending = acknowledgements.wait('upload:0');
  acknowledgements.resolve('upload:0');
  await pending;
});

test('a missing Engineering attachment acknowledgement rejects at the transport deadline', async () => {
  const acknowledgements = createEngineeringAttachmentAcknowledgements(5);
  await assert.rejects(acknowledgements.wait('upload:0'), /upload timed out/);
});
