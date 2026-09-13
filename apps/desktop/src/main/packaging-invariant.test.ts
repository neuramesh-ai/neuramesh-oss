// THE PACKAGING INVARIANT, PINNED (2026-09-08).
//
// A workspace package is raw TypeScript, so electron-vite BUNDLES it into out/ and it is excluded
// from externalization in electron.vite.config.ts. The other half of that rule is where it may be
// declared: electron-builder ships `dependencies` as real node_modules, and under pnpm a workspace
// dependency is a symlink whose target sits outside apps/desktop. The asar packer refuses it:
//
//   ⨯ …/packages/relay/package.json must be under …/apps/desktop/   failedTask=build
//
// That is not hypothetical. It failed v0.122.0's second build (2026-09-05), the config comment was
// written to explain it, and then `@neuramesh/relay` was moved INTO dependencies and
// `@neuramesh/relay-client` was added there — so v0.123.0 died the same way.
//
// It stayed hidden because nothing runs electron-builder until a release tag: CI's
// `typecheck · test · build` compiles, it does not PACKAGE. So a packaging break can only surface
// during a release, which is the worst moment to find it. This test moves the discovery into the
// suite that runs on every PR. It reads the manifests as data, so it needs no build and no network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const read = (p: string): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(p, 'utf8')) as never;

// this file is src/main/, so the manifest is two levels up
const DESKTOP_PKG = join(import.meta.dirname, '..', '..', 'package.json');

test('no @neuramesh workspace package is a desktop runtime dependency', () => {
  const pkg = read(DESKTOP_PKG);
  const runtime = Object.keys(pkg.dependencies ?? {}).filter((k) => k.startsWith('@neuramesh/'));
  assert.deepEqual(
    runtime,
    [],
    `these are bundled by electron-vite, so declaring them in "dependencies" makes electron-builder try to PACKAGE them and the asar step fails with "must be under apps/desktop". Move them to devDependencies: ${runtime.join(', ')}`,
  );
});

test('every workspace package the main process bundles is declared in devDependencies', () => {
  const pkg = read(DESKTOP_PKG);
  const dev = Object.keys(pkg.devDependencies ?? {});
  // the exact set electron.vite.config.ts excludes from externalization — kept in step by hand,
  // because a package bundled but undeclared would not install at all
  for (const name of ['@neuramesh/shared', '@neuramesh/relay', '@neuramesh/relay-client']) {
    assert.ok(dev.includes(name), `${name} is excluded from externalization but is not in devDependencies`);
  }
});
