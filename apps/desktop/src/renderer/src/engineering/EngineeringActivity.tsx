import { memo, useId, useMemo, useState } from 'react';
import type { OrbState } from 'thinking-orbs';
import { Md } from '../md/Md';
import { Orb } from '../ui/Orb';
import {
  IconActivity,
  IconAlert,
  IconBrain,
  IconCheck,
  IconChevron,
  IconCode,
  IconFile,
  IconGlobe,
  IconHistory,
  IconSearch,
  IconTerm,
} from '../ui/icons';
import {
  engineeringActivePresentation,
  engineeringActivityPresentation,
  engineeringReasoningSeconds,
  groupEngineeringTranscript,
  streamingEngineeringText,
  type EngineeringActivityKind,
} from './activity';
import type { EngineeringMessage, EngineeringSession } from './domain';
import { ThinkingReasoning } from './ThinkingReasoning';

function ActivityIcon({ kind }: { kind: EngineeringActivityKind }) {
  if (kind === 'runtime' || kind === 'brain') return <IconBrain s={13} />;
  if (kind === 'read' || kind === 'edit') return <IconFile s={13} />;
  if (kind === 'search') return <IconSearch s={13} />;
  if (kind === 'command') return <IconTerm s={13} />;
  if (kind === 'web') return <IconGlobe s={13} />;
  if (kind === 'mcp') return <IconActivity s={13} />;
  if (kind === 'checkpoint') return <IconHistory s={13} />;
  if (kind === 'verification') return <IconCheck s={13} />;
  return <IconCode s={13} />;
}

function orbState(kind: EngineeringActivityKind): OrbState {
  if (kind === 'search' || kind === 'read' || kind === 'web') return 'searching';
  if (kind === 'brain' || kind === 'runtime') return 'composing';
  if (kind === 'mcp') return 'weaving';
  if (kind === 'edit' || kind === 'command' || kind === 'verification') return 'working';
  return 'breathing';
}

export const EngineeringActivityGroup = memo(function EngineeringActivityGroup({ messages }: { messages: EngineeringMessage[] }) {
  const rows = messages.map(engineeringActivityPresentation);
  const warningCount = rows.filter((row) => row.status === 'warning').length;
  const successCount = rows.filter((row) => row.status === 'success').length;
  const [open, setOpen] = useState(warningCount > 0 || rows.some((row) => row.status === 'info'));
  const regionId = useId();
  const headline = rows.length === 1 ? rows[0]!.title : 'Activity';
  const outcome = warningCount
    ? `${warningCount} need${warningCount === 1 ? 's' : ''} attention`
    : successCount === rows.length
      ? `${successCount} complete`
      : `${successCount} of ${rows.length} complete`;
  return (
    <section className={`engactivity${warningCount ? ' warning' : ''}${open ? ' open' : ''}`} aria-label="Engineering progress">
      <button className="engactivityhead" type="button" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen((value) => !value)}>
        <span><IconActivity s={12} /><b>{headline}</b></span>
        <span className="engactivitymeta"><em>{outcome}</em><i><IconChevron s={11} /></i></span>
      </button>
      <div className="engactivityreveal" id={regionId} aria-hidden={!open}>
        <div className="engactivityrows" role="list">
          {rows.map((row, index) => (
            <div className={`engactivityrow ${row.status}`} role="listitem" key={messages[index]?.id ?? index}>
              <span className="engactivityico"><ActivityIcon kind={row.kind} /></span>
              <span className="engactivitycopy"><b>{row.title}</b>{row.detail ? <small>{row.detail}</small> : null}</span>
              <span className="engactivityoutcome" aria-label={row.status === 'warning' ? 'Needs attention' : row.status === 'success' ? 'Completed' : 'Information'}>
                {row.status === 'warning' ? <IconAlert s={12} /> : row.status === 'success' ? <IconCheck s={12} /> : <i />}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}, (previous, next) => previous.messages.length === next.messages.length && previous.messages.every((message, index) => message === next.messages[index]));

const EngineeringMessageView = memo(function EngineeringMessageView({ message }: { message: EngineeringMessage }) {
  if (message.tone === 'warning') {
    return (
      <div className="engnotice warning" role="alert">
        <span className="engnoticeico"><IconAlert s={14} /></span>
        <span className="engnoticecopy"><b>Needs attention</b><Md text={message.body} /></span>
      </div>
    );
  }
  return (
    <div className={`engmessage ${message.role} ${message.tone ?? ''}${message.streaming ? ' streaming' : ''}`}>
      <div className="engmessagerole">{message.role === 'user' ? 'You' : 'Engineering'}</div>
      {message.attachments?.length ? <div className="engmessageattachments">{message.attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`}><IconFile s={12} />{attachment.name}</span>)}</div> : null}
      {message.streaming
        ? <div className="engstreamtext" aria-live="polite">{streamingEngineeringText(message.body)}<span className="tcaret" /></div>
        : <Md text={message.body} />}
    </div>
  );
});

const EngineeringReasoningView = memo(function EngineeringReasoningView({ message, nextMessage }: { message: EngineeringMessage; nextMessage?: EngineeringMessage }) {
  const seconds = engineeringReasoningSeconds(message, nextMessage);
  return (
    <ThinkingReasoning
      thinking={Boolean(message.streaming)}
      elapsedSeconds={seconds}
      collapseWhenDone={Boolean(message.collapsed)}
    >
      {message.streaming
        ? <>{streamingEngineeringText(message.body)}<span className="tcaret" /></>
        : <Md text={message.body} />}
    </ThinkingReasoning>
  );
});

export function EngineeringTranscript({ messages }: { messages: EngineeringMessage[] }) {
  const blocks = useMemo(() => groupEngineeringTranscript(messages), [messages]);
  return blocks.map((block, index) => {
    if (block.kind === 'activity') return <EngineeringActivityGroup key={block.messages[0]?.id} messages={block.messages} />;
    if (block.message.role !== 'reasoning') return <EngineeringMessageView key={block.message.id} message={block.message} />;
    const nextBlock = blocks[index + 1];
    const next = nextBlock?.kind === 'message' ? nextBlock.message : nextBlock?.messages[0];
    return <EngineeringReasoningView key={block.message.id} message={block.message} nextMessage={next} />;
  });
}

export function EngineeringWorking({ session }: { session: EngineeringSession }) {
  const activity = engineeringActivePresentation(session.activeActivity, session.mode);
  return (
    <section className="engworking" role="status" aria-live="polite" aria-label="Work in progress">
      <header><span><IconActivity s={12} /> In progress</span><em>{session.mode === 'plan' ? 'Plan' : 'Act'}</em></header>
      <div className="engworkingrow">
        <span className="engworkingorb"><Orb state={orbState(activity.kind)} label={activity.title} /></span>
        <span className="engworkingcopy"><b>{activity.title}</b><small>{activity.detail}</small></span>
      </div>
    </section>
  );
}

export function EngineeringRecentState({ session }: { session: EngineeringSession }) {
  if (session.state === 'streaming') {
    const activity = engineeringActivePresentation(session.activeActivity, session.mode);
    return <span className="engrecentorb"><Orb state={orbState(activity.kind)} label={activity.title} /></span>;
  }
  return <span className={`engstatedot mode-${session.mode} ${session.state}`} aria-label={`${session.mode === 'plan' ? 'Plan' : 'Act'} mode`} />;
}
