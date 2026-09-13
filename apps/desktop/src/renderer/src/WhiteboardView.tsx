// The whiteboard tab (docs/38): Excalidraw hosted as the sixth workspace-tab kind. The canvas
// is the canvas — the library keeps its own island chrome inside the pane (the xterm ruling),
// takes the app's light/dark, and has its cloud/share affordances disabled; NeuraMesh owns the
// 38px header above it (title · #room chip · saved state · Share) and the save discipline:
//
//   autosave (1.5s idle) → serialize scene + export the SVG still → rev = base + 1 → nm.wbSave
//   (the LWW lane). Clean tab + a remote rev → the canvas refreshes in place (viewers watch a
//   board change live). Dirty tab + a remote rev → the conflict strip: take theirs or keep
//   mine — LWW with a human on the tiller, never a silent clobber.
//
// This file is a LAZY chunk (App imports it via React.lazy) and is the only React surface that
// touches excalidraw-lazy — the boot bundle never pays for the canvas.
import { WB_TITLE_MAX } from '@neuramesh/shared';
import { Excalidraw } from './excalidraw-lazy';
import { wbNeedsMaterialize, type WbRow } from './whiteboards';
import { wbMaterializeFailure } from './wb-materialize';
import { useWhiteboardDoc, type CanvasApi } from './whiteboard/useWhiteboardDoc';

export default function WhiteboardView({ boardId, onDirty, onTitle, onShare }: {
  boardId: string;
  onDirty?: (dirty: boolean) => void;
  onTitle?: (title: string) => void;
  /** slice 3 wires this to the share composer; absent = the button stays hidden */
  onShare?: (row: WbRow) => void;
}): React.JSX.Element {
  // the document: replica watch, save discipline, conflict verdicts (whiteboard/useWhiteboardDoc.ts)
  const { restore, apiRef, booted, conflict, doSave, editingTitle, keepMine, onChange,
          row, rowRef, save, setEditingTitle, takeTheirs, theme } = useWhiteboardDoc({ boardId, onDirty, onTitle });
  // ── render ────────────────────────────────────────────────────────────────────────────────
  const failure = wbMaterializeFailure(boardId);
  const archived = !!row?.archivedAt;
  const title = editingTitle ?? row?.title ?? 'Untitled board';

  if (!row || (!booted && !failure && wbNeedsMaterialize(row))) {
    return (
      <div className="wbpane">
        <div className="wbwait">
          {row?.source ? 'Drawing the board from its source…' : 'Opening the canvas…'}
        </div>
      </div>
    );
  }

  if (failure) {
    return (
      <div className="wbpane">
        <div className="wbhead">
          <span className="wbpath">whiteboard /</span>
          <span className="wbttl">{title}</span>
          {row.channelSlug ? <span className="wbchip"><span className="h">#</span>{row.channelSlug}</span> : null}
        </div>
        <div className="wbfail">
          <div className="t">This board’s source didn’t convert.</div>
          <div className="d">{failure}</div>
          <pre>{row.source?.value ?? ''}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="wbpane">
      <div className="wbhead">
        <span className="wbpath">whiteboard /</span>
        {editingTitle !== null ? (
          <input
            className="wbttl-in"
            value={editingTitle}
            maxLength={WB_TITLE_MAX}
            autoFocus
            onChange={(e) => setEditingTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEditingTitle(null);
            }}
            onBlur={() => {
              const next = editingTitle.trim();
              setEditingTitle(null);
              if (next && next !== row.title) void doSave(next);
            }}
          />
        ) : (
          <span className="wbttl" onDoubleClick={() => !archived && setEditingTitle(row.title)} title="Double-click to rename">
            {title}
          </span>
        )}
        {row.channelSlug ? <span className="wbchip"><span className="h">#</span>{row.channelSlug}</span> : null}
        <span className={`wbsaved${save === 'toolarge' ? ' warn' : ''}`}>
          {archived
            ? 'archived'
            : save === 'saved'
              ? 'saved · synced'
              : save === 'saving'
                ? 'saving…'
                : save === 'toolarge'
                  ? 'too large to sync — trim the board'
                  : 'editing…'}
        </span>
        {archived ? (
          <button className="wbshare" onClick={restore}>
            Restore
          </button>
        ) : onShare ? (
          <button className="wbshare" onClick={() => onShare(rowRef.current ?? row)}>
            <span className="a">↗</span> Share to chat
          </button>
        ) : null}
      </div>
      {conflict ? (
        <div className="wbconflict">
          <span>Someone else saved this board while you were drawing.</span>
          <button onClick={takeTheirs}>Take theirs</button>
          <button className="mine" onClick={keepMine}>Keep mine</button>
        </div>
      ) : null}
      <div className="wbcanvas">
        {booted ? (
          <Excalidraw
            excalidrawAPI={(api) => {
              apiRef.current = api as unknown as CanvasApi;
            }}
            initialData={{
              elements: booted.elements as never,
              appState: { ...(booted.appState ?? {}), collaborators: new Map() } as never,
              ...(booted.files ? { files: booted.files as never } : {}),
              scrollToContent: true,
            }}
            onChange={onChange as never}
            theme={theme}
            viewModeEnabled={archived}
            name={title}
            UIOptions={{
              canvasActions: { export: false, loadScene: false, saveToActiveFile: false, toggleTheme: false },
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
