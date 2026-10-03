// the browser lane's wire (packages/shared/src/browser-lane.ts): the open meta clamps the viewport,
// every viewer message is checked field by field, and the agent tab takes nothing that steers it.
import { describe, expect, it } from 'vitest';
import { agentTabAllows, b64Length, browserOpenMeta, parseBrowserInput, BROWSER_VIEWPORT, MAX_BROWSER_URL_CHARS } from '../src/browser-lane';

describe('the open meta', () => {
  it('names a tab and a size, and clamps the size to the viewport bounds', () => {
    expect(browserOpenMeta({ v: 1, tab: 'person', width: 812.6, height: 640 })).toEqual({ v: 1, tab: 'person', width: 813, height: 640 });
    expect(browserOpenMeta({ v: 1, tab: 'agent', width: 99_999, height: 10 })).toEqual({ v: 1, tab: 'agent', width: BROWSER_VIEWPORT.maxW, height: BROWSER_VIEWPORT.minH });
  });

  it('refuses another version, an unknown tab, and a size that is not a number', () => {
    expect(browserOpenMeta({ v: 2, tab: 'person', width: 800, height: 600 })).toBeNull();
    expect(browserOpenMeta({ v: 1, tab: 'admin', width: 800, height: 600 })).toBeNull();
    expect(browserOpenMeta({ v: 1, tab: 'person', width: '800', height: 600 })).toBeNull();
    expect(browserOpenMeta(null)).toBeNull();
  });
});

describe('viewer messages', () => {
  it('passes the messages it speaks', () => {
    expect(parseBrowserInput({ t: 'navigate', url: 'https://x.com' })).toEqual({ t: 'navigate', url: 'https://x.com' });
    expect(parseBrowserInput({ t: 'back' })).toEqual({ t: 'back' });
    expect(parseBrowserInput({ t: 'mouse', type: 'down', x: 10, y: 20, button: 'left', clicks: 1 })).toEqual({ t: 'mouse', type: 'down', x: 10, y: 20, button: 'left', clicks: 1 });
    expect(parseBrowserInput({ t: 'wheel', x: 1, y: 2, dx: 0, dy: -120 })).toEqual({ t: 'wheel', x: 1, y: 2, dx: 0, dy: -120 });
    expect(parseBrowserInput({ t: 'key', type: 'down', key: 'é', code: 'KeyE', keyCode: 69, mods: 8 })).toEqual({ t: 'key', type: 'down', key: 'é', code: 'KeyE', keyCode: 69, mods: 8 });
    expect(parseBrowserInput({ t: 'text', text: 'naïve 日本' })).toEqual({ t: 'text', text: 'naïve 日本' });
    expect(parseBrowserInput({ t: 'resize', width: 5000, height: 700 })).toEqual({ t: 'resize', width: BROWSER_VIEWPORT.maxW, height: 700 });
    expect(parseBrowserInput({ t: 'tab', tab: 'agent' })).toEqual({ t: 'tab', tab: 'agent' });
    expect(parseBrowserInput({ t: 'ack', n: 7 })).toEqual({ t: 'ack', n: 7 });
  });

  it('drops a message with any field out of bounds, never a part of it', () => {
    expect(parseBrowserInput({ t: 'navigate', url: '' })).toBeNull();
    expect(parseBrowserInput({ t: 'navigate', url: `https://a.com/${'x'.repeat(MAX_BROWSER_URL_CHARS)}` })).toBeNull();
    expect(parseBrowserInput({ t: 'mouse', type: 'down', x: -1, y: 0 })).toBeNull();
    expect(parseBrowserInput({ t: 'mouse', type: 'drag', x: 1, y: 1 })).toBeNull();
    expect(parseBrowserInput({ t: 'mouse', type: 'down', x: 1, y: 1, button: 'back' })).toBeNull();
    expect(parseBrowserInput({ t: 'mouse', type: 'move', x: Number.NaN, y: 1 })).toBeNull();
    expect(parseBrowserInput({ t: 'key', type: 'down', key: '', code: 'KeyA', keyCode: 65 })).toBeNull();
    expect(parseBrowserInput({ t: 'key', type: 'down', key: 'a', code: 'KeyA', keyCode: 65, mods: 16 })).toBeNull();
    expect(parseBrowserInput({ t: 'text', text: 'x'.repeat(2001) })).toBeNull();
    expect(parseBrowserInput({ t: 'ack', n: 1.5 })).toBeNull();
    expect(parseBrowserInput({ t: 'eval', code: 'alert(1)' })).toBeNull();
    expect(parseBrowserInput('{"t":"back"}')).toBeNull();
  });

  it('the agent tab takes a tab switch and acks, and nothing that steers the page', () => {
    const steer = [{ t: 'navigate', url: 'https://a.com' }, { t: 'reload' }, { t: 'mouse', type: 'down', x: 1, y: 1 }, { t: 'text', text: 'hi' }, { t: 'resize', width: 800, height: 600 }];
    for (const m of steer) expect(agentTabAllows(parseBrowserInput(m)!)).toBe(false);
    expect(agentTabAllows({ t: 'tab', tab: 'person' })).toBe(true);
    expect(agentTabAllows({ t: 'ack', n: 1 })).toBe(true);
  });

  it('measures a line the way base64 encodes it', () => {
    expect(b64Length(0)).toBe(0);
    expect(b64Length(1)).toBe(4);
    expect(b64Length(3)).toBe(4);
    expect(b64Length(4)).toBe(8);
    expect(b64Length(Buffer.byteLength('héllo'))).toBe(Buffer.from('héllo').toString('base64').length);
  });
});
