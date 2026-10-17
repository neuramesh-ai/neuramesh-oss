// the real dependencies of the agy lane: the agy binary, the loopback MCP bridge with the nm shim in
// agy's MCP config (the orchestrator's agy path installs the same shim, runtime/orchmcp.ts), and the
// managed tools over this thread's executors. a test hands the session its own (engineering-agy.ts).
import type { ToolExecutors } from '@cline/sdk';
// userDataDir, never electron's app: a cloud machine runs this under plain node
import { userDataDir } from '../harness/turntools';
import { cliVersion, ensureCli, versionBelow } from '../runtime/cli';
import * as orchmcp from '../runtime/orchmcp';
import type { AgyLaneDeps } from './engineering-agy';
import { agyManagedTools } from './engineering-agy-tools';

/** the first agy with --input-format stream-json, which the lane needs for a long-lived conversation */
export const AGY_FLOOR = '1.4.0';
const checked = new Map<string, Promise<string | null>>();

export function agyLaneDeps(o: {
  cwd: string;
  executors?: ToolExecutors;
  createDefaultTools?: typeof import('@cline/sdk').createDefaultTools;
}): AgyLaneDeps {
  return {
    bin: async () => {
      const path = await ensureCli('gemini');
      // agy updates itself, so the version is read once per binary, never per turn
      if (!checked.has(path)) checked.set(path, cliVersion(path));
      const version = await checked.get(path)!;
      if (version && versionBelow(version, AGY_FLOOR)) {
        checked.delete(path);
        throw new Error(`agy ${version} on this machine is too old for code. Run agy update on this machine, then send the message again.`);
      }
      return { path };
    },
    bridge: async () => {
      const port = await orchmcp.ensureBridge();
      orchmcp.ensureAgyMcpConfig(orchmcp.ensureShim(userDataDir()));
      return `http://127.0.0.1:${port}`;
    },
    register: orchmcp.registerTurn,
    unregister: orchmcp.unregisterTurn,
    managedTools: (nativeEdits) => o.executors && o.createDefaultTools ? agyManagedTools(o.createDefaultTools, o.executors, o.cwd, nativeEdits) : [],
  };
}
