// pnpm's manifest hook, for dependencies whose own manifests are wrong for this repo.
//
// The coding runtime's two sign-in lanes (@cline/llms loads ai-sdk-provider-claude-code and
// ai-sdk-provider-codex-cli, apps/desktop relay/engineering-provider.ts) are written for zod 4: the Codex one
// calls passthrough() on a refined object, which zod 3 lacks, so it threw at load. They name zod as a PEER,
// though, so pnpm hands them the desktop's zod 3, and neither an override nor a package extension moves a peer.
// Here their zod becomes their own dependency, the zod 4 that @cline/llms already uses.
// Every image that installs with --frozen-lockfile copies this file beside the lockfile.
const ZOD_FOUR = new Set(['ai-sdk-provider-claude-code', 'ai-sdk-provider-codex-cli']);

function readPackage(pkg) {
  if (ZOD_FOUR.has(pkg.name)) {
    if (pkg.peerDependencies) delete pkg.peerDependencies.zod;
    if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta.zod;
    pkg.dependencies = { ...pkg.dependencies, zod: '^4.3.6' };
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
