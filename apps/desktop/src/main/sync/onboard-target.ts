// WHICH WORKSPACE THE LAUNCH STEP FINISHES (the source-release round, unit U3a). The first hosted
// sign-in creates the person's first workspace on the server (control-api first-workspace.ts,
// unit U1b), so a desktop wizard that boots into it RESUMES it and names it here. The handler
// then adopts that workspace instead of minting one. A resume id the session does not hold a
// membership for is stale (the workspace was deleted, or the sign-in changed), and adopting it
// would bind the replica to a workspace the person cannot read: the handler creates instead.
export interface OnboardMembership { id: string; name: string; slug: string }

export type OnboardTarget =
  | { kind: 'adopt'; workspaceId: string; info: { name: string; slug: string } }
  | { kind: 'create' };

export function onboardTarget(input: { workspaceId?: string | undefined }, memberships: readonly OnboardMembership[]): OnboardTarget {
  if (!input.workspaceId) return { kind: 'create' };
  const held = memberships.find((m) => m.id === input.workspaceId);
  if (!held) return { kind: 'create' };
  return { kind: 'adopt', workspaceId: held.id, info: { name: held.name, slug: held.slug } };
}
