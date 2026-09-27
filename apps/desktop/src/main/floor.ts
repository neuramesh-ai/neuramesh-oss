// the soft floor, read from the Cloud connection (docs/46, rule 3).
//
// the hosted API names the oldest desktop it still serves: `minDesktopVersion` on
// /.well-known/nm-config. an app below it keeps working, because the floor never blocks. the update
// card gains one line, and the updater looks for the new version at once (update.ts). only the Cloud
// connection is read: the local stack is this app's own version, and a server that someone runs
// themselves moves at its own pace.
//
// pure around an injected fetch, so the verdicts are unit tests. no electron import.
import { belowFloor } from '@neuramesh/shared';

const TIMEOUT_MS = 10_000;

/**
 * the floor this app is below, read from the API at `apiUrl`. the floor's version when the app is
 * older than it. null when the app is at or above it, or the server names no floor. undefined when
 * the server did not answer: the caller keeps what it knew.
 */
export async function floorAbove(apiUrl: string, appVersion: string, fetchImpl: typeof fetch = fetch): Promise<string | null | undefined> {
  try {
    const res = await fetchImpl(`${apiUrl.replace(/\/+$/, '')}/.well-known/nm-config`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return undefined;
    const cfg = (await res.json()) as { minDesktopVersion?: unknown };
    const floor = typeof cfg.minDesktopVersion === 'string' ? cfg.minDesktopVersion : null;
    return belowFloor(appVersion, floor) ? floor : null;
  } catch {
    return undefined;
  }
}
