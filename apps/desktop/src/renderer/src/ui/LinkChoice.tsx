// THE LINK CHOICE (2026-09-17, George; visual contract mockups/external-links.html): a click on a
// web link asks where the page opens. Here, in the browser tab beside the sheet, or in the browser
// the OS uses. Before this, every link left the app, and a raw anchor opened a bare Electron window.
//
// The surface is the app's popover recipe (ui/Popover.tsx): it grows out of the press, over
// nothing, and folds back. The head is the fact you decide on, the host and the path. The rows
// wear the row-menu recipe. Row one wears the neuramesh mark (George, 2026-09-17: the app is the
// place, so its mark names the row). Row two wears the default browser's own icon and name, as
// the OS reports them (`nm.defaultBrowser`, asked once per launch).
//
// The host mounts once at the root: it registers the chooser and the OS opener on the link seam
// (lib/links.ts) and installs the capture-phase anchor watcher. The web client is already a
// browser, so there it registers no chooser and every link keeps its new tab.
import { useEffect, useRef, useState } from 'react';
import { nm } from '../bridge/nm';
import { NM_PLATFORM } from '../lib/platform';
import { modGlyph, openLink, setExternalOpener, setLinkChooser, splitUrl, watchLinks, type LinkAsk } from '../lib/links';
import { anchorPoint } from './anchor';
import { IconExternal, IconGlobe } from './icons';
import { PorchMark } from '../brand';
import { Popover } from './Popover';

type Browser = { name: string; icon: string | null } | null;
let browserOnce: Promise<Browser> | null = null;
const defaultBrowser = () => (browserOnce ??= (nm?.defaultBrowser?.() ?? Promise.resolve(null)).catch(() => null));

export function LinkChoiceHost({ openInApp }: { openInApp: (url: string) => void }) {
  const [ask, setAsk] = useState<LinkAsk | null>(null);
  const [browser, setBrowser] = useState<Browser>(null);
  useEffect(() => {
    setExternalOpener((url) => { void nm?.openExternal(url); });
    if (NM_PLATFORM !== 'web') setLinkChooser((a) => setAsk(a));
    const stop = watchLinks();
    void defaultBrowser().then(setBrowser);
    return () => { setExternalOpener(null); setLinkChooser(null); stop(); };
  }, []);
  if (!ask) return null;
  // a pick unmounts the surface at once: it has done its job and the eye follows the page
  const pick = (where: 'inapp' | 'external') => {
    setAsk(null);
    if (where === 'inapp') openInApp(ask.url);
    else openLink(ask.url, { skip: true });
  };
  return <LinkChoice key={ask.url} ask={ask} browser={browser} onPick={pick} onClose={() => setAsk(null)} />;
}

function LinkChoice({ ask, browser, onPick, onClose }: {
  ask: LinkAsk; browser: Browser; onPick: (where: 'inapp' | 'external') => void; onClose: () => void;
}) {
  const { host, path } = splitUrl(ask.url);
  const [row, setRow] = useState(0);
  const rows = [useRef<HTMLButtonElement>(null), useRef<HTMLButtonElement>(null)];
  // the highlight IS the focus: the first row at open, so ↵ opens the page here, and the arrows move both
  useEffect(() => { rows[row]?.current?.focus(); }, [row]); // eslint-disable-line react-hooks/exhaustive-deps
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onPick(e.metaKey || e.ctrlKey ? 'external' : row === 0 ? 'inapp' : 'external'); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') { e.preventDefault(); setRow((r) => 1 - r); }
  };
  const mod = modGlyph(typeof navigator === 'undefined' ? '' : navigator.platform);
  return (
    <Popover label="Open link" anchor={ask.anchor ?? anchorPoint()} width={264} onClose={onClose} className="linkpop">
      <div className="linkpophd">
        <IconGlobe s={14} />
        <span className="linkpophost">{host}</span>
        {path && <span className="linkpoppath">{path}</span>}
      </div>
      <div onKeyDown={onKey}>
        <button ref={rows[0]} className={`linkpoprow${row === 0 ? ' on' : ''}`} onMouseEnter={() => setRow(0)} onClick={() => onPick('inapp')}>
          <PorchMark size={16} /><span>Open in neuramesh</span><kbd>↵</kbd>
        </button>
        <button ref={rows[1]} className={`linkpoprow${row === 1 ? ' on' : ''}`} onMouseEnter={() => setRow(1)} onClick={() => onPick('external')}>
          {browser?.icon ? <img src={browser.icon} alt="" /> : <IconExternal s={14} />}
          <span>{browser?.name ? `Open in ${browser.name}` : 'Open in your browser'}</span>
          <kbd>{mod}↵</kbd>
        </button>
      </div>
    </Popover>
  );
}
