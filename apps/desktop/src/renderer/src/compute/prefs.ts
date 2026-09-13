// Compute-preference parsing — extracted from App.tsx (track A2).
import type { ComputePrefs } from '@neuramesh/shared';

/** {machine, agents} out of the member row's jsonb text; bad/absent → unset. */
export function parseComputePrefs(raw: string | null | undefined): ComputePrefs {
  try { return raw ? (JSON.parse(raw) as ComputePrefs) : {}; } catch { return {}; }
}
