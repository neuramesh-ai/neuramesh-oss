import { ConnectorMarks } from '../composer/ConnectorMarks';
import type { ChannelRow } from '../bridge/rows-rooms';

const SUGGESTIONS = ['Give me ideas', 'What moved while I was away?', 'Plan the next release'];

/** Suggestions fill the composer. The footer keeps its height while a draft hides them. */
export function HomeComposerFoot({ draft, channel, onPrompt }: {
  draft: string;
  channel: ChannelRow | null;
  onPrompt: (prompt: string) => void;
}) {
  return <div className={`cfoot${draft ? ' drafting' : ''}`}>
    <div className="cfootpills" aria-hidden={!!draft}>
      {SUGGESTIONS.map((text) => <button key={text} type="button" className="cfootpill" tabIndex={draft ? -1 : 0} onClick={() => onPrompt(text)}>{text}</button>)}
    </div>
    <ConnectorMarks channelId={channel?.id ?? null} marketing={channel?.marketing} />
  </div>;
}
