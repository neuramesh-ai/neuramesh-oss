// A REPOSITORY BUNDLE ON A CLOUD RUN MACHINE (control-api repo-bundles.ts, NM_REPO_BUNDLES=1). A
// repository that is not on GitHub is a `git bundle` file a person uploaded to the workspace's GCS
// prefix. The machine fetches it through its own sign route (kind 'bundle', download only, scoped to
// the bearer's workspace) and the Code lane clones from the file (relay/engineering-workspace.ts).
//
// The file goes to the OS temp dir, never under /nm/work: it is only an input to `git clone`, and a
// copy in the work dir would ride every drain snapshot for nothing.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchedBundle } from '../relay/engineering-workspace';
import type { Snapshots } from './snapshot';

/** the bundle `key` as a local file, with the dispose that removes it after the clone. Throws when
 *  the workspace holds no bundle with that key, in words a person can act on. */
export async function fetchBundle(snapshots: Pick<Snapshots, 'fetchRaw'>, key: string, root: string = tmpdir()): Promise<FetchedBundle> {
  const dir = mkdtempSync(join(root, 'nm-bundle-'));
  const dispose = (): void => rmSync(dir, { recursive: true, force: true });
  try {
    const file = join(dir, `${key}.bundle`);
    if (!(await snapshots.fetchRaw('bundle', key, file))) throw new Error(`The repository bundle ${key} is not in this workspace's storage. Upload it again and link the new key.`);
    return { file, dispose };
  } catch (e) {
    dispose();
    throw e;
  }
}
