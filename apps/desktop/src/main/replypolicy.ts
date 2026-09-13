// The stand-down contract now lives in @neuramesh/shared (stream.ts), beside the machine-fence
// filter, because it is the same job: text addressed to the daemon that a human must never see.
// It leaked into the activity feed and the live bubble as a bare "NO_REPLY" line precisely
// because the renderer had no access to this rule. Re-exported here so every existing caller —
// and the incident history above — keeps its home.
export { isStandDown } from '@neuramesh/shared';

// What an orchestrator transport returns when the model produced no channel text.
// An empty turn means "nothing to post" — a stand-down, exactly like NO_REPLY. It MUST
// satisfy isStandDown, so transports return THIS and never a user-facing placeholder:
// a literal like "(no digest)" is not a stand-down, so it posts to the channel AND
// re-arms the next sweep (the "(no digest)" leak a gemini-3.5-flash orchestrator hit on
// an empty research turn, 2026-07-19 — the same failure class as the NO_REPLY chatter above).
export const ORCH_EMPTY_TURN = '';
