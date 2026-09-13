import type { EngineeringCommand, EngineeringOpenMeta, EngineeringRuntimeEvent } from '../../../engineering-protocol';

export interface EngineeringNMBridge {
  /** the desktop's relay facts, answered by main (the desktop Code bridge, 2026-09-04) and composed
   *  into the browser's relay bridge before the app renders (bridge/desktop-relay.ts). Absent on the
   *  web, which builds its own config; the preview harness answers with no relay. */
  relayEnv?(): Promise<{ relayUrl: string; apiUrl: string; workspaceId: string }>;
  relayHeaders?(): Promise<Record<string, string>>;
  relayBearer?(): Promise<string | null>;
  /** THE LOCAL LANE (the desktop Code bridge, slice B1): the app's own engineering host, in
   *  process — a session on this Mac, no relay in the path. `machineId` is this machine's row,
   *  so the composed bridge can route a session that names it here. Absent everywhere else. */
  engineeringLocalInfo?(): Promise<{ available: boolean; reason?: string; machineId: string | null; machineName: string }>;
  openEngineeringLocal?(meta: EngineeringOpenMeta, onEvent: (event: EngineeringRuntimeEvent) => void, onExit: () => void): { subId: string; send: (command: EngineeringCommand) => Promise<void>; close: () => void };
  engineeringInfo?(): Promise<{ available: boolean; reason?: string }>;
  openEngineering?(meta: EngineeringOpenMeta, onEvent: (event: EngineeringRuntimeEvent) => void, onExit: () => void): { subId: string; send: (command: EngineeringCommand) => Promise<void>; close: () => void };
}
