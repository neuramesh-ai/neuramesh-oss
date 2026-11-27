// The image rule of the fleet feed (fleet.ts rowsToDesired, docs/design/whats-new-upgrades-2026-11/plan.md §7.1, §11).

/** a release image reaches a machine only when it is published or withdrawn. The one exception is the
 *  release canary, which runs a candidate so the release lane can watch it boot */
export function releaseImageFor(r: { id: string; release_image?: string | null; release_state?: string | null }, canary: string | null): string | null {
  if (!r.release_image) return null;
  if (r.release_state === 'published' || r.release_state === 'withdrawn') return r.release_image;
  return canary !== null && r.id === canary && (r.release_state === 'candidate' || r.release_state === 'qualified') ? r.release_image : null;
}
