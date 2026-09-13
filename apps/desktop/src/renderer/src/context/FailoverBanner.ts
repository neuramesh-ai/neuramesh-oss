// True while the capacity fly-up owns the answer, so the inline copies in the feed
// suppress to a pointer note instead of offering a second door (docs/22 §9).
import { createContext } from 'react';

// True while the sticky failover fly-up is showing (docs/22): a workspace cap is a
// workspace concern, so it follows the human on the fly-up above the composer. The inline
// copy in the channel feed would then be a redundant second card — so it stands down to a
// slim pointer while the fly-up owns the answer.
export const FailoverBannerContext = createContext(false);
