// the supported desktops and the soft floor (docs/46, rules 1 and 3).
//
// the server serves the newest PUBLISHED desktop and the one before it. only the release page
// knows what is published, so this list is kept by hand: it moves in the ledger-header PR after a
// publish (docs/11 §2, step 6), never in the version-bump PR. a bump only adds the snapshot of its
// version, and the contract test holds every tree to that candidate too until the list moves.
//
// the floor is the older of the two: the API announces it (`minDesktopVersion` on
// /.well-known/nm-config and /v1/me), and a desktop below it shows one line on its update card. the
// floor never blocks, and it only ever names a published desktop.

/** newest first: the two newest published desktops. the control-api's contract test holds every tree to them. */
export const SUPPORTED_DESKTOP_VERSIONS = ['0.152.0', '0.151.0'] as const;

/** the older supported desktop. a desktop below it reads "too old" on its update card. */
export const MIN_DESKTOP_VERSION: string = SUPPORTED_DESKTOP_VERSIONS[1];

const versionSegments = (v: string): number[] => v.split('.').map((n) => Number.parseInt(n, 10) || 0);

/** numeric-segment order, for sort(): '0.9.0' < '0.149.0' < '0.150.0'. a non-numeric suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const x = versionSegments(a);
  const y = versionSegments(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** true when `version` is older than the floor. no floor, or an unreadable one, is never below. */
export const belowFloor = (version: string, floor: string | null | undefined): boolean =>
  !!floor && /^\d+\.\d+/.test(floor) && compareVersions(version, floor) < 0;
