// Evidence-image pipeline (docs/03 §hygiene): how a worker's screenshots become task
// artifacts the reviewer can actually see.
//
// The failure this closes (#1015, 2026-07-15): the submit path lifted `.nm-evidence/`
// images with a NON-RECURSIVE readdir (captures in `.nm-evidence/captures/` never
// attached) under a budget of `8 - <changed-tree images>` that dropped the tail
// SILENTLY. Twelve legitimate captures sort card-* → pill-available-* →
// pill-downloading/pill-ready; the first eight attached and the reviewer — correctly,
// fail-closed — bounced every round for the four that never arrived, while the worker
// kept believing "all attached". Three rules fix the class:
//
//   1. The sweep is RECURSIVE (subfolders are normal: captures/, shots/), with
//      `design/` excluded — that dir holds the human-approved mockups the host stages
//      for the build, already on the task as 'design' artifacts.
//   2. Ordering is NEWEST-FIRST (mtime desc, name-asc tie-break): task worktrees are
//      retained across rework rounds, so stale round-1 images must not crowd a fresh
//      round's corrected captures out of the budget.
//   3. Truncation is LOUD: anything over budget is named in the submit note and the
//      log — a dropped image the worker can see is a re-scope; a dropped image nobody
//      sees is #1015's infinite review loop.

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

// Pooled per-submission budget for lifted evidence images (changed-tree captures first,
// then the .nm-evidence sweep). 16 covers a states × themes × surfaces matrix (the #1015
// DoD legitimately needed 12) while keeping the submit payload sane: each image is a
// ≤390KB data URI (ARTIFACT_CAP under the 400KB per-artifact command schema), and every
// artifact row replicates to every machine via PowerSync — the budget is a replica-size
// guard, not a product decision. Inline-artifact storage offload is the phase-2 lift.
export const EVIDENCE_IMAGE_BUDGET = 16;

// Under .nm-evidence/: not worker evidence, never swept.
const SWEEP_EXCLUDES = new Set(['design', 'node_modules']);
const MAX_DEPTH = 4; // evidence trees are shallow; a runaway symlink/vendored dir isn't
const MAX_ENTRIES = 500; // hard stop for pathological dirs — budget-dropping stays loud past it

// Recursively list evidence images under `evDir` (the task's .nm-evidence/), returning
// POSIX-relative paths — the relative path IS the artifact name, so provenance survives
// ("captures/pill-ready-dark.png"). Missing dir → []. Newest-first so budget drops hit
// the stalest files.
export async function sweepEvidenceImages(evDir: string): Promise<string[]> {
  const found: Array<{ rel: string; mtimeMs: number }> = [];
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || found.length >= MAX_ENTRIES) return;
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      if (found.length >= MAX_ENTRIES) return;
      if (entry.startsWith('.')) continue;
      if (depth === 0 && SWEEP_EXCLUDES.has(entry)) continue;
      const full = join(dir, entry);
      const st = await stat(full).catch(() => null);
      if (!st) continue;
      if (st.isDirectory()) await walk(full, rel ? `${rel}/${entry}` : entry, depth + 1);
      else if (IMAGE_EXT.test(entry)) found.push({ rel: rel ? `${rel}/${entry}` : entry, mtimeMs: st.mtimeMs });
    }
  };
  await walk(evDir, '', 0);
  return found
    .sort((a, b) => (b.mtimeMs - a.mtimeMs) || (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
    .map((f) => f.rel);
}

// First `budget` candidates (in the given order) attach; the rest are returned so the
// caller can make the drop loud. Order is the caller's ranking — this never re-sorts.
export function planEvidenceBudget<T>(candidates: T[], budget: number): { take: T[]; dropped: T[] } {
  const cap = Math.max(0, budget);
  return { take: candidates.slice(0, cap), dropped: candidates.slice(cap) };
}

// The submit-note line for a truncated attach — '' when nothing dropped. Carried in the
// worker's submitted summary so the worker, reviewer, and human ALL see exactly which
// images did not attach (the reviewer judges the artifacts list; a silent gap reads as
// missing evidence and loops the review).
export function evidenceDropNote(dropped: string[], budget: number): string {
  if (!dropped.length) return '';
  const names = dropped.slice(0, 12).join(', ');
  const more = dropped.length > 12 ? ` (+${dropped.length - 12} more)` : '';
  return `\n\n[evidence: ${dropped.length} image${dropped.length === 1 ? '' : 's'} did NOT attach (${budget}-image budget; unreadable/oversize skipped): ${names}${more} — if the reviewer needs one of these, delete stale files under .nm-evidence/ or combine captures and resubmit]`;
}
