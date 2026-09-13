// AUTHORSHIP ON THE BEARER LANE (2026-09-09). The desktop host has sent a Clerk bearer since
// #360, with x-nm-actor carrying WHO WROTE THE ROW on the lanes that post as an agent — and the
// bearer branch of the /v1 gate discarded the claim, so every agent-authored message and command
// a desktop hosted landed under the signed-in human. rex's replies then read as George's own
// words, each one woke rex again, and #marketing looped on itself (485 rows in one evening, 300
// of them in three minutes once an add-agent card kept re-triggering its own offer).
//
// The rule mirrors the machine lane's machineMayClaim: a member may author rows for an agent of
// a workspace they belong to, and an illegitimate claim is REFUSED (null here, 403 at the gate —
// never 401, which makes the desktop sign itself out), never quietly re-attributed. A human claim
// never overrides the verified bearer: the token says who is here.
import type { Actor } from '@neuramesh/shared';
import { ActorSchema } from './commands';

export interface BearerAuthStore {
  agentWorkspace(agentId: string): Promise<string | null>;
  humanMemberIds(workspace: string): Promise<string[]>;
}

/** the acting identity for the verified member `userId` and the raw x-nm-actor header; null = refuse */
export async function resolveBearerActor(store: BearerAuthStore, userId: string, rawHeader: string | undefined): Promise<Actor | null> {
  let claim: Actor | null = null;
  try { const parsed = ActorSchema.safeParse(JSON.parse(rawHeader ?? 'null')); claim = parsed.success ? parsed.data : null; } catch { claim = null; }
  if (!claim || claim.kind !== 'agent') return { kind: 'human', id: userId };
  const workspace = await store.agentWorkspace(claim.id).catch(() => null);
  if (!workspace) return null;
  return (await store.humanMemberIds(workspace)).includes(userId) ? claim : null;
}
