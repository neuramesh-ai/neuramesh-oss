// THE MOVE IPC — the electron half of move/driver.ts (artboards H1, H2; docs/export-format.md).
//
//   invoke  nm:move-plan { targetWorkspaceId? }  → MovePlanResult   the numbers, nothing written
//   invoke  nm:move-start { targetWorkspaceId }  → { ok } | the plan's refusal
//   invoke  nm:move-cancel                       → stops after the batch in flight
//   invoke  nm:move-state                        → the last pushed phase
//   invoke  nm:move-open                         → the foreground swaps to the target workspace
//   push    nm:move                              MovePush { phase, seq?, total?, written?, skipped?, message?, code?, storage? }
//
// One move at a time: a second start while one runs changes nothing, and the sheet draws the
// phase it is pushed. The gate (move/movegate.ts) decides what these connections allow, the driver
// does the work, and this file only connects them to the registry, the credentials and the window.
import { dirname } from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import type { ExportTable, ImportStorage } from '@neuramesh/shared';
import { apiAuthHeaders } from './apiauth';
import { connections, type Connection } from './connections';
import { MoveRefusal, planMove, runMove, type MoveDeps, type MoveEndpoint, type MovePlanned, type MovePush } from './move/driver';
import { fsMoveFiles, movedOf, type MoveTarget, type MovedMarker } from './move/files';
import { moveGate, type MoveGateCode } from './move/movegate';
import { actorId, setForeground } from './sync';

export type { MovePush } from './move/driver';
export type MovePlanResult =
  | { ok: true; source: { workspaceId: string; name: string; slug: string }; target: MoveTarget; targets: MoveTarget[]; counts: Record<ExportTable, number>; totalBytes: number; storage: ImportStorage | null; tooLarge: number; agents: string[]; alreadyMoved?: MovedMarker }
  | { ok: false; code: MoveGateCode | 'FAILED'; message: string; source?: { workspaceId: string; name: string; slug: string }; refusal?: { code: string; storage?: ImportStorage } };

let last: MovePush = { phase: 'idle' };
let held: { planned: MovePlanned; target: MoveTarget; endpoint: MoveEndpoint; deps: MoveDeps } | null = null;
let running: { cancelled: boolean } | null = null;

const push = (p: MovePush): void => {
  last = p;
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.webContents.isDestroyed()) w.webContents.send('nm:move', p);
};

const endpointOf = (c: Connection, workspaceId: string): MoveEndpoint => ({
  apiUrl: c.apiUrl, workspaceId, headers: () => apiAuthHeaders(c.apiUrl, { kind: 'human', id: actorId(c) }),
});

const localConnection = (): Connection | null => connections.all().find((c) => c.kind === 'local') ?? null;

async function plan(want?: string): Promise<MovePlanResult> {
  const local = localConnection();
  const cloud = connections.get('cloud') ?? null;
  const gate = moveGate(
    local && { workspaceId: local.ws, name: local.wsInfo.name, slug: local.wsInfo.slug, marker: movedOf(local) },
    cloud && { connectionId: cloud.id, standingIn: cloud.ws, workspaces: cloud.session.wsMemberships },
    want,
  );
  if (!gate.ok) { console.log(`move_error code=${gate.code}`); return gate; }
  const m = gate.alreadyMoved;
  if (m) return { ok: true, source: gate.source, target: m.target, targets: [], counts: m.counts, totalBytes: m.totalBytes, storage: null, tooLarge: 0, agents: [], alreadyMoved: m };
  // a move in flight keeps its plan: the sheet re-opened mid-move reads the same numbers
  if (running && held) {
    const p = held.planned;
    return { ok: true, source: gate.source, target: held.target, targets: gate.targets, counts: p.counts, totalBytes: p.totalBytes, storage: p.storage, tooLarge: p.tooLarge.length, agents: p.agents };
  }
  const deps: MoveDeps = { fetchImpl: fetch, emit: push, now: () => performance.now(), files: fsMoveFiles(dirname(local!.replicaPath), local!.ws), log: (line) => console.log(line) };
  const endpoint = endpointOf(cloud!, gate.target.workspaceId);
  try {
    const planned = await planMove(deps, endpointOf(local!, local!.ws), endpoint, { localHumanId: local!.identity.actorId, cloudUserId: actorId(cloud) });
    held = { planned, target: gate.target, endpoint, deps };
    push({ phase: 'ready', total: planned.batches.length - 1, storage: planned.storage });
    return { ok: true, source: gate.source, target: gate.target, targets: gate.targets, counts: planned.counts, totalBytes: planned.totalBytes, storage: planned.storage, tooLarge: planned.tooLarge.length, agents: planned.agents };
  } catch (e) {
    const r = e instanceof MoveRefusal ? e : null;
    const message = e instanceof Error ? e.message : String(e);
    console.log(`move_error code=${r?.code ?? 'FAILED'} message=${JSON.stringify(message)}`);
    push({ phase: 'error', code: r?.code ?? 'FAILED', message, storage: r?.details.storage });
    return { ok: false, code: 'FAILED', message, source: gate.source, refusal: r ? { code: r.code, storage: r.details.storage } : undefined };
  }
}

export function registerMoveIpc(): void {
  ipcMain.handle('nm:move-state', () => last);
  ipcMain.handle('nm:move-plan', (_e, arg?: { targetWorkspaceId?: string }) => plan(arg?.targetWorkspaceId));
  ipcMain.handle('nm:move-start', async (_e, arg?: { targetWorkspaceId?: string }): Promise<MovePlanResult | { ok: true }> => {
    if (running) return { ok: true };
    if (!held || (arg?.targetWorkspaceId && held.target.workspaceId !== arg.targetWorkspaceId)) {
      const p = await plan(arg?.targetWorkspaceId);
      if (!p.ok || p.alreadyMoved || !held) return p;
    }
    const run = { cancelled: false };
    running = run;
    const h = held;
    void runMove(h.deps, h.planned, h.endpoint, h.target, () => run.cancelled)
      .then((out) => { if (out.status === 'done') held = null; })
      .catch((err: unknown) => { console.log(`move_error code=FAILED message=${JSON.stringify(err instanceof Error ? err.message : String(err))}`); push({ phase: 'error', code: 'FAILED', message: err instanceof Error ? err.message : String(err) }); })
      .finally(() => { running = null; });
    return { ok: true };
  });
  ipcMain.handle('nm:move-cancel', () => { if (running) running.cancelled = true; });
  ipcMain.handle('nm:move-open', () => {
    const local = localConnection();
    const target = held?.target ?? (local ? movedOf(local)?.target : null);
    if (!target) return { ok: false };
    setForeground(target.connectionId, target.workspaceId);
    return { ok: true };
  });
}
