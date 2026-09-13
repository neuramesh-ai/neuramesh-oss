// the generated terminal page (S8): the bundle the WebView loads is whole — xterm, the bridge
// the screen posts to, and the mount point — so a stale or partial regeneration fails here, not
// as an empty pane on a phone.
import { describe, expect, it } from 'vitest';
import { TERMINAL_HTML } from '../src/terminal-html';

describe('terminal-html — the WebView page is whole', () => {
  it('is one document with the mount point, the bridge and xterm inside', () => {
    expect(TERMINAL_HTML.startsWith('<!doctype html>')).toBe(true);
    expect(TERMINAL_HTML).toContain('id="term"');
    expect(TERMINAL_HTML).toContain('ReactNativeWebView');
    expect(TERMINAL_HTML).toContain('.xterm');
    expect(TERMINAL_HTML.length).toBeGreaterThan(100_000);
  });
});
