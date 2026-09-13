// Capacity failover: the card, and the fly-up that follows the human to the frontmost
// composer. The fly-up wraps its own card in a FALSE banner context — with the true one
// it would suppress itself to an empty pointer.
import { useContext, useEffect, useMemo, useState } from 'react';
import { PACKS, PACK_PREVIEW_ROLES, resolvePackRoles, type FailoverCardData, type Provider } from '@neuramesh/shared';
import { IconBrain, IconClose } from '../ui/icons';
import { FailoverBannerContext } from '../context/FailoverBanner';
import { modelLabel, providerIdForModel } from '../lib/models';
import { foResetLabel, type NmQuestion } from './parse';

export function FailoverCard({ q, answers, onAnswer }: { q: NmQuestion; answers?: Map<string, string>; onAnswer?: (text: string) => void }) {
  const data = q.failover as FailoverCardData;
  const rec = data.recommendation;
  const [other, setOther] = useState('');
  const [sent, setSent] = useState(false);
  const answered = answers?.get(q.question);
  const bannerActive = useContext(FailoverBannerContext);

  // the fly-up owns an unanswered card — leave a pointer, not a duplicate
  if (!sent && !answered && bannerActive) {
    return <div className="fomini" role="note"><IconBrain s={12} /> Capacity switch pinned above the composer — respond there ↑</div>;
  }

  if (sent || answered) {
    return (
      <div className="focard sent">
        <span className="fotick">✓</span>
        <span className="foq">{q.question}</span>
        <span className="foa">{answered ?? '…'}</span>
      </div>
    );
  }

  // the house brain is 'neuramesh' and must not fall through to Google's letter (it did, because
  // the ternary's else was 'G'). a badge naming the wrong vendor on a failover card is worse than
  // no badge — this is the card a human reads to see which brain took over.
  const LETTER: Record<string, string> = { anthropic: 'A', openai: 'O', gemini: 'G', neuramesh: 'N' };
  const mk = (m: string) => { const p = providerIdForModel(m); return <span className={`fomk ${p}`} aria-hidden>{LETTER[p] ?? '·'}</span>; };
  const rows: Array<{ role: string; from?: string; to: string }> =
    rec.kind === 'fall_forward'
      ? rec.roles.map((role) => ({ role, from: rec.from, to: rec.to }))
      : rec.kind === 'switch_pack'
        ? (Object.entries(resolvePackRoles(rec.packId, []) ?? {}) as Array<[string, string]>)
            .filter(([role]) => (PACK_PREVIEW_ROLES as readonly string[]).includes(role))
            .map(([role, to]) => ({ role, to }))
        : [];
  const reset = foResetLabel(data.resetAtIso);
  const providers: Array<[Provider, string]> = [['anthropic', 'Claude'], ['openai', 'ChatGPT'], ['gemini', 'Gemini']];

  const confirm = (label: string) => {
    if (!onAnswer || !label.trim()) return;
    setSent(true);
    onAnswer(`**${q.question}** → ${label.trim()}`); // v1 scope is workspace-only; the label IS the choice
  };
  const opts = q.options ?? [];

  return (
    <div className="focard">
      <div className="fohead">
        <span className="fotitle">{q.question}</span>
        <span className={`fochip ${rec.kind === 'no_fallback' ? 'hold' : 'exh'}`}><span className="fodot" />{rec.kind === 'no_fallback' ? 'Nothing live' : 'Exhausted'}</span>
      </div>

      {rec.kind !== 'no_fallback' && rows.length > 0 && (
        <div className="forec">
          <div className="forechd">{rec.kind === 'fall_forward' ? 'Re-seat these roles' : `Switch to ${PACKS[rec.packId]?.name ?? rec.packId}`}<span className="forecbadge">{rec.kind === 'fall_forward' ? 'SAME PROVIDER' : `${providers.find(([p]) => p === rec.provider)?.[1] ?? rec.provider} LIVE`}</span></div>
          <div className="foseat">
            {rows.map((r) => (
              <div className="forow" key={r.role}>
                <span className="rolechip" data-role={r.role}>{r.role}</span>
                <span className="fomods">
                  {r.from && <><span className="fomod was">{mk(r.from)}{modelLabel(r.from)}</span><span className="foarr">→</span></>}
                  <span className="fomod now">{mk(r.to)}<b>{modelLabel(r.to)}</b></span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {rec.kind !== 'fall_forward' && (
        <div className="foavail">
          <div className="foavailhd">Live logins on this machine</div>
          {providers.map(([p, label]) => {
            const live = data.avail?.[p]?.authed;
            return (
              <div className="foprov" key={p}>
                <span className="foprovname"><span className={`fomk ${p}`} aria-hidden>{p === 'anthropic' ? 'A' : p === 'openai' ? 'O' : 'G'}</span>{label}</span>
                <span className={`foprovstat ${live ? 'live' : 'off'}`}><span className="fopdot" />{live ? 'Active' : 'Not connected'}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="fometa">
        {reset && <span>◷ resets {reset}</span>}
        <span>⛁ applies to the whole workspace</span>
      </div>

      {rec.kind !== 'no_fallback' && (
        <div className="fonote">Applies until you switch back to <b>{PACKS[data.currentPack]?.name ?? data.currentPack}</b> in Settings.</div>
      )}

      <div className="foactions">
        {opts.map((o, i) => (
          <button key={o.label} type="button" className={`btn block${i === 0 ? ' primary' : ''} sm`} onClick={() => confirm(o.label)}>
            {o.label}{o.description ? <span className="fobtnsub">{o.description}</span> : null}
          </button>
        ))}
      </div>
      {q.allowOther !== false && (
        <div className="focustom">
          <input value={other} onChange={(e) => setOther(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && confirm(other)} placeholder="…or tell Rex what to do instead" />
          <button type="button" className="btn sm" disabled={!other.trim()} onClick={() => confirm(other)}>Send</button>
        </div>
      )}
      <div className="fohuman">Only you can answer this — Rex won’t change what you pay for on its own.</div>
    </div>
  );
}

// The sticky capacity-failover fly-up (docs/22): a cap re-seats agents workspace-wide, so
// the human must be able to answer it wherever they are — the card was landing in the
// channel feed while they were in a task thread. This docks the ONE open failover above
// whatever composer is frontmost (channel, conversation sheet, task thread, Home). The
// answer posts to the CHANNEL the card lives in (task_id null) so the daemon's feed watch
// executes it, regardless of the surface the human answered from.
export function FailoverFlyup({ row, onAnswer, onOpenChannel, onDismiss }: {
  row: { decision_id: string; channel_id: string; channel_slug: string; body: string };
  onAnswer: (channelId: string, text: string) => void;
  onOpenChannel: (channelId: string) => void;
  onDismiss: () => void;
}) {
  const q = useMemo(() => {
    const m = /```nmq\s*\n([\s\S]*?)```/.exec(row.body);
    if (!m) return null;
    try { const parsed = JSON.parse(m[1]!) as NmQuestion; return parsed.failover ? parsed : null; } catch { return null; }
  }, [row.body]);
  // it docks FLAT on top of whatever composer is frontmost — matching its width and
  // position, sitting flush on its top edge — so it reads as part of the composer, not a
  // floating popover. The frontmost composer wins: an open thread overlay's, else Home's,
  // else the channel's. Measured on a rAF loop so it tracks overlays opening/closing/sliding.
  const [box, setBox] = useState<{ left: number; width: number; bottom: number } | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = document.querySelector('.threadpanel .tcompose') ?? document.querySelector('.hcomposer') ?? document.querySelector('.composer');
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0) {
        setBox((prev) => (prev && prev.left === Math.round(r.left) && prev.width === Math.round(r.width) && prev.bottom === Math.round(window.innerHeight - r.top)
          ? prev : { left: Math.round(r.left), width: Math.round(r.width), bottom: Math.round(window.innerHeight - r.top) }));
      } else setBox(null);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!q || !box) return null;
  return (
    <div className="foflyup" role="alertdialog" aria-label="Capacity switch" style={{ left: box.left, width: box.width, bottom: box.bottom }}>
      <div className="foflyupcard">
        <div className="foflyuptop">
          <span className="foflyuptag">⚡ Capacity</span>
          <button type="button" className="foflyupchan" onClick={() => onOpenChannel(row.channel_id)} title="open the channel this was raised in">#{row.channel_slug} ↗</button>
          {/* dismiss hides the fly-up without answering — the card stays open in the room
              feed (the record), and any NEW cap re-surfaces it */}
          <button type="button" className="foflyupx" onClick={onDismiss} title="dismiss — it stays in the channel feed; a new cap brings it back"><IconClose s={13} /></button>
        </div>
        {/* the fly-up IS the card here — turn suppression off so it renders in full
            (the inline copies in feeds stay suppressed by the outer provider) */}
        <FailoverBannerContext.Provider value={false}>
          <FailoverCard q={q} onAnswer={(t) => onAnswer(row.channel_id, t)} />
        </FailoverBannerContext.Provider>
      </div>
    </div>
  );
}
