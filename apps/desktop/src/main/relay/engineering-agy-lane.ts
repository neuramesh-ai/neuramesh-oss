import type { BridgeTool } from '../runtime/orchmcp';
import type { AgyLaneTool } from './engineering-agy-tools';
import type { AgySpawn } from './engineering-agy-process';

export interface AgyLaneDeps {
  /** the agy binary (runtime/cli.ts ensureCli), with any argv that goes first (a test's fake agy script) */
  bin(): Promise<{ path: string; lead?: string[] }>;
  /** the loopback bridge's URL, with the nm shim present in agy's MCP config */
  bridge(): Promise<string>;
  register(turn: string, secret: string, tools: BridgeTool[]): void;
  unregister(turn: string): void;
  /** Cline's managed shell, web, editor and patch tools over this thread's executors */
  managedTools(nativeEdits: boolean): AgyLaneTool[];
  spawn?: AgySpawn;
}
