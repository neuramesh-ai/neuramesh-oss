// The public face of the desktop main process's private Finance entry (docs/43 §2,
// scripts/public-tree.sh PUBLIC_STUBS). This build has no Finance model runtime.
import type { FinanceRuntime } from './hooks/finance';

/** the Finance model runtime of a cloud machine */
export const financeRuntime: FinanceRuntime | null = null;
