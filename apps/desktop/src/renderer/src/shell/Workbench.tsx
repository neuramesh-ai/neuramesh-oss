// THE WORKBENCH (2026-08-16; ONE FACE since the rail-ink round 3, 2026-09-04) — the open session's
// own details, as a card inside the thread's sheet (docs/33 §2). Split out of wtabs/filetree.tsx,
// which keeps the tree NODE and the file viewer — the parts this opens.
import { FsNode, wtabRel, type WScope } from '../wtabs/filetree';
import { IconBranch, IconClose } from '../ui/icons';
import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useRef, useState } from 'react';
import { WorkbenchEmpty } from './WorkbenchEmpty';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// It was `WFilePane`, headed "Files", toggled by a `▯`; then the Workbench with Details · Code ·
// Artifacts faces (2026-08-16/17). ONE FACE now (George, on the built card: "just one tab"): the
// session's details — description, requirements, the Definition of Done, artifacts, subtasks, the
// review loop — portalled in by the thread that owns them (shell/workbench-state.ts decides the
// subject). Code mode owns code and the Engineering floor never shows this panel, so a Code face
// had nowhere left to be; what survives of it is the FILES DRAWER under the details, shut by
// default and drawn only when the session has a worktree: the branch switcher, the finder (⌘P and
// the dock's "Open a file…" open it), the tree. No faces, so no segment and no wanted face.
//
// Still a doorway, never a viewer: a click opens a TAB in the side dock under the model's reuse
// rule. It never renders a file inside itself, or we are back to two containers for one job.
export function Workbench({ scope, scopeLabel, files, activePath, dirtyPaths, findSeq, slotRef, onOpenFile, onClose }: {
  scope: WScope; scopeLabel: string;
  /** the worktree the Files drawer browses — a session's, never a room's (workbench-state) */
  files: string | null;
  activePath: string | null; dirtyPaths: Set<string>; findSeq: number;
  /** the details' body: the open task or thread portals its rail sections in here */
  slotRef: (el: HTMLDivElement | null) => void;
  onOpenFile: (root: string, rel: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<string[] | null>(null);
  const find = useRef<HTMLInputElement>(null);
  const drawer = useRef<HTMLElement>(null);
  // the drawer is SHUT until asked — its own header, ⌘P, or the dock's "Open a file…" — and a
  // change of worktree shuts it again: an open tree of the previous session is a stale tree
  const [filesOpen, setFilesOpen] = useState(false);
  const tree = filesOpen && !!files;
  // an opened drawer at the foot of a long details list is otherwise below the fold
  useEffect(() => { if (filesOpen) requestAnimationFrame(() => drawer.current?.scrollIntoView({ block: 'end' })); }, [filesOpen]);
  // ── the branch switcher (docs/36 §4.2) ──
  // It takes over the drawer's LIST rather than opening a dropdown: the card is ~280px wide and
  // clips its own overflow, so a floating menu here would either be cut off or have to portal out
  // of the surface it belongs to. Swapping the body keeps one surface and one scroller.
  const [bopen, setBopen] = useState(false);
  const [git, setGit] = useState<{ current: string | null; branches: string[] } | null>(null);
  const [berr, setBerr] = useState('');
  const [busy, setBusy] = useState('');
  const readBranches = () => { if (files) void nm?.gitBranches(files).then(setGit).catch(() => setGit(null)); };
  // FsNode caches each directory's children, so after a checkout the tree would keep listing the
  // branch we just left. The seq is the remount key — cheaper and more honest than invalidating
  // a cache we do not own.
  const [fsSeq, setFsSeq] = useState(0);
  useEffect(() => {
    const onFs = () => { setFsSeq((n) => n + 1); readBranches(); };
    window.addEventListener('nm:fs-changed', onFs);
    return () => window.removeEventListener('nm:fs-changed', onFs);
  }, [files]);
  // the branch is read for the drawer's header, shut or open: it is the one-line answer to "which
  // code", and it cannot wait for a click (the 2026-08-19 stale-git bug, the other way round)
  useEffect(() => { setFilesOpen(false); setBopen(false); setBerr(''); setQ(''); if (files) readBranches(); else setGit(null); }, [files]);
  const checkout = async (b: string) => {
    if (!files || b === git?.current) { setBopen(false); return; }
    setBusy(b); setBerr('');
    const r = await nm?.gitCheckout(files, b);
    setBusy('');
    if (!r?.ok) { setBerr(r?.error ?? 'checkout failed'); return; }
    setBopen(false); setQ(''); readBranches();
    // the tree and every open file are now showing the OLD branch's bytes
    window.dispatchEvent(new CustomEvent('nm:fs-changed', { detail: { root: files } }));
  };
  useEffect(() => { if (!findSeq) return; setFilesOpen(true); requestAnimationFrame(() => find.current?.focus()); }, [findSeq]);
  // Typing turns the tree into a finder — a bounded walk over the SAME `nm:fs-list` the tree
  // uses, so ⌘P costs no new IPC and no second tree implementation (docs/36 §2.4 was about
  // having too few trees, not too many).
  useEffect(() => {
    const root = files;
    if (!tree || !root || !q.trim() || bopen) { setHits(null); return; }
    let live = true;
    const out: string[] = [];
    const walk = async (rel: string, depth: number): Promise<void> => {
      if (!live || out.length > 300 || depth > 5) return;
      const r = await nm?.fsList(root, rel).catch(() => null);
      for (const e of r?.entries ?? []) {
        if (e.name.startsWith('.git')) continue;
        if (e.name === 'node_modules') continue;
        const p = rel ? `${rel}/${e.name}` : e.name;
        if (e.dir) await walk(p, depth + 1);
        else if (p.toLowerCase().includes(q.trim().toLowerCase())) out.push(p);
      }
    };
    const id = window.setTimeout(() => void walk('', 0).then(() => { if (live) setHits(out.slice(0, 200)); }), 140);
    return () => { live = false; window.clearTimeout(id); };
  }, [tree, files, q, bopen]);
  const branches = git?.branches.filter((b) => b.toLowerCase().includes(q.trim().toLowerCase())) ?? [];
  return (
    <aside className="workbench" aria-label="Workbench">
      <div className="wbhead">
        <b className="wbname">Workbench</b>
        <span className="wbwt" title={scopeLabel}>{scopeLabel}</span>
        <button className="wbx" aria-label="Close the Workbench" onClick={onClose}><IconClose s={11} /></button>
      </div>
      {/* ONE scroller for the whole face: the subject's own sections portal into the slot (TaskThread ·
          ConvoThread · the room home), so this card never owns their state; the empty line under
          it is CSS-gated on the slot being childless, because only the portalling surface knows
          whether it has anything to say. The drawer sits last, under a hairline. */}
      <div className="wbbody">
        <div className="wbslot mkrail" ref={slotRef} />
        <WorkbenchEmpty />
        {files && (
          <section ref={drawer} className={`wbfiles${filesOpen ? ' on' : ''}`} aria-label="Files">
            <div className="wbfileshd">
              <button className="wbfilestg" aria-expanded={filesOpen} onClick={() => { setFilesOpen((o) => !o); setBopen(false); setQ(''); }}>
                <span className="wbfilesc" aria-hidden>{filesOpen ? '▾' : '▸'}</span>Files
              </button>
              {/* the branch chip is a control: it opens the drawer ON the branch list */}
              {git?.current ? (
                <button className={`wbbr${bopen ? ' on' : ''}`} onClick={() => { setFilesOpen(true); setBopen((o) => !o); setBerr(''); setQ(''); readBranches(); }}
                  title={`On ${git.current} — switch branch`} aria-expanded={bopen}>
                  <IconBranch s={10} /><span className="wbbrn">{git.current}</span><span className="wbbrc">▾</span>
                </button>
              ) : (
                <span className="wbfilesn" title={files}>{scope.label}</span>
              )}
            </div>
            {filesOpen && (<>
              <div className="wbfind">
                <input ref={find} value={q} placeholder={bopen ? 'Filter branches…' : 'Find files…'} spellCheck={false}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (bopen) { setBopen(false); setQ(''); } else if (q) setQ(''); else setFilesOpen(false); } }} />
              </div>
              <div className="wblist">
                {bopen && berr && <div className="wbempty">{berr}</div>}
                {bopen && branches.map((b) => (
                  <button key={b} className={`wbrow${b === git?.current ? ' on' : ''}`} onClick={() => void checkout(b)} title={b} disabled={!!busy}>
                    <span className="wbbrdot" data-on={b === git?.current ? '1' : '0'} />
                    <span className="wbn">{b}</span>
                    {busy === b && <span className="wbkind">switching…</span>}
                  </button>
                ))}
                {bopen && git && !branches.length && <div className="wbempty">No branch matching “{q}”.</div>}
                {!bopen && tree && hits === null && (
                  <FsNode key={`${files}:${fsSeq}`} root={files} rel="" name={scope.label} dir depth={0} openPath={wtabRel(files, activePath)} onOpen={(rel) => onOpenFile(files, rel)} />
                )}
                {!bopen && tree && hits !== null && !hits.length && <div className="wbempty">Nothing matching “{q}”.</div>}
                {!bopen && tree && hits?.map((p) => (
                  <button key={p} className={`wbrow${wtabRel(files, activePath) === p ? ' on' : ''}`} onClick={() => onOpenFile(files, p)} title={p}>
                    <span className="wbn">{p}</span>
                    {dirtyPaths.has(`${files}/${p}`) && <span className="wbkind" style={{ color: 'var(--link)' }}>M</span>}
                  </button>
                ))}
              </div>
            </>)}
          </section>
        )}
      </div>
    </aside>
  );
}
