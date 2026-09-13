// New project — the folder-first flow (docs/design), including attaching a repo.
// Extracted from App.tsx (track A2).
import { DEFAULT_CHANNELS } from '../lib/defaults';
import { IconBranch, IconCheck, IconChevron, IconFolder } from '../ui/icons';
import { LogoField } from './LogoField';
import { Modal } from '../ui/Modal';
import { cleanErr, slugifyName } from '../lib/text';
import { nm as nmBridge } from '../bridge/nm';
import { useCallback, useEffect, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Register a GitHub repo to the workspace so tasks can branch off it + push for
// review. v1 = public github.com; the executing machine's own git creds
// authenticate at push time (the platform stores no repo tokens). Idempotent
// server-side, so re-adding the same repo is a safe no-op.
export type RepoSpec = { url?: string; localPath?: string; name?: string; defaultBranch?: string };

// Shared repo-connect control: pick a source (GitHub · GitLab · Local), then paste a
// URL or choose a local folder (the folder also becomes the code-viewer home). Reports
// the current spec up; the parent owns submit (Connect adds now; New project links
// after the project is created). The repo list per source arrives in the next slice.
// the tab is remembered across the control's uses (create project · connect repo) so the
// fast path stays one click; `defaultSrc` only seeds a caller's first-ever open.
export const loadRepoSrc = (fallback: 'github' | 'gitlab' | 'local'): 'github' | 'gitlab' | 'local' => {
  const v = localStorage.getItem('nm:repoSrc');
  return v === 'github' || v === 'gitlab' || v === 'local' ? v : fallback;
};

export function RepoConnect({ onChange, defaultSrc = 'github' }: { onChange: (spec: RepoSpec | null) => void; defaultSrc?: 'github' | 'gitlab' | 'local' }) {
  const [src, setSrc] = useState<'github' | 'gitlab' | 'local'>(() => loadRepoSrc(defaultSrc));
  const [url, setUrl] = useState('');
  const [picked, setPicked] = useState<{ path: string; name: string; branch: string; isGit: boolean; remoteLabel?: string | null } | null>(null);
  useEffect(() => {
    if (src === 'local') onChange(picked ? { localPath: picked.path, name: picked.name, defaultBranch: picked.branch } : null);
    else { const u = url.trim(); onChange(u.length > 3 ? { url: u } : null); }
  }, [src, url, picked, onChange]);
  const pick = async () => { const r = await nm?.pickFolder(); if (r) setPicked(r); };
  const SOURCES = [
    { k: 'local' as const, label: 'Local', icon: <IconFolder s={14} /> },
    { k: 'github' as const, label: 'GitHub', icon: <IconBranch s={14} /> },
    { k: 'gitlab' as const, label: 'GitLab', icon: <IconBranch s={14} /> },
  ];
  return (
    <div className="rc">
      <div className="rcsrc">
        {SOURCES.map((s) => (
          <button key={s.k} className={`rcsrcbtn${src === s.k ? ' on' : ''}`} onClick={() => { setSrc(s.k); localStorage.setItem('nm:repoSrc', s.k); }}>{s.icon}{s.label}</button>
        ))}
      </div>
      {src === 'local' ? (
        picked ? (
          <div className="rcfolder">
            <span className="rcfico"><IconFolder s={16} /></span>
            <div className="rcfbody">
              <b>{picked.name}</b>
              <span title={picked.path}>{picked.path}</span>
              {picked.remoteLabel && <span className="rcfremote" title={`origin remote — ${picked.remoteLabel}`}>⌥ {picked.remoteLabel}</span>}
            </div>
            {picked.isGit && <span className="rcfbranch"><IconBranch s={11} /> {picked.branch}</span>}
            <button className="btn sm" onClick={() => void pick()}>Change</button>
          </div>
        ) : (
          <button className="rcpick" onClick={() => void pick()}><IconFolder s={16} /> Choose a folder on this Mac…</button>
        )
      ) : (
        <>
          <input className="rcurl" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={src === 'github' ? 'https://github.com/owner/repo' : 'https://gitlab.com/group/repo'} />
          <div className="rchint">Your machine's git credentials authenticate — no tokens stored.</div>
        </>
      )}
    </div>
  );
}

export function CreateProjectModal({ onClose, onCreated, origin }: { onClose: () => void; onCreated: (id: string) => void; origin?: { x: number; y: number } | null }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [desc, setDesc] = useState('');
  // a new project always mints its OWN fresh rooms (its own #dev/#general…) — slugs are unique per
  // project, so this never collides with another project's rooms.
  //
  // THREE on by default (2026-08-09): #marketing joins general+build, because the marketing HQ now
  // opens with a guided setup thread rather than an empty room, so an unused one costs a dismissable
  // item rather than dead space. #research stays OFF by design — of the four it is the least used in
  // this repo's own history, and four rooms per project is a rail nobody reads. Every chip is still a
  // toggle, so "unless the user unselects them" was already true; only the seed changed.
  const [newRooms, setNewRooms] = useState<string[]>(['general', 'build', 'marketing']);
  // detection prefills only fields the user hasn't touched — edits always win, including
  // across re-picks. Flags live in a ref (they never drive rendering); the per-chip touched
  // set does render (it hides a chip's "auto" tag the moment the user takes it over).
  const edited = useRef({ name: false, slug: false, desc: false, rooms: false });
  const [autoRooms, setAutoRooms] = useState<Set<string>>(new Set());
  const [touchedRooms, setTouchedRooms] = useState<Set<string>>(new Set());
  const [detected, setDetected] = useState<null | 'folder' | 'url'>(null);
  const detectSeq = useRef(0); // pick A, re-pick B fast → only B's detection lands
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // slug + description are optional details most creates never touch — they live behind a
  // quiet toggle (slug still previews under the name; description defaults to the name).
  const [moreOpen, setMoreOpen] = useState(false);
  const [repoSpec, setRepoSpec] = useState<RepoSpec | null>(null);
  // project identity — the website + the logo auto-detected from it (or the picked folder).
  // logoCleared latches a deliberate × so no auto-detect quietly re-adds what was removed.
  const [website, setWebsite] = useState('');
  const [logo, setLogoState] = useState<string | null>(null);
  const logoCleared = useRef(false);
  const setLogo = (v: string | null) => { logoCleared.current = v === null; setLogoState(v); };
  const applyDetect = (meta: { name?: string; slug?: string; description?: string; rooms?: string[] }, kind: 'folder' | 'url') => {
    if (meta.name && !edited.current.name) setName(meta.name);
    if (!edited.current.slug) setSlug(meta.slug ?? slugifyName(meta.name ?? ''));
    if (meta.description && !edited.current.desc) setDesc(meta.description);
    if (meta.rooms?.length && !edited.current.rooms) {
      setNewRooms(meta.rooms);
      setAutoRooms(new Set(meta.rooms.filter((r) => r !== 'general' && r !== 'build')));
    }
    setDetected(kind);
  };
  const onRepoChange = useCallback((s: RepoSpec | null) => {
    setRepoSpec(s);
    if (s?.localPath) {
      const seq = ++detectSeq.current;
      void nm?.projectDetect(s.localPath).then((meta) => {
        if (meta && seq === detectSeq.current) applyDetect(meta, 'folder');
      }).catch(() => { /* detection is best-effort — the picked folder still connects */ });
      // logo from the folder's own files — fills only while nothing is set/removed
      void nm?.logoDetect({ path: s.localPath }).then((r) => {
        if (r?.logoUrl && seq === detectSeq.current && !logoCleared.current) setLogoState((cur) => cur ?? r.logoUrl);
      }).catch(() => { /* best-effort */ });
    } else if (s?.url) {
      const m = /(?:github|gitlab)\.com[:/][^/\s]+\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/.exec(s.url.trim());
      if (m?.[1]) applyDetect({ name: m[1], slug: slugifyName(m[1]) }, 'url');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleRoom = (s: string) => {
    edited.current.rooms = true;
    setTouchedRooms((cur) => new Set(cur).add(s));
    setNewRooms((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  };
  // the slug tracks the name until the user edits it — then it's theirs to set
  const onName = (v: string) => { setName(v); edited.current.name = true; if (!edited.current.slug) setSlug(slugifyName(v)); };
  const onSlug = (v: string) => { setSlug(v.toLowerCase().replace(/[^a-z0-9-]/g, '-')); edited.current.slug = true; };
  const finalSlug = slugifyName(slug);
  const valid = name.trim().length > 0 && finalSlug.length > 0;
  const submit = async () => {
    if (!nm || !valid || busy) return;
    setBusy(true); setErr('');
    try {
      // type-URL-and-create without pausing on the field: if no logo landed yet, give
      // detection one short shot (time-boxed — a slow site never holds the create hostage)
      let logoUrl = logo ?? undefined;
      if (!logoUrl && !logoCleared.current && website.trim()) {
        const r = await Promise.race([
          nm.logoDetect({ url: website.trim() }).catch(() => null),
          new Promise<null>((res) => setTimeout(() => res(null), 4000)),
        ]);
        if (r?.logoUrl) logoUrl = r.logoUrl;
      }
      const r = await nm.projectCreate(name.trim(), desc.trim() || name.trim(), finalSlug, newRooms, { website: website.trim() || undefined, logoUrl });
      if (repoSpec) { try { await nm.repoAdd({ ...repoSpec, projectId: r.projectId }); } catch { /* project created; repo link is best-effort */ } }
      onCreated(r.projectId);
      onClose();
    } catch (e) { setErr(cleanErr(e, 'could not create project')); setBusy(false); }
  };
  return (
    <Modal
      title="New project"
      onClose={onClose}
      origin={origin}
      footer={
        <button className="btn primary sm" disabled={!valid || busy} onClick={() => void submit()}>{busy ? 'Creating…' : 'Create project'}</button>
      }
    >
      <div className="fld" style={{ marginTop: 10 }}>
        <label>Start from</label>
        <RepoConnect onChange={onRepoChange} defaultSrc="local" />
        {detected ? (
          <div className="detectnote">
            <IconCheck s={12} />
            {detected === 'folder' ? <>Prefilled from your folder <i>— edit anything below.</i></> : <>Name filled from the repo URL <i>— edit anything below.</i></>}
          </div>
        ) : (
          <div className="fldhint">Picking a folder fills the form in for you — or start blank below.</div>
        )}
      </div>
      <div className="fld">
        <label>Name</label>
        <input autoFocus value={name} onChange={(e) => onName(e.target.value)} placeholder="XYZ mobile app" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
        {!moreOpen && finalSlug && <div className="slugpreview">slug <code>{finalSlug}</code></div>}
      </div>
      <LogoField name={name || slug || 'P'} website={website} setWebsite={setWebsite} logo={logo} setLogo={setLogo} cleared={logoCleared} />
      <div className="fld">
        <label>Channels</label>
        <div className="chipselect">
          {DEFAULT_CHANNELS.map((s) => (
            <button key={s} type="button" className={`chiptoggle${newRooms.includes(s) ? ' on' : ''}`} onClick={() => toggleRoom(s)}>
              #{s}{autoRooms.has(s) && newRooms.includes(s) && !touchedRooms.has(s) && <span className="chiptag">auto</span>}
            </button>
          ))}
        </div>
        <div className="fldhint">Every project gets its own channels — add more anytime.</div>
      </div>
      <button type="button" className={`fldmore${moreOpen ? ' open' : ''}`} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
        <IconChevron s={12} /> Slug &amp; description
      </button>
      {moreOpen && (
        <>
          <div className="fld">
            <label>Slug — permanent identifier</label>
            <input value={slug} onChange={(e) => onSlug(e.target.value)} placeholder="xyz-mobile-app" onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          </div>
          <div className="fld">
            <label>Description</label>
            <input value={desc} onChange={(e) => { setDesc(e.target.value); edited.current.desc = true; }} placeholder={name.trim() ? `Defaults to “${name.trim()}”` : 'What this initiative delivers'} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          </div>
        </>
      )}
      {err && <div className="acterr" style={{ marginTop: 8 }}>{err}</div>}
    </Modal>
  );
}
