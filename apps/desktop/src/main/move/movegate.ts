// Which move is possible from these connections (the door rule, main's half). Pure over the facts
// the registry holds, so the refusals are unit tests: no local workspace, no cloud connection, no
// Pro workspace on it, none the person owns. A workspace that already moved answers its marker,
// and the sheet shows H2 with Open instead of a second move.
import type { MoveTarget, MovedMarker } from './files';

export interface GateLocal { workspaceId: string; name: string; slug: string; marker: MovedMarker | null }
export interface GateCloud {
  connectionId: string;
  /** the workspace the cloud connection stands in: the default target when it qualifies */
  standingIn: string;
  workspaces: Array<{ id: string; name: string; slug: string; role?: string; plan?: string | null }>;
}
export type MoveGateCode = 'NO_LOCAL' | 'NO_CLOUD' | 'NOT_PRO' | 'NOT_OWNER';
export type MoveGate =
  | { ok: true; source: { workspaceId: string; name: string; slug: string }; targets: MoveTarget[]; target: MoveTarget; alreadyMoved: MovedMarker | null }
  | { ok: false; code: MoveGateCode; message: string };

/** every sentence main says about a move that cannot start (CLAUDE.md #11) */
export const GATE_COPY: Record<MoveGateCode, string> = {
  NO_LOCAL: 'This Mac has no workspace to migrate.',
  NO_CLOUD: 'Sign in to neuramesh.app first.',
  NOT_PRO: 'This account has no Pro workspace.',
  NOT_OWNER: 'Only the workspace owner can migrate a workspace into it.',
};

export function moveGate(local: GateLocal | null, cloud: GateCloud | null, want?: string): MoveGate {
  if (!local?.workspaceId) return { ok: false, code: 'NO_LOCAL', message: GATE_COPY.NO_LOCAL };
  const source = { workspaceId: local.workspaceId, name: local.name, slug: local.slug };
  if (local.marker) return { ok: true, source, targets: [], target: local.marker.target, alreadyMoved: local.marker };
  if (!cloud) return { ok: false, code: 'NO_CLOUD', message: GATE_COPY.NO_CLOUD };
  const pro = cloud.workspaces.filter((w) => w.plan === 'cloud');
  if (!pro.length) return { ok: false, code: 'NOT_PRO', message: GATE_COPY.NOT_PRO };
  const owned = pro.filter((w) => w.role === 'owner');
  if (!owned.length) return { ok: false, code: 'NOT_OWNER', message: GATE_COPY.NOT_OWNER };
  const targets: MoveTarget[] = owned.map((w) => ({ connectionId: cloud.connectionId, workspaceId: w.id, name: w.name, slug: w.slug }));
  const target = targets.find((t) => t.workspaceId === want) ?? targets.find((t) => t.workspaceId === cloud.standingIn) ?? targets[0]!;
  return { ok: true, source, targets, target, alreadyMoved: null };
}
