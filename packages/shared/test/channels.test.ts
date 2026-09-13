import { describe, it, expect } from 'vitest';
import { agentInChannel } from '../src/channels';

// Regression for the slug-collision bug: after migration 0043 two projects can
// each own a #dev with DISTINCT ids. Membership must key on the id, never the
// shared slug — otherwise an agent in project A's #dev reads as already in
// project B's #dev, hiding the "+ add to channel" button.
describe('agentInChannel', () => {
  const projAdev = '11111111-1111-1111-1111-111111111111'; // project A's #dev
  const projBdev = '22222222-2222-2222-2222-222222222222'; // project B's #dev (same slug, different id)
  const general = '33333333-3333-3333-3333-333333333333';

  it('is a member of the exact channel id it is registered to', () => {
    expect(agentInChannel(projAdev, projAdev)).toBe(true);
  });

  it('is NOT a member of a different channel that shares the slug', () => {
    // the bug: viewing project B's #dev must still offer the "+" for this agent
    expect(agentInChannel(projAdev, projBdev)).toBe(false);
  });

  it('matches one id among several registrations', () => {
    expect(agentInChannel(`${projAdev},${general}`, general)).toBe(true);
  });

  it('trims whitespace around comma-joined ids', () => {
    expect(agentInChannel(`${projAdev}, ${general}`, general)).toBe(true);
  });

  it('returns false when the agent has no registrations', () => {
    expect(agentInChannel('', projAdev)).toBe(false);
    expect(agentInChannel(null, projAdev)).toBe(false);
    expect(agentInChannel(undefined, projAdev)).toBe(false);
  });

  it('returns false when there is no channel context', () => {
    expect(agentInChannel(projAdev, '')).toBe(false);
  });
});
