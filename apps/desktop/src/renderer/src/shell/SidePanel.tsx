// THE SIDE PANEL (rail-ink round 3, 2026-09-04, with Codex as the reference; the ONE right panel
// since the side-panel round, 2026-10-03, docs/design/side-panel-2026-10).
//
// Three panes: the rail, the sheet, and this. Everything beside the conversation lives here: the
// session's own tabs (Overview, Files, the code face) and what the session opened or made — files,
// terminals, browsers, whiteboards, reviews, articles. The Workbench card that floated inside the
// sheet retired into it. The panel belongs to the session in front of you (shell/panel-state.ts):
// a move to another session shows that session's tabs. It is toggled from the frame top's side
// panel glyph (⌘J); it unfolds itself when a tab comes to the front. Folded, its panes stay MOUNTED
// and hide by CSS: a terminal's pty and a browser's page history survive the fold exactly as they
// survive a tab switch (docs/36 §7).
import type { ReactNode } from 'react';
import { WTabStrip, type SessionTabSpec } from '../WorkspaceTabs';
import { IconCollapse, IconDockRight, IconExpand } from '../ui/icons';
import type { WTab } from '../wtabs';
import type { WScope } from '../wtabs/filetree';
import { PanelDock } from './PanelDock';

export function SidePanel({ open, width, min, max, mirrored, dragging, onWidth, onReset, onDragging, expanded, onExpand, sessionTabs, tabs, activeId, scope, canFind, onActivate, onClose, onNew, onFold, children }: {
  open: boolean;
  width: number; min: number; max: number; mirrored: boolean; dragging: boolean;
  onWidth: (px: number) => void; onReset: () => void; onDragging: (on: boolean) => void;
  /** the panel covers the main area for a deep review; Esc or the control returns it */
  expanded: boolean;
  onExpand: (on: boolean) => void;
  /** the session's own tabs, pinned */
  sessionTabs: SessionTabSpec[];
  /** the tabs this session opened, in strip order */
  tabs: WTab[]; activeId: string | null; scope: WScope;
  canFind: boolean;
  onActivate: (id: string) => void; onClose: (id: string) => void;
  onNew: (what: 'file' | 'terminal' | 'browser' | 'markdown' | 'whiteboard') => void;
  onFold: () => void;
  /** every pane, mounted whatever the fold and whatever the session: App decides which is on */
  children: ReactNode;
}) {
  return (
    <div className="sidedockwrap" data-open={open ? '1' : '0'}>
      <PanelDock width={width} min={min} max={max} mirrored={mirrored} dragging={dragging} onWidth={onWidth} onReset={onReset} onDragging={onDragging} expanded={expanded}>
        <WTabStrip sessionTabs={sessionTabs} tabs={tabs} activeId={activeId} scope={scope} canFind={canFind} onActivate={onActivate} onClose={onClose} onNew={onNew}
          aux={(
            <>
              <button className="utilbtn" data-tip={expanded ? 'Back beside the conversation · Esc' : 'Expand over the conversation'}
                aria-label={expanded ? 'Back beside the conversation' : 'Expand over the conversation'} aria-pressed={expanded} onClick={() => onExpand(!expanded)}>
                {expanded ? <IconCollapse s={13} /> : <IconExpand s={13} />}
              </button>
              <button className="utilbtn" data-tip="Fold the side panel · ⌘J" aria-label="Fold the side panel" onClick={onFold}>
                <IconDockRight s={15} />
              </button>
            </>
          )} />
        <div className="wtbody sdbody">
          {/* an open panel with nothing in it says what it is for, rather than showing a blank */}
          {sessionTabs.length === 0 && tabs.length === 0 && (
            <div className="sdempty">
              <b>Nothing open beside the conversation.</b>
              <span>＋ opens a file, a terminal, a browser, a note or a whiteboard here.</span>
            </div>
          )}
          {children}
        </div>
      </PanelDock>
    </div>
  );
}
