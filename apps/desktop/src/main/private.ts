// The public face of the desktop main process's private entry (docs/43 §2, scripts/public-tree.sh
// PUBLIC_STUBS). This build has no Cloud Run substrate: machined refuses NM_SUBSTRATE=cloudrun.
import type { CloudRunModule } from './hooks/cloudrun-machine';

/** the Cloud Run substrate (NM_SUBSTRATE=cloudrun) */
export const cloudRun: CloudRunModule | null = null;
