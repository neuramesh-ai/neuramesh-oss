// WHICH RELAY A CLIENT DIALS. Moved here from apps/desktop/src/main/relay-url.ts (the mobile fix
// round, 2026-09-06) because the phone needs the same answer and had none: its RELAY_URL came from
// an EXPO_PUBLIC_ variable nothing set in a production build, so a shipped app said "This build has
// no relay" and Code could not open a lane at all.
//
// The rule is the auth mode, not a build profile: under Clerk the client dials the production
// relay, and on a dev or supabase stack the default is NOTHING, because unset is the honest answer
// where no relay is deployed (docs/42: "unset degrades to No shell here"). A build profile can be
// forgotten. An auth mode cannot.
export const PROD_RELAY_URL = 'wss://relay.neuramesh.app';

/** the relay for this client: an explicit setting first, else production under Clerk, else none */
export function relayUrlFor(explicit: string | undefined, authMode: string): string {
  const set = explicit?.trim();
  if (set) return set;
  return authMode === 'clerk' ? PROD_RELAY_URL : '';
}
