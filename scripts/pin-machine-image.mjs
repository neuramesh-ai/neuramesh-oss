#!/usr/bin/env node
// Point the fleet at a machine image build.
//
//   pnpm fleet:pin              # the commit currently on origin/main
//   pnpm fleet:pin <sha|tag>    # a specific build (rollback: an older commit's sha)
//   pnpm fleet:pin --check      # exit 1 if the pin is behind origin/main, print the fix
//
// WHY A SCRIPT AND NOT A HAND EDIT. The pin is a 40-character sha inside a yaml value, and a
// typo there does not fail: the operator writes an image that does not exist, every workspace
// StatefulSet rolls to ImagePullBackOff, and the fleet goes down while the config still looks
// plausible in review. So the sha is copied by a machine, and --check is what CI runs so a daemon
// change that never reached the fleet is visible rather than assumed.
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const FILE = 'infra/k8s/cluster/overlays/gke/fleet-deployment.yaml';
const REPO = 'us-east4-docker.pkg.dev/neuramesh-prd/nm/machine';
const LINE = new RegExp(`(value:\\s*)${REPO}:(\\S+)`);

// The paths machine-image.yml rebuilds on. The pin must be compared against the last commit that
// would have produced a NEW IMAGE, not against main's tip: most commits change neither the daemon
// nor the image, and a check that fires on all of them is a check nobody reads. (Shipped wrong the
// first time and warned immediately on an infra-only commit.)
const IMAGE_PATHS = ['infra/images/machine', 'apps/desktop/src/main', 'packages/shared/src', 'pnpm-lock.yaml'];

const args = process.argv.slice(2);
const check = args.includes('--check');
const lastImageCommit = () =>
  execSync(`git log -1 --format=%H origin/main -- ${IMAGE_PATHS.join(' ')}`, { encoding: 'utf8' }).trim();
const wanted = args.find((a) => !a.startsWith('--')) ?? lastImageCommit();

const yaml = readFileSync(FILE, 'utf8');
const found = yaml.match(LINE);
if (!found) {
  console.error(`could not find a ${REPO} pin in ${FILE} — has the env var been renamed?`);
  process.exit(2);
}
const current = found[2];

if (current === wanted) {
  console.log(`fleet machine image is already pinned to ${current.slice(0, 12)}`);
  process.exit(0);
}

if (check) {
  // A NOTICE, NOT A FAILURE. Not every daemon change needs an immediate fleet roll, and blocking
  // main on that judgement would teach people to bypass the check. Naming the exact command is
  // what turns "someone should remember" into something you can act on in one line.
  console.log(`::warning::the fleet is pinned to ${current.slice(0, 12)} but the newest daemon build is ${wanted.slice(0, 12)} — workspaces are running older daemon code.`);
  console.log(`  to roll the fleet:  pnpm fleet:pin && git commit -am 'chore(fleet): roll machines to ${wanted.slice(0, 12)}' && push`);
  process.exit(1);
}

writeFileSync(FILE, yaml.replace(LINE, `$1${REPO}:${wanted}`));
console.log(`fleet machine image: ${current.slice(0, 12)} -> ${wanted.slice(0, 12)}`);
console.log('commit and merge it; fleet-deploy applies the operator, which rolls every workspace.');
