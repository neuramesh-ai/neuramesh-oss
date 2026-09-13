// The small parts a thread is made of — the crumb, the room chip, the pinned root, the
// typist chip, and the handful of helpers that group and read messages.
// Extracted from App.tsx (track A3).
import { AgentAvatar, ProjLogo } from '../components/AgentAvatar';
import { IconCheckCircle, IconLock, IconReply } from '../ui/icons';
import { Orb } from '../ui/Orb';
import { humanHandles, replyPreview, THREAD_STATUS_LABEL, type ThreadStatus } from '@neuramesh/shared';
import { selfLabel } from '../lib/self';
import { timeAgo } from '../lib/time';
import { type AgentRow, type MemberRow } from '../bridge/rows-crew';
import { type AttachmentRow } from '../bridge/rows-board';
import { type ContentItemRow } from '../bridge/rows-content';
import { type MessageRow, type ThreadRow } from '../bridge/rows-rooms';
import { useRef, useState } from 'react';

// ── ComposerInput — ONE input for the channel box and the task-thread reply box ──
// Owns what used to be forked (or missing) per composer: the @ suggestion popup, the
// `/` skill picker, keyboard nav, and the live mention highlight. The highlight is a
// backdrop twin: the textarea's ink goes transparent (caret kept) and an identical
// pre-wrap div behind it renders the tokenized draft, so styling can never desync
// from the text. Tokens come from the SAME shared tokenizer the daemon wakes on —
// a name lights up iff sending will reach that teammate.
// `name` is the mention token (agents: their name; humans: the handle humanHandles
// derives); `label` is a human's display name, shown beside the handle in the popup.
export interface ComposerPerson { name: string; kind: 'agent' | 'human'; here: boolean; role?: string | null; emoji?: string | null; label?: string }

// Drag-and-drop onto a composer. Tracks enter/leave depth so the highlight doesn't flicker over
// child elements. Window-level dragover/drop is prevented in App so a stray drop can't navigate.
export function useDropZone(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  const dropProps = {
    onDragEnter: (e: React.DragEvent) => { if (hasFiles(e)) { e.preventDefault(); depth.current++; setDragging(true); } },
    onDragOver: (e: React.DragEvent) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); depth.current = 0; setDragging(false); if (e.dataTransfer.files?.length) onFiles(Array.from(e.dataTransfer.files)); },
  };
  return { dragging, dropProps };
}

// Pull image/file objects off a paste event (screenshot paste, copied files).
export function filesFromPaste(e: React.ClipboardEvent): File[] {
  return Array.from(e.clipboardData?.items ?? [])
    .filter((i) => i.kind === 'file')
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
}

// "@" on the composer's control row — the discoverable twin of typing the character. Mentions are
// the one composer affordance with no icon, so the only way to learn them was to read the
// placeholder; this makes the roster one click away.
export function MentionButton({ onMention }: { onMention: () => void }) {
  return (
    <button type="button" className="attachbtn" data-tip="Mention a teammate · @" aria-label="Mention a teammate" onClick={onMention}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="3.6" /><path d="M15.6 8.4v4.9a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7" />
      </svg>
    </button>
  );
}

// ── Chat attachments (display side) ───────────────────────────────────────────
export function groupByMessage(atts: AttachmentRow[]): Map<string, AttachmentRow[]> {
  const m = new Map<string, AttachmentRow[]>();
  for (const a of atts) { const arr = m.get(a.message_id); if (arr) arr.push(a); else m.set(a.message_id, [a]); }
  return m;
}

/** the growing bubble only exists once tokens flow — empty presence draws the ghost instead */
export function streamContent(s: { agent: string; text: string } | null): { agent: string; text: string } | null {
  return s && s.text.trim() ? s : null;
}

// The humans a composer can address: every workspace member, mentioned by the handle
// humanHandles derives (display names carry spaces/case the [\w-] mention grammar can't
// hold). The self row resolves through selfLabel so its handle matches the name the
// roster panel shows; a member with no display name yet has nothing to derive from and
// simply isn't suggestible. `agentNames` (the active roster) is reserved so a member
// can never shadow an agent summon. Humans are workspace-wide, so `here` is always true
// (they're never woken — the daemon only tests agent names).
export function memberPeople(members: MemberRow[], agentNames: string[], selfId?: string | null, selfEmail?: string | null): ComposerPerson[] {
  const labels = members.map((m) => (m.user_id === selfId ? selfLabel(m.display_name, selfEmail) : m.display_name));
  return humanHandles(labels, agentNames).map((h) => ({ name: h.name, kind: 'human' as const, here: true, label: h.label }));
}

export function KindChip({ kind }: { kind?: string | null }) {
  if (!kind) return null;
  return <span className={`kindchip k-${kind}`} title={`work type: ${kind}`}>{kind}</span>;
}

/**
 * THE OPEN THREAD'S STATUS AND ITS ONE ACT (settle round, 2026-09-09, George: "also the thread").
 *
 * The phone has carried a Settle pill in the thread head since the thread-status round; the
 * desktop and the web carried none, so an open thread could only be settled from the rail, the
 * bell or ⌘Y. Both heads render THIS — a chat session and a task session answer "what is this
 * doing" and "how do I put it down" the same way, as docs/35 §3.4 already requires of the crumb.
 *
 * The chip sits with the other identity, the button with the other head controls. `settle` comes
 * from the shared derivation, so the button is absent when a stamp would move nothing — and there
 * is no reverse button: unsettle is the undo on the settle toast (George, 2026-09-09).
 */
export interface HeadStatus {
  status: ThreadStatus;
  /** whether a settle would move anything — false hides the button (shared canSettle) */
  settle: boolean;
  /** the thread the act writes to — a task's own, which its TaskRow does not carry */
  threadId: string;
}

export function ThreadStatusChip({ head }: { head?: HeadStatus | null }) {
  if (!head) return null;
  return <span className={`chip st-${head.status}`}>{THREAD_STATUS_LABEL[head.status]}</span>;
}

export function ThreadSettleBtn({ head, onSettle }: { head?: HeadStatus | null; onSettle?: (threadId: string) => void }) {
  if (!head?.settle || !onSettle) return null;
  return (
    <button
      type="button"
      className="btn sm theadsettle"
      title="Settle — the thread leaves Needs you. It is not an accept, and the board does not move."
      onClick={() => onSettle(head.threadId)}
    ><IconCheckCircle s={12} />Settle</button>
  );
}

// A drafted post rendered inline in its content task's thread (marketing-workflow §4.5): the
// platform-native preview + a STABLE id (#task·letter) + status chip. Read-only here — every
// mutation opens the human PostPreviewModal below (agents draft, humans publish).
// A shimmering placeholder at the tail of the strip while the marketer is still drafting — a
// "canvas of dots" sketching the next post, with N-of-M progress when the ask named a count.
export function DraftingCard({ done, total }: { done: number; total: number }) {
  const label = total > done ? `drafting post ${done + 1} of ${total}…` : total ? 'wrapping up…' : 'drafting the next post…';
  return (
    <div className="mkpostcard mkdrafting" aria-label={label}>
      <div className="mkdftghd"><span className="mkdftgspin" />{label}</div>
      <div className="mkdftgbody">
        <span className="skel-bar" style={{ width: '82%' }} />
        <span className="skel-bar" style={{ width: '95%' }} />
        <span className="skel-bar" style={{ width: '68%' }} />
        <div className="mkdftgcanvas">{Array.from({ length: 24 }, (_, i) => <span key={i} className="mkdftgdot" style={{ animationDelay: `${(i % 8) * 90}ms` }} />)}</div>
      </div>
      {total > 0 && <div className="mkdftgpips">{Array.from({ length: total }, (_, i) => <span key={i} className={`mkdftgpip${i < done ? ' on' : i === done ? ' now' : ''}`} />)}</div>}
    </div>
  );
}

/**
 * One drafted post as the transcript sees it: which letter it wears, which version, and WHERE it
 * belongs in the scroll.
 *
 * Shared by the task thread and the conversation thread (0115) because the letters are the
 * vocabulary the human and the agent both use — "reschedule b" has to mean the same card on both
 * surfaces, and two derivations of the same list is how they'd stop meaning it. Letters come from
 * creation order over EVERY item, so a revision never re-letters its siblings.
 */
export type PostVCard = { key: string; item: ContentItemRow; letter: string; version: number; superseded: boolean; isRevision: boolean; anchor: number };

/**
 * ONE rail for a thread (docs/25 round 2 — mockups/one-thread.html).
 *
 * Replaces the facts line + at-most-one-drawer: requirements, artifacts, subtasks and the PR stop
 * being toks that open an accordion under the header and become sections of a panel that is always
 * in the same place. The rule is the whole design and it lives here rather than at each call site:
 * **a section renders only when it has rows, and the rail renders only when a section does** — so
 * a thread with nothing standing gets the full width and no tab stub to explain.
 *
 * Sections arrive from two independent sources — the THREAD's own state and the ROOM's context
 * (`extra`) — which is why there is no such thing as a "marketing thread": it is a room that
 * supplies brand docs and a thread that happens to hold drafts, composing in one panel.
 *
 * Geometry is `.mkrail`'s, unchanged, so the marketing room's panel is not a lookalike of this one
 * — it IS this one.
 */
export type RailSection = { key: string; head: string; meta?: string; warm?: boolean; body: React.ReactNode };

export function TypistChip({ name, label, onOpen }: { name: string; label: string; onOpen: () => void }) {
  return (
    <span className="typist clickable" role="button" tabIndex={0} title={`see @${name}'s session activity`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}>
      <AgentAvatar name={name} size={16} radius={5} /> {name} is {label}
      <Orb state="breathing" label={`${name} is ${label}`} />
      <span className="typistcue">view activity <span className="typistcuechev" aria-hidden="true">›</span></span>
    </span>
  );
}

/**
 * The message this thread hangs off, pinned so the answers have their question (docs/31).
 *
 * Shared, because the conversation had it and the task thread did not — and a task thread born
 * from a room message answers one just as much. Pinned ONLY when the root lives ELSEWHERE: a
 * conversation swallows its own opener, so its root IS rows[0], and pinning that drew a
 * "Replying to george" banner above george's own first message (founder screenshot, 2026-08-06).
 */
export function ThreadRootPin({ thread, rows, agents, members }: {
  thread: ThreadRow | null;
  rows: MessageRow[];
  agents: AgentRow[];
  members: MemberRow[];
}) {
  if (!thread?.root_message_id || !thread.root_body) return null;
  if (rows.some((r) => r.id === thread.root_message_id)) return null;
  const who = thread.root_author_kind === 'agent'
    ? agents.find((a) => a.id === thread.root_author_id)?.name ?? 'an agent'
    : members.find((x) => x.user_id === thread.root_author_id)?.display_name ?? 'you';
  return (
    <div className="rootmsg">
      <div className="rootlbl"><IconReply s={10} /> Replying to {who}{thread.root_at ? ` · ${timeAgo(thread.root_at)}` : ''}</div>
      <div className="rootbody">{replyPreview(thread.root_body, 260)}</div>
    </div>
  );
}

/**
 * The thread header's place-crumb: `[logo] project › #channel`, right after the back control
 * (George, 2026-08-09 — the mockup's anatomy). The room used to sit as a lone tag in the
 * header's far-right action cluster, where "where am I" read as an afterthought among icon
 * buttons; the crumb puts the whole path where every crumb lives, on the left, and the
 * top-right tag is gone.
 */
export function ThreadCrumb({ project, slug }: { project?: { name: string; logo_url?: string | null } | null; slug: string }) {
  if (!slug) return null;
  return (
    <span className="tcrumb" title={project ? `${project.name} · #${slug}` : `#${slug}`}>
      {project && (
        <>
          <ProjLogo logo={project.logo_url ?? null} name={project.name} size={13} />
          <span className="tcrumbname">{project.name}</span>
          <span className="tcrumbsep" aria-hidden>›</span>
        </>
      )}
      <span className="h" aria-hidden>#</span>{slug}
    </span>
  );
}

/**
 * The thread composer's room — a chip that is deliberately NOT a control (2026-08-09).
 *
 * A thread's channel is frozen at birth (threads.mode and the room both are), so inside a
 * thread the composer used to show no room at all — the one surface where you type had no
 * answer to "where does this go". Showing it as the pickable chip the Home launcher wears
 * would promise a move the server refuses; hiding it left the question. So: same chip anatomy,
 * no chevron, a lock, and a title that says WHY rather than going quiet. Disabled controls
 * that explain themselves read as facts; ones that don't read as broken.
 */
export function ThreadRoomChip({ slug }: { slug: string }) {
  return (
    <span className="cchips">
      <span className="cchip roomlocked" title="A thread stays in the room it was born in" aria-disabled="true">
        <span className="rlk" aria-hidden><IconLock s={9} /></span>
        <span className="h">#</span> {slug}
      </span>
    </span>
  );
}
