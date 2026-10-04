// The workspace TAB STRIP — the side panel's chrome (rail-ink round 3, 2026-09-04; the side-panel
// round, 2026-10-03) — and the sheet's own head row, which the strip used to be. Slot 0's
// conversation is NOT drawn here: the conversation is the sheet itself (docs/36 §3.3 amended). The
// strip leads with the SESSION's own tabs (Overview, Files, the code face), pinned and never closed,
// then a hairline, then the tabs this session opened.
import { IconBoard, IconClose, IconFile, IconFolder, IconGlobe, IconImage, IconSearch, IconTerm, IconThreads, IconWhiteboard } from './ui/icons';
import { tabCapabilities, type WTab } from './wtabs';
import { sessionTabId, type SessionTabKey } from './shell/panel-state';
import { type WScope } from './wtabs/filetree';
import { useEffect, useState } from 'react';

export function WTabIcon({ tab, s = 12 }: { tab: WTab; s?: number }) {
  if (tab.kind === 'conversation') return <IconThreads s={s} />;
  if (tab.kind === 'terminal') return <IconTerm s={s} />;
  if (tab.kind === 'browser') return <IconGlobe s={s} />;
  if (tab.kind === 'whiteboard') return <IconWhiteboard s={s} />;
  if (tab.kind === 'task') return <IconBoard s={s} />;
  if (!tab.path && !tab.artifactId) return <IconFolder s={s} />; // no path AND no bytes = a pane on a root, which is what a dock EDITOR tab was
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(tab.path ?? tab.title) ? <IconImage s={s} /> : <IconFile s={s} />;
}

/** THE SHEET'S HEAD: the room's rail (bell · crew · views) at the sheet's top-right corner, and in
 *  Code mode the workspace header beside it on one row. With no context the head is BARE and floats
 *  over the corner (the Cabinet round's `.utilbar` placement, restored 2026-09-18 after George saw
 *  every title a whole row below the bell): the rows that own the sheet's first line — a
 *  destination's `.topbar`, a session's `.thead` — start at the top and reserve the corner. With
 *  context it stays ONE flex row, so the Code header and the rail cannot overlap by construction. */
export function SheetHead({ context, aux }: { context?: React.ReactNode; aux?: React.ReactNode }) {
  return (
    <div className={`wtstrip sheethd${context ? '' : ' bare'}`}>
      {context && <div className="wtcontext">{context}</div>}
      <div className="wtright">{aux}</div>
    </div>
  );
}

/** one of the session's own tabs as the strip draws it (shell/panel-state.ts derives which) */
export interface SessionTabSpec {
  key: SessionTabKey;
  label: string;
  icon: React.ReactNode;
  /** a count the tab wears (changes, checkpoints), or a mark (the Work Plan's ✓) */
  count?: string | number | null;
  /** it holds a gate that waits for you */
  warm?: boolean;
  /** drawn as its glyph alone, the way the code face drew Terminal */
  iconOnly?: boolean;
}

export function WTabStrip({ sessionTabs, tabs, activeId, scope, canFind, onActivate, onClose, onNew, aux }: {
  /** the session's own tabs: pinned, never closed (the side-panel round, 2026-10-03) */
  sessionTabs: SessionTabSpec[];
  /** the tabs this session opened — never the conversation */
  tabs: WTab[]; activeId: string | null; scope: WScope;
  /** the session has a Files tab, so "Open a file" has somewhere to go */
  canFind: boolean;
  onActivate: (id: string) => void; onClose: (id: string) => void;
  onNew: (what: 'file' | 'terminal' | 'browser' | 'markdown' | 'whiteboard') => void;
  /** the panel's own controls at the strip's right end (expand · fold) */
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
    // five own tabs (a coding thread) is "many": a narrow panel draws the ones behind the front tab as their glyph alone
    <div className={`wtstrip${sessionTabs.length > 2 ? ' many' : ''}`} role="tablist" aria-label="Side panel tabs">
      <div className="wtlead">
        <div className="wtlist">
          {sessionTabs.map((st, i) => {
            const id = sessionTabId(st.key);
            const on = id === activeId;
            return (
              <button key={id} role="tab" aria-selected={on} data-session={st.key} aria-label={st.iconOnly ? st.label : undefined}
                className={`wtab pin${on ? ' on' : ''}${st.warm ? ' warm' : ''}`} title={`${st.label}${i < 8 ? ` · ⌘${i + 2}` : ''}`} onClick={() => onActivate(id)}>
                <span className="wtabic">{st.icon}</span>
                {!st.iconOnly && <span className="wtablbl">{st.label}</span>}
                {st.count != null && st.count !== '' && <span className="wtabct">{st.count}</span>}
              </button>
            );
          })}
          {sessionTabs.length > 0 && tabs.length > 0 && <span className="wtsep" aria-hidden />}
          {tabs.map((t, i) => {
            const caps = tabCapabilities(t);
            const on = t.id === activeId;
            const n = sessionTabs.length + i;
            return (
              <button
                key={t.id} role="tab" aria-selected={on} data-kind={t.kind}
                className={`wtab${on ? ' on' : ''}${t.dirty ? ' dirty' : ''}`}
                title={`${t.title}${n < 8 ? ` · ⌘${n + 2}` : ''}`} onClick={() => onActivate(t.id)}
              >
                <span className="wtabic"><WTabIcon tab={t} /></span>
                <span className="wtablbl">{t.title}</span>
                {t.dirty && <span className="wtabdot" aria-label="unsaved edits" />}
                {t.fresh && !on && !t.dirty && <span className="wtabnew" aria-label="new" />}
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
              {/* the row-menu recipe (docs/33 §8): one line per row, an icon, no sublabels */}
              <div className="navrowmenu wtfly" role="menu">
                <div className="wtflyhint">Open here</div>
                <button role="menuitem" disabled={!canFind} title={canFind ? `in ${where}` : 'no files to browse here'} onClick={() => pick('file')}><IconSearch s={13} />Open a file<kbd className="wtflykbd">⌘P</kbd></button>
                <button role="menuitem" title={scope.taskNumber != null ? "in the task's worktree" : `in ${scope.label}`} onClick={() => pick('terminal')}><IconTerm s={13} />Terminal</button>
                <button role="menuitem" title="a URL or localhost" onClick={() => pick('browser')}><IconGlobe s={13} />Browser</button>
                <div className="wtflysep" />
                <div className="wtflyhint">Create</div>
                <button role="menuitem" disabled={!scope.root} title={scope.root ? `a note in ${where}` : 'no worktree here'} onClick={() => pick('markdown')}><IconFile s={13} />New note</button>
                <button role="menuitem" title="sketch it, then share it to the conversation" onClick={() => pick('whiteboard')}><IconWhiteboard s={13} />New whiteboard</button>
              </div>
            </>
          )}
        </span>
      </div>
      <div className="wtright">{aux}</div>
    </div>
  );
}
