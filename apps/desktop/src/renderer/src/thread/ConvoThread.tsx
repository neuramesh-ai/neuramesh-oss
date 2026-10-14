import type { ConvoThreadProps } from './ConvoThreadProps';
import { overviewSourceFiles, overviewOutputFiles } from './overview-model';
import { ThreadOverviewBody, useThreadOverview } from './ThreadOverview';
import { artifactOverviewSection, sourceOverviewSection, runOverviewSection, threadStatusOverviewSection } from './overview-sections';
// What hangs off a message — attachments, a whiteboard snapshot card, a dropped document.
// Split out of thread/convo.tsx.

import { BrainNotice } from './BrainNotice';
import { AgentGhost } from './AgentGhost';
import { WaitGhost } from './WaitGhost';
import { useConvoPresence } from './convo-presence';
import { AttachButton, AttachTray, consumeWbAttach, useAttachments } from '../composer/attach';
import { AttachLightbox } from './AttachLightbox';
import { BrainChip } from '../brain/BrainChip';
import { SessionComposer } from '../composer/SessionComposer';

import { DeliveryStrip } from './DeliveryStrip';
import { IconClose, IconPaperclip, IconReply, IconSend, IconSkill } from '../ui/icons';

import { MentionButton, ThreadCrumb, ThreadRootPin, ThreadSettleBtn, TypistChip, filesFromPaste, groupByMessage, streamContent, type PostVCard, useDropZone } from './parts';

import { PostPreviewModal } from '../marketing/PostPreviewModal';
import { RunCard } from './RunCard';
import { RunDock, ThreadLiveBar } from './ThreadLiveBar';
import { SocialPostCard, postCardsFrom } from '../marketing/SocialPostCard';
import { StreamBubble } from './StreamBubble';

import { RailSections } from './ThreadRail';

import { agentInChannel, groupDeliveries, isPostsFile, parseBrainOverride, renderableDeliverables, splitSessionRuns, threadModeOf, threadTitle, type ThreadMode } from '@neuramesh/shared';
import { agentLive } from '../lib/presence';
import { answersResolver } from '../answers';


import { isWatchableRun, runTrees, type RunTree } from '../runs/runs';

import { nm as nmBridge } from '../bridge/nm';


import { suggestionTarget } from '../cards/parse';


import { type ArtifactUI, type AttachmentRow, type TaskAllRow } from '../bridge/rows-board';
import { type ChannelArtifactRow, type MessageRow } from '../bridge/rows-rooms';

import { useLandedGrace, useRuns, useThreadStream } from './hooks';
import { useStickToBottom } from './useStickToBottom';
import { createPortal } from 'react-dom';
import { CapGate } from '../compute/CapGate';
import { HostedGate } from '../shell/HostedGate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ThreadMessage } from './ThreadMessage';
import { BrandSections } from './../marketing/BrandSections';
import { useThreadPosts } from './usePosts';
import { useOwnedUnitPosts } from './useOwnedUnitPosts';
import { convoArtifactSection, useThreadArtifacts } from './useArtifacts';
import { convoArrivals, markerArrivals, useArrivals } from './useArrivals';
import { DraftsRow, DraftsTab, stripCards, useDraftsTab } from './DraftsPane';

import { RoutineChip, SessionRuns, draftStrips } from './SessionRuns';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export function ConvoThread({ threadId, back, thread, channelId, channelSlug, channelKind, channelMarketing, agents, machines, members, selfEmail, people, skills, packs, plan, decisions, railSlot, onDetails, onArrive, drafts, onUpgrade, onClose, onActivity, onUpgradeReason, onSeeUsage, taskRef, onOpenTask, onOpenDoc, onOpenArticle, onOpenWhiteboard, brainProject, crumbProject, onSetProjectPack, onBrainConnect, marks, onSettle, hostedGate }: ConvoThreadProps) {
  const [rows, setRows] = useState<MessageRow[]>([]);
  useEffect(() => (nm ? nm.watchConvo(threadId, setRows) : undefined), [threadId]);
  // who's working IN this conversation (thread-keyed emit): presence from the wake,
  // content once tokens flow
  const stream = useThreadStream(`${channelId}:${threadId}`, rows, (name) => agents.find((a) => a.name === name)?.id ?? null);
  const streaming = streamContent(stream);
  // the agent whose streamed reply just landed here: it is on screen as that reply (streamstore.ts)
  const landedAgent = useLandedGrace(`${channelId}:${threadId}`);
  const [draft, setDraft] = useState('');
  const [attachedSkill, setAttachedSkill] = useState<{ name: string; pack?: string | null } | null>(null);
  const atts = useAttachments(plan, onUpgrade);
  const listRef = useRef<HTMLDivElement>(null);
  useStickToBottom(listRef, threadId); // pinned while the reader is at the bottom, released when they scroll up
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
  // what this conversation makes while you look at it opens in the side panel by itself (shell/arrivals.ts)
  useArrivals(convoArts, `thread:${threadId}`, (fresh) => { const l = convoArrivals(fresh, rows); if (l.length) onArrive?.(l); });
  useArrivals(rows, `thread:${threadId}`, (fresh) => { const l = markerArrivals(fresh); if (l.length) onArrive?.(l); });
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
  const { ghostAgent, waitGhost, carded, typists } = useConvoPresence({ rows, agents, machines, channelId, threadId, runRows, trees, stream, streaming });
  // The drafted posts, in the transcript where they were handed over. Originals land as ONE strip
  // at the first draft's time; a revision rides its own strip after the reply that asked for it,
  // so scrolling back replays the review round rather than showing only the final copy.
  // a schedule's session holds one run per firing: draft letters and draft strips restart at each (SessionRuns.tsx)
  const runStarts = useMemo(() => splitSessionRuns(rows, thread?.schedule_id)?.map((f) => f.at) ?? [], [rows, thread?.schedule_id]);
  const mkCards = useMemo(() => postCardsFrom(mkPosts, rows, runStarts), [mkPosts, rows, runStarts]);
  const stream1 = useMemo(() => {
    const originals = mkCards.filter((c) => !c.isRevision);
    const items: Array<{ at: string; msg?: MessageRow; tree?: RunTree; strip?: PostVCard[]; unit?: TaskAllRow; delivery?: ChannelArtifactRow[]; key?: string }> = [
      ...rows.map((m) => ({ at: m.created_at, msg: m })),
      ...trees.map((t) => ({ at: t.run.started_at, tree: t })),
      ...draftStrips(originals, runStarts),
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
  }, [rows, trees, mkCards, units.strips, runStarts]);
  /** one drafted post's card: the transcript's strips and the Drafts tab draw the very same one */
  const renderDraft = (c: PostVCard, unit?: TaskAllRow) => (
    <SocialPostCard
      key={c.key} item={c.item} channelSlug={channelSlug} letter={c.letter} taskNumber={unit?.number} onOpen={() => setMkPreview(c.item)}
      version={c.version} superseded={c.superseded} imageReady={unit ? units.imageReady : mkImageReady}
      onReply={c.superseded ? undefined : () => { if (unit) units.setReplyTo({ id: c.item.id, letter: c.letter, number: unit.number }); else setMkReplyTo({ id: c.item.id, letter: c.letter }); setCfocus((n) => n + 1); }}
      // the marker is what the daemon acts on; the prose is for the transcript. A
      // conversation names the letter, having no task number to borrow; a unit's card
      // posts into the UNIT's own thread, where the agent that drew it listens.
      onGenerateImage={c.superseded ? undefined : (redraw, kind) => { const ask = kind === 'video' ? `Film the hook for draft ${c.letter}.‹gen-video:${c.item.id}›` : `${redraw ? 'Redraw' : 'Generate'} the image for draft ${c.letter}.‹gen-image:${c.item.id}›`; void (unit ? nm?.sendThread(unit.id, channelId, ask) : nm?.send(channelId, ask, { threadId })); }}
    />
  );
  // THE DRAFTS TAB (the side-panel round): every strip's cards once, with the unit each came from
  const draftEntries = useMemo(() => stripCards<PostVCard & { unit?: TaskAllRow }, { unit?: TaskAllRow }>(stream1, (it) => (it.unit ? { unit: it.unit } : {})), [stream1]);
  useDraftsTab(draftEntries, mkPosts, `thread:${threadId}`, drafts, onArrive);
  const overview = useThreadOverview(`thread:${threadId}`, [threadStatusOverviewSection(marks),
    { id: 'details', label: 'Details', items: channelKind === 'marketing' ? [{ id: 'brand', label: 'Brand', open: onDetails }] : [] },
    artifactOverviewSection(overviewOutputFiles(convoArts, rows), onOpenDoc), sourceOverviewSection(overviewSourceFiles(convoAtts, rows), setConvoLightbox), runOverviewSection(trees, listRef)]);
  return (
    <aside
      className="threadpanel convo"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="thead thread-crumb-row">
        {/* the crumb IS the way back (docs/35 §3.4): a session replaced the list, so the header
            says what it replaced rather than offering an ✕ that looks like "discard" */}
        <button className="scrumb" title="back — Esc" aria-label={`Back to ${back}`} onClick={onClose}>‹ {back}</button>
        {/* where this thread LIVES — project › #room, on the left with the other wayfinding
            (George, 2026-08-09). The lone top-right room tag retired with it; the Tasks/Chat
            mode chip stays gone (founder, 2026-08-06). */}
        <ThreadCrumb project={crumbProject} slug={channelSlug} />
        {/* a routine's session says so in the header (2026-08-22, George) — the same quiet pill the
            setup task wears, and since routine sessions (2026-09-28) it names the cadence */}
        <RoutineChip scheduleId={thread?.schedule_id} />
        {/* Settle leads the act cluster; the details are the side panel's Overview tab (the side-panel round) */}
        <div className="theadact">{overview.toggle}<ThreadSettleBtn head={marks} onSettle={onSettle} /></div>
      </div>
      <div className="thread-title-row"><span className="convotitle" title={title}>{title}</span></div>
      <ThreadLiveBar trees={trees} agents={agents} />
      <div className="convobody">
      <div className="convomain">
      <ThreadOverviewBody overview={overview} label={crumbProject?.name ?? title}>
      <div className="tmsgs convomsgs" ref={listRef}>
        <ThreadRootPin thread={thread} rows={rows} agents={agents} members={members} />
        {rows.length === 0 && !stream && <div className="tempty">Say the word — the channel's agents see this thread.</div>}
        <SessionRuns threadId={threadId} thread={thread} channelId={channelId} rows={rows} items={stream1} roomKind={channelKind} listRef={listRef} sources={{ units: units.anchored, cards: decisions, drafts: mkPosts, files: convoArts, openRuns: runRows }} render={(it) => {
          if (it.tree) return <RunCard key={it.tree.run.id} tree={it.tree} agent={agents.find((a) => a.id === it.tree!.run.agent_id) ?? null} onActivity={onActivity} />;
          if (it.delivery) return (
            <DeliveryStrip
              key={it.key}
              arts={it.delivery.map((a) => ({ ...a, task_id: null } as unknown as ArtifactUI))}
              superseded={new Set<string>()}
              onOpen={(name) => { const a = it.delivery!.find((x) => x.name === name); if (a?.inline_content) onOpenDoc?.({ label: name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), file: name, doc: a.inline_content }); }}
            />
          );
          // a delivery of drafts is ONE ROW here; the cards read at full size in the side panel's Drafts tab
          if (it.strip) return drafts
            ? <DraftsRow key={it.key} cards={it.strip} onOpen={drafts.onShow} />
            : <div className="mkdrafts" key={it.key}><div className="mkdraftsgrid">{it.strip.map((c) => renderDraft(c, it.unit))}</div></div>;
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
        }} />
        {ghostAgent && <AgentGhost key={ghostAgent.id} agent={ghostAgent} onActivity={onActivity} />}
        {/* NOBODY IS WORKING YET, AND THE THREAD STILL SAYS SO (docs/26 §5). On the browser this
            is the only orb for the first seconds of every message: with no local stream, the
            working ghost cannot mount until `thinking` has made a round trip to the runner.
            ONE LIVE SURFACE (docs/26 §3): words in the bubble are the answer, so the wait row
            stands down while they flow. TaskThread already guards on its stream; this did not,
            and "rex thinking…" sat above rex's own live reply. */}
        {!ghostAgent && !streaming && (
          /* Retry = say it again, which is what a person does anyway. It re-fires the daemon's
             live message watch AND re-bumps the machine, so it uses the proven path rather than
             a second one nobody exercises. The duplicate in the transcript is the truth. */
          <WaitGhost found={waitGhost} onRetry={async () => { await nm?.send(channelId, rows[rows.length - 1]?.body ?? '', { threadId }); }} />
        )}
        {streaming && <StreamBubble live={streaming} role={agents.find((a) => a.name === streaming.agent)?.role} taskRef={taskRef} onOpenTask={onOpenTask} />}
      </div>
      </ThreadOverviewBody>
      <div className="tcompose">
        <RunDock trees={trees} agents={agents} onOpen={onActivity} scrollRef={listRef} />
        {(() => {
          // who's on it: the agents working in THIS thread (convo-presence), streamer first. It
          // was this room's THINKING set — fine while a room showed one conversation, and a
          // cross-thread leak once it showed many (an agent thinking in another thread, or on
          // another machine, is not typing here).
          // card › ghost › chip — the precedence the task panel already encodes. The ghost is
          // the head of the SAME list, so without this filter every ghost was narrated twice:
          // once as a card in the transcript, once as a chip on the composer, each offering its
          // own door to the one activity log. An agent an open run card already names is spoken
          // for too. What survives: the streamer while its bubble draws (`typing`), and a second
          // agent working this thread beside the one the ghost narrates.
          const spokenFor = new Set<string>([
            ...(ghostAgent ? [ghostAgent.id] : []),
            // the WAIT ghost speaks for its agent too, and it is on screen exactly when the
            // working one is not — without this the row said "rex · thinking…" and the composer
            // said "rex is thinking" underneath it, at the same time (evidence shot, 2026-09-09)
            ...(!ghostAgent && waitGhost ? [waitGhost.agent.id] : []),
            ...carded,
            // a streamer whose reply already landed is on screen as that reply, while its run settles
            ...(landedAgent ? typists.filter((a) => a.name === landedAgent).map((a) => a.id) : []),
          ]);
          const list = typists.filter((a) => !spokenFor.has(a.id));
          if (!list.length) return null;
          return (
            <div className="typingbar">
              {list.map((a) => {
                const label = stream && a.name === stream.agent && stream.typing ? 'typing' : 'thinking';
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
          <SessionComposer rowClass="trow" input={<SessionComposer.Input
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
          />} controls={<>
            <MentionButton onMention={() => setCmention((n) => n + 1)} />
            <AttachButton onFiles={atts.addFiles} count={atts.count} max={atts.limits.maxPerMessage} />
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
          </>} />
          {convoDrop.dragging && <div className="drophint"><IconPaperclip s={15} /> Drop to attach</div>}
        </div>
        )}
      </div>
      </div>
      {/* THE CONVERSATION'S DETAILS (2026-08-17) — into the side panel's Overview tab (the
          Workbench card until 2026-10-03), exactly as the task thread's do. Same portal, same
          `RailSections`, same toks while Overview is out of view. */}
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
      {mkPreview && !drafts?.slot && (
        <PostPreviewModal
          item={mkPreview}
          channelSlug={channelSlug}
          channelId={channelId}
          projectName={crumbProject?.name ?? null}
          onClose={() => setMkPreview(null)}
          onChanged={() => { setMkPreview(null); setMkTick((n) => n + 1); units.setTick((n) => n + 1); }}
        />
      )}
      <DraftsTab door={drafts} cards={draftEntries} renderCard={(c) => renderDraft(c, c.unit)} preview={mkPreview} channelSlug={channelSlug} channelId={channelId} projectName={crumbProject?.name ?? null}
        onClose={() => setMkPreview(null)} onChanged={() => { setMkPreview(null); setMkTick((n) => n + 1); units.setTick((n) => n + 1); }} />
    </aside>
  );
}
