// ONE MESSAGE — its attachments, the whiteboard snapshot card, a dropped document, and the
// answer-then-post path a decision reply takes.
//
// This module and ConvoThread.tsx import each other, and that is structural rather than
// accidental: a message can CONTAIN a conversation (a whiteboard card and a brand section both
// render one). Every reference is inside a component body, so the hoisted declarations resolve
// at render time, never at module evaluation. Split out of thread/convo.tsx.
import { AgentAvatar } from '../components/AgentAvatar';
import { IconFile, IconWhiteboard } from '../ui/icons';
import { Orb } from '../ui/Orb';
import { Md } from '../md/Md';
import { SuggestionRow } from '../cards/SuggestionRow';
import { answersFrom } from '../answers';
import { authorLabel } from '../views/SkillsView';
import { docDropParts } from '../docdrop';
import { formatBytes, journeyFor, parseArticleRef, parseModeMarker, parsePlanRef, parseReportRef, parseSuggestions, parseTaskUnitRef, parseWhiteboardRef, type WorkPlan } from '@neuramesh/shared';
import { ArticleCard, type ArticleOpen } from './ArticleCard';
import { ReportCard } from './ReportCard';
import { DocDropCard } from './DocDropCard';
import { PhaseRing } from '../task/BeatsTracker';
import type { TaskAllRow } from '../bridge/rows-board';
import { isImageAtt } from './AttachLightbox';
import { materializeWhiteboard } from '../wb-materialize';
import { nm as nmBridge } from '../bridge/nm';
import { parseWbRow, type WbRow, wbNeedsMaterialize, wbSnapshotSrc } from '../whiteboards';
import { stripMarkers } from './markers';
import { timeAgoShort } from '../lib/time';
import { PlanReviewCard } from '../cards/PlanReviewCard';
import { type AgentRow, type MemberRow } from '../bridge/rows-crew';
import { type AttachmentRow, type DecisionAllRow, type TaskRow } from '../bridge/rows-board';
import { type MessageRow } from '../bridge/rows-rooms';
import { type TaskRefInfo } from '../cards/parse';
import { useEffect, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Attachments shown under a message: image thumbnails (click → lightbox) + file chips. The inline
// thumbnail (synced) is the preview; the full file streams from nm-attachment:// in the lightbox,
// falling back to the thumbnail when the bytes live on another machine.
export function MsgAttachments({ atts, onOpen }: { atts: AttachmentRow[]; onOpen: (a: AttachmentRow) => void }) {
  if (!atts.length) return null;
  return (
    <div className="msgatts">
      {atts.map((a) =>
        isImageAtt(a) ? (
          <button key={a.id} type="button" className="msgimg" onClick={() => onOpen(a)} title={a.name}
            style={a.width && a.height ? { aspectRatio: `${a.width} / ${a.height}` } : undefined}>
            <img src={a.inline_content ?? `nm-attachment://${a.id}`} alt={a.name} loading="lazy"
              onError={(e) => { const full = `nm-attachment://${a.id}`; if (e.currentTarget.src !== full) e.currentTarget.src = full; }} />
          </button>
        ) : (
          <div key={a.id} className="msgfile" title={a.name}>
            <span className="msgfileic"><IconFile s={17} /></span>
            <span className="msgfileinfo"><span className="msgfilename">{a.name}</span><span className="msgfilesub">{a.size_bytes ? formatBytes(a.size_bytes) : 'file'}</span></span>
          </div>
        ),
      )}
    </div>
  );
}

// A card click answers two consumers: the authoritative decision.answer flip (what
// Mission Control renders) and the `**q** → a` reply message (what the asking agent
// behaviorally watches). Flip first — CONFLICT means another machine already answered
// every card this reply covers, so stand down instead of double-posting; any OTHER
// failure (offline, transient) still posts the reply so the human's answer is never
// swallowed — the row stays open on Mission Control where it can be re-answered or
// dismissed.
export async function answerDecisionsThenPost(replyText: string, open: DecisionAllRow[], post: (text: string) => void): Promise<void> {
  const pairs = answersFrom([{ author_kind: 'human', body: replyText }]);
  let won = 0;
  let lost = 0;
  for (const d of open) {
    const answer = pairs.get(d.question);
    if (answer === undefined || !nm) continue;
    try {
      await nm.decisionAction('decision.answer', d.id, answer);
      won++;
    } catch (e) {
      if (e instanceof Error && /already (answered|dismissed)/.test(e.message)) lost++;
      // anything else: fall through — the reply still posts, the row stays open
    }
  }
  if (lost > 0 && won === 0) return; // fully raced — the other machine's reply already landed
  post(replyText);
}

// The conversation sheet (conversation-first shell): every send starts one — chat-first,
// task-ready. It rides the same full-width slide as the task thread; when the orchestrator
// fans a task OUT of the exchange, threads.task_id syncs down and App swaps this sheet for
// the task thread in place — one continuous surface, upgraded.
/** The whiteboard thread card (docs/38): the transcript record of a shared board. It reads the
 *  board's SYNCED row (snapshot still, title, filing) — no duplicate bytes ride the message —
 *  and a mount that finds an unrealized agent source volunteers as its materializer. Click is
 *  the doorway to the tab; the card itself never hosts a live canvas. */
export function WbCard({ id, onOpen }: { id: string; onOpen?: (b: { id: string; title: string }) => void }) {
  const [row, setRow] = useState<WbRow | null>(null);
  useEffect(() => {
    if (!nm?.watchWhiteboard) return;
    return nm.watchWhiteboard(id, (raw) => setRow(parseWbRow(raw)));
  }, [id]);
  useEffect(() => {
    if (row && wbNeedsMaterialize(row)) void materializeWhiteboard(row);
  }, [row]);
  const src = row ? wbSnapshotSrc(row.snapshotSvg) : null;
  return (
    <button className="wbcard" onClick={() => row && onOpen?.({ id: row.id, title: row.title })} disabled={!row || !onOpen} title={row?.title ?? 'whiteboard'}>
      <span className="wbcardsnap">
        {src
          ? <img className="wbsnapimg" src={src} alt="" draggable={false} />
          : <span className="wbtilewait">{row ? (row.source ? 'drawing from its source…' : 'an empty board') : 'this board is no longer here'}</span>}
      </span>
      <span className="wbcardm">
        <span className="ic"><IconWhiteboard s={12} /></span>
        <b>{row?.title ?? 'whiteboard'}</b>
        <span className="kind">whiteboard</span>
        <span className="by">{row ? `#${row.channelSlug} · ${timeAgoShort(row.updatedAt)}` : ''}</span>
        {onOpen && row ? <span className="open">Open ›</span> : null}
      </span>
    </button>
  );
}

/** The unit card (thread-owned work, 2026-08-17): the ‹task:id› marker worn as the LIVE task
 *  row — id · title · state chip · the journey wound into the PhaseRing dial · the facts line.
 *  A TEXT row since 2026-08-26 (George): the embossed card + spectrum ribbon read as a foreign
 *  panel in a conversation — the dial joins the chip as one status cluster (the docs/24 §2
 *  ruling that retired the panel's ribbon), and the row is typography with a hover cue.
 *  Self-contained like WbCard (it watches the synced rows itself), so BOTH thread renderers
 *  show one truth; click = the peek, through the same onOpenTask door a #N ref uses. A lens on
 *  the row, never a copy — if the board and the card could disagree, one would be lying. */
export function UnitCard({ id, onOpen }: { id: string; onOpen?: (taskId: string) => void }) {
  const [row, setRow] = useState<TaskAllRow | null>(null);
  const [kin, setKin] = useState<Set<string>>(new Set());
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!nm?.watchTasksAll) return;
    return nm.watchTasksAll((rows) => {
      setRow(rows.find((r) => r.id === id) ?? null);
      setKin(new Set(rows.filter((r) => r.parent_task_id === id).map((r) => r.id)));
    });
  }, [id]);
  // live = a running run on this unit or one of its subtasks (2026-08-22, George: the card sat
  // dark while rex planned it) — the runs rows, the same truth the nav orb reads
  useEffect(() => {
    if (!nm?.watchRuns || !row?.channel_id) return;
    return nm.watchRuns(row.channel_id, (runs) =>
      setLive(runs.some((r) => r.state === 'running' && !!r.task_id && (r.task_id === id || kin.has(r.task_id)))));
  }, [row?.channel_id, id, kin]);
  if (!row) {
    return <div className="unitcard gone">this task is no longer here</div>;
  }
  const plan = ((): WorkPlan | null => {
    if (!row.work_plan) return null;
    try { return JSON.parse(row.work_plan) as WorkPlan; } catch { return null; }
  })();
  // owners resolve in the panel, not on a card — a full placeholder roster keeps future legs
  // ghosted (todo) instead of claiming a staffing gap this surface cannot verify
  const legs = plan
    ? journeyFor(
        { state: row.state, kind: row.kind, blockedFrom: null, hasDesignRound: false, hasPlanDoc: true, repoBacked: !!row.repo_id, shipGate: false, assigneeName: row.assignee_id, workPlanLegs: plan.legs },
        { designer: '·', architect: '·', developer: '·', reviewer: '·', shipper: '·' },
      )
    : [];
  const gate = row.state === 'plan_review' && !row.plan_approved_at;
  return (
    <button className="unitcard" onClick={() => onOpen?.(row.id)} title={`open #${row.number} beside the thread`}>
      <span className="uchead">
        <span className="ucid">#{row.number}</span>
        <span className="ucti">{row.title}</span>
        <span className={`chip c-${row.state}`}>{row.state.replace('_', ' ')}</span>
        <PhaseRing legs={legs} />
      </span>
      {/* the status line says what a HUMAN needs (round 3 rerun, founder): a live orb while
          the work runs — the uuid fragment it used to print named nobody — and the accept
          ask once it rests at the gate */}
      <span className="ucline">
        {gate
          ? 'plan awaiting your review — open the card to approve it'
          : live || row.state === 'in_progress'
            ? <><Orb state="composing" label="working" /> {({ planning: 'planning it…', designing: 'designing it…', in_review: 'reviewing it…' } as Record<string, string>)[row.state] ?? 'working on it…'}</>
            : row.state === 'done'
              ? 'done — review the deliverable and accept'
              : row.state === 'todo' && !row.assignee_id
                ? 'approved — awaiting its offer'
                : row.state.replace('_', ' ')}
      </span>
    </button>
  );
}


/**
 * ONE message row, for every thread.
 *
 * The task thread and the conversation each had their own copy of this, and the copies drifted —
 * every one of this round's rendering bugs lived here: the conversation leaked `‹gen-image:…›`
 * because only the task thread stripped markers; it showed no attachments because only the task
 * thread looked them up; the whiteboard card had to be added twice and the doc-drop card once had
 * a comment admitting "a card that lands in only one of the two thread renderers is the docdrop
 * bug class". Two renderers of one row is that bug class, standing.
 *
 * Everything that differed between the copies is a PROP, and every prop is optional: a
 * conversation simply passes fewer. Nothing here asks what kind of thread it is.
 */
export function ThreadMessage({
  m, agents, members, selfId, selfEmail, channelId,
  atts, onOpenAtt, answers, decisions, onAnswerPost,
  taskRef, onOpenTask, onOpenWhiteboard, onOpenDoc, onOpenArticle, planCtx,
  md, suggestions,
}: {
  m: MessageRow;
  agents: AgentRow[];
  members: MemberRow[];
  selfId?: string | null;
  selfEmail?: string | null;
  channelId: string;
  atts: AttachmentRow[];
  onOpenAtt: (a: AttachmentRow) => void;
  answers: Map<string, string>;
  decisions: DecisionAllRow[];
  /** how THIS surface posts an answer back (a task thread and a conversation address differently) */
  onAnswerPost: (text: string) => void;
  taskRef?: (n: number) => TaskRefInfo | null;
  onOpenTask?: (id: string) => void;
  onOpenWhiteboard?: (b: { id: string; title: string }) => void;
  onOpenDoc?: (d: { label: string; file: string; doc: string }) => void;
  /** the ‹article:id› card's door — Open lands the article in a reading tab (article round) */
  onOpenArticle?: (a: ArticleOpen) => void;
  /** the plan-review card's world (task threads only): the thread's own task + its doors —
   *  absent on conversations, where a ‹plan:vN› marker degrades to its readable line */
  planCtx?: { task: TaskRow; onOpenPlan: (name?: string) => void; onArmRevise: () => void } | null;
  /** the extra Md powers a task thread has and a conversation has no use for */
  md?: Partial<React.ComponentProps<typeof Md>>;
  /** null = this row is not the suggestion target, or the surface is suppressing them */
  suggestions?: { onPick: (t: string) => void; onEdit: (t: string) => void } | null;
}) {
  // docs/34 — the Tasks flip, drawn as a rule across the transcript rather than a bubble: it is
  // something that HAPPENED to the thread, not something anyone said. A conversation that
  // escalated in place carries this marker into its task thread, so both must render it.
  const flipped = parseModeMarker(m.body);
  if (flipped) {
    return (
      <div className="sysline">
        <span>Tasks <b>{flipped === 'tasks' ? 'on' : 'off'}</b> — {flipped === 'tasks'
          ? 'the next message goes to the board'
          : 'the agents answer here from now on'}</span>
      </div>
    );
  }
  const a = authorLabel(m, agents, members, selfId ?? null, selfEmail ?? null);
  const drop = a.agent ? docDropParts(m.body) : null;
  // a shared whiteboard (docs/38): the marker becomes the snapshot card, the surrounding prose
  // stays prose — HUMAN shares included, so this sits outside the agent-only doc-drop gate
  const wb = drop ? null : parseWhiteboardRef(m.body);
  // thread-owned work (2026-08-17): the ‹task:id› unit card — any author (the server posts it
  // as the creator), both renderers, prose stays prose
  const unit = drop || wb ? null : parseTaskUnitRef(m.body);
  // an article deliverable (article round): the ‹article:id› marker worn as the magazine tile
  const article = drop || wb || unit ? null : parseArticleRef(m.body);
  // a scored report (marketing-os round): the ‹report:id› marker worn as the scorecard
  const report = drop || wb || unit || article ? null : parseReportRef(m.body);
  // the plan-review card (2026-08-19): ‹plan:vN› + a task-thread context = the gate as a
  // thread-native card; without planCtx (a conversation) the readable line renders as prose
  const plan = drop || wb || unit || article || report || !planCtx ? null : parsePlanRef(m.body);
  // every marker shares one anatomy: surrounding prose stays prose, the marker becomes its card
  const marker = plan && planCtx ? { prose: plan.prose, card: <PlanReviewCard version={plan.version} task={planCtx.task} onOpenPlan={planCtx.onOpenPlan} onArmRevise={planCtx.onArmRevise} /> }
    : wb ? { prose: wb.prose, card: <WbCard id={wb.id} onOpen={onOpenWhiteboard} /> }
    : unit ? { prose: unit.prose, card: <UnitCard id={unit.id} onOpen={onOpenTask} /> }
    : article ? { prose: article.prose, card: <ArticleCard id={article.id} onOpen={onOpenArticle} /> }
    : report ? { prose: report.prose, card: <ReportCard id={report.id} onOpen={onOpenDoc} /> }
    : null;
  return (
    <div className={`msg${a.agent ? '' : a.self ? ' human mine' : ' human'}`}>
      {a.agent ? <AgentAvatar name={a.name} size={26} interactive /> : <span className="av">{a.initial}</span>}
      <div className="body">
        <div className="head">
          <b>{a.name}</b>
          {a.agent && a.role ? <span className="rolechip msgrole" data-role={a.role}>{a.role}</span> : null}
          <span className="time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        {marker ? (
          <>
            {marker.prose ? <Md text={marker.prose} taskRef={taskRef} onOpenTask={onOpenTask} /> : null}
            {marker.card}
          </>
        ) : drop ? (
          <DocDropCard drop={drop} channelId={channelId} onOpen={onOpenDoc} />
        ) : (
          <Md
            {...md}
            text={stripMarkers(m.body)}
            answers={answers}
            onAnswer={(t) => void answerDecisionsThenPost(t, decisions.filter((d) => d.message_id === m.id && d.status === 'open'), onAnswerPost)}
            taskRef={taskRef}
            onOpenTask={onOpenTask}
          />
        )}
        <MsgAttachments atts={atts} onOpen={onOpenAtt} />
        {suggestions && (
          <SuggestionRow suggestions={parseSuggestions(m.body)} onPick={suggestions.onPick} onEdit={suggestions.onEdit} />
        )}
      </div>
    </div>
  );
}
