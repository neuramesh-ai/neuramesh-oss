// THE RELEASE CARD (docs/design/release-drafts-2026-09 §4.4) — the ‹brief:id› marker worn as the
// release brief: kicker · tag · date · verdict chip · the feature title · the why · Audience /
// Assets / Not known rows · Open brief / Save to Files. The ReportCard idiom, self-contained
// (it reads its own artifact row), so both thread renderers show one truth. A #385 in the why
// names a PULL REQUEST, never a task, so it stays plain text: no ref, no link.
import { releaseBriefFrom, whyBelowTitle as whyBelow, type ReleaseBrief } from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useMemo, useState } from 'react';
import type { ArticleRow } from './ArticleCard';
import type { ReportOpen } from './ReportCard';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export function useRelease(id: string): { row: ArticleRow | null; brief: ReleaseBrief | null; gone: boolean; refresh: () => void } {
  const [row, setRow] = useState<ArticleRow | null>(null);
  const [gone, setGone] = useState(false);
  const refresh = () => {
    void nm?.artifact(id).then(
      (r) => { setRow(r.artifact); setGone(!r.artifact); },
      () => setGone(true),
    );
  };
  // one read per card — the row is synced content, and a re-read rides user action (refresh)
  useEffect(() => { refresh(); }, [id]);
  const brief = useMemo(() => (row?.inline_content ? releaseBriefFrom(row.name, row.inline_content) : null), [row?.name, row?.inline_content]);
  return { row, brief, gone, refresh };
}

/** a section as one line of plain text: the emphasis marks and line breaks belong to the document, not the card */
const plain = (s: string): string => s.replace(/\*\*?|`/g, '').replace(/\s*\n+\s*/g, ' ').trim();

/** the why without the sentence the title already says (the shared rule), flattened for the card */
export function whyBelowTitle(b: Pick<ReleaseBrief, 'title' | 'why'>): string {
  return plain(whyBelow(b));
}

export function ReleaseCard({ id, onOpen }: { id: string; onOpen?: (r: ReportOpen) => void }) {
  const { row, brief, gone, refresh } = useRelease(id);
  const [busy, setBusy] = useState(false);
  if (gone) return <div className="relcard relgone">this brief is no longer here</div>;
  if (!row || !brief) return <div className="relcard relgone">loading brief…</div>;
  const saved = (row.promoted ?? 0) > 0;
  const why = whyBelowTitle(brief);
  const shelve = async () => {
    setBusy(true);
    try { await nm?.promoteArtifact(row.id); refresh(); } finally { setBusy(false); }
  };
  return (
    <div className="relcard">
      <div className="relhd">
        <span className="k">Release brief</span>
        <span className="reltag">{brief.tag}</span>
        <span className="reldate">{new Date(row.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span className={`chip rv-${brief.verdict}`}>{brief.verdict}</span>
      </div>
      <div className="relbody">
        <div className="reltitle">{brief.title}</div>
        {why && <div className="relwhy">{why}</div>}
        <div className="relrows">
          {brief.audience && <div className="relrow"><span className="k">Audience</span><span className="v">{plain(brief.audience)}</span></div>}
          {brief.assets && <div className="relrow"><span className="k">Assets</span><span className="v">{plain(brief.assets)}</span></div>}
          {/* the honesty row is never hidden — the gaps section is what makes a document a brief at all */}
          <div className="relrow"><span className="k">Not known</span><span className="v gap">{plain(brief.gaps) || 'None.'}</span></div>
        </div>
      </div>
      <div className="relfoot">
        <button className="btn sm" disabled={!row.inline_content}
          onClick={() => row.inline_content && onOpen?.({ label: 'Release brief', file: row.name, doc: row.inline_content })}>
          Open brief ↗
        </button>
        {/* Save = INTO the project's Workspace Files (the ★ shelf), the ArticleCard rule */}
        {saved
          ? <span className="chip artsaved">★ in Files</span>
          : <button className="btn ghost sm" disabled={busy} onClick={() => void shelve()}>Save to Files</button>}
        <span className="sp" />
        <span className="mono" title={row.name}>{row.name}</span>
      </div>
    </div>
  );
}
