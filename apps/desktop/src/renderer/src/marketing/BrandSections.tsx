// Brand context in a thread — the marketing room's document rail and the sections it opens.
// A section renders a conversation, hence the import cycle with ConvoThread (see
// ThreadMessage.tsx for why that is safe). Split out of thread/convo.tsx.
import { BRAND_DOC_NAMES } from '@neuramesh/shared';
import { ConnectionsList } from '../settings/ConnectionsList';
import { Orb } from '../ui/Orb';
import { UpcomingList } from '../schedule/schedule';
import { nm as nmBridge } from '../bridge/nm';
import { type ChannelArtifactRow } from '../bridge/rows-rooms';
import { useEffect, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// The bootstrap's doc-drop message shape (agents.ts runMarketingBootstrap): header line +
// blank line + the full document. Recognizing it lets chat wear the doc as a bounded,
// internally-scrollable card instead of an endless message (round 5).
// The Brand-docs rail (rounds 6+9, the Helena shape): docs fill in live beside the
// conversation AND the room feed; while the crew writes, the dashed row names the doc
// actually in flight (parsed from the agent-activity narration, not a generic spinner).
/**
 * The ROOM's contribution to a thread's rail: brand docs, what's queued, which accounts are
 * connected. Markup only — no `<aside>`, no collapse button — because these are sections of the
 * one rail, not a rail of their own.
 *
 * Split out of `BrandDocsRail` (2026-08-08). It used to BE the rail, which is why a marketing
 * room's own content task had no brand docs on screen: the panel was mounted in `ConvoThread` and
 * the room home and nowhere else, so the moment work got tracked the voice and guidelines
 * vanished. Nobody wrote that rule; the component just got built once. Sections compose; rails
 * don't.
 */
export function BrandSections({ channelId, channelSlug, onOpen, marketing }: {
  channelId: string;
  /** scopes the drafting narration to THIS room's stream (LogRow.channel_slug) */
  channelSlug?: string;
  onOpen?: (d: { label: string; file: string; doc: string }) => void;
  marketing?: string | null; // the room profile json — the MCP toggle state
}) {
  const [docs, setDocs] = useState<ChannelArtifactRow[]>([]);
  const [writing, setWriting] = useState<{ file: string; at: number } | null>(null);
  useEffect(() => {
    const load = () => {
      // BRAND docs only (2026-08-22, George: result.md × 7, posts.json and article drafts had
      // buried the actual brand voice). Brand-ness is the `brand` tag stamped at generation;
      // the canonical name set keeps every doc written before tags existed. The old denylist
      // (round 3) is subsumed — a plan artifact was never going to pass an allowlist.
      const isBrand = (a: ChannelArtifactRow) => /\bbrand\b/.test(a.tags ?? '') || BRAND_DOC_NAMES.includes(a.name);
      void nm?.channelArtifacts(channelId).then((r) => setDocs(r.artifacts.filter((a) =>
        a.kind === 'doc' && !!a.inline_content && isBrand(a)))).catch(() => {});
    };
    load();
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [channelId]);
  // Subscribe UNCONDITIONALLY (round 3, second finding): the old gate was `ghostLive` — a
  // typist/status derivation that is false for the setup task's thread (no assignee), so the
  // live bootstrap drafted four docs with no ghost at all. The narration itself is the truth;
  // the slug scopes it to this room.
  useEffect(() => {
    const un = nm?.watchAgentLogs((row) => {
      if (channelSlug && row.channel_slug && row.channel_slug !== channelSlug) return;
      const mm = /^drafting (\S+\.md)/.exec(row.summary ?? '');
      if (mm) setWriting({ file: mm[1]!, at: Date.now() });
    });
    return () => un?.();
  }, [channelSlug]);
  // The doc landing retires the ghost; a stale signal (run died mid-doc) ages out. Round 3:
  // the row used to render for ANY live agent — "writing the next doc" over a playbook run
  // that writes no doc at all — so now only a fresh `drafting <file>` narration shows it.
  useEffect(() => {
    if (!writing) return undefined;
    if (docs.some((d) => d.name === writing.file)) { setWriting(null); return undefined; }
    const iv = setInterval(() => {
      setWriting((w) => (w && Date.now() - w.at > 4 * 60_000 ? null : w));
    }, 30_000);
    return () => clearInterval(iv);
  }, [writing, docs]);
  return (
    <>
      <div className="mkrailhead mkrailhead2">Brand docs</div>
      {docs.map((a) => (
        <button key={a.id} className="mkrailrow" title={a.name}
          onClick={() => onOpen?.({ label: a.name.replace(/\.md$/, '').replace(/-/g, ' '), file: a.name, doc: a.inline_content! })}>
          <span aria-hidden>📄</span>
          <b>{a.name}</b>
          <span className="when">{new Date(a.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </button>
      ))}
      {/* an agent is ALIVE here, so it wears the orb like every other live moment — this rail was
          still drawing the pre-orb border-spinner */}
      {writing && <div className="mkrailgen"><Orb state="composing" label={`writing ${writing.file}`} /> writing {writing.file}…</div>}
      <div className="mkrailhead mkrailhead2">Upcoming</div>
      <UpcomingList channelId={channelId} />
      <div className="mkrailhead mkrailhead2">Connections</div>
      <ConnectionsList channelId={channelId} marketing={marketing} />
    </>
  );
}

// `BrandDocsRail` retired 2026-08-17: the room home's standalone panel was the THIRD mounting of
// one surface (a task's aside, a chat's aside, and this). The room's sections now portal into the
// Workbench's Details face like every other subject's — see shell/workbench-state.ts.
