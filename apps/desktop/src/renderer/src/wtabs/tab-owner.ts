// THE TAB'S SESSION (#717 review): a tab belongs to the session that asked for it. A load that ends
// after the person moved to another session (a task's artifact waits for its detail) still lands in
// the session that asked, never in the one in front when the load ends.
import type { WTab } from '../wtabs';

/** the spec's own owner, else the session the caller captured before the load, else the one in front */
export const tabOwner = (spec: Pick<WTab, 'owner'>, asked: string | null | undefined, front: string | null): WTab['owner'] =>
  spec.owner !== undefined ? spec.owner : asked !== undefined ? asked : front;
