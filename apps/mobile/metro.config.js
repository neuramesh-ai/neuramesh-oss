// Metro for this pnpm monorepo. Keep pnpm's isolated linker (symlinks) — do NOT
// hoist; the desktop app's node_modules layout is load-bearing (patched
// @powersync/node, onlyBuiltDependencies).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Scope the crawl to ONLY what the app imports — the store + the four workspace
// packages (client-core · shared · relay-client, the phone's Code lane since the
// mobile-cloud round S5 · fonts, the house face's static cuts) — not the whole repo root
// (.git, apps/desktop/Electron), which hangs the file crawler.
config.watchFolders = [
  path.resolve(monorepoRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'packages/client-core'),
  path.resolve(monorepoRoot, 'packages/shared'),
  path.resolve(monorepoRoot, 'packages/relay-client'),
  path.resolve(monorepoRoot, 'packages/fonts'),
];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.unstable_enableSymlinks = true;

// This machine's watchman is broken (dyld: libfmt.11 missing), which HANGS Metro's
// file-map init. Force the Node file watcher. (Remove once watchman is repaired:
// `brew reinstall watchman`.)
config.resolver.useWatchman = false;

// Pin React + friends to the app's SINGLE copy. Hierarchical lookup (left enabled so
// every package's nested transitive deps resolve through pnpm's symlink tree) can
// otherwise load two Reacts, which nulls the hooks dispatcher ("Cannot read property
// 'useMemo' of null"). Re-resolving these from a fixed app-root origin forces one
// instance. `context.resolveRequest` here is Metro's default resolver (no recursion).
const SINGLETONS = /^(react|react-native)(\/|$)/;
const appOrigin = path.join(projectRoot, 'index.js');
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (SINGLETONS.test(moduleName)) {
    return context.resolveRequest({ ...context, originModulePath: appOrigin }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
