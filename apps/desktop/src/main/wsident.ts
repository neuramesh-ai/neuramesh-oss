import { pickActiveWorkspace } from '@neuramesh/shared';

// Workspace identity for the local replica: what replica.json holds and which
// identity a boot should act as. Pure (no electron imports) so the contract is
// testable — the 2026-07-10 incident class it prevents: a network blip during
// boot made /v1/workspaces fail once, the app silently fell back to the dev-seed
// identity ("Acme Robotics" + the dev workspace id), showed a phantom workspace,
// and the marker mismatch wiped the user's offline replica. These rules make
// that impossible: a cloud-mode boot never acts as the dev seed, and the replica
// is only wiped when the identity is authoritative.

export interface WorkspaceIdent {
  workspaceId: string;
  name?: string;
  slug?: string;
}

// replica.json contents — tolerant of the pre-identity shape ({ workspaceId }
// only) and of garbage (missing file reads pass null through).
export function parseWorkspaceIdent(raw: string | null | undefined): WorkspaceIdent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { workspaceId?: unknown; name?: unknown; slug?: unknown };
    if (typeof v.workspaceId !== 'string' || !v.workspaceId) return null;
    return {
      workspaceId: v.workspaceId,
      name: typeof v.name === 'string' ? v.name : undefined,
      slug: typeof v.slug === 'string' ? v.slug : undefined,
    };
  } catch {
    return null;
  }
}

export interface BootPick {
  ws: string;
  info: { name: string; slug: string };
  // true only when the id came from a successful API resolution — the sole
  // license to wipe a mismatched replica or stamp the marker.
  authoritative: boolean;
  needsOnboarding: boolean;
  /** the existing-but-unfinished workspace to carry on with. ONLY set when onboarding resumes;
   *  a first-ever run has no workspace to resume, and passing one would make the wizard skip the
   *  step that creates it. */
  resumeWorkspaceId?: string;
}

// Which identity should this boot act as?
// - resolved (the API answered): the workspace the marker names IF you are still a member of it,
//   otherwise the first. An empty list → onboarding.
// - unresolved + marker: the last-synced identity — cached data stays readable offline.
// - unresolved + no marker: keep the current id but a neutral display identity,
//   never the dev seed's.
//
// Preferring the marker is what makes multi-workspace membership survivable. This used to be a
// flat `resolved[0]`, and /v1/workspaces orders by created_at — so accepting an invitation to a
// workspace OLDER than your own silently moved you into it on the next boot (and, with the old
// wipe rule below, took your local replica with it). Membership is a set now; which one you are
// standing in is YOUR choice, persisted in the marker. `[0]` remains the first-ever-boot default.
export function pickBootWorkspace(args: {
  /** `onboarded` is false for a workspace that exists but never finished the wizard — absent
   *  (older server) is treated as finished, so a stale API can never eject a working user. */
  resolved: Array<{ id: string; name: string; slug: string; onboarded?: boolean }> | null;
  marker: WorkspaceIdent | null;
  current: { ws: string; info: { name: string; slug: string } };
}): BootPick {
  if (args.resolved?.length) {
    // shared with mobile so the two clients cannot drift on this rule
    const chosen = pickActiveWorkspace(args.resolved, args.marker?.workspaceId)!;
    // HAVING a workspace is not the same as having FINISHED one. This rule used to be "the list
    // is non-empty, so you are done", which was true while the wizard created the workspace at
    // its last step. The browser now mints it at the FIRST step — the cloud machine is
    // provisioned against its id — so a refresh at the brain step left a real, empty workspace
    // and dropped the user into an app with no crew and no rooms (George, 2026-08-28).
    // `onboarded === false` is the only value that resumes: undefined means an older server that
    // does not answer the question, and guessing "unfinished" there would eject a working user.
    const unfinished = chosen.onboarded === false;
    return {
      ws: chosen.id, info: { name: chosen.name, slug: chosen.slug }, authoritative: true,
      needsOnboarding: unfinished,
      ...(unfinished ? { resumeWorkspaceId: chosen.id } : {}),
    };
  }
  if (args.resolved) return { ws: args.current.ws, info: { name: '', slug: '' }, authoritative: true, needsOnboarding: true };
  if (args.marker) {
    return {
      ws: args.marker.workspaceId,
      info: { name: args.marker.name ?? '', slug: args.marker.slug ?? '' },
      authoritative: false,
      needsOnboarding: false,
    };
  }
  return { ws: args.current.ws, info: { name: '', slug: '' }, authoritative: false, needsOnboarding: false };
}

// The replica holds every workspace you belong to — the sync rules stream `workspace_id in
// (select workspace_id from my_workspaces)`, plural — so switching BETWEEN your workspaces is a
// scope change, not a generation change, and must not cost a re-download.
//
// Wipe only when the workspace the replica last synced is one we are sure you are no longer in:
// a different account, or a workspace deleted and recreated under the same marker. Passing the
// membership set is what distinguishes those from an ordinary switch. An unresolved boot still
// never wipes — that would destroy offline data on a network blip (the 2026-07-10 incident).
export function shouldWipeReplica(
  lastWs: string | null,
  ws: string,
  authoritative: boolean,
  memberOf?: readonly string[],
): boolean {
  if (!lastWs || lastWs === ws || !authoritative) return false;
  // `undefined` = the caller could not tell us (legacy path): fall back to the old rule rather
  // than assuming membership we have not seen.
  return memberOf ? !memberOf.includes(lastWs) : true;
}

/**
 * Has this identity's WORKSPACE MEMBERSHIP changed since we last looked?
 *
 * PowerSync computes a connection's buckets when the stream is established, from `my_workspaces`
 * in the sync rules. A membership granted afterwards therefore streams NOTHING until the client
 * reconnects — which is why "added to a workspace while the app was running" looked like a broken
 * replica (0 machines, 0 agents, the pill reading Local) and why quitting and relaunching
 * "fixed" it (George, live, 2026-08-13).
 *
 * Order-insensitive: `/v1/workspaces` makes no ordering promise, and re-sorting must never read
 * as a change — a false positive here reconnects the stream on every poll.
 */
export function membershipChanged(prev: readonly string[], next: readonly string[]): boolean {
  if (prev.length !== next.length) return true;
  const seen = new Set(prev);
  return next.some((id) => !seen.has(id));
}
