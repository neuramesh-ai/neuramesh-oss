import { CodingMessageBody, type CodingDisplayDoors } from './CodingMessageBody';
import { answersFrom } from '../answers';
import { AgentAvatar } from '../components/AgentAvatar';
// THE CODING TRANSCRIPT (coding threads §5, visual contract Thread.dc.html): the runtime's rows in
// the THREAD's anatomy — the human's hairline bubble, the developer's prose on the ground with the
// folded thought and the tool receipts above it, one Engineering voice (ruling 2, 2026-09-26).
// The rows come from the shared reducer (groupEngineeringTranscript), the blocks the phone draws
// too: a run of receipts and the thought that preceded them fold into the Engineering row whose
// prose follows, so one turn reads as one row, never as a stack of TOOL labels.
import { Fragment, useMemo, type ReactNode } from 'react';
import type { ChannelArtifactRow } from '../bridge/rows-rooms';
import { codingArtifactTurns } from './coding-artifacts';
import { transcriptMessages } from './coding-transcript';
import type { OrbState } from 'thinking-orbs';
import { DEFAULT_ENGINEERING_AGENT, engineeringReviewMessages, engineeringWorkPlanMessages } from '@neuramesh/shared';
import { engineeringActivePresentation, engineeringActivityPresentation, engineeringReasoningSeconds, groupEngineeringTranscript, streamingEngineeringText, type EngineeringActivityKind } from '../engineering/activity';
import type { EngineeringMessage, EngineeringSession } from '../engineering/domain';
import { EngineeringChangeCard, type OpenChangeReview } from '../engineering/EngineeringChangeCard';
import { EngineeringWorkPlan } from '../engineering/EngineeringWorkPlan';
import { Md } from '../md/Md';
import { Orb } from '../ui/Orb';
import { IconActivity, IconAlert, IconBrain, IconCheck, IconCode, IconFile, IconGlobe, IconHistory, IconSearch, IconTerm } from '../ui/icons';

type Row =
  | { key: string; kind: 'human'; message: EngineeringMessage }
  | { key: string; kind: 'eng'; reasoning: EngineeringMessage | null; receipts: EngineeringMessage[]; message: EngineeringMessage | null };

/** one Engineering row per turn: [thought] + [receipts…] + the prose that closes it */
function rowsOf(messages: EngineeringMessage[]): Row[] {
  const rows: Row[] = [];
  let pending: Extract<Row, { kind: 'eng' }> | null = null;
  const open = (key: string) => (pending ??= { key, kind: 'eng', reasoning: null, receipts: [], message: null });
  const flush = () => { if (pending) { rows.push(pending); pending = null; } };
  for (const block of groupEngineeringTranscript(messages)) {
    if (block.kind === 'activity') { open(block.messages[0]!.id).receipts.push(...block.messages); continue; }
    const m = block.message;
    if (m.role === 'user') { flush(); rows.push({ key: m.id, kind: 'human', message: m }); continue; }
    if (m.role === 'reasoning') { open(m.id).reasoning = m; continue; }
    open(m.id).message = m; flush();
  }
  flush();
  return rows;
}

function ReceiptIcon({ kind }: { kind: EngineeringActivityKind }) {
  if (kind === 'runtime' || kind === 'brain') return <IconBrain s={12} />;
  if (kind === 'read' || kind === 'edit') return <IconFile s={12} />;
  if (kind === 'search') return <IconSearch s={12} />;
  if (kind === 'command') return <IconTerm s={12} />;
  if (kind === 'web') return <IconGlobe s={12} />;
  if (kind === 'mcp') return <IconActivity s={12} />;
  if (kind === 'checkpoint') return <IconHistory s={12} />;
  if (kind === 'verification') return <IconCheck s={12} />;
  return <IconCode s={12} />;
}
const orbOf = (kind: EngineeringActivityKind): OrbState =>
  kind === 'search' || kind === 'read' || kind === 'web' ? 'searching' : kind === 'brain' || kind === 'runtime' ? 'composing' : kind === 'mcp' ? 'weaving' : kind === 'edit' || kind === 'command' || kind === 'verification' ? 'working' : 'breathing';
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** the folded thought line: `Read 3 files · thought for 14s` */
function thinkLine(row: Extract<Row, { kind: 'eng' }>): string {
  const parts: string[] = [];
  const steps = row.receipts.length;
  if (steps) parts.push(`${steps} ${steps === 1 ? 'step' : 'steps'}`);
  if (row.reasoning) { const s = engineeringReasoningSeconds(row.reasoning, row.message ?? row.receipts[0]); if (s != null && s > 0) parts.push(`thought for ${s}s`); }
  return parts.join(' · ');
}

type ReviewProps = CodingDisplayDoors & { onOpenReview?: OpenChangeReview; pendingApprovalId?: string; onApproval?: (approved: boolean) => void };
function EngineeringRow({ row, onOpenWorkPlan, onOpenReview, pendingApprovalId, onApproval, ...display }: { row: Extract<Row, { kind: 'eng' }>; onOpenWorkPlan?: (text: string) => void } & ReviewProps) {
  const stamp = (row.message ?? row.receipts[0] ?? row.reasoning)?.createdAt;
  const line = thinkLine(row);
  const agent = (row.message ?? row.reasoning ?? row.receipts[0])?.agent ?? DEFAULT_ENGINEERING_AGENT;
  return (
    <div className="msg">
      <span className="av" aria-hidden><AgentAvatar name={agent.name} emoji={agent.emoji} role={agent.role} size={26} radius={4} /></span>
      <div className="body">
        <div className="head"><b>{agent.name}</b>{stamp ? <span className="time">{clock(stamp)}</span> : null}</div>
        {line ? <div className="think"><span className="tw"><IconBrain s={9} /></span><span>{line}</span></div> : null}
        {row.receipts.length ? (
          <div className="receipts">
            {row.receipts.map((m) => {
              const p = engineeringActivityPresentation(m);
              return (
                <div key={m.id} className="receipt" data-status={p.status}>
                  <ReceiptIcon kind={p.kind} />
                  <span>{p.title}{p.detail && p.detail !== 'Completed' ? <> · <code>{p.detail}</code></> : null}</span>
                  <span className={p.status === 'warning' ? 'wait' : 'ok'}>{p.status === 'warning' ? <IconAlert s={11} /> : <IconCheck s={11} />}</span>
                  <span className="rl">{p.kind}</span>
                </div>
              );
            })}
          </div>
        ) : null}
        {row.message?.kind === 'change_review' && row.message.review ? <EngineeringChangeCard review={row.message.review} pending={row.message.review.id === pendingApprovalId} onOpen={onOpenReview} onResolve={onApproval} /> : row.message?.kind === 'work_plan' ? <EngineeringWorkPlan text={row.message.body} report={row.message.planReport} inline onOpen={onOpenWorkPlan ? () => onOpenWorkPlan(row.message!.body) : undefined} /> : row.message ? (row.message.streaming ? <p>{streamingEngineeringText(row.message.body)}<span className="tcaret" /></p> : <CodingMessageBody text={row.message.body} {...display} />) : null}
      </div>
    </div>
  );
}

export function CodingTranscript({ session, artifacts, onOpenWorkPlan, onOpenReview, onApproval, ...display }: { session: EngineeringSession; artifacts?: { rows: ChannelArtifactRow[]; card: (rows: ChannelArtifactRow[]) => ReactNode }; onOpenWorkPlan?: (text: string) => void } & ReviewProps) {
  const answers = useMemo(() => answersFrom(session.messages.filter(message => message.role === 'user').map(message => ({ author_kind: 'human', body: message.body }))), [session.messages]);
  const rows = useMemo(() => rowsOf(transcriptMessages(engineeringWorkPlanMessages({ ...session, messages: engineeringReviewMessages(session) }), !!session.blockedOn)), [session]);
  const deliveries = codingArtifactTurns(artifacts?.rows ?? [], session.messages);
  let turn: string | null = null;
  const agent = session.agent ?? DEFAULT_ENGINEERING_AGENT;
  const live = session.state === 'streaming' ? engineeringActivePresentation(session.activeActivity, session.mode) : null;
  return (
    <>
      {artifacts?.card(deliveries.get(null) ?? [])}
      {rows.map((row, index) => {
        if (row.kind === 'human') turn = row.message.id;
        return <Fragment key={row.key}>{row.kind === 'human'
          ? <div className="msg human mine"><div className="body"><div className="head"><b>you</b><span className="time">{clock(row.message.createdAt)}</span></div><Md text={row.message.body} /></div></div>
          : <EngineeringRow {...display} answers={answers} row={row} onOpenReview={onOpenReview} onApproval={onApproval} pendingApprovalId={session.pendingApproval?.id} onOpenWorkPlan={onOpenWorkPlan} />}
          {turn && (index === rows.length - 1 || rows[index + 1]?.kind === 'human') ? artifacts?.card(deliveries.get(turn) ?? []) : null}
        </Fragment>;
      })}
      {live ? (
        <div className="msg" role="status" aria-live="polite">
          <span className="av" aria-hidden><AgentAvatar name={agent.name} emoji={agent.emoji} role={agent.role} size={26} radius={4} /></span>
          <div className="body"><div className="head"><b>{agent.name}</b></div><div className="think live"><span className="tw"><Orb state={orbOf(live.kind)} label={live.title} /></span><span>{live.title} · {live.detail}</span></div></div>
        </div>
      ) : null}
    </>
  );
}
