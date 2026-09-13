import { EventEmitter } from 'node:events';

// Bridges the two live-process registries — the terminal PTYs (`ptys` in sync.ts) and the agent
// runs (`executing` in agents.ts) — into a single 'change' signal the renderer's background-processes
// tracker subscribes to over IPC. Both files import this; neither has to export its private map.
export const procEvents = new EventEmitter();
procEvents.setMaxListeners(50);
export const emitProcChange = (): void => { try { procEvents.emit('change'); } catch { /* no listeners */ } };
