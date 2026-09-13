// THE READING TAB (docs/design/article-deliverables-2026-08) — Open article lands here: the
// artifact-tab seam grown up for long-form. Reading measure, the serif ramp, a Sources section
// that arrives styled because the markdown carries it, and every embedded image wearing a quiet
// ⤓ Save chip. Its own react-markdown pass (not md/Md): Md is the TRANSCRIPT renderer and card
// dispatcher; an article needs image figures with save affordances and none of the card powers.
import Markdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { nm as nmBridge } from '../bridge/nm';
import { useArticle } from '../thread/ArticleCard';
import { useMemo, useRef, useState } from 'react';
import type { Components } from 'react-markdown';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/** data-URL → saveFileAs payload: the bytes are already local, so Save never re-fetches */
const saveDataImage = async (src: string, suggested: string): Promise<void> => {
  const m = /^data:(image\/([a-z0-9.+-]+));base64,(.+)$/i.exec(src);
  if (!m) return;
  const ext = (m[2] === 'jpeg' ? 'jpg' : m[2]!).split('+')[0]!;
  const name = `${suggested.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'image'}.${ext}`;
  await nm?.saveFileAs({ name, content: m[3]!, base64: true });
};

/** an embedded image as a figure with the ⤓ chip — remote srcs are CSP-blocked, so a
 *  non-drawable image degrades to its alt text rather than a broken frame */
function Fig({ src, alt }: { src?: string; alt?: string }) {
  const drawable = !!src && (src.startsWith('data:image/') || src.startsWith('nm:'));
  if (!drawable) return alt ? <span className="readimgalt">[{alt}]</span> : null;
  const canSave = src!.startsWith('data:image/');
  return (
    <span className="readfig">
      <img src={src} alt={alt ?? ''} draggable={false} />
      {canSave && (
        <button className="imgsave" title="Save this image to disk"
          onClick={() => void saveDataImage(src!, alt || 'article-image')}>⤓ Save image</button>
      )}
    </span>
  );
}

/** the OS-browser export: the ALREADY-RENDERED article DOM, styles inlined — exactly what the
 *  tab shows, images riding as data URLs, honest offline */
const exportHtml = (title: string, bodyHtml: string): string => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title.replace(/</g, '&lt;')}</title><style>
body{max-width:64ch;margin:40px auto;padding:0 20px;font:15px/1.72 -apple-system,'Segoe UI',sans-serif;color:#2a2a2a;background:#fdfcfa}
h1{font:680 30px/1.22 Georgia,'Times New Roman',serif;color:#171310}
h2,h3{font-family:Georgia,serif;color:#171310;margin:1.4em 0 .5em}
img{max-width:100%;border-radius:10px}
a{color:#9c5730} .imgsave{display:none} .readfig{display:block;margin:18px 0}
blockquote{border-left:3px solid #ddd;margin:0;padding:2px 16px;color:#555}
code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;background:#f0ede8;border-radius:4px;padding:1px 5px}
</style></head><body>${bodyHtml}</body></html>`;

export function ArticleView({ artifactId, name, content }: { artifactId: string; name: string; content: string }) {
  const { row, meta, refresh } = useArticle(artifactId);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const components = useMemo<Components>(() => ({
    img: (p) => <Fig src={typeof p.src === 'string' ? p.src : undefined} alt={p.alt} />,
    // external links leave through the OS browser — the reading tab never navigates itself away
    a: (p) => <a {...p} onClick={(e) => { e.preventDefault(); if (typeof p.href === 'string' && /^https?:/.test(p.href)) void nm?.openExternal(p.href); }} />,
  }), []);
  const saved = (row?.promoted ?? 0) > 0;
  const act = async (key: string, run: () => Promise<unknown>) => {
    setBusy(key);
    try { await run(); } finally { setBusy(null); }
  };
  return (
    <div className="readwrap">
      <div className="readbar">
        <span className="k">Article{row?.channel_slug ? ` · #${row.channel_slug}` : ''}</span>
        <span className="actions">
          {/* Save = the project's Workspace Files (the ★ shelf); Download is the local-disk exit */}
          {saved
            ? <span className="chip artsaved">★ in Files</span>
            : <button className="btn primary sm" disabled={busy === 'shelf'} onClick={() => void act('shelf', async () => { await nm?.promoteArtifact(artifactId); refresh(); })}>Save to Files</button>}
          <button className="btn sm" disabled={busy === 'dl'} onClick={() => void act('dl', async () => nm?.saveFileAs({ name, content }))}>⤓ Download</button>
          <button className="btn sm" disabled={busy === 'ext'} onClick={() => void act('ext', async () => {
            const html = bodyRef.current?.innerHTML ?? '';
            if (html) await nm?.articleExternal(name, exportHtml(meta?.title ?? name, html));
          })}>Open in browser</button>
        </span>
      </div>
      <div className="read" ref={bodyRef}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) => (url.startsWith('data:image/') || url.startsWith('nm:') ? url : defaultUrlTransform(url))}
          components={components}
        >{content}</Markdown>
      </div>
    </div>
  );
}
