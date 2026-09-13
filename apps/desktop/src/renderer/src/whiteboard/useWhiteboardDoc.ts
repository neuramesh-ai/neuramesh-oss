// THE WHITEBOARD DOCUMENT — the replica watch, the save discipline, and the conflict verdicts.
//
// Split out of WhiteboardView, which was 254 lines of document syncing wearing an 81-line
// render. Two lanes write these rows (docs/38): humans local-first, LWW-by-rev, and agents on
// the strict command lane — so most of this file is about a stale autosave ACKing applied:false
// rather than wedging the upload queue, and about which side wins when it doesn't.
//
// The render reads fourteen things and never touches a ref's internals, which is what made this
// a hook rather than a smaller component: the boundary already existed, it just had no name.
import { useCallback, useEffect, useRef, useState } from 'react';
import { exportToSvg, getSceneVersion, serializeAsJSON } from '../excalidraw-lazy';
import { materializeWhiteboard } from '../wb-materialize';
import { parseWbRow, type WbRow, wbNeedsMaterialize, wbSnapshotStale } from '../whiteboards';
import { WB_SCENE_MAX, WB_SNAPSHOT_MAX } from '@neuramesh/shared';

interface WbBridge {
  wbSave(id: string, rev: number, patch: { scene?: string; snapshotSvg?: string; title?: string }): Promise<void>;
  wbArchive(id: string, rev: number, restore?: boolean): Promise<void>;
  watchWhiteboard(id: string, cb: (row: unknown | null) => void): () => void;
}
const nm = (window as unknown as { nm?: WbBridge }).nm;

// the excalidraw imperative API — typed structurally to what this view actually calls, so the
// deep library types never leak into the app's own surface
export interface CanvasApi {
  getSceneElements(): readonly unknown[];
  getAppState(): Record<string, unknown>;
  getFiles(): Record<string, unknown>;
  updateScene(scene: { elements?: unknown[] }): void;
  // files ride BESIDE the scene in Excalidraw's model — updateScene cannot carry them
  addFiles(files: unknown[]): void;
}

type SaveState = 'saved' | 'editing' | 'saving' | 'toolarge';

const themeOf = (): 'light' | 'dark' =>
  ((document.documentElement.getAttribute('data-theme') ?? 'dark').includes('dark') ? 'dark' : 'light');


export function useWhiteboardDoc(a: {
  boardId: string;
  onDirty?: (dirty: boolean) => void;
  onTitle?: (title: string) => void;
}) {
  const { boardId, onDirty, onTitle } = a;
  const [row, setRow] = useState<WbRow | null>(null);
  const [booted, setBooted] = useState<{ elements: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> } | null>(null);
  const [save, setSave] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(themeOf);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);

  const apiRef = useRef<CanvasApi | null>(null);
  const rowRef = useRef<WbRow | null>(null);
  const baseRevRef = useRef(0); // the rev this canvas last agreed with the replica on
  const savedVersionRef = useRef(0); // getSceneVersion at the last save/load
  const seenVersionRef = useRef(0); // the newest version already scheduled — see onChange
  const timerRef = useRef<number | null>(null);
  const snapshotRepairedRef = useRef(false);
  const conflictRef = useRef(false);
  conflictRef.current = conflict;

  // ── the replica watch: boot, echoes, remote edits ─────────────────────────────────────────
  useEffect(() => {
    if (!nm) return;
    const stop = nm.watchWhiteboard(boardId, (raw) => {
      const r = parseWbRow(raw);
      if (!r) return;
      rowRef.current = r;
      setRow(r);
    });
    return stop;
  }, [boardId]);

  useEffect(() => {
    if (!row) return;
    // an agent board still carrying source: this mount is a candidate materializer
    if (wbNeedsMaterialize(row)) {
      void materializeWhiteboard(row);
      return;
    }
    if (!booted) {
      // first workable row → the canvas's initial scene
      //
      // `files` is not optional detail: an image element holds only a fileId, and the BYTES live in
      // this map. Dropping it opened every image-bearing board as grey placeholders — and because
      // the save path serializes `api.getFiles()`, the first edit then wrote the empty map back and
      // the picture was gone for good. Caught live: an agent's mermaid that mermaid-to-excalidraw
      // renders as one image (anything outside flowchart/sequence/class) opens exactly this way.
      let parsed: { elements: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> } = { elements: [] };
      if (row.scene) {
        try {
          const v = JSON.parse(row.scene) as { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> };
          parsed = { elements: Array.isArray(v.elements) ? v.elements : [], appState: v.appState, ...(v.files ? { files: v.files } : {}) };
        } catch {
          /* an unreadable scene opens empty — the next save rewrites it */
        }
      }
      baseRevRef.current = row.rev;
      // -1 = "adopt the first onChange": Excalidraw's restore() normalizes elements on mount,
      // so a version computed from the RAW stored JSON never matches the canvas's own — and a
      // board would open already-dirty and autosave a pointless rev on every open.
      savedVersionRef.current = -1;
      setBooted(parsed);
      return;
    }
    if (row.rev > baseRevRef.current) {
      // the replica moved past what this canvas built on
      const dirty = save === 'editing' || save === 'saving' || save === 'toolarge';
      if (!dirty && row.scene && apiRef.current) {
        try {
          const v = JSON.parse(row.scene) as { elements?: unknown[]; files?: Record<string, unknown> };
          // addFiles BEFORE updateScene: an incoming rev can carry pictures this canvas has never
          // seen (an agent redrawing the board), and updateScene has no channel for their bytes
          if (v.files) apiRef.current.addFiles(Object.values(v.files));
          apiRef.current.updateScene({ elements: Array.isArray(v.elements) ? v.elements : [] });
          baseRevRef.current = row.rev;
          savedVersionRef.current = getSceneVersion((v.elements ?? []) as never);
          seenVersionRef.current = savedVersionRef.current;
        } catch {
          /* leave the canvas as-is; the row stays ahead and the banner path can take it */
        }
      } else if (dirty) {
        setConflict(true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- row drives; save/booted read latest
  }, [row]);

  // ── theme follows the app (the data-theme attribute is the one signal) ────────────────────
  useEffect(() => {
    const watch = new MutationObserver(() => setTheme(themeOf()));
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => watch.disconnect();
  }, []);

  useEffect(() => () => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
  }, []);

  // ── the save discipline ───────────────────────────────────────────────────────────────────
  const doSave = useCallback(async (titleOnly?: string) => {
    const api = apiRef.current;
    const r = rowRef.current;
    if (!nm || !r || (!api && titleOnly === undefined)) return;
    if (conflictRef.current) return; // a human decision is pending — autosave holds its breath
    const rev = Math.max(baseRevRef.current, r.rev) + 0; // base we agreed on; bump below
    if (titleOnly !== undefined) {
      const next = rev + 1;
      await nm.wbSave(r.id, next, { title: titleOnly });
      baseRevRef.current = next;
      onTitle?.(titleOnly);
      return;
    }
    const elements = api!.getSceneElements();
    const version = getSceneVersion(elements as never);
    const appState = api!.getAppState();
    const files = api!.getFiles();
    const scene = serializeAsJSON(elements as never, appState as never, files as never, 'local');
    if (scene.length > WB_SCENE_MAX) {
      setSave('toolarge');
      onDirty?.(true);
      return;
    }
    setSave('saving');
    let snapshotSvg: string | undefined;
    try {
      const svg = await exportToSvg({
        elements: elements as never,
        appState: { ...appState, exportBackground: true, viewBackgroundColor: (appState['viewBackgroundColor'] as string) || '#ffffff', theme: 'light', exportWithDarkMode: false } as never,
        files: files as never,
      });
      const text = svg.outerHTML;
      if (text.length <= WB_SNAPSHOT_MAX) snapshotSvg = text;
    } catch {
      /* still saves; the snapshot stays stale and repairs on a later save */
    }
    const next = rev + 1;
    await nm.wbSave(r.id, next, { scene, snapshotSvg });
    baseRevRef.current = next;
    savedVersionRef.current = version;
    seenVersionRef.current = version;
    // edits may have landed while the export ran
    const nowVersion = getSceneVersion(api!.getSceneElements() as never);
    const stillDirty = nowVersion !== version;
    setSave(stillDirty ? 'editing' : 'saved');
    onDirty?.(stillDirty);
    if (stillDirty) schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const schedule = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void doSave();
    }, 1500);
  }, [doSave]);

  const onChange = useCallback((elements: readonly unknown[]) => {
    const version = getSceneVersion(elements as never);
    if (savedVersionRef.current === -1) {
      // the mount's own normalization pass — this IS the saved scene, freshly restored
      savedVersionRef.current = version;
      seenVersionRef.current = version;
      return;
    }
    if (version === savedVersionRef.current) {
      seenVersionRef.current = version;
      return;
    }
    // Debounce on the VERSION moving, never on the callback firing: Excalidraw re-announces
    // onChange for appState churn (selection, pointer, tool) with the SAME scene version, and
    // rescheduling on each announcement starves the timer — the live e2e run sat in "editing…"
    // forever. A dirty version re-announced lets the pending timer run out.
    if (version === seenVersionRef.current) return;
    seenVersionRef.current = version;
    setSave((s) => (s === 'saving' ? s : 'editing'));
    onDirty?.(true);
    schedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);

  // stale still + no pending source: the open editor is the repair shop (once per mount)
  useEffect(() => {
    if (!row || !booted || !apiRef.current || snapshotRepairedRef.current) return;
    if (!wbNeedsMaterialize(row) && row.scene && wbSnapshotStale(row) && save === 'saved') {
      snapshotRepairedRef.current = true;
      void doSave();
    }
  }, [row, booted, save, doSave]);

  // ── conflict verdicts ─────────────────────────────────────────────────────────────────────
  const takeTheirs = useCallback(() => {
    const r = rowRef.current;
    const api = apiRef.current;
    if (!r?.scene || !api) return;
    try {
      const v = JSON.parse(r.scene) as { elements?: unknown[] };
      api.updateScene({ elements: Array.isArray(v.elements) ? v.elements : [] });
      baseRevRef.current = r.rev;
      savedVersionRef.current = getSceneVersion((v.elements ?? []) as never);
      seenVersionRef.current = savedVersionRef.current;
      setConflict(false);
      setSave('saved');
      onDirty?.(false);
    } catch {
      /* their scene would not parse — keep mine stays available */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const keepMine = useCallback(() => {
    const r = rowRef.current;
    if (!r) return;
    baseRevRef.current = r.rev; // build on their rev so the save lands above it
    setConflict(false);
    void doSave();
  }, [doSave]);


  /** un-archive — the same call the render used to make inline, named so `nm` stays private here */
  const restore = useCallback(() => {
    const r = rowRef.current;
    if (r) void nm?.wbArchive(r.id, Math.max(baseRevRef.current, r.rev) + 1, true);
  }, []);

  return { restore, apiRef, baseRevRef, booted, conflict, doSave, editingTitle, keepMine, onChange, row, rowRef, save, setEditingTitle, takeTheirs, theme };
}
