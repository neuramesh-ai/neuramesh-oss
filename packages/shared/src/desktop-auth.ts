// The desktop sign-in handoff's window (POST /auth/desktop/start → /complete → /poll). Fifteen
// minutes since the source release (2026-09, unit U1b): the page behind Get Pro signs a person up
// AND takes them through Stripe checkout before it completes the handoff, and five minutes was a
// sign-in's budget. The site stashes the nonce for this long plus slack (apps/web pro-handoff.ts).
export const DESKTOP_AUTH_TTL_MS = 15 * 60_000;
