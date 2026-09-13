// The workspace TAB STRIP — the side dock's chrome (rail-ink round 3, 2026-09-04) — and the sheet's
// own head row, which the strip used to be. Slot 0's conversation is NOT drawn here any more: the
// conversation is the sheet itself (docs/36 §3.3 amended). The model still holds its record as
// the dock's scope subject, and App filters it out before the tabs reach this strip. The peek
// that pointed back at the conversation retired with the move: nothing hides it now.
import { IconClose, IconFile, IconFolder, IconGlobe, IconImage, IconSearch, IconTerm, IconThreads, IconWhiteboard } from './ui/icons';
import { tabCapabilities, type WTab } from './wtabs';
import { type WScope } from './wtabs/filetree';
import { useEffect, useState } from 'react';

export function WTabIcon({ tab, s = 12 }: { tab: WTab; s?: number }) {
  if (tab.kind === 'conversation') return <IconThreads s={s} />;
  if (tab.kind === 'terminal') return <IconTerm s={s} />;
  if (tab.kind === 'browser') return <IconGlobe s={s} />;
  if (tab.kind === 'whiteboard') return <IconWhiteboard s={s} />;
  if (!tab.path && !tab.artifactId) return <IconFolder s={s} />; // no path AND no bytes = a pane on a root, which is what a dock EDITOR tab was
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(tab.path ?? tab.title) ? <IconImage s={s} /> : <IconFile s={s} />;
}

/** THE SHEET'S HEAD ROW: what the tab strip left behind when the tabs moved to the side dock — a
 *  destination's own controls on the left (Code mode's workspace header) and the room's rail on
 *  the right (bell · crew · views). It keeps the strip's classes so the Code-mode grid override
 *  still lands, and it is ONE flex row, so nothing in it can overlap by construction. */
export function SheetHead({ context, aux }: { context?: React.ReactNode; aux?: React.ReactNode }) {
  return (
    <div className="wtstrip sheethd">
      {context ? <div className="wtcontext">{context}</div> : <div className="wtcontext sheethdsp" aria-hidden />}
      <div className="wtright">{aux}</div>
    </div>
  );
}

export function WTabStrip({ tabs, activeId, scope, onActivate, onClose, onNew, aux }: {
  /** the guests — never the conversation */
  tabs: WTab[]; activeId: string | null; scope: WScope;
  onActivate: (id: string) => void; onClose: (id: string) => void;
  onNew: (what: 'file' | 'terminal' | 'browser' | 'markdown' | 'whiteboard') => void;
  /** the dock's own controls at the strip's right end (the fold) */
  aux?: React.ReactNode;
}) {
  const [addOpen, setAddOpen] = useState(false);
  useEffect(() => {
    if (!addOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setAddOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [addOpen]);
  const where = scope.taskNumber != null ? `⎇ nm-${scope.taskNumber}` : scope.label;
  const pick = (what: Parameters<typeof onNew>[0]) => { setAddOpen(false); onNew(what); };
  return (
    <div className="wtstrip" role="tablist" aria-label="Side panel tabs">
      <div className="wtlead">
        <div className="wtlist">
          {tabs.map((t, i) => {
            const caps = tabCapabilities(t);
            const on = t.id === activeId;
            return (
              <button
                key={t.id} role="tab" aria-selected={on} data-kind={t.kind}
                className={`wtab${on ? ' on' : ''}${t.dirty ? ' dirty' : ''}`}
                title={`${t.title}${i < 8 ? ` · ⌘${i + 2}` : ''}`} onClick={() => onActivate(t.id)}
              >
                <span className="wtabic"><WTabIcon tab={t} /></span>
                <span className="wtablbl">{t.title}</span>
                {t.dirty && <span className="wtabdot" aria-label="unsaved edits" />}
                {caps.canClose && (
                  <span className="wtabx" role="button" aria-label={`Close ${t.title}`} onClick={(e) => { e.stopPropagation(); onClose(t.id); }}>
                    <IconClose s={10} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="wtaddwrap">
          <button className={`wtadd${addOpen ? ' on' : ''}`} aria-label="Open here" aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)}>＋</button>
          {addOpen && (
            <>
              <div className="projmenu-scrim" onClick={() => setAddOpen(false)} />
              {/* the row-menu recipe (docs/33 §8 — the New-chat caret's menu): one line per row, an
                  icon, no sublabels. The card that explained each row was the "card style" George
                  retired from the caret (rail-ink round 2), and "New chat" left with it: a chat is
                  the sheet's subject, not something that opens in this column. Split stays out
                  until it exists (docs/36 §9). */}
              <div className="navrowmenu wtfly" role="menu">
                <div className="wtflyhint">Open here</div>
                <button role="menuitem" title={scope.root ? `from ${where}` : 'the Workbench’s finder'} onClick={() => pick('file')}><IconSearch s={13} />Open a file…<kbd className="wtflykbd">⌘P</kbd></button>
                <button role="menuitem" title={scope.taskNumber != null ? "in the task's worktree" : `in ${scope.label}`} onClick={() => pick('terminal')}><IconTerm s={13} />Terminal</button>
                <button role="menuitem" title="preview a URL or localhost" onClick={() => pick('browser')}><IconGlobe s={13} />Browser</button>
                <div className="wtflysep" />
                <div className="wtflyhint">Create</div>
                <button role="menuitem" disabled={!scope.root} title={scope.root ? `a note in ${where}` : 'no worktree here yet'} onClick={() => pick('markdown')}><IconFile s={13} />New markdown</button>
                <button role="menuitem" title="sketch, then share to chat" onClick={() => pick('whiteboard')}><IconWhiteboard s={13} />New whiteboard</button>
              </div>
            </>
          )}
        </span>
      </div>
      <div className="wtright">{aux}</div>
    </div>
  );
}
