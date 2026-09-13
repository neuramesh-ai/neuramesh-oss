// The project logo field — pick or drop an image, previewed at the size it will be seen.
// Extracted from App.tsx (track A2).
import { ProjLogo } from '../components/AgentAvatar';
import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Website + auto-detected logo, shared by New project and Project settings. The parent
// owns website/logo state (submit/save read both); this field owns the detect calls —
// typed URLs auto-detect once they settle (only while no logo is set and the user hasn't
// removed one), the Detect button re-runs on demand, and folder detection is offered when
// the project has a local repo folder. Detection runs on this machine (nm:logo-detect).
export function LogoField({ name, website, setWebsite, logo, setLogo, cleared, folderPath }: {
  name: string;
  website: string; setWebsite: (v: string) => void;
  logo: string | null; setLogo: (v: string | null) => void;
  cleared: React.MutableRefObject<boolean>; // parent-owned "user removed the logo" latch
  folderPath?: string | null;
}) {
  const [busy, setBusy] = useState<null | 'site' | 'folder'>(null);
  const [note, setNote] = useState('');
  const seq = useRef(0); // type A, detect, type B fast → only B's result lands
  const run = async (input: { url?: string; path?: string }, kind: 'site' | 'folder') => {
    if (!nm) return;
    const s = ++seq.current;
    setBusy(kind); setNote('');
    const r = await nm.logoDetect(input).catch(() => null);
    if (s !== seq.current) return;
    setBusy(null);
    if (r?.logoUrl) {
      setLogo(r.logoUrl);
      if (input.url && r.website) setWebsite(r.website);
      setNote(`Logo found · ${r.source}`);
    } else {
      setNote(kind === 'site' ? 'No logo found at that address.' : 'No logo file found in the repo folder.');
    }
  };
  const detectSite = () => { if (website.trim()) void run({ url: website.trim() }, 'site'); };
  // auto-detect as the URL settles — never clobbers a set logo or a deliberate removal
  useEffect(() => {
    const url = website.trim();
    if (!url || logo || cleared.current || !/\.|localhost/.test(url)) return;
    const t = setTimeout(() => { void run({ url }, 'site'); }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [website, logo]);
  return (
    <div className="fld">
      <label>Website &amp; logo</label>
      <div className="logorow">
        <span className="logoswatch">
          <ProjLogo logo={logo} name={name} size={36} radius={9} />
          {logo && <button type="button" className="logoclear" title="remove logo" aria-label="Remove logo" onClick={() => { setLogo(null); setNote(''); }}>×</button>}
        </span>
        <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://yourproject.com" spellCheck={false}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); detectSite(); } }} />
        <button type="button" className="btn sm" disabled={busy !== null || !website.trim()} onClick={detectSite}>{busy === 'site' ? 'Detecting…' : 'Detect'}</button>
        {folderPath && <button type="button" className="btn sm" disabled={busy !== null} title={`scan ${folderPath} for a logo file`} onClick={() => void run({ path: folderPath }, 'folder')}>{busy === 'folder' ? 'Scanning…' : 'From folder'}</button>}
      </div>
      <div className="fldhint">{busy ? 'Looking for a logo…' : note || 'The logo is auto-detected from the site’s icons — it shows on the project switcher.'}</div>
    </div>
  );
}
