// The first hosted sign-in creates the workspace (source release 2026-09, unit U1b).
//
// The site's /pro page signs a person up, calls POST /auth/clerk, then polls GET /v1/workspaces
// for the workspace to put through checkout (apps/web pro.tsx waitForWorkspace). Before this,
// only the desktop wizard's workspace.create made one, so a person who arrived through the site
// had nothing to pay for. Now onAuthArrival (onauth.ts, the one hook every sign-in route reaches)
// creates one when the person has NO membership and NO invitation waiting, through the normal
// workspace.create command, so the gate exemption, the human check and the event are the same
// as for any other creation. Idempotent by that membership test: a second sign-in creates nothing.
//
// Named from the Clerk profile's first name, else the address's local part, with "'s workspace".
// The slug is derived and de-duplicated by asking: workspace.create refuses a taken slug with
// CONFLICT, and the next candidate carries a counter.
//
// Not under NM_LOCAL: the local stack seeds a user and no workspace, and the wizard creates it (unit U2).
//
// The first workspace is born with SIGNUP_GRANT_CREDITS (the first-run doors, 2026-09-19, George:
// "cloud should indicate free 500 credits to get started"): a free hosted account's first workspace
// gets 500 credits once, so the starter brain answers before a key is added. The grant is best
// effort behind the creation: a sign-in never fails because a ledger row did not land.
import { SIGNUP_GRANT_CREDITS } from '@neuramesh/shared';
import { grantCredits } from './credit-ledger';
import { sqlOf } from './credits';
import { DomainError } from './errors';
import { executeCommand } from './handler';
import { localMode } from './localmode';
import type { Store } from './store';

export function firstWorkspaceName(firstName: string | null, email: string | null): string {
  const who = firstName?.trim() || email?.split('@')[0]?.trim() || '';
  return (who ? `${who}'s workspace` : 'My workspace').slice(0, 60);
}

/** a slug candidate from the person's name: lowercase, dashes, 2 to 36 chars so a counter fits under 40 */
export function firstWorkspaceSlug(firstName: string | null, email: string | null): string {
  const who = firstName?.trim() || email?.split('@')[0]?.trim() || '';
  const base = who.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36).replace(/-+$/, '');
  if (base.length >= 2) return base;
  return base ? `${base}-workspace` : 'workspace';
}

export interface FirstWorkspaceInput {
  userId: string;
  email: string | null;
  firstName: string | null;
  /** the invitations onAuthArrival found waiting on the verified address; one waiting = no creation */
  pending: readonly string[];
}

const ATTEMPTS = 20;

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

/** Creates the person's first workspace when they have none, grants its starting credits, and answers what it made. */
export async function ensureFirstWorkspace(store: Store, a: FirstWorkspaceInput): Promise<{ workspaceId: string; slug: string } | null> {
  if (localMode()) return null;
  if (a.pending.length > 0) return null;
  if ((await store.listWorkspaces(a.userId)).length > 0) return null;
  const name = firstWorkspaceName(a.firstName, a.email);
  const base = firstWorkspaceSlug(a.firstName, a.email);
  const create = async (slug: string): Promise<{ workspaceId: string; slug: string }> => {
    const made = (await executeCommand(store, { kind: 'human', id: a.userId }, { type: 'workspace.create', name, slug })) as unknown as { workspaceId: string };
    console.log(`first_workspace_created user=${a.userId} workspace=${made.workspaceId} slug=${slug}`);
    await grantSignupCredits(store, made.workspaceId);
    return { workspaceId: made.workspaceId, slug };
  };
  for (let i = 1; i <= ATTEMPTS; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    try {
      return await create(slug);
    } catch (e) {
      if (e instanceof DomainError && e.code === 'CONFLICT') continue; // the slug is taken: next candidate
      throw e;
    }
  }
  // twenty people with the same name signed up before this one: a random tail, once
  return create(`${base}-${Math.random().toString(36).slice(2, 6)}`);
}
