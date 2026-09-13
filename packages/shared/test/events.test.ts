import { describe, expect, it } from 'vitest';
import { EventSchema, TRANSITION_EVENT, TRANSITIONS, createEvent } from '../src/index';

describe('event envelope', () => {
  it('creates schema-valid events with monotonic sortable ids', () => {
    const a = createEvent({
      type: 'task.created',
      source: 'agent:rex',
      target: 'task:1042',
      workspace: 'ws_acme',
      payload: { title: 'fix mobile navigation' },
    });
    const b = createEvent({
      type: 'task.claimed',
      source: 'agent:patch',
      target: 'task:1042',
      workspace: 'ws_acme',
      inReplyTo: a.id,
    });

    expect(EventSchema.parse(a)).toEqual(a);
    expect(b.id > a.id).toBe(true);
    expect(b.in_reply_to).toBe(a.id);
  });

  it('rejects unknown event types and invalid addresses', () => {
    expect(
      EventSchema.safeParse({
        id: '0'.repeat(26),
        type: 'task.exploded',
        source: 'agent:patch',
        target: 'task:1',
        workspace: 'ws',
        ts: new Date().toISOString(),
      }).success,
    ).toBe(false);

    expect(() =>
      createEvent({ type: 'task.created', source: 'not an address', target: 'task:1', workspace: 'ws' }),
    ).toThrow();
  });

  it('every transition has an event type', () => {
    for (const t of TRANSITIONS) expect(TRANSITION_EVENT[t.name]).toBeDefined();
  });
});
