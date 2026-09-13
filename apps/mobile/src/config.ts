import { relayUrlFor } from '@neuramesh/relay-client';
import Constants from 'expo-constants';

// Endpoints. Overridable per build via EXPO_PUBLIC_* env or app.json `extra`;
// defaults point at production. POWERSYNC_URL is the sync instance the connector
// hands to the SDK (empty until wired to the real instance).
const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string; powersyncUrl?: string; relayUrl?: string };

// Dev mode (EXPO_PUBLIC_NM_AUTH=dev): talk to the local dev stack as the seeded dev
// user, no Clerk. The .env supplies the local URLs (control-api :8788, PowerSync :58081).
export const IS_DEV = process.env.EXPO_PUBLIC_NM_AUTH === 'dev';
// the seeded dev user by default; EXPO_PUBLIC_NM_DEV_USER points the phone at another nm_users row
// (a fresh one with no memberships is how the onboarding flow is driven on the dev stack, S6)
export const DEV_USER = process.env.EXPO_PUBLIC_NM_DEV_USER ?? '00000000-0000-0000-0000-000000000001';
export const DEV_EMAIL = process.env.EXPO_PUBLIC_NM_DEV_EMAIL ?? 'george@acme.dev';

export const API_URL = process.env.EXPO_PUBLIC_NM_API ?? extra.apiUrl ?? 'https://api.neuramesh.app';
export const POWERSYNC_URL = process.env.EXPO_PUBLIC_NM_POWERSYNC ?? extra.powersyncUrl ?? '';
// The marketing site — the handoff page that signs you in or up (D15), and the desktop download.
export const WEB_URL = process.env.EXPO_PUBLIC_NM_WEB ?? (extra as { webUrl?: string }).webUrl ?? 'https://neuramesh.app';

// nm-relay (docs/42): the rendezvous the phone's Code lane dials out to. The rule is the SHARED one
// the desktop uses — under Clerk the production relay, on a dev stack nothing, because unset is the
// honest answer where no relay is deployed and Code says so. It used to read an EXPO_PUBLIC_
// variable that no production build set, so every shipped app said "This build has no relay" and
// Code and the terminal were both dead in TestFlight (found 2026-09-06, before build 24).
export const RELAY_URL = relayUrlFor(process.env.EXPO_PUBLIC_NM_RELAY_URL ?? extra.relayUrl, IS_DEV ? 'dev' : 'clerk');
export const DEV_RELAY_TOKEN = process.env.EXPO_PUBLIC_NM_DEV_RELAY_TOKEN ?? '';
