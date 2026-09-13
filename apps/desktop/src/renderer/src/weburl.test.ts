// The web's addresses derive from the connection's web url, with the baked default as the last rung.
// Run from apps/desktop:  pnpm exec tsx --test src/renderer/src/weburl.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WEB_URL_DEFAULT, downloadsUrl, setConnectionWebUrl, webUrl, workspaceHost } from './weburl';

test('the default is the baked site, and an empty connection url keeps it', () => {
  assert.equal(webUrl(), WEB_URL_DEFAULT);
  setConnectionWebUrl('');
  assert.equal(webUrl(), 'https://neuramesh.app');
  setConnectionWebUrl(null);
  assert.equal(webUrl(), 'https://neuramesh.app');
});

test('the workspace host is the app host with a slash: hq. before the apex, a dev host as is', () => {
  assert.equal(workspaceHost('https://neuramesh.app'), 'hq.neuramesh.app/');
  assert.equal(workspaceHost('https://hq.neuramesh.app'), 'hq.neuramesh.app/');
  assert.equal(workspaceHost('http://localhost:5173'), 'localhost:5173/');
  assert.equal(workspaceHost('http://127.0.0.1:5173/'), '127.0.0.1:5173/');
  assert.equal(workspaceHost('not a url'), 'hq.neuramesh.app/');
});

test('the downloads page is the real /downloads route on whatever site the connection names', () => {
  assert.equal(downloadsUrl('https://neuramesh.app'), 'https://neuramesh.app/downloads');
  assert.equal(downloadsUrl('https://nm.example/'), 'https://nm.example/downloads');
});

test('a connection web url set at bootstrap drives both readers', () => {
  setConnectionWebUrl('https://nm.example/');
  assert.equal(webUrl(), 'https://nm.example/');
  assert.equal(workspaceHost(), 'hq.nm.example/');
  assert.equal(downloadsUrl(), 'https://nm.example/downloads');
  setConnectionWebUrl(undefined);
  assert.equal(webUrl(), WEB_URL_DEFAULT);
});
