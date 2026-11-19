// The public face of the Electron app's private Finance entry (docs/43 §2, scripts/public-tree.sh
// PUBLIC_STUBS). This build has no Finance: it reaches the desktop app on its own release.
import type { DesktopFinance } from '../hooks/finance';

/** Finance in the desktop app */
export const desktopFinance: DesktopFinance | null = null;
