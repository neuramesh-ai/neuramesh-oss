import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddress, type Address } from '../src/index';

const valid: Array<[string, Address]> = [
  ['human:george', { kind: 'human', id: 'george' }],
  ['agent:patch', { kind: 'agent', id: 'patch' }],
  ['machine:m-georges-mbp', { kind: 'machine', id: 'm-georges-mbp' }],
  ['task:1042', { kind: 'task', id: '1042' }],
  ['channel/dev', { kind: 'channel', slug: 'dev' }],
  ['project/marketing-site', { kind: 'project', slug: 'marketing-site' }],
  ['resource/artifact/scr-001', { kind: 'resource', type: 'artifact', id: 'scr-001' }],
];

describe('addressing', () => {
  it.each(valid)('round-trips %s', (text, address) => {
    expect(parseAddress(text)).toEqual(address);
    expect(formatAddress(address)).toBe(text);
  });

  it.each([
    [''],
    ['bogus:x'],
    ['human:'],
    ['channel/'],
    ['channel/dev/extra'],
    ['resource/artifact'],
    ['project/-leading-dash'],
    ['agent:has space'],
  ])('rejects %s', (text) => {
    expect(parseAddress(text)).toBeNull();
  });
});
