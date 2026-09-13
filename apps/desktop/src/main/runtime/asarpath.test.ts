// Remap of in-asar node_modules paths to their app.asar.unpacked twin — the fix for the packaged
// app's `wake failed: spawn ENOTDIR` (the Claude Agent SDK spawns its native CLI from a path inside
// app.asar, a regular FILE). Run:
//   node --import tsx --test apps/desktop/src/main/runtime/asarpath.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asarUnpackedPath } from './adapter';

const PACKED =
  '/Applications/NeuraMesh.app/Contents/Resources/app.asar/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.193/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude';
const UNPACKED =
  '/Applications/NeuraMesh.app/Contents/Resources/app.asar.unpacked/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.193/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude';

test('remaps a packed app.asar binary path to its app.asar.unpacked twin', () => {
  assert.equal(asarUnpackedPath(PACKED), UNPACKED);
});

test('a dev path (no app.asar segment) is returned unchanged — no-op outside the packaged app', () => {
  const dev =
    '/home/x/neuramesh/node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-darwin-arm64@0.3.193/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude';
  assert.equal(asarUnpackedPath(dev), dev);
});

test('only the exact /app.asar/ segment is rewritten — a dir named app.asarx is left alone', () => {
  const tricky = '/x/app.asarx/app.asar/node_modules/y/claude';
  assert.equal(asarUnpackedPath(tricky), '/x/app.asarx/app.asar.unpacked/node_modules/y/claude');
});

test('the rewritten path no longer traverses the app.asar file (the ENOTDIR cause)', () => {
  const out = asarUnpackedPath(PACKED);
  assert.ok(out.includes(`${'/app.asar.unpacked/'}node_modules/`));
  assert.ok(!out.includes('/app.asar/node_modules/'));
});
