// THE SETUP TRACKER'S ROWS PER CONNECTION (the source-release round, review F13). The shared list
// (`onboardingItems`, packages/shared) is the cloud's: a cloud machine leads it and the phone
// closes it. A LOCAL connection has neither — no machine was provisioned and no phone can reach a
// stack that listens on 127.0.0.1 — so those rows are ABSENT, never `null`: a `null` renders as an
// open step, and an ask the person can never finish is the one thing a tracker must not show.
import { onboardingItems, type OnboardingItem, type OnboardingSignals } from '@neuramesh/shared';
import type { ConnectionKind } from '../bridge/nm';

/** the ids a local connection cannot act on */
const CLOUD_ONLY: ReadonlySet<OnboardingItem['id']> = new Set(['machine', 'mobile']);

export function setupItemsFor(signals: OnboardingSignals, connection: ConnectionKind | undefined): OnboardingItem[] {
  const items = onboardingItems(signals);
  return connection === 'local' ? items.filter((i) => !CLOUD_ONLY.has(i.id)) : items;
}
