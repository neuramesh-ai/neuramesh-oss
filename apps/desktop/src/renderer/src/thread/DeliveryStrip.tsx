// The delivery strip — whether what you sent actually left this machine.
// Extracted from App.tsx (track A3).
import { IconImage } from '../ui/icons';
import { Md } from '../md/Md';
import { fileTag, fileWeight, isPostsFile, parseDraftedPosts, reportFrom } from '@neuramesh/shared';
import { ReportFileBody } from './ReportCard';

import { previewType } from '../views/docpreview';
import { type ArtifactUI } from '../bridge/rows-board';

/** the body for one file, chosen by previewType — the drawer and this card can never disagree */
export function FileBody({ art }: { art: ArtifactUI }) {
  const c = art.inline_content ?? '';
  const t = previewType(art.name, art.kind, c);
  if (!c) return <div className="filecanvas none fileempty">no inline preview — open to view</div>;
  if (t === 'image') {
    const src = c.startsWith('data:') ? c : `data:image/svg+xml;utf8,${encodeURIComponent(c)}`;
    return <div className="filecanvas none fimgwrap"><img className="fimg" src={src} alt={art.name} /></div>;
  }
  if (t === 'html') {
    // an agent-authored page never gets script, network, or storage in the thread
    return <div className="filecanvas none"><div className="fhtml"><iframe className="fhtmlframe" sandbox="" srcDoc={c} tabIndex={-1} title={art.name} loading="lazy" /></div></div>;
  }
  if (t === 'diff') {
    return <div className="filecanvas"><pre className="fdiff">{c.split('\n').slice(0, 400).map((ln, i) => (
      <span key={i} className={ln.startsWith('+') && !ln.startsWith('+++') ? 'a' : ln.startsWith('-') && !ln.startsWith('---') ? 'd' : ln.startsWith('@@') ? 'h' : ''}>{ln}{'\n'}</span>
    ))}</pre></div>;
  }
  if (t === 'markdown') {
    // a doc that PARSES as a scored report renders as one everywhere at once (thread, Files,
    // mobile) — the articles.ts one-parse rule. Branched HERE, not by widening previewType:
    // the drawer/Review panel keep the exact five types they switch on (the csv ruling below).
    if (reportFrom(art.name, c)) return <div className="filecanvas"><ReportFileBody name={art.name} content={c} /></div>;
    return <div className="filecanvas"><div className="fmd"><Md text={c} /></div></div>;
  }
  // The marketer's wire file renders AS POSTS (live #1048). Same argument as csv below: a JSON
  // array in a 148px window is unreadable, and posts are the whole reason the file exists —
  // that thread showed a slab of `{"platform":"x","body":…}` where the human wanted to read
  // three tweets. It can no longer double up with the draft cards: since the transcript
  // builders merged, the thread drops this artifact when those posts are already carding
  // (see the `isPostsFile` filter there). Here it is the representation everywhere else — the
  // Library, the mobile viewer, a thread whose posts never became content_items.
  if (isPostsFile(art.name)) {
    const posts = parseDraftedPosts(c);
    if (posts.length) {
      return (
        <div className="filecanvas"><div className="fposts">
          {posts.map((p, i) => (
            <div key={i} className="fpost">
              <div className="fposthd">
                <span className="fpostg">{MK_PLATFORM_ICON[p.platform] ?? '•'}</span>
                <span className="fpostnet">{MK_PLATFORMS.find(([k]) => k === p.platform)?.[1] ?? p.platform}</span>
                <span className="fpostn">{i + 1} / {posts.length}</span>
              </div>
              <div className="fposttext">{p.body}</div>
              {p.imageBrief && <div className="fpostbrief"><IconImage s={11} /><span>{p.imageBrief}</span></div>}
            </div>
          ))}
        </div></div>
      );
    }
    // unparseable → fall through to raw, so a malformed file is visibly malformed
  }
  // csv/tsv get a real table rather than raw text — a comma-separated wall in a 148px window is
  // unreadable, and a table is the whole reason the file exists. Handled HERE rather than by
  // widening previewType, so the drawer/Review panel keep the exact five types they switch on.
  if (/\.(csv|tsv)$/i.test(art.name)) {
    const sep = /\.tsv$/i.test(art.name) ? '\t' : ',';
    const rows = c.trim().split('\n').slice(0, 60).map((ln) => ln.split(sep));
    const [head, ...body] = rows;
    return (
      <div className="filecanvas"><div className="fdata"><table>
        <thead><tr>{(head ?? []).map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{body.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
      </table></div></div>
    );
  }
  return <div className="filecanvas"><pre className="fraw">{c.slice(0, 8000)}</pre></div>;
}

export function FileCard({ art, superseded, onOpen }: { art: ArtifactUI; superseded?: boolean; onOpen: () => void }) {
  const weight = fileWeight(art.name, art.kind, art.inline_content);
  return (
    <div className={`filecard${superseded ? ' old' : ''}`}>
      <button type="button" className="filehead" onClick={onOpen} title={`${art.name} — open`}>
        <span className="filekind">{fileTag(art.name, art.kind)}</span>
        <span className="filename">{art.name}</span>
        {superseded ? <span className="oldtag">superseded</span> : <span className="fileopen">Open ↗</span>}
        {weight && <span className="filemeta">{weight}</span>}
      </button>
      {!superseded && <FileBody art={art} />}
    </div>
  );
}

/**
 * One submit's files. A single file gets the full card width; several scroll HORIZONTALLY —
 * the .mkdraftsgrid idiom the marketing drafts already use, so a ten-file delivery is one row
 * you swipe rather than a wall that buries the rest of the thread.
 */
export function DeliveryStrip({ arts, superseded, onOpen }: { arts: ArtifactUI[]; superseded: Set<string>; onOpen: (name: string) => void }) {
  if (!arts.length) return null;
  const many = arts.length > 1;
  return (
    <div className={`delivery${many ? ' many' : ''}`}>
      <div className="deliveryhead">{arts.length === 1 ? 'Delivered' : `Delivered · ${arts.length} files`}</div>
      <div className={many ? 'filerow' : 'filecards'}>
        {arts.map((a) => <FileCard key={a.id} art={a} superseded={superseded.has(a.id)} onOpen={() => onOpen(a.name)} />)}
      </div>
    </div>
  );
}

// The Calendar surface (marketing-channel plan §4.7, mockup scene 05): platform rows ×
// days; a chip is a content item, never a task. Drafts are dashed (no clock yet),
// scheduled are solid with their time, published are green with the receipt. Click →
// preview popover with the human gates (Approve · Unschedule); approve puts it on the
// clock server-side (HUMAN_ONLY), publishing lands with connectors.
export const MK_PLATFORMS: Array<[string, string]> = [['x', 'X'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['tiktok', 'TikTok'], ['email', 'Email']];

export const MK_PLATFORM_ICON: Record<string, string> = { x: '𝕏', instagram: '◫', linkedin: 'in', tiktok: '♪', email: '✉' };
