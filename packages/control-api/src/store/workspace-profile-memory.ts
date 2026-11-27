// The in-memory store's half of the company profile (docs/design/onboarding-2026-11 O2, O7), kept out of
// memory.ts, which is at its size cap. pgstore checks owner or admin in the transaction. The memory store has
// no roles to read, so it stores what it is given. Its boot backfill keeps only the profile half of the
// pgstore rule: it seeds no starter rooms, so its tests plant rooms by hand, and the no-agents half would
// only get in their way.
import type { CompanyProfile, NMEvent } from '@neuramesh/shared';
import { DomainError } from '../errors';

export async function setWorkspaceProfileMem(
  workspaces: Array<{ id: string; name: string; profile?: CompanyProfile | null }>,
  events: NMEvent[],
  workspaceId: string,
  input: { name?: string; profile: CompanyProfile; by: string },
  makeEvent: (workspace: string) => NMEvent,
): Promise<{ id: string }> {
  const w = workspaces.find((x) => x.id === workspaceId);
  if (!w) throw new DomainError('NOT_FOUND', 'workspace not found');
  // card 1 keeps what Sales setup wrote (offer, customer) when it names none, as pgstore does
  w.profile = { ...(w.profile?.offer ? { offer: w.profile.offer } : {}), ...(w.profile?.customer ? { customer: w.profile.customer } : {}), ...input.profile };
  if (input.name) w.name = input.name;
  events.push(makeEvent(workspaceId));
  return { id: workspaceId };
}
