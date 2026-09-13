// THE ARTICLE CARD (docs/design/article-deliverables-2026-08) — the ‹article:id› marker worn
// as a magazine tile: kicker · serif title · dek · hero · facts line · Open/Save. Never the
// full text — the card sells the read, the reading tab IS the read. Self-contained like WbCard
// (it reads its own artifact row), so both thread renderers show one truth.
import { articleFacts, articleFrom, type ArticleMeta } from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useMemo, useState } from 'react';
import type { ChannelArtifactRow } from '../bridge/rows-rooms';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export type ArticleRow = ChannelArtifactRow & { channel_id?: string | null; channel_slug?: string | null };

export interface ArticleOpen {
  id: string;
  name: string;
  content: string;
  channelSlug: string | null;
}

/** hero sources the renderer can actually draw — remote URLs are CSP-blocked, so the card
 *  degrades to a text tile rather than a broken image frame */
export const drawableSrc = (src: string | null): string | null =>
  src && (src.startsWith('data:image/') || src.startsWith('nm:')) ? src : null;

export function useArticle(id: string): { row: ArticleRow | null; meta: ArticleMeta | null; gone: boolean; refresh: () => void } {
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
  const meta = useMemo(() => (row?.inline_content ? articleFrom(row.name, row.inline_content) : null), [row?.name, row?.inline_content]);
  return { row, meta, gone, refresh };
}

export function ArticleCard({ id, onOpen }: { id: string; onOpen?: (a: ArticleOpen) => void }) {
  const { row, meta, gone, refresh } = useArticle(id);
  const [busy, setBusy] = useState(false);
  if (gone) return <div className="artcard artgone">this article is no longer here</div>;
  if (!row || !meta) return <div className="artcard artgone">loading article…</div>;
  const hero = drawableSrc(meta.hero);
  const saved = (row.promoted ?? 0) > 0;
  const shelve = async () => {
    setBusy(true);
    try { await nm?.promoteArtifact(row.id); refresh(); } finally { setBusy(false); }
  };
  return (
    <div className="artcard">
      <div className="artkick">
        <span className="k">Article · research deliverable</span>
        {saved && <span className="chip artsaved">★ in Files</span>}
      </div>
      {hero && (
        <div className="arthero">
          <img src={hero} alt="" draggable={false} />
        </div>
      )}
      <div className="artmain">
        <div className="arttitle">{meta.title}</div>
        {meta.dek && <div className="artdek">{meta.dek}</div>}
        <div className="artfacts">{articleFacts(meta)}</div>
        <div className="artfoot">
          <span className="artby">{row.channel_slug ? `#${row.channel_slug}` : row.name}</span>
          <span className="actions">
            {/* Save = INTO the project's Workspace Files (the ★ shelf), per George 2026-08-19 —
                the local-disk export lives in the reading tab as Download */}
            {!saved && <button className="btn ghost sm" disabled={busy} onClick={() => void shelve()}>Save to Files</button>}
            <button className="btn primary sm" disabled={!row.inline_content}
              onClick={() => row.inline_content && onOpen?.({ id: row.id, name: row.name, content: row.inline_content, channelSlug: row.channel_slug ?? null })}>
              Open article
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
