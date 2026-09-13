// Bus delivery for the CLI runtimes (docs/harness/03 §3.4).
//
// The Claude adapter gets bus tools in-process. Codex and agy are SEPARATE processes, so they reach
// the same tools over the loopback MCP bridge that already exists for the orchestrator's tools on
// `agy` (runtime/orchmcp.ts): a 127.0.0.1 HTTP endpoint guarded by a per-turn secret, fronted by a
// tiny stdio shim that is inert outside a turn.
//
// This file only widens that bridge's SCOPE — every turn kind, both CLI runtimes — which is the whole
// mechanism by which a Codex-seated worker gains record_lesson, add_backlog_item and real beats. No
// new transport, nothing new to secure, and the cost is one loopback round trip per tool call against
// a CLI spawn measured in seconds.
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TurnKind } from '@neuramesh/shared';
import { bridgeToolsForTurn, type ToolHost } from './toolbus';
import * as orchmcp from '../runtime/orchmcp';
import type { LogFn } from '../agentlog';

/** A turn's identity for tool purposes: what kind it is, and what its tools can reach. */
export interface TurnTools {
  kind: TurnKind;
  host: ToolHost;
}

export interface BusBridge {
  /** env the child process needs so the shim can find + authenticate to this turn */
  env: Record<string, string>;
  /** codex takes its MCP servers as config rather than env; this is that shape */
  codexConfig: Record<string, unknown>;
  /** how many tools were advertised — logged, so an empty toolset is visible not silent */
  count: number;
  cleanup: () => void;
}

/** A bridge that advertises nothing — used when a turn genuinely has no bus tools. */
const NO_BRIDGE: BusBridge = { env: {}, codexConfig: {}, count: 0, cleanup: () => {} };

/**
 * Open the loopback bridge for one turn and return what a child process needs to reach it.
 *
 * Fail-open by design, matching the egress proxy and the FS jail: if the bridge cannot start, the
 * turn runs WITHOUT nm tools rather than not running at all. That is the honest trade — losing
 * `record_lesson` for one turn is a degradation; losing the turn is an outage — and the degradation
 * is logged rather than swallowed.
 */
export async function openBusBridge(tools: TurnTools, userDataDir: string, log?: LogFn): Promise<BusBridge> {
  const bridgeTools = bridgeToolsForTurn(tools.kind, tools.host);
  if (!bridgeTools.length) return NO_BRIDGE;
  try {
    const port = await orchmcp.ensureBridge();
    const turnId = randomBytes(9).toString('hex');
    const secret = randomBytes(24).toString('hex');
    orchmcp.registerTurn(turnId, secret, bridgeTools);
    const shim = orchmcp.ensureShim(userDataDir);
    const url = `http://127.0.0.1:${port}`;
    log?.({ kind: 'tool', phase: 'inject', summary: `${bridgeTools.length} nm tool${bridgeTools.length === 1 ? '' : 's'} on the loopback bus (${tools.kind} turn)` });
    return {
      env: { NM_ORCH_URL: url, NM_ORCH_TURN: turnId, NM_ORCH_SECRET: secret },
      // codex reads MCP servers from its config rather than a global file, so the shim is passed
      // per-thread — which also means a user's own `codex` sessions never see these tools.
      // the nm server entry comes from the ONE builder orchmcp owns — this copy and
      // orchturn's drifted once (the missing default_tools_approval_mode cost a whole round;
      // see codexNmServer for the story) and now they cannot.
      codexConfig: {
        mcp_servers: {
          nm: orchmcp.codexNmServer(process.execPath, shim, { NM_ORCH_URL: url, NM_ORCH_TURN: turnId, NM_ORCH_SECRET: secret }),
        },
      },
      count: bridgeTools.length,
      cleanup: () => orchmcp.unregisterTurn(turnId),
    };
  } catch (err) {
    log?.({
      kind: 'tool',
      phase: 'inject',
      summary: `nm tools unavailable this turn — the loopback bus did not start (${err instanceof Error ? err.message.slice(0, 90) : 'error'})`,
      level: 'warn',
    });
    return NO_BRIDGE;
  }
}

/**
 * Make sure `agy` knows about the shim.
 *
 * agy resolves MCP servers from its own global config, so registration is idempotent and one-time
 * (a MERGE, never a clobber — the user's other servers stay). The shim is inert when NM_ORCH_* is
 * unset, so a human's interactive `agy` session never sees nm tools.
 */
export function ensureAgyBus(userDataDir: string): void {
  try {
    orchmcp.ensureAgyMcpConfig(orchmcp.ensureShim(userDataDir), process.execPath);
  } catch {
    /* agy will simply have no nm tools; the turn still runs */
  }
}

/** Where the shim lives — exported so a test can assert it lands under userData, not the repo. */
export function shimPath(userDataDir: string): string {
  return join(userDataDir, 'nm-orch-mcp-shim.mjs');
}

/**
 * Electron's userData, resolved lazily so this module stays importable in a plain-node test.
 *
 * The fallback must NEVER be `process.cwd()`: outside Electron that is the repo, and `ensureShim`
 * writes a file — so a test run left `nm-orch-mcp-shim.mjs` sitting in `apps/desktop/`, one `git add`
 * away from being committed. (Found exactly that way.) A temp dir is the correct scratch home for a
 * generated shim, and `NM_USERDATA` still wins when the dev launcher sets it.
 */
export function userDataDir(): string {
  try {
    const { app } = require('electron') as typeof import('electron');
    return app.getPath('userData');
  } catch {
    return process.env['NM_USERDATA'] ?? join(tmpdir(), 'nm-harness');
  }
}

/**
 * Adapt the daemon's async beats writer to the bus tool's synchronous, message-returning shape.
 *
 * The daemon's writer is fire-and-forget by design (a beats hiccup must never disturb a run), while
 * a tool has to answer the model immediately. So the write is kicked off and the acknowledgement is
 * returned at once — the same contract the Claude path's `createBeatRun` already gives.
 */
export function beatsAdapter(beats: { declare: (items: string[]) => Promise<void>; advance: (seq: number, status: string) => Promise<void> }): {
  declare: (steps: string[]) => string;
  complete: (step: number, blocked: boolean) => string;
} {
  let declared = 0;
  return {
    declare: (steps) => {
      declared = steps.length;
      void beats.declare(steps).catch(() => {});
      return `plan declared — ${steps.length} steps now render live for the human; call advance_beat as each lands`;
    },
    complete: (step, blocked) => {
      if (declared && (step < 1 || step > declared)) return `step ${step} is outside your declared plan of ${declared}`;
      void beats.advance(step, blocked ? 'blocked' : 'done').catch(() => {});
      return blocked ? `step ${step} marked blocked` : `step ${step} marked done`;
    },
  };
}
