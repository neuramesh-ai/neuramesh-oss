// The public face of the renderer's private Finance entry (docs/43 §2, scripts/public-tree.sh
// PUBLIC_STUBS). This build has no Finance destination.
import type { ComponentType } from 'react';
import type { ProviderKey } from './models/picks';

/** the Finance destination */
export const FinanceHome: ComponentType<{ onConnect: (provider: ProviderKey) => void }> | null = null;
