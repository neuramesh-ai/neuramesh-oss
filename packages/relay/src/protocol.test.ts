import { describe, expect, it } from 'vitest';
import { MAX_CHANNEL_DATA_B64_CHARS, parseMessage } from './protocol';

describe('channel frame limits', () => {
  it('accepts bounded data and rejects oversized payloads before routing', () => {
    expect(parseMessage(JSON.stringify({ ch: 'code-1', t: 'data', d: 'e30=' }))).not.toBeNull();
    expect(parseMessage(JSON.stringify({ ch: 'code-1', t: 'data', d: 'x'.repeat(MAX_CHANNEL_DATA_B64_CHARS + 1) }))).toBeNull();
  });

  it('rejects data frames without a payload', () => {
    expect(parseMessage(JSON.stringify({ ch: 'code-1', t: 'data' }))).toBeNull();
  });
});
