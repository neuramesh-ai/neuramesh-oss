// THE DESKTOP'S RELAY FACTS (the desktop Code bridge, 2026-09-04) — three answers the renderer
// composes the browser's relay bridge from, so Code reaches a machine from the app you downloaded
// exactly the way it reaches one from a browser (docs/design/desktop-code-bridge-2026-09/plan.md).
//
// Main answers, the renderer dials. The credentials leave main only as the same bearer every /v1
// call already carries, and the relay URL is main's to know: NM_RELAY_URL, the machine daemon's
// own switch, defaulting to the production relay under Clerk auth and to nothing on a dev stack.
// Every answer is about the FOREGROUND connection (connections.ts), read at call time.
import type { Actor } from '@neuramesh/shared';
import { ipcMain } from 'electron';
import { apiAuthHeaders, apiBearerHeader } from './apiauth';
import { relayUrlFor } from './relay-url';
import { actorId, apiUrl, cur, ws } from './sync';

export function registerRelayIpc(): void {
  ipcMain.handle('nm:relay-env', () => ({ relayUrl: relayUrlFor(process.env, cur().authMode), apiUrl: apiUrl(), workspaceId: ws() }));
  ipcMain.handle('nm:relay-headers', () => apiAuthHeaders(apiUrl(), { kind: 'human', id: actorId() } as Actor));
  // the relay validates a CLIENT with the Clerk bearer (control-api /internal/relay/validate-client);
  // a dev stack that opted in (NM_ALLOW_DEV_RELAY=1) takes its NM_DEV_RELAY_TOKEN instead
  ipcMain.handle('nm:relay-bearer', async () => {
    if (cur().authMode !== 'clerk') return process.env['NM_DEV_RELAY_TOKEN'] ?? null;
    const head = await apiBearerHeader(apiUrl());
    return head['authorization']?.replace(/^Bearer /, '') ?? null;
  });
}
