// THE SIDE DOCK (rail-ink round 3, 2026-09-04 — George, with Codex as the reference).
//
// The workspace tab strip and everything it opens — files, terminals, browsers, whiteboards,
// reviews — moved out of the sheet into a column of their own at the frame's right edge, so the
// conversation owns the sheet edge to edge and the Workbench can float inside it as a card. The
// dock is toggled from the frame top's side-panel glyph (⌘J); it unfolds itself when a tab comes
// to the front and folds when the last one closes (shell/sidedock-state.ts, tested). Folded, its
// panes stay MOUNTED and hide by CSS: a terminal's pty and a browser's page history survive the
// fold exactly as they survive a tab switch (docs/36 §7).
import type { ReactNode } from 'react';
import { WTabStrip } from '../WorkspaceTabs';
import { IconDockRight } from '../ui/icons';
import type { WTab } from '../wtabs';
import type { WScope } from '../wtabs/filetree';
import { WorkbenchDock } from './WorkbenchDock';

export function SideDock({ open, width, min, max, mirrored, dragging, onWidth, onReset, onDragging, tabs, activeId, scope, onActivate, onClose, onNew, onFold, children }: {
  open: boolean;
  width: number; min: number; max: number; mirrored: boolean; dragging: boolean;
  onWidth: (px: number) => void; onReset: () => void; onDragging: (on: boolean) => void;
  /** the guests — never the conversation (shell/sidedock-state.ts `dockTabs`) */
  tabs: WTab[]; activeId: string | null; scope: WScope;
  onActivate: (id: string) => void; onClose: (id: string) => void;
  onNew: (what: 'file' | 'terminal' | 'browser' | 'markdown' | 'whiteboard') => void;
  onFold: () => void;
  /** the panes, one per guest, mounted whatever the fold */
  children: ReactNode;
}) {
  return (
    <div className="sidedockwrap" data-open={open ? '1' : '0'}>
      <WorkbenchDock variant="side" width={width} min={min} max={max} mirrored={mirrored} dragging={dragging} onWidth={onWidth} onReset={onReset} onDragging={onDragging}>
        <WTabStrip tabs={tabs} activeId={activeId} scope={scope} onActivate={onActivate} onClose={onClose} onNew={onNew}
          aux={(
            <button className="utilbtn" data-tip="Hide the side panel · ⌘J" aria-label="Hide the side panel" onClick={onFold}>
              <IconDockRight s={15} />
            </button>
          )} />
        <div className="wtbody sdbody">
          {/* an open dock with nothing in it says what it is for, rather than showing a blank */}
          {tabs.length === 0 && (
            <div className="sdempty">
              <b>Nothing open beside the conversation.</b>
              <span>＋ opens a file, a terminal, a browser, a note or a whiteboard here.</span>
            </div>
          )}
          {children}
        </div>
      </WorkbenchDock>
    </div>
  );
}
