// THE SCRATCH WORKSPACE OF A CODING THREAD (round 9, 0177). A coding thread with
// `threads.workspace_mode = 'scratch'` has no repository. The machine makes a fresh local git
// repository for it (apps/desktop relay/engineering-scratch.ts), with the same worktree shape a
// repository session has, so file review, diffs, commands and the dependency cache work the same.
//
// The client opens the session with SCRATCH_REPO_ID in place of a repository id. The machine trusts
// the thread row (workspace_mode), not this id: the id only says that the client has no repository.
import type { IntakeDecision } from '../intake';
import type { EngineeringRepo } from './domain';

export const SCRATCH_REPO_ID = 'scratch';
export const SCRATCH_WORKSPACE_LABEL = 'Scratch workspace';
export const isScratchRepoId = (id: string | null | undefined): boolean => id === SCRATCH_REPO_ID;

const MAX_NAME = 40;

/** a kebab-case name for the scratch repository and its folder: the intake's name, else the thread
 *  title, else `scratch`. Only a to z, 0 to 9 and single dashes */
export function scratchWorkspaceName(intake: Pick<IntakeDecision, 'name'> | null | undefined, title?: string | null): string {
  for (const raw of [intake?.name, title]) {
    const name = (raw ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_NAME).replace(/-+$/, '');
    if (name) return name;
  }
  return 'scratch';
}

/** the repository a client opens a scratch thread's session with */
export function scratchEngineeringRepo(): EngineeringRepo {
  return { id: SCRATCH_REPO_ID, name: SCRATCH_WORKSPACE_LABEL, owner: '', branch: 'main', root: null };
}
