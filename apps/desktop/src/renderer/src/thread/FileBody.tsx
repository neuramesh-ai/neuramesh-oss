// The body of one produced file, chosen by previewType — the side panel's reader for the kinds its
// file view does not draw (a csv table, the marketer's posts wire file, a scored report), and the
// card body it was in the thread until the side-panel round (2026-10-03). Split out of DeliveryStrip.
import { IconImage } from '../ui/icons';
import { Md } from '../md/Md';
import { isPostsFile, parseDraftedPosts, reportFrom } from '@neuramesh/shared';
import { ReportFileBody } from './ReportCard';
import { MK_PLATFORMS, MK_PLATFORM_ICON } from './DeliveryStrip';
import { previewType } from '../views/docpreview';
import { type ArtifactUI } from '../bridge/rows-board';

/** the kinds the side panel reads through FileBody rather than its plain file view */
export const richFileBody = (name: string, content: string | null | undefined): boolean =>
  /\.(csv|tsv)$/i.test(name) || isPostsFile(name) || (!!content && !!reportFrom(name, content));

/** the body for one file, chosen by previewType — the drawer and this card can never disagree */
export function FileBody({ art }: { art: ArtifactUI }) {
  const c = art.inline_content ?? '';
  const t = previewType(art.name, art.kind, c);
  if (!c) return <div className="filecanvas none fileempty">This file has no preview here.</div>;
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

