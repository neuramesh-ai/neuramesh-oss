// The relay rule moved into @neuramesh/relay-client (the mobile fix round, 2026-09-06) so the phone
// answers it the same way. Re-exported here because the main process reads it by this path, and
// wrapped because the desktop asks with a whole env rather than one value.
import { relayUrlFor as pick } from '@neuramesh/relay-client';

export { PROD_RELAY_URL } from '@neuramesh/relay-client';

export function relayUrlFor(env: Record<string, string | undefined>, authMode: string): string {
  return pick(env['NM_RELAY_URL'], authMode);
}
