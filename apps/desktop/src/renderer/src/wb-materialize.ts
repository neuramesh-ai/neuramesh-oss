// Materialize-on-first-render (docs/38 §4): an agent's board arrives as SOURCE (mermaid or an
// element skeleton) because conversion needs a DOM and the daemon never renders. The first
// surface to mount it — thread card, destination tile, or the editor — calls this; the strict
// command lane's rev guard makes the race one-winner (WHITEBOARD_STALE for the losers, whose
// replicas then receive the winner's scene through sync).
//
// This module is EAGER-safe: the Excalidraw bundle is imported dynamically inside the call, so
// cards and tiles can import this without paying the canvas chunk at boot.
import { WB_SCENE_MAX, WB_SNAPSHOT_MAX } from '@neuramesh/shared';
import type { WbRow } from './whiteboards';

interface WbCmdBridge {
  wbUpdateCmd(p: { whiteboardId: string; baseRev: number; title?: string; scene?: string; snapshotSvg?: string; clearSource?: boolean }): Promise<{ ok: boolean; status: number; rev?: number; code?: string; error?: string }>;
}

const inflight = new Set<string>();
// session-scoped: a source that failed to convert (bad mermaid, oversize scene) must not
// retry on every mount — the failure renders as a note on the board, not a loop
const failed = new Map<string, string>();

export const wbMaterializeFailure = (id: string): string | null => failed.get(id) ?? null;

export async function materializeWhiteboard(row: Pick<WbRow, 'id' | 'rev' | 'source'>): Promise<void> {
  const nm = (window as unknown as { nm?: WbCmdBridge }).nm;
  if (!row.source || !nm || inflight.has(row.id) || failed.has(row.id)) return;
  inflight.add(row.id);
  try {
    const x = await import('./excalidraw-lazy');
    let skeleton: unknown[];
    let files: Record<string, unknown> | undefined;
    if (row.source.kind === 'mermaid') {
      ({ elements: skeleton, files } = await x.parseMermaid(row.source.value));
    } else {
      const parsed = JSON.parse(row.source.value) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('the element skeleton is not a JSON array');
      skeleton = parsed;
    }
    const elements = x.convertToExcalidrawElements(skeleton as never, { regenerateIds: true });
    const appState = { viewBackgroundColor: '#ffffff' };
    const scene = x.serializeAsJSON(elements as never, appState as never, (files ?? {}) as never, 'local');
    if (scene.length > WB_SCENE_MAX) throw new Error('the generated scene is too large to sync');
    let snapshotSvg: string | undefined;
    try {
      const svg = await x.exportToSvg({
        elements: elements as never,
        appState: { ...appState, exportBackground: true } as never,
        files: (files ?? null) as never,
      });
      const text = svg.outerHTML;
      if (text.length <= WB_SNAPSHOT_MAX) snapshotSvg = text;
    } catch {
      /* a board without a still shows its placeholder; the editor's next save re-exports */
    }
    const res = await nm.wbUpdateCmd({ whiteboardId: row.id, baseRev: row.rev, scene, snapshotSvg, clearSource: true });
    if (!res.ok && res.code !== 'WHITEBOARD_STALE') {
      failed.set(row.id, res.error ?? `materialize failed (${res.status})`);
    }
  } catch (e) {
    failed.set(row.id, e instanceof Error ? e.message : 'the source did not convert');
  } finally {
    inflight.delete(row.id);
  }
}
