// the Pro trial's birth: a person's FIRST workspace starts with SIGNUP_GRANT_CREDITS (500, once)
// and its cloud machine (George, 2026-09-19 and 2026-09-25: "cloud is pro, with 500 free credits
// to start"). it runs inside workspace.create, so every door that makes that workspace gets it.
// before, only the first hosted sign-in did (first-workspace.ts): a person with an invitation
// waiting gets no workspace at sign-in, and when they chose "Set up my own workspace" (phone or
// web) the wizard's own workspace started with no credits and no machine, and its Launch step
// waited for a runner that never came.
//
// "first" is the sign-in's own test: no other membership at all, owned or not. a second workspace,
// or one made by a member of another workspace, gets neither, and the paid plan's flip
// (plan-flip.ts) mints its own runner. never under NM_LOCAL: the local stack bills nothing and runs
// on the person's own Mac. best effort, like the sign-in it rides: a workspace is never refused
// because a ledger row or a machine row did not land.
import { SIGNUP_GRANT_CREDITS } from '@neuramesh/shared';
import { grantCredits } from './credit-ledger';
import { sqlOf } from './credits';
import { localMode } from './localmode';
import { mintWorkspaceRunner } from './plan-flip';
import type { Store } from './store';

/** the credits a first workspace starts with: 500, once, the ledger's `signup` kind */
export async function grantSignupCredits(store: Store, workspaceId: string): Promise<boolean> {
  const sql = sqlOf(store);
  if (!sql) return false;
  try {
    await grantCredits(sql, workspaceId, SIGNUP_GRANT_CREDITS, 'signup', 'first workspace');
    console.log(`signup_grant workspace=${workspaceId} credits=${SIGNUP_GRANT_CREDITS}`);
    return true;
  } catch (e) {
    console.error(`signup_grant FAILED workspace=${workspaceId}:`, e);
    return false;
  }
}

/** is this the person's first workspace? any other membership, owned or not, means no */
export async function isFirstWorkspace(store: Store, userId: string, workspaceId: string): Promise<boolean> {
  return (await store.listWorkspaces(userId)).every((w) => w.id === workspaceId);
}

/** the trial's starting credits and cloud machine, for the person's first workspace */
export async function birthFirstWorkspace(store: Store, userId: string, workspaceId: string): Promise<void> {
  if (localMode()) return;
  try {
    if (!(await isFirstWorkspace(store, userId, workspaceId))) return;
  } catch (e) {
    console.error(`signup_birth_skipped workspace=${workspaceId}:`, e);
    return;
  }
  await grantSignupCredits(store, workspaceId);
  const sql = sqlOf(store);
  if (sql) await mintWorkspaceRunner(store, sql, workspaceId, 'signup');
}
