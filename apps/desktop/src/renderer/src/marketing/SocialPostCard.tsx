// Social post cards (docs/design/thread-posts) — a drafted post, its per-network preview,
// and the approve/schedule controls. Thread-native: the same card renders in a conversation
// and in a task panel from one derivation. Extracted from App.tsx (track A3).
import { IconDownload, IconImage, IconKebab, IconPlay, IconReply } from '../ui/icons';
import { MK_PLATFORMS, MK_PLATFORM_ICON } from '../thread/DeliveryStrip';
import { openImageConnect } from '../settings/ConnectionsList';
import { type ContentItemRow } from '../bridge/rows-content';
import { type PostVCard } from '../thread/parts';
import { useEffect, useState } from 'react';
import { nm as nmBridge } from '../bridge/nm';
import { cardParts, filmFacts, filmFile, filmSeconds, filmingOn, type CardMedia, type StarterVideoCatalog } from './cardparts';
import { filmMinutes } from '@neuramesh/shared';
import { useFilm } from './FilmPreview';
import { openCredits } from '../settings/ConnectionsList';

// THE TIER CATALOG (the video rung): what this server films on and what it costs, read once per
// session and shared by every card, so a thread of six video cards asks the server once, not six
// times. A card that mounts before the answer shows no facts line rather than a wrong one.
let catalogOnce: Promise<StarterVideoCatalog> | null = null;
const readCatalog = (): Promise<StarterVideoCatalog> => (catalogOnce ??= (nmBridge?.starterVideo?.() ?? Promise.resolve(null)).then((c) => (c as StarterVideoCatalog) ?? null).catch(() => null));
export function useStarterVideo(): StarterVideoCatalog {
  const [cat, setCat] = useState<StarterVideoCatalog>(null);
  useEffect(() => { let live = true; void readCatalog().then((c) => { if (live) setCat(c); }); return () => { live = false; }; }, []);
  return cat;
}

export function postCardsFrom(items: ContentItemRow[], rows: ReadonlyArray<{ body: string; created_at: string }>): PostVCard[] {
  // A draft's ORIGINAL version + its replaced history land in ONE delivery strip (they were
  // handed over together); a targeted REVISION rides its own card after the reply that asked
  // for it (the ‹revised:id› marker carries that time).
  const revisedAt = new Map<string, number>();
  for (const m of rows) { const mk = /‹revised:([^›]+)›/.exec(m.body); if (mk) for (const id of mk[1]!.split(',')) revisedAt.set(id.trim(), new Date(m.created_at).getTime() + 1); }
  const cards: PostVCard[] = [];
  [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).forEach((it, i) => {
    const letter = String.fromCharCode(97 + i);
    const media = ((): { history?: Array<{ body: string; brief?: string; script?: string; thumb?: string; at: string }>; revised_at?: string } => { try { return JSON.parse(it.media ?? '{}') as never; } catch { return {}; } })();
    const history = media.history ?? [];
    history.forEach((h, vi) => cards.push({
      key: `${it.id}:v${vi}`, letter, version: vi + 1, superseded: true, isRevision: false, anchor: new Date(h.at).getTime(),
      item: { ...it, body: h.body, status: 'draft', scheduled_at: null, external_url: null, media: JSON.stringify({ ...(h.brief ? { brief: h.brief } : {}), ...(h.script ? { script: h.script } : {}), ...(h.thumb ? { thumb: h.thumb } : {}) }) },
    }));
    cards.push({ key: it.id, item: it, letter, version: history.length + 1, superseded: false, isRevision: revisedAt.has(it.id) || !!media.revised_at, anchor: revisedAt.get(it.id) ?? new Date(media.revised_at ?? it.created_at).getTime() });
  });
  return cards;
}


export function SocialPostCard({ item, channelSlug, taskNumber, letter, onOpen, onReply, onGenerateImage, imageReady, version, superseded }: { item: ContentItemRow; channelSlug: string; taskNumber?: number | null; letter: string; onOpen: () => void; onReply?: () => void; /* `redraw` = the card already had a picture, so the message the thread records says so; `kind` = 'video' films the script's hook instead of drawing */ onGenerateImage?: (redraw: boolean, kind?: 'image' | 'video') => void; imageReady?: boolean; version?: number; superseded?: boolean }) {
  // the handle the human and the agent both use for this card. A task's drafts wear its number
  // (#1048·b); a conversation's have no board row to point at, so the letter alone IS the handle —
  // "change b" reaches the same card either way.
  const ref = taskNumber ? `#${taskNumber}·${letter}` : `draft ${letter}`;
  const platformName = MK_PLATFORMS.find(([k]) => k === item.platform)?.[1] ?? item.platform;
  const glyph = MK_PLATFORM_ICON[item.platform] ?? '•';
  const chars = item.body.replace(/\n/g, '').length;
  const limit = item.platform === 'x' ? 280 : null;
  const slot = item.scheduled_at ? new Date(item.scheduled_at) : null;
  const grad = item.platform === 'instagram' || item.platform === 'tiktok';
  const pvClass = item.platform === 'x' ? 'mkpv mkpvx' : grad ? `mkpv mkpv-${item.platform}` : 'mkpv';
  const goLabel = item.status === 'draft' ? 'Review · schedule ↗' : item.status === 'scheduled' ? 'Reschedule ↗' : item.status === 'published' ? 'View ↗' : 'Open ↗';
  // media jsonb: `thumb` is the generated image's inline preview, `brief` the visual the marketer
  // asked for. The brief is only ever its own row — it must never ride in the post text, where it
  // would publish verbatim and break the character count.
  const media = ((): CardMedia | null => {
    try { return JSON.parse(item.media ?? 'null') as CardMedia | null; } catch { return null; }
  })();
  // THE SCRIPT AND ITS FILM (George, 2026-09-18). A VIDEO post is the caption that posts, the
  // creator's script beside it, and the film. The script is long: the card folds it to its first
  // beat and a click on the text opens it. The script can be FILMED: the hook, as an eight-second
  // clip, on the same lane a picture takes (the marker, the daemon, the attach), and the film shows
  // on the card where a picture would. A video card never offers a picture: the film is its media,
  // and a new script (request changes) films again.
  const { caption, script } = cardParts(item.body, media);
  const isVideo = !!script;
  const [open, setOpen] = useState(false);
  const canFilm = isVideo && !superseded && item.status === 'draft';
  const film = useFilm(media?.video_id);
  const catalog = useStarterVideo();
  // a film in flight: the local press until the server's row says so (video_pending, which
  // survives a reload), or the own-key lane's thirty seconds
  const [filmPending, setFilmPending] = useState(false);
  useEffect(() => { setFilmPending(false); }, [media?.video_id, media?.video_error, media?.video_pending]);
  const filming = filmPending || !!media?.video_pending;
  const facts = isVideo ? filmFacts(media, catalog, script) : null;
  // the length the next film takes (plan §8): the angle card's pick on the draft, held to the tier's lengths
  const seconds = filmSeconds(media, catalog?.served ? catalog.tiers.find((t) => t.tier === catalog.tier) : null);
  // THE FILM IS A FILE (George, 2026-09-19). A clip the card plays can be saved, on any card that
  // shows one: the bytes are already here, so Save hands them to the OS dialog (the desktop) or the
  // browser's own download, named for the card. The door is the card's menu (the kebab in the
  // header, the project card's idiom), not a button beside the actions: saving is not a step in
  // the draft's life, so it does not stand with Film again and Review.
  const canSave = !!media?.video_id && !!film && !filming;
  const [menu, setMenu] = useState(false);
  const saveFilm = () => {
    setMenu(false);
    const f = filmFile(film, `${channelSlug}-${taskNumber ? `${taskNumber}-` : ''}${letter}-hook`);
    if (f) void nmBridge?.saveFileAs(f).catch(() => null);
  };
  // THE CARD'S IMAGE STATE, in two questions rather than one.
  //
  // It used to be a single `wantsImage` whose first clause was `!media?.thumb` — so the moment a
  // card HAD a picture every image control vanished: no redraw, no error, no connect prompt. That
  // read as "the button disappeared" (live, 2026-08-13) when it had simply never covered the case.
  // `hasImage` and `canDraw` separate what the card SHOWS from what it can DO: anything with art
  // direction can be drawn again, whether or not it already carries a picture.
  // `draft` only, not merely "not published": generateDraftImage scopes its lookup to drafts, so a
  // redraw offered on a SCHEDULED card would fail every time. That is also the right gate — a
  // scheduled post is human-approved, and changing what publishes is what unschedule is for
  // (revising its copy already drops the slot for exactly this reason).
  const hasImage = !isVideo && (!!media?.thumb || !!media?.image_url);
  const canDraw = !isVideo && !!media?.brief && !superseded && item.status === 'draft';
  const wantsImage = !hasImage && canDraw;
  const [tryPending, setTryPending] = useState(false);
  useEffect(() => { setTryPending(false); }, [media?.thumb, media?.image_error]); // a fresh outcome clears the spinner
  return (
    <div className={`mkpostcard${superseded ? ' mkpcold' : ''}`}>
      <div className="mkpchd">
        <span className="mkpcnet"><span className="mkpcg">{glyph}</span>{platformName}</span>
        <span className="mkpcid">{ref}{version && version > 1 ? ` · v${version}` : ''}</span>
        <span className={`chip ${superseded ? 'mk-old' : `mk-${item.status}`}`}>{superseded ? 'replaced' : item.status}</span>
        {canSave && <button className={`mkpckebab${menu ? ' show' : ''}`} title="Card menu" aria-label={`Menu for draft ${letter}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)}><IconKebab s={14} /></button>}
      </div>
      {menu && (
        <>
          <div className="projmenu-scrim" onClick={() => setMenu(false)} />
          <div className="pmenu mkpcmenu" role="menu">
            <button role="menuitem" onClick={saveFilm}><IconDownload s={13} />Download the film</button>
          </div>
        </>
      )}
      <div className={pvClass}>
        <div className="mkpvhead">
          <span className={`mkpvav${grad ? ' grad' : ''}`}>{channelSlug[0]?.toUpperCase() ?? 'N'}</span>
          <b>{channelSlug}</b><span className="mkpvhandle">· {superseded ? `earlier version` : item.status === 'published' ? 'posted' : 'draft'}</span>
        </div>
        {caption && <div className="mkpvtext ro">{caption}</div>}
        {script && (
          <div className={`mkscript${open ? ' open' : ''}${caption ? ' mkscriptunder' : ''}`} role="button" tabIndex={0} title={open ? 'Fold the script' : 'Show the whole script'}
            onClick={() => setOpen((v) => !v)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}>
            <div className="mkpvtext ro mkscripttext">{script}</div>
            <span className="mkscriptmore">{open ? 'fold the script ‹' : 'the script ›'}</span>
          </div>
        )}
        {hasImage && media?.thumb && <img className="mkpcimg" src={media.thumb} alt={media.brief ?? 'generated post image'} title={media.brief ?? undefined} />}
        {media?.video_id && !filming && (film ? <video className="mkpcfilm" src={film} controls playsInline preload="metadata" /> : <div className="mkpcimgwait" aria-live="polite">loading the film…</div>)}
        {filming && (
          <div className="mkpcfilmwait" aria-live="polite">
            <b>Filming {seconds} s on {filmingOn(catalog)}</b>
            <span>About {filmMinutes(seconds)} minutes. The film lands on this card, and you can leave the page.</span>
            <span className="mkpcprog"><i /></span>
          </div>
        )}
        {/* the shape of what is coming, where it will appear — a pending state belongs on the
            picture, not in a banner whose own button has to argue it is busy */}
        {tryPending && !media?.thumb && <div className="mkpcimgwait" aria-live="polite">drawing…</div>}
      </div>
      {/* The brief stays readable once the picture exists (it is what a redraw will re-run), so it
          says what it IS rather than what is missing. */}
      {(wantsImage || (hasImage && !!media?.brief && !superseded)) && (
        <div className="mkpcbrief" title="the visual the marketer described">
          <IconImage s={13} />
          <span><span className="mkpcbriefk">{hasImage ? 'image brief' : 'needs image'}</span> · {media!.brief}</span>
        </div>
      )}
      {isVideo && !!media?.brief && !superseded && (
        <div className="mkpcbrief" title="the shot direction the film follows">
          <IconPlay s={13} />
          <span><span className="mkpcbriefk">{media.video_id ? 'shot direction' : 'needs video'}</span> · {media.brief}</span>
        </div>
      )}
      {/* one clear state per card — the reason on the card, not buried in a summary message. The
          rows say WHY; every button lives in the foot below (George, 2026-09-19: "align the buttons
          at the bottom of the preview social cards, now we have buttons scattered"). */}
      {wantsImage && imageReady === false && (
        <div className="mkpcsetup"><b>No image model connected.</b> Your designer wrote the art direction but has nothing to draw with. A subscription login carries no API key.</div>
      )}
      {wantsImage && imageReady !== false && media?.image_error && (
        <div className="mkpcsetup mkpcimgerr"><b>Image didn&rsquo;t generate.</b> {media.image_error}</div>
      )}
      {canFilm && media?.video_error && !filming && (
        <div className="mkpcsetup mkpcimgerr"><b>{media.video_error_code === 'NO_CREDITS' ? 'Out of credits.' : 'Video didn\u2019t generate.'}</b> {media.video_error}</div>
      )}
      {/* the facts line: what films this card and what it costs, said before the press; what filmed it, after */}
      {facts && !superseded && <div className="mkpcfacts">{facts.map((f, i) => <span key={i} className={/credits$/.test(f) ? 'cr' : undefined}>{f}</span>)}</div>}
      <div className="mkpcfoot">
        {/* the primary actions, one place: draw, film, retry, connect, add credits */}
        {!superseded && item.status === 'draft' && onGenerateImage && (
          <span className="mkpcdo">
            {wantsImage && imageReady === false && <button className="btn sm" onClick={() => openImageConnect()}>Connect an image model →</button>}
            {/* `imageReady` is undefined while the credential lookup is in flight: a disabled control is the honest placeholder */}
            {wantsImage && imageReady !== false && (
              <button className="btn sm" disabled={tryPending || imageReady !== true} title={imageReady === undefined ? 'checking for an image model…' : undefined}
                onClick={() => { setTryPending(true); onGenerateImage(false); }}>{tryPending ? 'Drawing…' : media?.image_error ? 'Try again' : 'Generate image'}</button>
            )}
            {canFilm && (
              <button className="btn sm" disabled={filming} title={`Film the script's first ${seconds} seconds as a vertical clip`}
                onClick={() => { setFilmPending(true); onGenerateImage(!!media?.video_id, 'video'); }}>{filming ? 'Filming…' : media?.video_error ? 'Try again' : media?.video_id ? 'Film again' : 'Generate video'}</button>
            )}
            {canFilm && media?.video_error_code === 'NO_CREDITS' && !filming && <button className="btn sm" onClick={() => openCredits()}>Add credits →</button>}
            {canFilm && media?.video_error_code && !filming && <button className="btn sm" onClick={() => openImageConnect()}>Add a Google key →</button>}
          </span>
        )}
        {limit != null && <span className="mkpccc">{chars}/{limit}</span>}
        {item.status === 'scheduled' && slot && <span className="mkpcwhen">◷ {slot.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
        {item.status === 'published' && item.external_url && <span className="mkpclive">✓ live</span>}
        {item.status === 'failed' && <span className="mkpcfail" title={item.last_error ?? undefined}>⚠ failed</span>}
        {superseded && <span className="mkpcverlbl">was {ref}</span>}
        <span className="mkpcactions">
          {/* request changes on THIS draft — arms the thread composer with the card as a pill,
              rather than an inline field on the card (George's ask). Not on a live post, and not on
              a superseded version (it's history — request changes on the current one). It wears
              its name (2026-09-19, George: "it seems hidden on the card"): the bare arrow read as
              decoration beside the labelled buttons, and the one way to refine a script went unseen. */}
          {onReply && !superseded && item.status !== 'published' && (
            <button className="mkico mkpcreply" title={isVideo ? 'Ask for a change to the script or the caption' : 'Ask for a change to this draft'} aria-label={`Request changes on draft ${letter}`} onClick={onReply}><IconReply s={13} /><span>Request changes</span></button>
          )}
          {/* REDRAW — the affordance a card with a picture never had. Quiet, in the same family as
              Reply, because a card whose image already looks right should not wear a banner about
              it. It re-runs the brief the card carries; a DIFFERENT picture is a conversation
              ("make it warmer"), which the agent answers with revise_posts + a new brief. */}
          {hasImage && canDraw && onGenerateImage && (
            <button className="mkico mkpcredraw" disabled={tryPending || imageReady !== true}
              title={imageReady === false ? 'No image model connected' : imageReady === undefined ? 'checking for an image model…' : 'Redraw this image from its brief'}
              aria-label={`Redraw the image on draft ${letter}`}
              onClick={() => { setTryPending(true); onGenerateImage(true); }}><IconImage s={13} /></button>
          )}
          {!superseded && <button className="btn sm mkpcgo" onClick={onOpen}>{goLabel}</button>}
        </span>
      </div>
    </div>
  );
}
