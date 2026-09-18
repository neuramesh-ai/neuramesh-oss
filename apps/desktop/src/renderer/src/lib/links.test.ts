// The link seam (lib/links.ts): which URLs the door handles, how the choice's head reads them,
// which gestures skip the choice, and where a link goes with and without a chooser registered.
// Run from apps/desktop: pnpm exec tsx --test src/renderer/src/lib/links.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWebUrl, modGlyph, openLink, setExternalOpener, setLinkChooser, skipsChoice, splitUrl, type LinkAsk } from './links';

test('isWebUrl: the door handles http(s) and nothing else', () => {
  assert.equal(isWebUrl('https://github.com/acme/site/pull/12'), true);
  assert.equal(isWebUrl('http://localhost:5173/'), true);
  assert.equal(isWebUrl('nm:task/1042'), false);
  assert.equal(isWebUrl('mailto:team@example.com'), false);
  assert.equal(isWebUrl('javascript:alert(1)'), false);
  assert.equal(isWebUrl('file:///etc/hosts'), false);
  assert.equal(isWebUrl('not a url'), false);
});

test('splitUrl: host on the first line, the rest on the second, and a bare origin has no second line', () => {
  assert.deepEqual(splitUrl('https://github.com/acme/site/pull/1052'), { host: 'github.com', path: '/acme/site/pull/1052' });
  assert.deepEqual(splitUrl('https://x.com/rjchint/status/19?s=20#top'), { host: 'x.com', path: '/rjchint/status/19?s=20#top' });
  assert.deepEqual(splitUrl('https://x.com/'), { host: 'x.com', path: '' });
  assert.deepEqual(splitUrl('http://localhost:5173/board'), { host: 'localhost:5173', path: '/board' });
  assert.deepEqual(splitUrl('garbage'), { host: 'garbage', path: '' });
});

test('skipsChoice: ⌘/Ctrl and the middle button skip, a plain click asks', () => {
  assert.equal(skipsChoice({ metaKey: true }), true);
  assert.equal(skipsChoice({ ctrlKey: true }), true);
  assert.equal(skipsChoice({ button: 1 }), true);
  assert.equal(skipsChoice({ button: 0 }), false);
  assert.equal(skipsChoice({ shiftKey: true } as { metaKey?: boolean }), false);
  assert.equal(skipsChoice({}), false);
});

test('modGlyph: the Mac wears ⌘, everything else says Ctrl', () => {
  assert.equal(modGlyph('MacIntel'), '⌘');
  assert.equal(modGlyph('Win32'), 'Ctrl');
  assert.equal(modGlyph('Linux x86_64'), 'Ctrl');
});

test('openLink: with a chooser it asks, unless told to skip; without one it goes external', () => {
  const asked: LinkAsk[] = [];
  const opened: string[] = [];
  setLinkChooser((a) => asked.push(a));
  setExternalOpener((u) => opened.push(u));
  try {
    openLink('https://example.com/a', { anchor: { x: 10, y: 20 } });
    assert.deepEqual(asked, [{ url: 'https://example.com/a', anchor: { x: 10, y: 20 } }]);
    assert.deepEqual(opened, []);
    openLink('https://example.com/b', { skip: true });
    assert.deepEqual(opened, ['https://example.com/b']);
    assert.equal(asked.length, 1);
    // a non-web URL never reaches either door
    openLink('nm:plan');
    openLink('mailto:x@y.z', { skip: true });
    assert.equal(asked.length, 1);
    assert.equal(opened.length, 1);
    // the web client registers no chooser: every link goes external, which there is a new tab
    setLinkChooser(null);
    openLink('https://example.com/c');
    assert.deepEqual(opened, ['https://example.com/b', 'https://example.com/c']);
  } finally {
    setLinkChooser(null);
    setExternalOpener(null);
  }
});

test('openLink: nothing registered and no window (node) is a no-op, never a throw', () => {
  assert.doesNotThrow(() => openLink('https://example.com/'));
});
