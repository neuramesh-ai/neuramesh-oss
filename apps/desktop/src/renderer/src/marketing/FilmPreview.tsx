// The film on a post (the video rung, 2026-09-19), split from the card and the preview modal at
// the size gate: the hook that reads the clip's bytes, and the preview block the modal shows where
// a picture would stand. The card keeps its own markup for the film (the pending row, the facts).
import { useEffect, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';

/** The film on a card: the media row's bytes, read once with the session (the film is too big for the synced row). */
export function useFilm(videoId: string | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setSrc(null);
    if (videoId) void nmBridge?.contentMedia(videoId).then((d) => { if (live) setSrc(d); }).catch(() => {});
    return () => { live = false; };
  }, [videoId]);
  return src;
}

/** the script folded to its first beats (the text is the toggle, as on the card) and the film, or
 *  the honest empty: a film in flight, or none yet, which the card's Generate video makes */
export function FilmPreview({ script, film, hasFilm, pending }: { script: string | null; film: string | null; hasFilm: boolean; pending: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {script && (
        <div className={`mkscript mkscriptunder${open ? ' open' : ''}`} role="button" tabIndex={0} title={open ? 'Fold the script' : 'Show the whole script'}
          onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}>
          <div className="mkpvtext ro mkscripttext">{script}</div>
          <span className="mkscriptmore">{open ? 'fold the script ‹' : 'the script ›'}</span>
        </div>
      )}
      {hasFilm && !pending
        ? (film ? <video className="mkpcfilm mkpvfilm" src={film} controls playsInline preload="metadata" /> : <div className="mkpcimgwait" aria-live="polite">loading the film…</div>)
        : <div className="mkpvmedia mkpvfilmnone" aria-hidden>▷<span>{pending ? 'Filming the hook…' : 'No film yet. Generate video on the card.'}</span></div>}
    </>
  );
}
