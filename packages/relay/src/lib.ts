// the package's IMPORTABLE surface — the hub, the protocol and the machine client, with no
// side effects.
//
// index.ts is a PROGRAM: importing it starts an http server and process.exit(1)s when its
// env is missing. That is correct for the container's `tsx src/index.ts`, and a trap for
// anything that wants the types or the hub for a test. So package `main` points here and
// the Dockerfile keeps running index.ts directly.
export { createHub, type Hub, type HubOptions } from './hub.js';
export { connectEchoMachine, type MachineClient, type MachineClientOptions } from './machine-client.js';
export {
  CLOSE, isChannelFrame, parseMessage, toB64, fromB64,
  type ChannelFrame, type ChannelLane, type EdgeMessage, type FrameType, type RelayMessage,
} from './protocol.js';
export { makeValidators } from './validate.js';
