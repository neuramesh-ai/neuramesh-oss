// The streaming bubble — tokens as they arrive, before the message row exists.
// Extracted from App.tsx (track A3).
import { AgentAvatar } from '../components/AgentAvatar';
import { Md } from '../md/Md';

import { useTypewriter } from './AgentGhost';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).


export function StreamBubble({ live }: { live: { agent: string; text: string } }) {
  // transport fences (```nmq / ```nmauth …) must NOT render as cards mid-stream: the
  // bubble has no answer wiring, so a streamed card is a dead control that eats the
  // human's clicks — they pick an option, the synced message lands, and the real card
  // mounts fresh, discarding their picks. Render an inert forming hint instead; the
  // interactive card arrives with the message. (Second replace covers the fence still
  // streaming in, before its closing ``` exists.)
  const text = live.text
    .replace(/```nm\w*\s*\n[\s\S]*?```/g, '\n› *question card forming…*\n')
    .replace(/```nm\w*[\s\S]*$/, '\n› *question card forming…*\n');
  // design round §D: the reply TYPES in — word-burst over the streamed target, so SDK block
  // bursts read as writing instead of popping in whole. Only prose types (fences were already
  // swapped for the forming hint above); the synced message replaces this bubble whole.
  const typed = useTypewriter(text, false);
  return (
    <div className="msg streaming">
      <AgentAvatar name={live.agent} size={26} />
      <div className="body">
        <div className="head"><b>{live.agent}</b><span className="time">now</span></div>
        <Md text={typed} />
        <span className="streamcaret" />
      </div>
    </div>
  );
}
