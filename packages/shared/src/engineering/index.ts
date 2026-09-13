// ENGINEERING OS, THE CLIENT-SIDE HALF, SHARED (the mobile-cloud round, S5.1): the transport-neutral
// contract (protocol), the session model (domain), the runtime-event reducer (remote), the copy
// boundary, checkpoints, the transport failure, and the transcript presentation — moved verbatim
// from apps/desktop (src/engineering-protocol.ts · src/renderer/src/engineering/*), which re-exports
// them. The desktop's Code view, the browser client and the phone's Code thread reduce the same
// events through the same code; a second reducer would be a second opinion about a turn.
export * from './protocol';
export * from './patch';
export * from './domain';
export * from './handoff';
export * from './copy';
export * from './remote';
export * from './checkpoints';
export * from './transport-state';
export * from './activity';
