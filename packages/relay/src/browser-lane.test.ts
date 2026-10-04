import { describe, expect, it } from 'vitest';
import { admitBrowser, MAX_BROWSER_CHANNELS_PER_CLIENT, MAX_BROWSER_CHANNELS_PER_MACHINE } from './browser-lane';
import { parseMessage } from './protocol';

describe('the browser lane at the hub', () => {
  it('admits only on a machine whose hello named the lane', () => {
    expect(admitBrowser(new Set(['terminal', 'stream']), 0, 0)).toBe('lane');
    expect(admitBrowser(new Set(), 0, 0)).toBe('lane');
    expect(admitBrowser(new Set(['terminal', 'browser']), 0, 0)).toBe('ok');
  });

  it('holds the per-client and per-machine caps', () => {
    const lanes = new Set(['browser']);
    expect(admitBrowser(lanes, MAX_BROWSER_CHANNELS_PER_CLIENT - 1, 0)).toBe('ok');
    expect(admitBrowser(lanes, MAX_BROWSER_CHANNELS_PER_CLIENT, 0)).toBe('limit');
    expect(admitBrowser(lanes, 0, MAX_BROWSER_CHANNELS_PER_MACHINE)).toBe('limit');
  });

  it('a hello that names the lane keeps it, and an unknown lane name is dropped', () => {
    expect(parseMessage(JSON.stringify({ t: 'hello', machineId: 'm1', lanes: ['terminal', 'browser', 'teleport'] }))).toEqual({ t: 'hello', machineId: 'm1', lanes: ['terminal', 'browser'] });
  });
});
