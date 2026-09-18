// Mini-browser guest policy (browser-guard.ts): what a dock-browser <webview> may
// load, where popups go, and which srcs may attach. Pure, so the security posture
// is unit-testable without Electron.
// Run from apps/desktop: pnpm exec tsx --test src/main/browser-guard.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedWebviewSrc, mainNavPolicy, mainPopupPolicy, navPolicy, popupPolicy, BROWSER_PARTITION } from './browser-guard';

test('allowedWebviewSrc: web + blank srcs attach, everything else is refused', () => {
  assert.equal(allowedWebviewSrc('https://example.com/'), true);
  assert.equal(allowedWebviewSrc('http://localhost:5173/'), true);
  assert.equal(allowedWebviewSrc('about:blank'), true);
  assert.equal(allowedWebviewSrc(''), true); // attribute-less first render
  assert.equal(allowedWebviewSrc(undefined), true);
  assert.equal(allowedWebviewSrc('file:///etc/passwd'), false);
  assert.equal(allowedWebviewSrc('javascript:alert(1)'), false);
  assert.equal(allowedWebviewSrc('chrome://settings'), false);
  assert.equal(allowedWebviewSrc('data:text/html,<b>x</b>'), false);
});

test('navPolicy: guests navigate the web only', () => {
  assert.equal(navPolicy('https://example.com/a'), 'allow');
  assert.equal(navPolicy('http://127.0.0.1:8080/'), 'allow');
  assert.equal(navPolicy('about:blank'), 'allow');
  assert.equal(navPolicy('file:///home/x'), 'deny');
  assert.equal(navPolicy('javascript:void(0)'), 'deny');
  assert.equal(navPolicy('ws://example.com/'), 'deny');
  assert.equal(navPolicy('not a url'), 'deny');
});

test('popupPolicy: web popups stay in the pane, mailto goes external, rest die', () => {
  assert.equal(popupPolicy('https://example.com/next'), 'same-pane');
  assert.equal(popupPolicy('http://localhost:3000/'), 'same-pane');
  assert.equal(popupPolicy('mailto:team@example.com'), 'external');
  assert.equal(popupPolicy('file:///etc/hosts'), 'deny');
  assert.equal(popupPolicy('javascript:alert(1)'), 'deny');
  assert.equal(popupPolicy(''), 'deny');
});

test('partition is the dedicated persistent mini-browser session', () => {
  assert.equal(BROWSER_PARTITION, 'persist:nm-browser');
});

test('mainPopupPolicy: the app window never keeps a popup; the web and mailto go to the OS browser', () => {
  assert.equal(mainPopupPolicy('https://github.com/acme/site/pull/12'), 'external');
  assert.equal(mainPopupPolicy('http://localhost:3000/'), 'external');
  assert.equal(mainPopupPolicy('mailto:team@example.com'), 'external');
  assert.equal(mainPopupPolicy('file:///etc/hosts'), 'deny');
  assert.equal(mainPopupPolicy('javascript:alert(1)'), 'deny');
  assert.equal(mainPopupPolicy(''), 'deny');
});

test('mainNavPolicy: the app keeps its own origin, hands the web to the OS browser, and is never replaced', () => {
  const dev = 'http://localhost:5173/index.html';
  const prod = 'file:///Applications/neuramesh.app/Contents/Resources/app.asar/out/renderer/index.html';
  assert.equal(mainNavPolicy(dev, 'http://localhost:5173/index.html?reload=1'), 'allow'); // a dev reload
  assert.equal(mainNavPolicy(dev, 'https://x.com/rjchint/status/1'), 'external');
  assert.equal(mainNavPolicy(prod, 'https://github.com/acme/site'), 'external');
  assert.equal(mainNavPolicy(prod, 'file:///Applications/neuramesh.app/Contents/Resources/app.asar/out/renderer/index.html'), 'allow');
  assert.equal(mainNavPolicy(dev, 'file:///etc/hosts'), 'deny'); // a web-served app may never load a file
  assert.equal(mainNavPolicy(prod, 'mailto:team@example.com'), 'external');
  assert.equal(mainNavPolicy(prod, 'javascript:alert(1)'), 'deny');
  assert.equal(mainNavPolicy(prod, 'about:blank'), 'deny');
  assert.equal(mainNavPolicy(prod, 'not a url'), 'deny');
});
