// THE CLIENT EDGE OF nm-relay, as a package (the mobile-cloud round, S1.3). It was the browser
// client's (apps/desktop/src/renderer/web) — the desktop's Code bridge became its second host and
// the phone is the third, so the edge lives where all three can import it. Pure of any host:
// a WebSocket, TextEncoder/TextDecoder and atob/btoa are the whole runtime contract (docs/42,
// "bytes, not strings"). Nothing here knows a bridge, an IPC lane or a React tree.
export { openRelayJsonChannel, openRelayPty, resetRelay, waitForRelayCapacity } from './relay-client';
export type { PtyHandle, RelayConfig, RelayJsonHandle } from './relay-client';
export { closeReason, encodeB64, makeDecoder, notice } from './relay-frames';
export { ensureMachine, ENSURE_TIMEOUT_MS } from './ensure-machine';
export { PROD_RELAY_URL, relayUrlFor } from './relay-url';
export type { EnsureDeps, EnsurePhase, EnsureResult } from './ensure-machine';
