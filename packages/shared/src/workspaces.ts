// Multi-workspace membership (0113). A person belongs to a SET of workspaces —
// `workspace_members` is PK (workspace_id, user_id) and the PowerSync rules have always
// streamed every one of them into the same replica. What was missing was any client-side rule
// for which one you are standing in.
//
// This lives in `shared` rather than `client-core` because Electron's MAIN process needs it too,
// and main already depends on shared; client-core peer-depends on PowerSync, which has no
// business inside main for a rule this small.

/**
 * Which workspace to stand in, given every membership and the one last chosen.
 *
 * ONE rule for every client: honour the stored choice while it is still yours, otherwise fall
 * back to the first. Both clients got this wrong in different ways —
 *   · desktop used a flat `resolved[0]`, and /v1/workspaces orders by `created_at`, so accepting
 *     an invitation to a workspace OLDER than your own silently relocated you on the next boot
 *     (and, with the old wipe rule, took your local replica with it);
 *   · mobile used `select workspace_id from workspace_members limit 1`, which is not merely
 *     arbitrary but non-deterministic — a second membership could move the app between launches.
 *
 * Sharing the rule is what stops them drifting apart again. Returns null only when no membership
 * has synced yet, which callers should render as "still loading" rather than "no workspace".
 */
export function pickActiveWorkspace<T extends { id: string }>(
  memberships: readonly T[],
  stored: string | null | undefined,
): T | null {
  if (!memberships.length) return null;
  return memberships.find((w) => w.id === stored) ?? memberships[0]!;
}
