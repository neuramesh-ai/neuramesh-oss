// The workspace VOICE on this daemon (docs/design/agent-comm-rules-2026-08).
//
// One module owns the cached rules and the block; five composers append it LAST
// (housestyle.test.ts enumerates them with a sentinel rule — a composer that forgets the
// block fails the list, the selector-audit lesson). Config rides the API settings lane
// (workspaces aren't PowerSync-synced): fetched at boot, refreshed on a short TTL and
// nudged by the settings IPC, so a toggle reaches the next agent turn without a restart.
import { commRulesFrom, houseStyleBlock, withHouseStyle, type CommRules } from '@neuramesh/shared';

let cached: Required<CommRules> = commRulesFrom(null); // defaults-ON until the first fetch
let fetchedAt = 0;
let fetcher: (() => Promise<unknown>) | null = null;
const TTL_MS = 60_000;

/** boot wiring: give the module its API door + prime the cache */
export function initHouseStyle(fetchRules: () => Promise<unknown>): void {
  fetcher = fetchRules;
  void refreshHouseStyle();
}

export async function refreshHouseStyle(): Promise<void> {
  if (!fetcher) return;
  try {
    cached = commRulesFrom(await fetcher());
    fetchedAt = Date.now();
  } catch { /* keep the last good rules — never let a blip strip the voice */ }
}

/** the block for THIS moment — TTL-refreshes in the background, answers synchronously */
export function houseStyle(): string | null {
  if (fetcher && Date.now() - fetchedAt > TTL_MS) void refreshHouseStyle();
  return houseStyleBlock(cached);
}

/** the one wrapper every composer calls — appends LAST, which is what makes "supersedes" real */
export function styled(system: string): string {
  return withHouseStyle(system, houseStyle());
}

/** test-only: pin the rules without a fetcher */
export function __setHouseStyleForTest(rules: unknown): void {
  cached = commRulesFrom(rules);
  fetchedAt = Date.now();
  fetcher = null;
}
