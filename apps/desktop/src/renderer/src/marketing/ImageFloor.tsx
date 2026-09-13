// The image floor (docs/design/calendar-image-gen-2026-08), split from PostPreviewModal at
// the size gate: purely presentational — the modal owns the state and the IPC.

/** The image floor (calendar-image-gen round): dashed invitation → shimmer + ticker → landed
 *  picture with quiet second thoughts (Regenerate · New angle). Drafts only; the failure strip
 *  wears the card's amber image_error idiom. Purely presentational — the modal owns the state. */
export function ImageFloor({ thumb, canGen, gen, err, pending = '', angleOpen, angle, onAngle, onAngleOpen, onGen, onRewrite }: {
  thumb: string; canGen: boolean; gen: null | 'image' | 'rewrite'; err: string;
  /** a tab asked its cloud machine to draw; the picture lands on the row by sync (webnm-content.ts) */
  pending?: string;
  angleOpen: boolean; angle: string; onAngle: (v: string) => void; onAngleOpen: (v: boolean) => void;
  onGen: () => void; onRewrite: () => void;
}) {
  if (gen || pending) {
    return (
      <div>
        <div className="mkgenwork" aria-label="generating image" />
        <div className="mkgenticker"><span className="dot" />{pending || (gen === 'rewrite' ? 'rex is redrafting — new body, new image' : 'rex is drawing — it writes the brief first if the draft has none')}</div>
      </div>
    );
  }
  if (thumb) {
    return (
      <div>
        <img className="mkpcimg" src={thumb} alt="generated post image" />
        {canGen && (angleOpen ? (
          <div className="mkgenangle">
            <input value={angle} onChange={(e) => onAngle(e.target.value)} autoFocus spellCheck={false}
              placeholder='different angle? plain words — optional' aria-label="Rewrite angle"
              onKeyDown={(e) => { if (e.key === 'Enter') onRewrite(); if (e.key === 'Escape') onAngleOpen(false); }} />
            <button type="button" className="btn sm" onClick={onRewrite}>Rewrite post</button>
            <button type="button" className="btn ghost sm" onClick={() => onAngleOpen(false)} aria-label="Cancel">✕</button>
          </div>
        ) : (
          <div className="mkgenrow">
            <button type="button" className="btn ghost sm" onClick={onGen}>↻ Regenerate</button>
            <button type="button" className="btn ghost sm" onClick={() => onAngleOpen(true)}>✎ New angle</button>
          </div>
        ))}
        {err && <div className="mkgenerr"><b>Image</b><span>{err}</span></div>}
      </div>
    );
  }
  if (!canGen) return null;
  return (
    <div>
      {err
        ? <div className="mkgenerr"><b>No image</b><span>{err}</span><button type="button" className="btn ghost sm" onClick={onGen}>Try again</button></div>
        : (
          <div className="mkgenslot">
            <div>
              <button type="button" className="mkgenbtn" onClick={onGen}><span aria-hidden>✦</span> Generate image</button>
              <div className="mkgenhint">rex writes the brief from the post, then draws it here</div>
            </div>
          </div>
        )}
    </div>
  );
}
