// Social post cards (docs/design/thread-posts) — a drafted post, its per-network preview,
// and the approve/schedule controls. Thread-native: the same card renders in a conversation
// and in a task panel from one derivation. Extracted from App.tsx (track A3).
import { MK_PLATFORMS } from '../thread/DeliveryStrip';
import { cleanErr } from '../lib/text';
import { createPortal } from 'react-dom';
import { nm as nmBridge } from '../bridge/nm';
import { openLink } from '../lib/links';
import { type ContentItemRow } from '../bridge/rows-content';
import { WhenPicker, localYmd } from './WhenPicker';
import { ImageFloor } from './ImageFloor';
import { anchorPoint } from '../ui/anchor';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cardParts, type CardMedia } from './cardparts';
import { FilmPreview, useFilm } from './FilmPreview';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// The calendar's post preview (round 13, the Helena shape): a platform-native card in a
// centered overlay — the tweet reads like a tweet, the IG post like a post — with the text
// editable in place while it's a draft/scheduled, the slot picker, and approve/unschedule/
// delete. Agents draft; every mutation here is the human's.
export function PostPreviewModal({ item, channelSlug, channelId, projectName, onClose, onChanged }: {
  item: ContentItemRow;
  channelSlug: string;
  /** the room this draft belongs to — its PROJECT owns the connector that will post it (0106) */
  channelId?: string | null;
  projectName?: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [body, setBody] = useState(item.body);
  // THE FILM IN THE PREVIEW (George, 2026-09-19: "when I click on review/schedule, the preview
  // doesn't show the film"). A video post previews as its card does: the caption, the script
  // beside it, and the film where a picture would stand. Never the image floor: the film is its
  // media, and a video post never offers a picture.
  const cardMedia = useMemo((): CardMedia | null => { try { return JSON.parse(item.media ?? 'null') as CardMedia | null; } catch { return null; } }, [item.media]);
  const { script } = cardParts(item.body, cardMedia);
  const isVideo = !!script;
  const film = useFilm(cardMedia?.video_id);
  const filmBlock = isVideo && <FilmPreview script={script} film={film} hasFilm={!!cardMedia?.video_id} pending={!!cardMedia?.video_pending} />;
  const origMedia = useMemo(() => { try { return ((JSON.parse(item.media ?? 'null') as { image_url?: string } | null)?.image_url) ?? ''; } catch { return ''; } }, [item.media]);
  // the generated image's inline preview (marketing-workflow §4.6) — present on any platform,
  // and what the human is actually approving when no remote URL was pasted
  const genThumb = useMemo(() => { try { return ((JSON.parse(item.media ?? 'null') as { thumb?: string } | null)?.thumb) ?? ''; } catch { return ''; } }, [item.media]);
  const imageErr = useMemo(() => { try { return ((JSON.parse(item.media ?? 'null') as { image_error?: string } | null)?.image_error) ?? ''; } catch { return ''; } }, [item.media]);
  // THE IMAGE FLOOR (docs/design/calendar-image-gen-2026-08). The item prop is a click-time
  // snapshot (the calendar's `open` state), so the IPC result carries the fresh thumb/body and
  // we hold them locally — the row catches up via sync for every other surface.
  const [gen, setGen] = useState<null | 'image' | 'rewrite'>(null);
  const [freshThumb, setFreshThumb] = useState('');
  const [genErr, setGenErr] = useState('');
  // FROM A TAB the picture is asked for, not drawn (George, 2026-09-05): the lane posts the ask into
  // the draft's thread and the cloud machine draws onto the row. The item prop is a snapshot, so
  // while the ask is out we poll the room's items for the row's media to change — a new thumb, a
  // new body, or the machine's reason — and stop the moment it does (or after ~3 minutes).
  const [pending, setPending] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);
  const awaitRow = (since: string | null) => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!channelId) return;
    let polls = 0;
    pollRef.current = setInterval(() => {
      void nm?.contentItems(channelId).then((r) => {
        const row = r.items.find((x) => x.id === item.id);
        if (!row || row.media === since) { if (++polls >= 45) { clearInterval(pollRef.current!); pollRef.current = null; setPending(''); setGenErr('still drawing — the card updates when it lands'); } return; }
        clearInterval(pollRef.current!); pollRef.current = null; setPending('');
        const m = ((): { thumb?: string; image_error?: string } | null => { try { return JSON.parse(row.media ?? 'null') as { thumb?: string; image_error?: string } | null; } catch { return null; } })();
        if (m?.thumb) setFreshThumb(m.thumb);
        if (row.body !== item.body) setBody(row.body);
        if (m?.image_error && !m.thumb) setGenErr(m.image_error);
        onChanged();
      }).catch(() => {});
    }, 4000);
  };
  const [angleOpen, setAngleOpen] = useState(false);
  const [angle, setAngle] = useState('');
  const shownThumb = freshThumb || genThumb;
  const runGen = async (opts?: { rewrite?: boolean }) => {
    const req = opts?.rewrite ? { rewrite: true, ...(angle.trim() ? { angle: angle.trim() } : {}) } : undefined;
    setGen(opts?.rewrite ? 'rewrite' : 'image'); setGenErr(''); setAngleOpen(false);
    try {
      const r = await nm?.draftImage(item.id, req);
      if (r?.ok && r.pending) {
        setAngle('');
        setPending(opts?.rewrite ? 'asked your cloud machine to redraft — new body, new image; the card updates when it lands' : 'asked your cloud machine to draw — the card updates when it lands');
        awaitRow(item.media);
      } else if (r?.ok) {
        if (r.thumb) setFreshThumb(r.thumb);
        if (r.body) setBody(r.body);
        setAngle('');
        onChanged();
      } else setGenErr(r?.error ?? 'that didn’t stick — try again');
    } catch (e) { setGenErr(cleanErr(e, 'that didn’t stick — try again')); }
    setGen(null);
  };
  const [mediaUrl, setMediaUrl] = useState(origMedia);
  // remote images can't render under the renderer CSP — main fetches the URL and hands
  // back a data: URL; a failed fetch is also an early warning the platform can't pull it
  const [preview, setPreview] = useState<{ state: 'idle' | 'loading' | 'ok' | 'broken'; src: string | null }>({ state: origMedia ? 'loading' : 'idle', src: null });
  useEffect(() => {
    const u = mediaUrl.trim();
    if (!/^https?:\/\/\S+$/i.test(u)) { setPreview({ state: 'idle', src: null }); return; }
    setPreview({ state: 'loading', src: null });
    let dead = false;
    const t = setTimeout(() => {
      void nm?.mediaPreview(u).then(
        (r) => { if (!dead) setPreview(r.dataUrl ? { state: 'ok', src: r.dataUrl } : { state: 'broken', src: null }); },
        () => { if (!dead) setPreview({ state: 'broken', src: null }); },
      );
    }, 450);
    return () => { dead = true; clearTimeout(t); };
  }, [mediaUrl]);
  // WHOSE ACCOUNT, and WHOSE PROJECT (George, 2026-08-18). The card showed the room slug wearing
  // an avatar — which reads like an author but is only where the draft is filed. What a human is
  // approving is a post going out from a specific connected account, and publishing resolves that
  // connector through the room's PROJECT (0106) — so a workspace with two X accounts had nothing
  // on this surface to say which one was about to tweet.
  const [account, setAccount] = useState<{ handle: string; status: string } | null>(null);
  useEffect(() => {
    if (!channelId) { setAccount(null); return undefined; }
    let dead = false;
    void nm?.connectors(channelId).then(
      (r) => { if (!dead) setAccount(r.connectors.find((c) => c.provider === item.platform) ?? null); },
      () => { if (!dead) setAccount(null); },
    );
    return () => { dead = true; };
  }, [channelId, item.platform]);
  // viewport point → box-space transform-origin, measured because only one of the two is known
  // up front. Frozen at mount for the reason ui/Popover.tsx spells out: an un-frozen origin makes
  // every click INSIDE the surface the new anchor.
  const panelRef = useRef<HTMLDivElement>(null);
  const [pivot] = useState(() => anchorPoint());
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el || !pivot) return;
    const r = el.getBoundingClientRect();
    el.style.transformOrigin = `${Math.round(pivot.x - r.left)}px ${Math.round(pivot.y - r.top)}px`;
  }, [pivot]);
  const [rawBusy, setBusy] = useState(false);
  const busy = rawBusy || gen !== null; // the floor's work also parks the foot
  const [killAsk, setKillAsk] = useState(false);
  const [err, setErr] = useState('');
  const editable = item.status !== 'published';
  const slot = item.scheduled_at ? new Date(item.scheduled_at) : null;
  // LOCAL Y-M-D, never `toISOString().slice(0, 10)` (George, 2026-08-19). That took the **UTC**
  // date while the time below took the **local** hours, so the two halves of one slot were read in
  // different frames: a post at Tue 18:30 in Vancouver is Wed 01:30 UTC, and the picker said
  // "Wed, Aug 19 at 18:30" for a post the calendar correctly placed on Tuesday.
  //
  // It was not only a display bug. `pickedIso()` re-parses `${date}T${time}` as LOCAL, so the UTC
  // date came back in as a local one — opening a scheduled post anywhere west of UTC and pressing
  // Save time moved it a day into the future without anyone touching the date.
  const [date, setDate] = useState(() => localYmd(slot ?? new Date(Date.now() + 3600_000)));
  const [time, setTime] = useState(() => {
    const d = slot ?? new Date(Date.now() + 3600_000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const pickedIso = () => new Date(`${date}T${time}:00`).toISOString();
  const dirty = body.trim() !== item.body || mediaUrl.trim() !== origMedia;
  const fail = (e: unknown) => { setBusy(false); setErr(e instanceof Error && /future/i.test(e.message) ? 'pick a time in the future' : cleanErr(e, 'that didn\'t stick — try again')); };
  const guardFuture = (): boolean => {
    if (new Date(pickedIso()).getTime() > Date.now()) return true;
    setErr('pick a time in the future');
    return false;
  };
  const saveText = async () => { setBusy(true); setErr(''); try { await nm?.contentUpdate(item.id, body.trim(), mediaUrl.trim()); onChanged(); setBusy(false); } catch (e) { fail(e); } };
  const approve = async () => { if (!guardFuture()) return; setBusy(true); setErr(''); try { if (dirty) await nm?.contentUpdate(item.id, body.trim(), mediaUrl.trim()); await nm?.contentApprove(item.id, pickedIso()); onChanged(); onClose(); } catch (e) { fail(e); } };
  // "Now", honestly: `content.approve` requires a FUTURE slot (the server guards it), and the
  // publish cron fires every minute — so the soonest legal instant is a few seconds out and the
  // very next pass sends it. Re-queuing also clears `last_error` server-side, or the card would
  // sit scheduled while still showing why it failed last time.
  const publishNow = async () => {
    setBusy(true); setErr('');
    try { await nm?.contentApprove(item.id, new Date(Date.now() + 20_000).toISOString()); onChanged(); onClose(); } catch (e) { fail(e); }
  };
  const retime = async () => { if (!guardFuture()) return; setBusy(true); setErr(''); try { await nm?.contentApprove(item.id, pickedIso()); onChanged(); onClose(); } catch (e) { fail(e); } };
  const unschedule = async () => { setBusy(true); try { await nm?.contentUnschedule(item.id); onChanged(); onClose(); } catch { setBusy(false); } };
  const del = async () => { setBusy(true); try { await nm?.contentDelete(item.id); onChanged(); onClose(); } catch { setBusy(false); } };
  const platformName = MK_PLATFORMS.find(([k]) => k === item.platform)?.[1] ?? item.platform;
  // The card's byline: the ACCOUNT that will post, and the PROJECT whose connector it is. It falls
  // back to the room slug only when no connector is resolvable — which is itself worth saying,
  // because that post cannot go out at all until one is connected.
  // X handles arrive as '@joinflowe' (the callback prepends it) but other providers store bare
  // names — strip before re-prefixing, or the byline reads '@@joinflowe'.
  const handleBare = account?.handle?.replace(/^@+/, '') ?? '';
  const byline = (
    <span className="mkpvwho">
      <b>{handleBare ? `@${handleBare}` : channelSlug}</b>
      {projectName && <span className="mkpvproj">{projectName}</span>}
      {account && account.status !== 'connected' && <span className="mkpvwarn">{account.status === 'reauth_required' ? 'needs re-auth' : account.status}</span>}
      {!account && channelId && <span className="mkpvwarn">no {platformName} account connected</span>}
    </span>
  );
  const timeLabel = slot ? slot.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  const textArea = editable
    ? <textarea className="mkpvtext" value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(10, Math.max(3, body.split('\n').length + 1))} aria-label="Post text" />
    : <div className="mkpvtext ro">{item.body}</div>;
  // PORTALLED to <body> on purpose. This modal mounts INSIDE the task panel, and `position:
  // fixed` is only viewport-relative while no ancestor establishes a containing block — any
  // transform / filter / backdrop-filter / contain up the chain re-parents it silently. That is
  // exactly what happened: the veil stopped at the task panel's edges and painted a pale slab
  // over the thread instead of dimming the window. Portalling makes it immune to whatever the
  // ancestors do later (the same fix the icon popovers already carry).
  // THE SAME POPOVER TREATMENT as ⌘Y, the rosters and the launcher (2026-08-19): no tint, no blur,
  // and it grows out of the calendar chip or card you clicked. This overlay predates `ui/Popover`
  // and is its own `.mkdocovl`, so it takes the `bare` variant plus a pivot rather than being
  // rebuilt — same result, one class and a transform-origin.
  const node = (
    <div className="mkdocovl bare" role="dialog" aria-label={`${platformName} post`} onClick={onClose}>
      <div className="mkdocpanel mkpvpanel pivot" ref={panelRef} onClick={(e) => e.stopPropagation()}>
        <div className="mkdocpanelhead">
          <b>{platformName} post</b>
          <span className={`chip mk-${item.status}`}>{item.status}</span>
          <button className="mkppx" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="mkdocpanelbody">
          {item.platform === 'x' && (
            <div className="mkpv mkpvx">
              <div className="mkpvhead">
                <span className="mkpvav">{(handleBare || channelSlug)[0]?.toUpperCase() ?? 'N'}</span>
                {byline}<span className="mkpvhandle">· {item.status === 'published' ? 'posted' : item.status}</span>
              </div>
              {gen === 'rewrite' ? <div className="mkgenghost" aria-hidden><i /><i style={{ width: '82%' }} /><i style={{ width: '58%' }} /></div> : textArea}
              {isVideo ? filmBlock : <ImageFloor thumb={shownThumb} canGen={item.status === 'draft'} gen={gen} err={genErr || imageErr} pending={pending}
                angleOpen={angleOpen} angle={angle} onAngle={setAngle} onAngleOpen={setAngleOpen}
                onGen={() => void runGen()} onRewrite={() => void runGen({ rewrite: true })} />}
              <div className="mkpvengage" aria-hidden><span>💬 —</span><span>⇄ —</span><span>♡ —</span><span>{timeLabel}</span></div>
            </div>
          )}
          {(item.platform === 'instagram' || item.platform === 'tiktok') && (
            <div className={`mkpv mkpv-${item.platform}`}>
              <div className="mkpvhead">
                <span className="mkpvav grad">{(handleBare || channelSlug)[0]?.toUpperCase() ?? 'N'}</span>
                {byline}<span className="mkpvhandle">· {platformName}</span>
              </div>
              {isVideo ? filmBlock
                : preview.state === 'ok' && preview.src
                ? <img className="mkpvimg" src={preview.src} alt="post media" />
                : preview.state === 'idle' && genThumb
                ? <img className="mkpvimg" src={genThumb} alt="generated post image" />
                : <div className="mkpvmedia" aria-hidden>{item.platform === 'tiktok' ? '♪' : '◫'}<span>{
                    preview.state === 'loading' ? 'fetching image…'
                    : preview.state === 'broken' ? 'that image URL didn’t load — check it’s public'
                    : item.platform === 'instagram' ? 'Instagram requires an image — paste its URL below'
                    : 'TikTok requires an image — paste its URL below'}</span></div>}
              {editable && !isVideo && (
                <div className="mkpvmediarow">
                  <input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="public image URL (https://…)" aria-label="Post media URL" spellCheck={false} />
                </div>
              )}
              {textArea}
              <div className="mkpvengage" aria-hidden><span>♡ —</span><span>💬 —</span><span>↗ —</span><span>{timeLabel}</span></div>
            </div>
          )}
          {item.platform !== 'x' && item.platform !== 'instagram' && item.platform !== 'tiktok' && (
            <div className="mkpv">
              {gen === 'rewrite' ? <div className="mkgenghost" aria-hidden><i /><i style={{ width: '82%' }} /><i style={{ width: '58%' }} /></div> : textArea}
              {isVideo ? filmBlock : <ImageFloor thumb={shownThumb} canGen={item.status === 'draft'} gen={gen} err={genErr || imageErr} pending={pending}
                angleOpen={angleOpen} angle={angle} onAngle={setAngle} onAngleOpen={setAngleOpen}
                onGen={() => void runGen()} onRewrite={() => void runGen({ rewrite: true })} />}
            </div>
          )}
          <div className="mkpvwhen">
            <span aria-hidden>🕐</span>
            {editable ? (
              <WhenPicker date={date} time={time} onDate={setDate} onTime={setTime} />
            ) : (
              <span>{slot ? slot.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : new Date(item.published_at ?? item.created_at).toLocaleString()}</span>
            )}
          </div>
          {/* WHY IT FAILED (George, 2026-08-18). `last_error` has been written since 0084 and syncs
              already — no client had ever read it, so a failed post said "failed" and stopped
              there, with no reason and no way back. The card is where the human is deciding, so
              the reason belongs here rather than in a log. */}
          {item.status === 'failed' && item.last_error && (
            <div className="mkpvfail" role="status">
              <b>Didn’t go out</b>
              <span>{item.last_error}</span>
            </div>
          )}
          {err && <div className="acterr" style={{ marginTop: 8 }}>{err}</div>}
          <div className="mkpvfoot">
            {item.status === 'draft' && <button className="btn accept sm" disabled={busy} onClick={() => void approve()}>Approve · schedule</button>}
            {item.status === 'scheduled' && <button className="btn primary sm" disabled={busy} onClick={() => void retime()}>Save time</button>}
            {/* A FAILED POST HAD NO WAY BACK — only Delete, because the foot only ever branched on
                draft/scheduled/published. Two ways out now, both the same re-queue: send it on the
                next pass, or put it back on the calendar at a time you pick. (The publish cron runs
                every minute, so "now" is honest — see `publishNow`.) */}
            {item.status === 'failed' && <button className="btn accept sm" disabled={busy} onClick={() => void publishNow()}>Publish now</button>}
            {item.status === 'failed' && <button className="btn primary sm" disabled={busy} onClick={() => void retime()}>Reschedule</button>}
            {editable && dirty && item.status !== 'draft' && <button className="btn sm" disabled={busy} onClick={() => void saveText()}>Save changes</button>}
            {editable && dirty && item.status === 'draft' && <button className="btn sm" disabled={busy} onClick={() => void saveText()}>Save · keep draft</button>}
            {item.status === 'scheduled' && <button className="btn sm" disabled={busy} onClick={() => void unschedule()}>Unschedule</button>}
            {item.status === 'published' && item.external_url && (
              <button className="btn primary sm" onClick={() => openLink(item.external_url!)}>View on {platformName} ↗</button>
            )}
            {editable && (killAsk
              ? <button className="btn sm mkdanger" disabled={busy} onClick={() => void del()}>Delete — sure?</button>
              : <button className="btn ghost sm" onClick={() => { setKillAsk(true); setTimeout(() => setKillAsk(false), 2600); }}>Delete</button>)}
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(node, document.body);
}
