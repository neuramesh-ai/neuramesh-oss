import type { ProcList } from './rows-infra';

export interface TerminalNMBridge {
  terminalInfo(taskNumber: number, hasRepo: boolean): Promise<{ available: boolean; cwd: string | null }>;
  openTerminal(taskNumber: number, hasRepo: boolean, cols: number, rows: number, onData: (d: string) => void, onExit: () => void): { subId: string; input: (d: string) => void; resize: (c: number, r: number) => void; close: () => void };
  openTerminalCwd(cwd: string, cols: number, rows: number, onData: (d: string) => void, onExit: () => void, startupCommand?: string): { subId: string; input: (d: string) => void; resize: (c: number, r: number) => void; close: () => void };
  processList(): Promise<ProcList>;
  processKill(kind: 'agent' | 'terminal', id: string): Promise<{ ok: boolean }>;
}
