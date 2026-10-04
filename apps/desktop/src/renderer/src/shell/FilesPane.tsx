// THE FILES TAB (the side-panel round, 2026-10-03) — a task's worktree as one of the session's own
// tabs. It was the Workbench card's Files drawer (rail-ink round 3), shut by default under the
// details; the card retired, and the drawer became a whole pane: the finder (⌘P focuses it), the
// branch switch, the tree. Still a doorway, never a viewer: a click opens a file TAB beside it.
import { FsNode, wtabRel, type WScope } from '../wtabs/filetree';
import { IconBranch } from '../ui/icons';
import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export function FilesPane({ root, scope, activePath, dirtyPaths, findSeq, onOpenFile }: {
  /** the worktree this session browses */
  root: string;
  scope: WScope;
  activePath: string | null; dirtyPaths: Set<string>;
  /** bumped by ⌘P and the ＋ menu's "Open a file": focus the finder */
  findSeq: number;
  onOpenFile: (root: string, rel: string) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<string[] | null>(null);
  const find = useRef<HTMLInputElement>(null);
  // ── the branch switcher (docs/36 §4.2) — it takes over the pane's LIST rather than opening a
  // dropdown, so the pane keeps one surface and one scroller
  const [bopen, setBopen] = useState(false);
  const [git, setGit] = useState<{ current: string | null; branches: string[] } | null>(null);
  const [berr, setBerr] = useState('');
  const [busy, setBusy] = useState('');
  const readBranches = () => { void nm?.gitBranches(root).then(setGit).catch(() => setGit(null)); };
  // FsNode caches each directory's children, so after a checkout the tree would keep listing the
  // branch we just left. The seq is the remount key.
  const [fsSeq, setFsSeq] = useState(0);
  useEffect(() => {
    const onFs = () => { setFsSeq((n) => n + 1); readBranches(); };
    window.addEventListener('nm:fs-changed', onFs);
    return () => window.removeEventListener('nm:fs-changed', onFs);
  }, [root]);
  // a new worktree is a new tree: an open list of the previous session is a stale list
  useEffect(() => { setBopen(false); setBerr(''); setQ(''); readBranches(); }, [root]);
  const checkout = async (b: string) => {
    if (b === git?.current) { setBopen(false); return; }
    setBusy(b); setBerr('');
    const r = await nm?.gitCheckout(root, b);
    setBusy('');
    if (!r?.ok) { setBerr(r?.error ?? 'The checkout failed.'); return; }
    setBopen(false); setQ(''); readBranches();
    // the tree and every open file now show the OLD branch's bytes
    window.dispatchEvent(new CustomEvent('nm:fs-changed', { detail: { root } }));
  };
  useEffect(() => { if (findSeq) requestAnimationFrame(() => find.current?.focus()); }, [findSeq]);
  // Typing turns the tree into a finder: a bounded walk over the SAME `nm:fs-list` the tree uses,
  // so ⌘P costs no new IPC and no second tree implementation (docs/36 §2.4).
  useEffect(() => {
    if (!q.trim() || bopen) { setHits(null); return; }
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
  }, [root, q, bopen]);
  const branches = git?.branches.filter((b) => b.toLowerCase().includes(q.trim().toLowerCase())) ?? [];
  return (
    <div className="filespane" aria-label="Files">
      <div className="fpbar">
        <div className="wbfind">
          <input ref={find} value={q} placeholder={bopen ? 'Filter branches' : 'Find files · ⌘P'} spellCheck={false} aria-label={bopen ? 'Filter branches' : 'Find files'}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); if (bopen) { setBopen(false); setQ(''); } else if (q) setQ(''); } }} />
        </div>
        {/* the branch chip is a control: it opens the pane ON the branch list */}
        {git?.current ? (
          <button className={`wbbr${bopen ? ' on' : ''}`} onClick={() => { setBopen((o) => !o); setBerr(''); setQ(''); readBranches(); }}
            title={`On ${git.current}. Switch the branch.`} aria-expanded={bopen}>
            <IconBranch s={10} /><span className="wbbrn">{git.current}</span><span className="wbbrc">▾</span>
          </button>
        ) : (
          <span className="wbfilesn" title={root}>{scope.label}</span>
        )}
      </div>
      <div className="wblist">
        {bopen && berr && <div className="wbempty">{berr}</div>}
        {bopen && branches.map((b) => (
          <button key={b} className={`wbrow${b === git?.current ? ' on' : ''}`} onClick={() => void checkout(b)} title={b} disabled={!!busy}>
            <span className="wbbrdot" data-on={b === git?.current ? '1' : '0'} />
            <span className="wbn">{b}</span>
            {busy === b && <span className="wbkind">Please wait…</span>}
          </button>
        ))}
        {bopen && git && !branches.length && <div className="wbempty">No branch matches “{q}”.</div>}
        {!bopen && hits === null && (
          <FsNode key={`${root}:${fsSeq}`} root={root} rel="" name={scope.label} dir depth={0} openPath={wtabRel(root, activePath)} onOpen={(rel) => onOpenFile(root, rel)} />
        )}
        {!bopen && hits !== null && !hits.length && <div className="wbempty">No file matches “{q}”.</div>}
        {!bopen && hits?.map((p) => (
          <button key={p} className={`wbrow${wtabRel(root, activePath) === p ? ' on' : ''}`} onClick={() => onOpenFile(root, p)} title={p}>
            <span className="wbn">{p}</span>
            {dirtyPaths.has(`${root}/${p}`) && <span className="wbkind" style={{ color: 'var(--link)' }}>M</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
