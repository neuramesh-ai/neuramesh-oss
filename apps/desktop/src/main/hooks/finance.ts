// What the main process uses of Finance (finance/worker.ts, sync/ipc/finance.ts). Types only, and
// public: callers take the module from the private Finance entry (private-finance.ts), which the
// public tree replaces with a stub that has no module (docs/design/oss-private-seam-2026-11/plan.md).

/** the Finance model runtime: it claims Finance chat turns that the API routes to this machine */
export interface FinanceRuntime {
  /** start one worker per (API, workspace, machine). The return value stops it */
  start(o: { apiUrl: string; workspace: string; machineId: string; headers: () => Promise<Record<string, string>>; log?: (line: string) => void }): () => void;
  busy(machineId: string): boolean;
  /** stop claiming new turns. A turn in flight finishes */
  hold(machineId: string): void;
  stop(machineId: string): void;
}

/** Finance in the desktop app: present only when the build carries the Finance release */
export interface DesktopFinance {
  runtime: FinanceRuntime;
  /** the nm:finance-* IPC handlers */
  registerIpc(): void;
}
