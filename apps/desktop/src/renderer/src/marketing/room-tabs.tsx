// The marketing room's own Calendar and Library tabs — the room-scoped twins of the
// workspace destinations. Extracted from App.tsx (track A4).
import { DiffView, DocOverlay, previewType } from '../views/docpreview';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { MK_PLATFORMS, MK_PLATFORM_ICON } from '../thread/DeliveryStrip';
import { Md } from '../md/Md';
import { PostPreviewModal } from './PostPreviewModal';
import { fileTag } from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { themedMockupDoc } from '../design/plans';
import { type ChannelArtifactRow, type ChannelRow } from '../bridge/rows-rooms';
import { type ContentItemRow } from '../bridge/rows-content';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export function MarketingCalendar({ channel, projectName }: {
  channel: ChannelRow;
  /** whose connector will post these — the room's PROJECT owns it (0106) */
  projectName?: string | null;
}) {
  const [items, setItems] = useState<ContentItemRow[]>([]);
  const [weekOff, setWeekOff] = useState(0);
  const [open, setOpen] = useState<ContentItemRow | null>(null);
  const reload = useCallback(() => { void nm?.contentItems(channel.id).then((r) => setItems(r.items)).catch(() => {}); }, [channel.id]);
  // light poll like the strip/rail — replica lag otherwise leaves a just-mutated chip stale
  useEffect(() => { reload(); const iv = setInterval(reload, 5000); return () => clearInterval(iv); }, [reload]);
  const monday = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOff * 7);
    return d;
  }, [weekOff]);
  const days = useMemo(() => [...Array(7)].map((_, i) => new Date(monday.getTime() + i * 86_400_000)), [monday]);
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const itemDay = (it: ContentItemRow) => { const d = new Date(it.scheduled_at ?? it.created_at); return dayKey(d); };
  const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '—');
  const range = `${monday.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${days[6]!.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  const todayKey = dayKey(new Date());
  return (
    <div className="mkcalwrap">
      <div className="mkcalhead">
        <div className="mkcalnav">
          <button onClick={() => setWeekOff((w) => w - 1)} aria-label="Previous week">‹</button>
          <button onClick={() => setWeekOff((w) => w + 1)} aria-label="Next week">›</button>
        </div>
        <span className="mkcalrange">{range}</span>
        {weekOff !== 0 && <button className="btn ghost sm" onClick={() => setWeekOff(0)}>Today</button>}
      </div>
      <div className="mkcalgrid" role="grid" aria-label="Content calendar">
        <div className="mkchd" style={{ borderLeft: 'none' }} />
        {days.map((d) => (
          <div key={d.toISOString()} className={`mkchd${dayKey(d) === todayKey ? ' today' : ''}`}>
            {d.toLocaleDateString([], { weekday: 'short' })} <span className="dnum">{d.getDate()}</span>
          </div>
        ))}
        {MK_PLATFORMS.map(([pk, pl]) => (
          <Fragment key={pk}>
            <div className="mkplab">{pl}</div>
            {days.map((d) => (
              <div key={dayKey(d)} className={`mkcell${dayKey(d) === todayKey ? ' today' : ''}`}>
                {items.filter((it) => it.platform === pk && itemDay(it) === dayKey(d)).map((it) => (
                  <button key={it.id} className={`mkcalitem ${it.status}`} onClick={() => setOpen(it)} title={`${it.body}\n— ${it.status}${it.scheduled_at ? ` · ${timeOf(it.scheduled_at)}` : ''}`}>
                    <span className="pic" aria-hidden>{MK_PLATFORM_ICON[pk] ?? '•'}</span>
                    <span className="t">{timeOf(it.scheduled_at ?? it.published_at)}</span>
                    {it.status === 'published' ? '✓ ' : ''}{it.body.slice(0, 42)}
                  </button>
                ))}
              </div>
            ))}
          </Fragment>
        ))}
      </div>
      {open && <PostPreviewModal key={open.id} item={open} channelSlug={channel.slug} channelId={channel.id} projectName={projectName ?? null} onClose={() => setOpen(null)} onChanged={reload} />}
    </div>
  );
}

// The Library surface (marketing-channel plan §4.9, mockup scene 06): the room's artifacts
// worn as a first-class surface — no new storage system. Docs ride inline_content exactly
// as deliverables do; images render their inline thumb (or nm-attachment:// for chat
// media); folders derive from kind. The channel ACL is the row's ACL, unchanged.
export const MK_FOLDERS: Array<[string, string, (a: ChannelArtifactRow) => boolean]> = [
  ['all', 'All', () => true],
  ['docs', 'Docs', (a) => a.kind === 'doc' || a.kind === 'file'],
  ['media', 'Media', (a) => a.kind === 'screenshot' || (a.mime ?? '').startsWith('image/') || (a.mime ?? '').startsWith('video/')],
  ['design', 'Design', (a) => a.kind === 'design'],
];

/** the bytes for a library row: the synced inline copy, else the local attachment stream */
export function libSrc(a: ChannelArtifactRow): string | null {
  if (a.inline_content?.startsWith('data:')) return a.inline_content;
  return a.message_id ? `nm-attachment://${a.id}` : a.inline_content;
}

// A shelf whose every tile wore the same paperclip icon told you nothing — you had to open each
// file to find the one you wanted. So a tile shows the FILE, typed by the same previewType() the
// thread's deliverable cards and the artifacts drawer switch on (docs/30): three surfaces, one
// answer about what a file is. Rendered static and clipped rather than in a scrollable canvas —
// the tile is one click target, and reading it properly is what the overlay is for.
export function LibPreview({ art }: { art: ChannelArtifactRow }) {
  const c = art.inline_content ?? '';
  const mime = art.mime ?? '';
  // clips: only the local machine has the bytes, and a poster frame IS the preview
  if (mime.startsWith('video/')) {
    const src = libSrc(art);
    return src && !src.startsWith('data:image')
      ? <video className="mklpmedia" src={src} muted playsInline preload="metadata" tabIndex={-1} />
      : <span className="mklpnone">clip</span>;
  }
  if (!c) {
    const src = art.message_id ? `nm-attachment://${art.id}` : null;
    return src && mime.startsWith('image/')
      ? <img className="mklpmedia" src={src} alt="" loading="lazy" />
      : <span className="mklpnone">{fileTag(art.name, art.kind)}</span>;
  }
  const t = previewType(art.name, art.kind, c);
  if (t === 'image') {
    return <img className="mklpmedia" src={c.startsWith('data:') ? c : `data:image/svg+xml;utf8,${encodeURIComponent(c)}`} alt="" loading="lazy" />;
  }
  if (t === 'html') {
    // an agent-authored page gets no script, network or storage in a thumbnail
    return <span className="mklphtml"><iframe className="mklpframe" sandbox="" srcDoc={themedMockupDoc(c)} tabIndex={-1} title={art.name} loading="lazy" /></span>;
  }
  if (t === 'diff') {
    return <span className="mklpdiff"><pre>{c.split('\n').slice(0, 40).map((ln, i) => (
      <span key={i} className={ln.startsWith('+') && !ln.startsWith('+++') ? 'a' : ln.startsWith('-') && !ln.startsWith('---') ? 'd' : ln.startsWith('@@') ? 'h' : ''}>{ln}{'\n'}</span>
    ))}</pre></span>;
  }
  // a thumbnail can show a few hundred words at most, and the grid renders every row at once —
  // so the head of the file is what gets parsed, not a 3,000-word report per tile
  if (t === 'markdown') return <span className="mklpmd"><Md text={c.slice(0, 1800)} /></span>;
  return <span className="mklpraw"><pre>{c.slice(0, 900)}</pre></span>;
}

export function MarketingLibrary({ channel }: { channel: ChannelRow }) {
  const [rows, setRows] = useState<ChannelArtifactRow[]>([]);
  const [folder, setFolder] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { void nm?.channelArtifacts(channel.id).then((r) => setRows(r.artifacts)).catch(() => {}); }, [channel.id]);
  const filter = MK_FOLDERS.find(([k]) => k === folder)?.[2] ?? (() => true);
  const shown = rows.filter(filter);
  const open = openId ? rows.find((a) => a.id === openId) ?? null : null;
  const openSrc = open ? libSrc(open) : null;
  const openType = open ? previewType(open.name, open.kind, open.inline_content ?? '') : null;
  return (
    <div className="mklibwrap">
      <div className="mklibbar">
        <div className="folderchips" role="tablist" aria-label="Library folders">
          {MK_FOLDERS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={folder === k} className={folder === k ? 'on' : ''} onClick={() => { setFolder(k); setOpenId(null); }}>{l}</button>
          ))}
        </div>
        <span className="mklibcount">{shown.length} {shown.length === 1 ? 'item' : 'items'}</span>
      </div>
      {shown.length === 0 && <div className="empty">Nothing here yet — the crew's docs, images and clips land as they're produced.</div>}
      <div className="mklibgrid">
        {shown.map((a) => (
          // a div, not a button: a preview holds an iframe/video, which no button may contain
          <div key={a.id} role="button" tabIndex={0} className={`mklibtile${openId === a.id ? ' on' : ''}`} title={a.name}
            onClick={() => setOpenId(openId === a.id ? null : a.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(openId === a.id ? null : a.id); } }}>
            <span className="mklthumb"><LibPreview art={a} /></span>
            <span className="mklmeta">
              <b>{a.name}</b>
              <span>{a.kind}{a.promoted ? ' · ★' : ''} · {new Date(a.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
            </span>
          </div>
        ))}
      </div>
      {open && (openSrc || open.inline_content) && (
        <DocOverlay title={open.name} file={{ name: open.name, content: open.inline_content ?? '' }} onClose={() => setOpenId(null)}>
          {(open.mime ?? '').startsWith('video/') && openSrc
            ? <video className="mklibfull" src={openSrc} controls autoPlay />
            : openType === 'image'
              ? <img className="mklibfull" src={openSrc ?? open.inline_content!} alt={open.name} />
              : openType === 'html'
                // full size, so the mockup runs its own scripts — the docs/14 review contract
                ? <iframe className="apvframe" sandbox="allow-scripts" srcDoc={themedMockupDoc(open.inline_content!)} title={open.name} />
                : openType === 'diff'
                  ? <DiffView text={open.inline_content!} />
                  : openType === 'markdown'
                    ? <div className="plBody"><Md text={open.inline_content!} /></div>
                    : <pre className="mklibraw">{open.inline_content}</pre>}
        </DocOverlay>
      )}
    </div>
  );
}
