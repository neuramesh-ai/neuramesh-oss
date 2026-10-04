// THE CODING TRANSCRIPT (coding threads §5, visual contract Thread.dc.html): the runtime's rows in
// the THREAD's anatomy — the human's hairline bubble, the developer's prose on the ground with the
// folded thought and the tool receipts above it, one Engineering voice (ruling 2, 2026-09-26).
// The rows come from the shared reducer (groupEngineeringTranscript), the blocks the phone draws
// too: a run of receipts and the thought that preceded them fold into the Engineering row whose
// prose follows, so one turn reads as one row, never as a stack of TOOL labels.
import { useMemo } from 'react';
import type { OrbState } from 'thinking-orbs';
import { isEngineeringGitHubWait } from '@neuramesh/shared';
import { engineeringActivePresentation, engineeringActivityPresentation, engineeringReasoningSeconds, groupEngineeringTranscript, streamingEngineeringText, type EngineeringActivityKind } from '../engineering/activity';
import type { EngineeringMessage, EngineeringSession } from '../engineering/domain';
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

function EngineeringRow({ row }: { row: Extract<Row, { kind: 'eng' }> }) {
  const stamp = (row.message ?? row.receipts[0] ?? row.reasoning)?.createdAt;
  const line = thinkLine(row);
  return (
    <div className="msg">
      <span className="av eng" aria-hidden><IconCode s={13} /></span>
      <div className="body">
        <div className="head"><b>Engineering</b>{stamp ? <span className="time">{clock(stamp)}</span> : null}</div>
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
        {row.message ? (row.message.streaming ? <p>{streamingEngineeringText(row.message.body)}<span className="tcaret" /></p> : <Md text={row.message.body} />) : null}
      </div>
    </div>
  );
}

/** the session's greeting says "Ready in <repo>": while the machine cannot reach the code, it would say the opposite of
 *  the gate below. The machine's GitHub sentence is the phone's reason (it has no gate): here the gate and the
 *  connected divider say it, and after the grant the sentence would be stale, so it never shows */
export function transcriptMessages(messages: EngineeringMessage[], blocked: boolean): EngineeringMessage[] {
  return (blocked && messages[0]?.role === 'assistant' ? messages.slice(1) : messages).filter((m) => !isEngineeringGitHubWait(m));
}

export function CodingTranscript({ session }: { session: EngineeringSession }) {
  const rows = useMemo(() => rowsOf(transcriptMessages(session.messages, !!session.blockedOn)), [session.messages, session.blockedOn]);
  const live = session.state === 'streaming' ? engineeringActivePresentation(session.activeActivity, session.mode) : null;
  return (
    <>
      {rows.map((row) => row.kind === 'human'
        ? <div key={row.key} className="msg human mine"><div className="body"><div className="head"><b>you</b><span className="time">{clock(row.message.createdAt)}</span></div><Md text={row.message.body} /></div></div>
        : <EngineeringRow key={row.key} row={row} />)}
      {live ? (
        <div className="msg" role="status" aria-live="polite">
          <span className="av eng" aria-hidden><IconCode s={13} /></span>
          <div className="body"><div className="head"><b>Engineering</b></div><div className="think live"><span className="tw"><Orb state={orbOf(live.kind)} label={live.title} /></span><span>{live.title} · {live.detail}</span></div></div>
        </div>
      ) : null}
    </>
  );
}
