// Social post cards (docs/design/thread-posts) — a drafted post, its per-network preview,
// and the approve/schedule controls. Thread-native: the same card renders in a conversation
// and in a task panel from one derivation. Extracted from App.tsx (track A3).
import { IconImage, IconReply } from '../ui/icons';
import { MK_PLATFORMS, MK_PLATFORM_ICON } from '../thread/DeliveryStrip';
import { openImageConnect } from '../settings/ConnectionsList';
import { type ContentItemRow } from '../bridge/rows-content';
import { type PostVCard } from '../thread/parts';
import { useEffect, useState } from 'react';

export function postCardsFrom(items: ContentItemRow[], rows: ReadonlyArray<{ body: string; created_at: string }>): PostVCard[] {
  // A draft's ORIGINAL version + its replaced history land in ONE delivery strip (they were
  // handed over together); a targeted REVISION rides its own card after the reply that asked
  // for it (the ‹revised:id› marker carries that time).
  const revisedAt = new Map<string, number>();
  for (const m of rows) { const mk = /‹revised:([^›]+)›/.exec(m.body); if (mk) for (const id of mk[1]!.split(',')) revisedAt.set(id.trim(), new Date(m.created_at).getTime() + 1); }
  const cards: PostVCard[] = [];
  [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()).forEach((it, i) => {
    const letter = String.fromCharCode(97 + i);
    const media = ((): { history?: Array<{ body: string; brief?: string; thumb?: string; at: string }>; revised_at?: string } => { try { return JSON.parse(it.media ?? '{}') as never; } catch { return {}; } })();
    const history = media.history ?? [];
    history.forEach((h, vi) => cards.push({
      key: `${it.id}:v${vi}`, letter, version: vi + 1, superseded: true, isRevision: false, anchor: new Date(h.at).getTime(),
      item: { ...it, body: h.body, status: 'draft', scheduled_at: null, external_url: null, media: JSON.stringify({ ...(h.brief ? { brief: h.brief } : {}), ...(h.thumb ? { thumb: h.thumb } : {}) }) },
    }));
    cards.push({ key: it.id, item: it, letter, version: history.length + 1, superseded: false, isRevision: revisedAt.has(it.id) || !!media.revised_at, anchor: revisedAt.get(it.id) ?? new Date(media.revised_at ?? it.created_at).getTime() });
  });
  return cards;
}

export function SocialPostCard({ item, channelSlug, taskNumber, letter, onOpen, onReply, onGenerateImage, imageReady, version, superseded }: { item: ContentItemRow; channelSlug: string; taskNumber?: number | null; letter: string; onOpen: () => void; onReply?: () => void; /* `redraw` = the card already had a picture, so the message the thread records says so */ onGenerateImage?: (redraw: boolean) => void; imageReady?: boolean; version?: number; superseded?: boolean }) {
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
  const media = ((): { image_url?: string; brief?: string; thumb?: string; image_error?: string } | null => {
    try { return JSON.parse(item.media ?? 'null') as { image_url?: string; brief?: string; thumb?: string; image_error?: string } | null; } catch { return null; }
  })();
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
  const hasImage = !!media?.thumb || !!media?.image_url;
  const canDraw = !!media?.brief && !superseded && item.status === 'draft';
  const wantsImage = !hasImage && canDraw;
  const [tryPending, setTryPending] = useState(false);
  useEffect(() => { setTryPending(false); }, [media?.thumb, media?.image_error]); // a fresh outcome clears the spinner
  return (
    <div className={`mkpostcard${superseded ? ' mkpcold' : ''}`}>
      <div className="mkpchd">
        <span className="mkpcnet"><span className="mkpcg">{glyph}</span>{platformName}</span>
        <span className="mkpcid">{ref}{version && version > 1 ? ` · v${version}` : ''}</span>
        <span className={`chip ${superseded ? 'mk-old' : `mk-${item.status}`}`}>{superseded ? 'replaced' : item.status}</span>
      </div>
      <div className={pvClass}>
        <div className="mkpvhead">
          <span className={`mkpvav${grad ? ' grad' : ''}`}>{channelSlug[0]?.toUpperCase() ?? 'N'}</span>
          <b>{channelSlug}</b><span className="mkpvhandle">· {superseded ? `earlier version` : item.status === 'published' ? 'posted' : 'draft'}</span>
        </div>
        <div className="mkpvtext ro">{item.body}</div>
        {media?.thumb && <img className="mkpcimg" src={media.thumb} alt={media.brief ?? 'generated post image'} title={media.brief ?? undefined} />}
        {/* the shape of what is coming, where it will appear — a pending state belongs on the
            picture, not in a banner whose own button has to argue it is busy */}
        {tryPending && !media?.thumb && <div className="mkpcimgwait" aria-live="polite">drawing…</div>}
      </div>
      {/* The brief stays readable once the picture exists (it is what a redraw will re-run), so it
          says what it IS rather than what is missing. */}
      {(wantsImage || (hasImage && !!media?.brief && !superseded)) && (
        <div className="mkpcbrief" title="the visual the marketer described">
          <IconImage s={13} />
          <span><span className="mkpcbriefk">{hasImage ? 'image brief' : 'needs image'}</span> — {media!.brief}</span>
        </div>
      )}
      {/* one clear image state per card — the reason on the card, not buried in a summary message */}
      {wantsImage && imageReady === false && (
        <div className="mkpcsetup">
          <b>No image model connected.</b> Your designer wrote the art direction but has nothing to draw with — a subscription login carries no API key.
          <button className="btn sm" onClick={() => openImageConnect()}>Connect an image model →</button>
        </div>
      )}
      {wantsImage && imageReady !== false && media?.image_error && (
        <div className="mkpcsetup mkpcimgerr">
          <b>Image didn&rsquo;t generate.</b> {media.image_error}
          {onGenerateImage && <button className="btn sm" disabled={tryPending} onClick={() => { setTryPending(true); onGenerateImage(false); }}>{tryPending ? 'Drawing…' : 'Try again'}</button>}
        </div>
      )}
      {/* `imageReady` is undefined while the credential lookup is in flight (or after it rejected),
          and every branch here tests === true / === false — so this row used to render NOTHING at
          all, indistinguishable from a card that never wanted a picture. A disabled control is the
          honest placeholder: it exists, it is not ready yet. */}
      {wantsImage && !media?.image_error && onGenerateImage && (
        <div className="mkpcsetup mkpcimggen">
          <button className="btn sm" disabled={tryPending || imageReady !== true}
            title={imageReady === undefined ? 'checking for an image model…' : undefined}
            onClick={() => { setTryPending(true); onGenerateImage(false); }}>{tryPending ? 'Drawing…' : 'Generate image'}</button>
        </div>
      )}
      <div className="mkpcfoot">
        {limit != null && <span className="mkpccc">{chars}/{limit}</span>}
        {item.status === 'scheduled' && slot && <span className="mkpcwhen">◷ {slot.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
        {item.status === 'published' && item.external_url && <span className="mkpclive">✓ live</span>}
        {item.status === 'failed' && <span className="mkpcfail" title={item.last_error ?? undefined}>⚠ failed</span>}
        {superseded && <span className="mkpcverlbl">was {ref}</span>}
        <span className="mkpcactions">
          {/* request changes on THIS draft — arms the thread composer with the card as a pill,
              rather than an inline field on the card (George's ask). Not on a live post, and not on
              a superseded version (it's history — request changes on the current one). */}
          {onReply && !superseded && item.status !== 'published' && (
            <button className="mkico mkpcreply" title="Request changes on this draft" aria-label={`Request changes on draft ${letter}`} onClick={onReply}><IconReply s={13} /></button>
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
