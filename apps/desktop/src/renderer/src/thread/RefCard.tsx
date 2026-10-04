// THE ONE-ROW CARD (the side-panel round, 2026-10-03, docs/design/side-panel-2026-10 §3.5). When the
// side panel shows a thing a session made (a plan, a design round, a file, drafts), the thread keeps
// one row that names it: the glyph, the name, the kind, the gate, and "In the panel" or "Open". A
// click shows its tab again. The inline previews that showed the same thing beside the panel retired
// on the web; the phone keeps its own cards.
import { createContext, useContext, type ReactNode } from 'react';
import { IconArrowR } from '../ui/icons';

/**
 * What the side panel shows in front right now, so a row can say "In the panel": the name of the
 * file or review in front (`name`), or the session's Drafts tab (`drafts`). Null fields while the
 * panel is folded or shows something else.
 */
export interface PanelShown { name: string | null; drafts: boolean }
export const PanelShownContext = createContext<PanelShown>({ name: null, drafts: false });
export const usePanelShown = (): PanelShown => useContext(PanelShownContext);

export function RefCard({ glyph, tone, name, meta, waits, shown, chips, onOpen }: {
  glyph: ReactNode;
  /** the glyph's well: a plan, a design round, a marketing draft, else neutral */
  tone?: 'plan' | 'design' | 'mkt' | null;
  name: string;
  /** the kind and its facts: `plan · v2`, `doc · 3 KB` */
  meta: string;
  /** the gate, said in the warm tone: `waits for your verdict` */
  waits?: string | null;
  /** the panel shows this thing in front now */
  shown: boolean;
  /** the drafts' letters, or anything else the row names at its end */
  chips?: ReactNode;
  onOpen: () => void;
}) {
  return (
    <button type="button" className={`refcard${shown ? ' on' : ''}`} onClick={onOpen} title={shown ? `${name} is in the side panel` : `Open ${name} in the side panel`}>
      <span className={`refic${tone ? ` ${tone}` : ''}`} aria-hidden>{glyph}</span>
      <span className="reftx">
        <b>{name}</b>
        {/* the facts give way before the gate does: a long list of networks truncates, "waits for your verdict" never */}
        <span className="refmeta"><span>{meta}</span>{waits ? <em>{waits}</em> : null}</span>
      </span>
      {chips && <span className="refchips">{chips}</span>}
      <span className={`refgo${shown ? ' here' : ''}`}>{shown ? 'In the panel' : 'Open'}{!shown && <IconArrowR s={10} />}</span>
    </button>
  );
}
