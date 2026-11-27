// the machine releases whose contract the server keeps (docs/46, the machine lane; whats-new-upgrades
// plan §9).
//
// a machine runs its release until its owner upgrades, so old releases stay live: every release
// published in the last 30 days, and never fewer than the newest three (`supportFloor` in
// machine-releases.ts). CI cannot read the published releases, so this list is kept by hand. a release
// joins it when it is published, and leaves it only after the floor passed it and no machine runs it.
// the control-api's machine contract test holds every tree to each release named here, and to each
// snapshot newer than the newest one: the candidate of a release PR that is not published yet.

/** newest first: the published machine releases that a machine may still run */
export const SUPPORTED_MACHINE_VERSIONS = ['2026.11.1'] as const;
