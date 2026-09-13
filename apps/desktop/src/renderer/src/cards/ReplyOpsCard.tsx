// The reply-ops card (docs/design/reply-radar-2026-08) — conversations worth joining, target
// first and draft second, on one row.
//
// It replaces replies rendering in SocialPostCard, the STANDALONE-post preview: that card wears
// network chrome, offers "Review · schedule" (which would schedule the reply as its own post),
// and shows nothing of the post being answered — so the targets lived in a separate prose list
// and the reader joined two surfaces by letter (George, 2026-08-22).
//
// v1 publishes nothing, and the verbs say so: you open the post, copy the reply and post it
// yourself. Same self-contained shape as NextStepsCard — the block carries its own channel, and
// nothing here writes anything except through the human's click.
import { REPLIES_PAGE, REPLY_LIMITS, type NmReply, type ReplyItem } from '@neuramesh/shared';
import { useEffect, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';

const nm = nmBridge;

/** each network's mark — the glyphs the Connections rows already use, so one language */
const GLYPH: Record<string, string> = { x: '𝕏', linkedin: 'in', instagram: '◫', tiktok: '♪' };

function Metrics({ t }: { t: ReplyItem['target'] }) {
  if (t.source === 'web' || !t.metrics) {
    // an honest absence, not a blank: only a connector read measures reach
    return <span className="rpmetrics"><i className="rpweb">found on the public web · reach not measured</i></span>;
  }
  const m = t.metrics;
  return (
    <span className="rpmetrics">
      {m.impressions != null && <span><b>{m.impressions.toLocaleString()}</b> impressions</span>}
      {m.likes != null && <span>{m.likes.toLocaleString()} likes</span>}
      {m.reposts != null && <span>{m.reposts.toLocaleString()} reposts</span>}
      {m.replies != null && <span>{m.replies.toLocaleString()} replies</span>}
    </span>
  );
}

/** the drawn picture: shown small, saved as a real file — the human attaches it themselves */
function ReplyImage({ id, brief, onAsk, letter }: { id: string; brief?: string; onAsk?: (t: string) => void; letter: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [name, setName] = useState('reply-image.png');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void nm?.artifact(id).then((r) => {
      if (r.artifact?.inline_content) { setSrc(r.artifact.inline_content); setName(r.artifact.name || 'reply-image.png'); }
    }).catch(() => {});
  }, [id]);
  if (!src) return null;
  const save = async () => {
    const b64 = src.split(',')[1] ?? '';
    const r = await nm?.saveFileAs({ name, content: b64, base64: true }).catch(() => null);
    if (r?.saved) { setSaved(true); setTimeout(() => setSaved(false), 2400); }
  };
  return (
    <div className="rpimg">
      <span className="rpthumb">
        <img src={src} alt="" draggable={false} />
        {/* the control CHANGES FORM once a picture exists — the wantsImage lesson, never vanishes */}
        <button className="redraw" title="Redraw this picture" aria-label="Redraw this picture"
          onClick={() => onAsk?.(`Redraft reply ${letter} with a new image: `)}>↻</button>
      </span>
      <span className="rpimgmeta">
        {brief ? <span className="rpbrief">{brief}</span> : null}
        <button className="nbtn" onClick={() => void save()}>{saved ? '✓ saved' : '⤓ Download image'}</button>
      </span>
    </div>
  );
}

export function ReplyOpsCard({ data, onAsk }: { data: NmReply; onAsk?: (text: string) => void }) {
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // "replied" is THIS reader's progress through the list, not a synced fact — the card says so
  // by keeping it local (the askedLocal idiom); the report keeps the targets either way
  const [done, setDone] = useState<Record<string, boolean>>({});
  const pages = Math.max(1, Math.ceil(data.items.length / REPLIES_PAGE));
  const rows = data.items.slice(page * REPLIES_PAGE, (page + 1) * REPLIES_PAGE);
  const copy = (it: ReplyItem) => {
    void navigator.clipboard?.writeText(it.draft).then(() => {
      setCopied(it.letter);
      setTimeout(() => setCopied((c) => (c === it.letter ? null : c)), 2400);
    }).catch(() => {});
  };
  return (
    <div className="replycard">
      <div className="rphead">Reply opportunities — ranked by fit</div>
      <div className="rpsrc">
        {data.report ? <>from <code>{data.report}</code> · </> : null}{data.items.length} target{data.items.length === 1 ? '' : 's'}
      </div>
      {data.baseline ? <div className="rpbase">{data.baseline}</div> : null}
      {rows.map((it) => {
        const t = it.target;
        const limit = REPLY_LIMITS[t.platform] ?? 280;
        if (done[it.letter]) {
          return (
            <div key={it.letter} className="rprow done">
              <div className="rpdonehead">
                <span className="rank">{it.letter}</span>
                <a className="rphandle" href={t.url} target="_blank" rel="noreferrer">@{t.handle}</a>
                <span className="rpname">replied</span>
                <button className="nbtn q" onClick={() => setDone((d) => ({ ...d, [it.letter]: false }))}>undo</button>
              </div>
            </div>
          );
        }
        return (
          <div key={it.letter} className="rprow">
            <div className="rptop">
              <span className="rank">{it.letter}</span>
              <span className={`rpnet ${t.platform}`} title={t.platform} aria-hidden>{GLYPH[t.platform] ?? '•'}</span>
              <a className="rphandle" href={t.url} target="_blank" rel="noreferrer">@{t.handle}</a>
              {t.name ? <span className="rpname">{t.name}</span> : null}
              {t.age ? <span className="rpage">{t.age}</span> : null}
            </div>
            <Metrics t={t} />
            {/* the target post — three lines at rest, the whole thing on click */}
            <div className={`rptarget${open === it.letter ? ' open' : ''}`} role="button" tabIndex={0}
              onClick={() => setOpen((o) => (o === it.letter ? null : it.letter))}
              onKeyDown={(e) => { if (e.key === 'Enter') setOpen((o) => (o === it.letter ? null : it.letter)); }}>
              {t.text}
            </div>
            <div className="rpdraft"><span className="arrow" aria-hidden>↳</span><span>{it.draft}</span></div>
            {it.why ? <div className="rpwhy">{it.why}</div> : null}
            {it.imageArtifactId
              ? <ReplyImage id={it.imageArtifactId} brief={it.imageBrief} letter={it.letter} onAsk={onAsk} />
              : null}
            <div className="rpacts">
              <span className={`rpchars${it.draft.length > limit ? ' over' : ''}`}>{it.draft.length}/{limit}</span>
              <a className="nbtn" href={t.url} target="_blank" rel="noreferrer">Open post ↗</a>
              <button className="nbtn" onClick={() => copy(it)}>{copied === it.letter ? '✓ copied' : 'Copy reply'}</button>
              <button className="nbtn q" disabled={!onAsk} onClick={() => onAsk?.(`Redraft reply ${it.letter}: `)}>Redraft ›</button>
              {!it.imageArtifactId && (
                <button className="nbtn q" disabled={!onAsk} onClick={() => onAsk?.(`Redraft reply ${it.letter} with an image: `)}>+ Image ›</button>
              )}
              <button className="nbtn q" onClick={() => setDone((d) => ({ ...d, [it.letter]: true }))}>✓ replied</button>
            </div>
          </div>
        );
      })}
      {pages > 1 && (
        <div className="npager">
          <button className="nbtn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹</button>
          <span>{page * REPLIES_PAGE + 1}–{Math.min((page + 1) * REPLIES_PAGE, data.items.length)} of {data.items.length}</span>
          <button className="nbtn" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>›</button>
        </div>
      )}
    </div>
  );
}
