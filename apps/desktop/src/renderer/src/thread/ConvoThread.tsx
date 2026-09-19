// What hangs off a message — attachments, a whiteboard snapshot card, a dropped document.
// Split out of thread/convo.tsx.

import { BrainNotice } from './BrainNotice';
import { AgentGhost } from './AgentGhost';
import { WaitGhost } from './WaitGhost';
import { useConvoPresence } from './convo-presence';
import { AttachButton, AttachTray, consumeWbAttach, useAttachments } from '../composer/attach';
import { AttachLightbox } from './AttachLightbox';
import { BrainChip } from '../brain/BrainChip';
import { ComposerInput } from '../composer/ComposerInput';

import { DeliveryStrip } from './DeliveryStrip';
import { IconClose, IconPaperclip, IconReply, IconRoutineClock, IconSend, IconSkill, IconWorkbench } from '../ui/icons';

import { MentionButton, ThreadCrumb, ThreadRoomChip, ThreadRootPin, ThreadSettleBtn, ThreadStatusChip, TypistChip, filesFromPaste, groupByMessage, streamContent, type ComposerPerson, type HeadStatus, type PostVCard, useDropZone } from './parts';

import { PostPreviewModal } from '../marketing/PostPreviewModal';
import { RunCard } from './RunCard';
import { RunDock, ThreadLiveBar } from './ThreadLiveBar';
import { SocialPostCard, postCardsFrom } from '../marketing/SocialPostCard';
import { StreamBubble } from './StreamBubble';

import { RailSections, RailToks } from './ThreadRail';

import { agentInChannel, groupDeliveries, isPostsFile, parseBrainOverride, renderableDeliverables, threadModeOf, threadTitle, type ThreadMode } from '@neuramesh/shared';
import { agentLive } from '../lib/presence';
import { answersResolver } from '../answers';


import { isWatchableRun, runTrees, type RunTree } from '../runs/runs';

import { nm as nmBridge } from '../bridge/nm';


import { suggestionTarget, type TaskRefInfo } from '../cards/parse';

import { type AgentRow, type MachineRow, type MemberRow } from '../bridge/rows-crew';
import { type ArtifactUI, type AttachmentRow, type DecisionAllRow, type TaskAllRow } from '../bridge/rows-board';
import { type ChannelArtifactRow, type MessageRow, type ThreadRow } from '../bridge/rows-rooms';
import { type SkillPackRow, type SkillRow } from '../bridge/rows-content';
import { useAgentStream, useRuns, useStreamOwners } from './hooks';
import { createPortal } from 'react-dom';
import { CapGate } from '../compute/CapGate';
import { HostedGate } from '../shell/HostedGate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ThreadMessage } from './ThreadMessage';
import { BrandSections } from './../marketing/BrandSections';
import { useThreadPosts } from './usePosts';
import { useOwnedUnitPosts } from './useOwnedUnitPosts';
import { convoArtifactSection, useThreadArtifacts } from './useArtifacts';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export function ConvoThread({ threadId, back, thread, channelId, channelSlug, channelKind, channelMarketing, agents, machines, members, selfEmail, people, skills, packs, plan, decisions, railSlot, onWorkbench, wbOpen, onToggleWorkbench, onUpgrade, onClose, onActivity, onUpgradeReason, onSeeUsage, taskRef, onOpenTask, onOpenDoc, onOpenArticle, onOpenWhiteboard, brainProject, crumbProject, onSetProjectPack, onBrainConnect, marks, onSettle, hostedGate }: {
  threadId: string;
  /** what this conversation is doing, and the act its stamp offers (shell/rowstatus.ts) */
  marks?: HeadStatus | null; onSettle?: (threadId: string) => void;
  /** the Workbench's Details slot when it is open on that face — this thread's sections portal
   *  in there and nowhere else (2026-08-17; see ThreadRail's note) */
  railSlot?: HTMLElement | null;
  /** OPEN the Workbench (the RailToks door while the panel is shut) — the toggle itself lives on the tab row now */
  onWorkbench?: () => void; wbOpen?: boolean; onToggleWorkbench?: () => void; // + the Workbench card's state and its header toggle (rail-ink round 3)
  /** where the back crumb goes — the room's list, or Home when the session was opened there */
  back: string;
  thread: ThreadRow | null; // null during the optimistic window before the server-born row syncs down
  channelId: string;
  channelSlug: string;
  channelKind?: string | null; // 'marketing' opens the brand-docs rail (round 6)
  channelMarketing?: string | null; // the room profile json for the rail's connections
  agents: AgentRow[];
  machines: MachineRow[];
  members: MemberRow[];
  selfEmail?: string | null;
  people: ComposerPerson[];
  skills: SkillRow[];
  packs: SkillPackRow[];
  plan: string; /** a free hosted workspace (shell/hostedrule.ts): the gate card docks where the composer stood */ hostedGate?: boolean;
  decisions: DecisionAllRow[]; // the channel's non-task nmq-card state — answers land + collapse here too
  onUpgrade: (reason: string) => void;
  onClose: () => void;
  onActivity?: (a: AgentRow) => void;
  /** the cap gate's two doors: open the shared upgrade surface with the cap as its reason, and
   *  open Compute. Both are App-level surfaces, so the thread only forwards the intent. */
  onUpgradeReason: (reason: string) => void;
  onSeeUsage: () => void;
  taskRef?: (n: number) => TaskRefInfo | null;
  onOpenTask?: (id: string) => void;
  /** docs/36 §6 — a brand doc is a FILE: it opens as a tab and stays there while you keep typing */
  onOpenDoc?: (d: { label: string; file: string; doc: string }) => void;
  /** the ‹article:id› card's Open — the reading tab (article round) */
  onOpenArticle?: (a: import('./ArticleCard').ArticleOpen) => void;
  /** docs/10 §15 — the brain chip's inputs. A plain conversation is the PUREST case of "who am I
   *  actually talking to", and it was the one thread that could not answer it. */
  brainProject?: { id: string; name: string; pack: string | null } | null;
  /** the thread's project, for the header place-crumb (project › #room) */
  crumbProject?: { name: string; logo_url?: string | null } | null;
  onSetProjectPack?: (packId: string) => Promise<void>;
  onBrainConnect?: () => void;
  onOpenWhiteboard?: (b: { id: string; title: string }) => void;
  onApproveDoc?: (file: string) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<MessageRow[]>([]);
  useEffect(() => (nm ? nm.watchConvo(threadId, setRows) : undefined), [threadId]);
  // who's working IN this conversation (thread-keyed emit): presence from the wake,
  // content once tokens flow
  const stream = useAgentStream(`${channelId}:${threadId}`);
  const streaming = streamContent(stream);
  // who is streaming WHERE — the thread-blind fallback below reads it (2026-08-10)
  const streamOwners = useStreamOwners();
  const [draft, setDraft] = useState('');
  const [attachedSkill, setAttachedSkill] = useState<{ name: string; pack?: string | null } | null>(null);
  const atts = useAttachments(plan, onUpgrade);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [rows.length, stream?.text]);
  const [cfocus, setCfocus] = useState(0); // ⌥-click on a pill drops its text here to edit
  const [cmention, setCmention] = useState(0); // nonce → the @ button types "@" + opens the picker
  // Attachments, both directions. A conversation could always SEND an image and never show you
  // the one you sent: the task thread rendered `MsgAttachments` and opened a lightbox, and this
  // surface simply never got the same wiring. Same for dragging a file in. Neither was a rule —
  // they are the audit's "withheld for no reason" rows (mockups/one-thread.html §01).
  const [convoAtts, setConvoAtts] = useState<AttachmentRow[]>([]);
  const convoAttByMsg = useMemo(() => groupByMessage(convoAtts), [convoAtts]);
  const [convoLightbox, setConvoLightbox] = useState<AttachmentRow | null>(null);
  useEffect(() => {
    if (!nm) { setConvoAtts([]); return undefined; }
    setConvoAtts([]);
    return nm.watchConvoAttachments(threadId, setConvoAtts);
  }, [threadId]);
  const convoDrop = useDropZone(atts.addFiles);
  const { mkPosts, mkImageReady, mkPreview, setMkPreview, mkReplyTo, setMkReplyTo, setMkTick } = useThreadPosts(threadId, rows.length);
  // the post cards of the content units this conversation OWNS (release drafts §4.5), and the one
  // armed pill: whichever kind of card asked for changes, the composer reads it from here
  const units = useOwnedUnitPosts(threadId, rows);
  const armed = mkReplyTo ?? units.replyTo;
  const convoArts = useThreadArtifacts(threadId, rows.length);
  // docs/34 — this conversation's mode, and the human's flip. The thread row is the truth
  // (synced, so every machine agrees); `pending` is the optimistic value while the command
  // round-trips, so the chip never reads stale for the second it takes to land.
  const [pendingMode, setPendingMode] = useState<ThreadMode | null>(null);
  const mode: ThreadMode = pendingMode ?? threadModeOf(thread?.mode);
  useEffect(() => { setPendingMode(null); }, [thread?.mode]); // the synced row won — drop the guess
  const sugTarget = useMemo(() => suggestionTarget(rows, agents), [rows, agents]);
  // the server names the thread at birth (shared heuristic); until its row syncs down,
  // derive the same title locally from the first message — identical by construction
  const title = thread?.title || (rows[0]?.body ? threadTitle(rows[0].body) : 'New thread');
  const send = async () => {
    const body = draft.trim();
    const attSpecs = atts.specs();
    if ((!body && !attSpecs.length) || atts.busy || !nm) return;
    const marker = attachedSkill ? `‹skill:${attachedSkill.name}${attachedSkill.pack ? `@${attachedSkill.pack}` : ''}› ` : '';
    const msgId = atts.msgId();
    setDraft('');
    setAttachedSkill(null);
    atts.reset();
    // "Request changes" on a draft card arms the composer, and the ↩ prefix is what tells the
    // agent WHICH card — the same sentence shape a content task uses, minus the task number a
    // conversation doesn't have; a unit's card keeps its number (#1142·c, TaskThread's form).
    // The agent answers it with revise_posts, in place.
    const prefix = mkReplyTo ? `↩ Re draft ${mkReplyTo.letter}: ` : units.replyTo ? `↩ Re #${units.replyTo.number}·${units.replyTo.letter}: ` : '';
    setMkReplyTo(null); units.setReplyTo(null);
    await nm.send(channelId, prefix + marker + consumeWbAttach(body), { id: msgId, attachments: attSpecs, threadId });
  };
  // answered nmq cards collapse to ✓ lines here exactly as in the room feed — replies in
  // this conversation + the authoritative decision rows both count
  const convoAnswers = useMemo(() => answersResolver(rows, decisions), [rows, decisions]);
  // a chat doc-card expanded into the shared reader overlay (round 5)
  // Runs (docs/29): work that outlives a reply renders as a card IN the transcript, in the
  // order it started — so scrolling back replays how the answer was actually produced.
  const runRows = useRuns(channelId);
  const trees = useMemo(() => runTrees(runRows, { threadId }).filter(isWatchableRun), [runRows, threadId]);
  // who is live here: the working ghost, the wait ghost that precedes it, and the run cards that
  // outrank both. One derivation, because the typist chip below has to agree with all three.
  const { ghostAgent, waitGhost, carded } = useConvoPresence({ rows, agents, machines, channelId, threadId, runRows, trees, stream, streaming, streamOwners });
  // The drafted posts, in the transcript where they were handed over. Originals land as ONE strip
  // at the first draft's time; a revision rides its own strip after the reply that asked for it,
  // so scrolling back replays the review round rather than showing only the final copy.
  const mkCards = useMemo(() => postCardsFrom(mkPosts, rows), [mkPosts, rows]);
  const stream1 = useMemo(() => {
    const originals = mkCards.filter((c) => !c.isRevision);
    const items: Array<{ at: string; msg?: MessageRow; tree?: RunTree; strip?: PostVCard[]; unit?: TaskAllRow; delivery?: ChannelArtifactRow[]; key?: string }> = [
      ...rows.map((m) => ({ at: m.created_at, msg: m })),
      ...trees.map((t) => ({ at: t.run.started_at, tree: t })),
      ...(originals.length
        ? [{ at: new Date(Math.min(...originals.map((c) => c.anchor))).toISOString(), strip: originals, key: 'drafts' }]
        : []),
      // deliverable strips (docs/30) — a conversation produces real files and could only ever
      // LIST them; the task thread has carded them all along. Same grouping, same de-dupe: echoes
      // of messages already on screen drop, and so does the wire file when its posts card.
      ...groupDeliveries(renderableDeliverables(
        convoArts
          .filter((a) => !(mkCards.length > 0 && isPostsFile(a.name)))
          // a message-attached IMAGE is an attachment, not a file drop: it already renders as
          // the message's preview canvas (msgatts thumb → lightbox). Letting it into the
          // delivery lane painted it a second time through .filecanvas.none — the deliberately
          // unbounded task-evidence frame — which is the full-bleed blowout share_images hit
          // live (George, 2026-08-19). Task threads keep their full-width evidence renders.
          .filter((a) => !(a.mime ?? '').startsWith('image/'))
          .map((a) => ({ id: a.id, name: a.name, kind: a.kind, content: a.inline_content, createdAt: a.created_at })),
        rows.map((m) => m.body),
      )).flatMap((batch) => {
        const rowArts = batch.map((b) => convoArts.find((a) => a.id === b.id)).filter((a): a is ChannelArtifactRow => !!a);
        return rowArts.length ? [{ at: rowArts[rowArts.length - 1]!.created_at, delivery: rowArts, key: `delivery-${rowArts[0]!.id}` }] : [];
      }),
      ...mkCards.filter((c) => c.isRevision).map((c) => ({ at: new Date(c.anchor).toISOString(), strip: [c], key: `rev-${c.key}` })),
      // an owned content unit's drafts (release drafts §4.5): one strip per unit, under its completion note
      ...units.strips.map((s) => ({ at: s.at, strip: s.cards, unit: s.unit, key: `unit-${s.unit.id}` })),
    ];
    return items.sort((a, b) => a.at.localeCompare(b.at));
  }, [rows, trees, mkCards, units.strips]);
  return (
    <aside
      className="threadpanel convo"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="thead">
        {/* the crumb IS the way back (docs/35 §3.4): a session replaced the list, so the header
            says what it replaced rather than offering an ✕ that looks like "discard" */}
        <button className="scrumb" title="back — Esc" aria-label={`Back to ${back}`} onClick={onClose}>‹ {back}</button>
        {/* where this thread LIVES — project › #room, on the left with the other wayfinding
            (George, 2026-08-09). The lone top-right room tag retired with it; the Tasks/Chat
            mode chip stays gone (founder, 2026-08-06). */}
        <ThreadCrumb project={crumbProject} slug={channelSlug} />
        {/* the chip is identity: this conversation's word, the one the rail row and ⌘Y wear */}
        <span className="convotitle" title={title}>{title}</span><ThreadStatusChip head={marks} />
        {/* a routine's run says so in the header (2026-08-22, George) — the same quiet pill the
            setup task wears, so "opened by an automation, runs hands-off" is one glance */}
        {thread?.schedule_id ? <span className="routinechip" title="Opened by a scheduled routine — it runs hands-off"><IconRoutineClock s={10} /> routine</span> : null}
        {/* Settle leads the act cluster; the Workbench card lives inside this thread (rail-ink round 3) */}
        <div className="theadact"><ThreadSettleBtn head={marks} onSettle={onSettle} />{onToggleWorkbench && <button className={`navpin${wbOpen ? ' on' : ''}`} aria-pressed={!!wbOpen} title={wbOpen ? 'Hide the Workbench — ⌘P' : 'Show the Workbench — ⌘P'} aria-label={wbOpen ? 'Hide the Workbench' : 'Show the Workbench'} onClick={onToggleWorkbench}><IconWorkbench s={14} /></button>}</div>
      </div>
      {/* what the Details face holds, while it is shut (see ThreadRail's note) */}
      {!railSlot && onWorkbench && (
        <RailToks
          sections={convoArtifactSection(convoArts)}
          extraLabel={channelKind === 'marketing' ? 'brand' : null}
          label="Thread details"
          onOpen={onWorkbench}
        />
      )}
      <ThreadLiveBar trees={trees} agents={agents} />
      <div className="convobody">
      <div className="convomain">
      <div className="tmsgs convomsgs" ref={listRef}>
        <ThreadRootPin thread={thread} rows={rows} agents={agents} members={members} />
        {rows.length === 0 && !stream && <div className="tempty">Say the word — the channel's agents see this thread.</div>}
        {stream1.map((it) => {
          if (it.tree) return <RunCard key={it.tree.run.id} tree={it.tree} agent={agents.find((a) => a.id === it.tree!.run.agent_id) ?? null} onActivity={onActivity} />;
          if (it.delivery) return (
            <DeliveryStrip
              key={it.key}
              arts={it.delivery.map((a) => ({ ...a, task_id: null } as unknown as ArtifactUI))}
              superseded={new Set<string>()}
              onOpen={(name) => { const a = it.delivery!.find((x) => x.name === name); if (a?.inline_content) onOpenDoc?.({ label: name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), file: name, doc: a.inline_content }); }}
            />
          );
          if (it.strip) return (
            <div className="mkdrafts" key={it.key}>
              <div className="mkdraftsgrid">
                {it.strip.map((c) => (
                  <SocialPostCard
                    key={c.key} item={c.item} channelSlug={channelSlug} letter={c.letter} taskNumber={it.unit?.number} onOpen={() => setMkPreview(c.item)}
                    version={c.version} superseded={c.superseded} imageReady={it.unit ? units.imageReady : mkImageReady}
                    onReply={c.superseded ? undefined : () => { if (it.unit) units.setReplyTo({ id: c.item.id, letter: c.letter, number: it.unit.number }); else setMkReplyTo({ id: c.item.id, letter: c.letter }); setCfocus((n) => n + 1); }}
                    // the marker is what the daemon acts on; the prose is for the transcript. A
                    // conversation names the letter, having no task number to borrow; a unit's card
                    // posts into the UNIT's own thread, where the agent that drew it listens.
                    onGenerateImage={c.superseded ? undefined : (redraw, kind) => { const ask = kind === 'video' ? `Film the hook for draft ${c.letter}.‹gen-video:${c.item.id}›` : `${redraw ? 'Redraw' : 'Generate'} the image for draft ${c.letter}.‹gen-image:${c.item.id}›`; void (it.unit ? nm?.sendThread(it.unit.id, channelId, ask) : nm?.send(channelId, ask, { threadId })); }}
                  />
                ))}
              </div>
            </div>
          );
          const m = it.msg!;
          return (
            <ThreadMessage
              key={m.id}
              m={m} agents={agents} members={members} selfEmail={selfEmail} channelId={channelId}
              atts={convoAttByMsg.get(m.id) ?? []} onOpenAtt={setConvoLightbox}
              answers={convoAnswers(m.id)} decisions={decisions}
              onAnswerPost={(txt) => void nm?.send(channelId, txt, { threadId })}
              taskRef={taskRef} onOpenTask={onOpenTask} onOpenWhiteboard={onOpenWhiteboard} onOpenDoc={onOpenDoc} onOpenArticle={onOpenArticle}
              suggestions={!stream && sugTarget === m.id
                ? { onPick: (t) => void nm?.send(channelId, t, { threadId }), onEdit: (t) => { setDraft(t); setCfocus((n) => n + 1); } }
                : null}
            />
          );
        })}
        {ghostAgent && <AgentGhost key={ghostAgent.id} agent={ghostAgent} onActivity={onActivity} />}
        {/* NOBODY IS WORKING YET, AND THE THREAD STILL SAYS SO (docs/26 §5). On the browser this
            is the only orb for the first seconds of every message: with no local stream, the
            working ghost cannot mount until `thinking` has made a round trip to the runner. */}
        {!ghostAgent && (
          /* Retry = say it again, which is what a person does anyway. It re-fires the daemon's
             live message watch AND re-bumps the machine, so it uses the proven path rather than
             a second one nobody exercises. The duplicate in the transcript is the truth. */
          <WaitGhost found={waitGhost} onRetry={async () => { await nm?.send(channelId, rows[rows.length - 1]?.body ?? '', { threadId }); }} />
        )}
        {streaming && <StreamBubble live={streaming} />}
      </div>
      <div className="tcompose">
        <RunDock trees={trees} agents={agents} onOpen={onActivity} scrollRef={listRef} />
        {(() => {
          // who's on it: the live streamer (precise) + this room's THINKING agents — a chat
          // wake holds 'thinking', so this is the "responding right now" set; 'working' means
          // a claimed task elsewhere and must not bleed into a fresh conversation
          const busy = agents.filter((a) => a.status === 'thinking' && agentLive(a, machines) && agentInChannel(a.channel_ids, channelId));
          const streamer = stream ? agents.find((a) => a.name === stream.agent) ?? null : null;
          // card › ghost › chip — the precedence the task panel already encodes. The ghost is
          // selected by the SAME predicate as `busy`, so without this filter every ghost was
          // narrated twice: once as a card in the transcript, once as a chip on the composer,
          // each offering its own door to the one activity log. An agent an open run card
          // already names is spoken for too. What survives is the case neither covers — an
          // agent `working` a claimed task elsewhere, which mints no ghost in this room.
          const spokenFor = new Set<string>([
            ...(ghostAgent ? [ghostAgent.id] : []),
            // the WAIT ghost speaks for its agent too, and it is on screen exactly when the
            // working one is not — without this the row said "rex · thinking…" and the composer
            // said "rex is thinking" underneath it, at the same time (evidence shot, 2026-09-09)
            ...(!ghostAgent && waitGhost ? [waitGhost.agent.id] : []),
            ...carded,
          ]);
          const shown = busy.filter((a) => !spokenFor.has(a.id));
          const list = streamer && !spokenFor.has(streamer.id) && !shown.some((b) => b.id === streamer.id) ? [streamer, ...shown] : shown;
          if (!list.length) return null;
          return (
            <div className="typingbar">
              {list.map((a) => {
                const label = streamer && a.id === streamer.id && stream!.text.trim() ? 'typing' : 'thinking';
                return <TypistChip key={a.id} name={a.name} label={label} onOpen={() => onActivity?.(a)} />;
              })}
              <span className="tdots"><i /><i /><i /></span>
            </div>
          );
        })()}
        {/* the ONE contextual gate above the composer (docs/25). It renders only when the
            workspace's machine is capped — the moment a message will not be answered and the
            person has no other way to find out. */}
        {/* the brain notice (docs/10 §15.7): a seat that cannot run, or runs on Starter here, said
            above the composer where a reply is typed — the card in the transcript scrolls away */}
        <BrainNotice rows={rows} override={parseBrainOverride(thread?.brain_override ?? null)} onReset={async () => { await nm?.threadSetBrain(threadId, null); }} />
        <CapGate onUpgrade={onUpgradeReason} onSeeUsage={onSeeUsage} />
        {hostedGate ? <HostedGate /> : (
        <div
          className={`cbox${convoDrop.dragging ? ' dropping' : ''}${armed ? ' armed' : ''}`}
          {...convoDrop.dropProps}
          onKeyDownCapture={(e) => { if (e.key === 'Escape' && armed) { e.stopPropagation(); setMkReplyTo(null); units.setReplyTo(null); } }}
        >
          {attachedSkill && (
            <div className="skillattach">
              <span className="skillchip"><IconSkill s={12} /> skill: {attachedSkill.name}{attachedSkill.pack ? ` · ${attachedSkill.pack}` : ''}</span>
              <button className="skillattachx" title="remove" onClick={() => setAttachedSkill(null)}><IconClose s={12} /></button>
            </div>
          )}
          {/* the armed "request changes" pill — the card it belongs to, named, so a long reply
              never loses which draft it is about */}
          {armed && (
            <div className="skillattach">
              <span className="skillchip modechip"><IconReply s={12} /> Request changes · {'number' in armed ? `#${armed.number}·${armed.letter}` : `draft ${armed.letter}`}</span>
              <button className="skillattachx" title="cancel — esc" onClick={() => { setMkReplyTo(null); units.setReplyTo(null); }}><IconClose s={12} /></button>
            </div>
          )}
          <AttachTray items={atts.items} onRemove={atts.remove} />
          <ComposerInput
            value={draft}
            onChange={setDraft}
            onSend={() => void send()}
            people={people}
            skills={skills}
            packs={packs}
            attachedSkill={attachedSkill}
            onPickSkill={setAttachedSkill}
            onClearSkill={() => setAttachedSkill(null)}
            onOpenSkills={() => {}}
            onPaste={(e) => { const fs = filesFromPaste(e); if (fs.length) { e.preventDefault(); atts.addFiles(fs); } }}
            placeholder={armed ? `What should change on draft ${armed.letter}? · esc cancels` : mode === 'chat' ? 'Ask anything — ↵ send' : 'Reply — @ mention · / skill · ↵ send'}
            focusSignal={cfocus}
            mentionSignal={cmention}
          />
          <div className="trow">
            <MentionButton onMention={() => setCmention((n) => n + 1)} />
            <AttachButton onFiles={atts.addFiles} count={atts.count} max={atts.limits.maxPerMessage} />
            <ThreadRoomChip slug={channelSlug} />
            {/* the same chip the task composer carries — the override it edits belongs to THIS
                thread, and `threads.brain_override` is already synced onto the row we hold */}
            <BrainChip
              onConnect={onBrainConnect ?? (() => {})}
              project={brainProject ?? null}
              onSetProjectPack={onSetProjectPack}
              thread={{ id: threadId, label: title, override: parseBrainOverride(thread?.brain_override ?? null) }}
              castAgents={agents.filter((a) => agentLive(a, machines) && agentInChannel(a.channel_ids, channelId))}
              onSetThreadBrain={async (override) => { await nm?.threadSetBrain(threadId, override as Record<string, string> | null); }}
            />
            <button className="btn primary tsend" disabled={(!draft.trim() && !atts.count) || atts.busy} onClick={() => void send()} aria-label={atts.busy ? 'Uploading attachments' : 'Send reply'} data-tip="Send · ↵">{atts.busy ? '…' : <IconSend s={20} />}</button>
          </div>
          {convoDrop.dragging && <div className="drophint"><IconPaperclip s={15} /> Drop to attach</div>}
        </div>
        )}
      </div>
      </div>
      {/* THE CONVERSATION'S DETAILS (2026-08-17) — into the WORKBENCH, exactly as the task
          thread's do. This is the half of the 2026-08-16 round that never landed: this component
          mounted `<ThreadRail>` inline and unconditionally, so a content thread drew Brand docs ·
          Upcoming · Connections inside the sheet, three inches from the panel built to hold them —
          and opening the Workbench put a second panel at the same edge. Same portal, same
          `RailSections`, same toks when it is shut. */}
      {(() => {
        if (!railSlot) return null;
        const extra = channelKind === 'marketing'
          ? <BrandSections channelId={channelId} channelSlug={channelSlug} onOpen={(d) => onOpenDoc?.(d)} marketing={channelMarketing} />
          : null;
        return createPortal(<RailSections sections={convoArtifactSection(convoArts, onOpenDoc)} extra={extra} />, railSlot);
      })()}
      </div>
      {/* approve · schedule · edit · delete — the human's own surface, unchanged from the task
          panel's. Agents draft; every mutation in here is theirs. */}
      {convoLightbox && <AttachLightbox att={convoLightbox} onClose={() => setConvoLightbox(null)} />}
      {mkPreview && (
        <PostPreviewModal
          item={mkPreview}
          channelSlug={channelSlug}
          channelId={channelId}
          projectName={crumbProject?.name ?? null}
          onClose={() => setMkPreview(null)}
          onChanged={() => { setMkPreview(null); setMkTick((n) => n + 1); units.setTick((n) => n + 1); }}
        />
      )}
    </aside>
  );
}
