// The streaming bubble — tokens as they arrive, before the message row exists.
// Extracted from App.tsx (track A3).
import { useMemo } from 'react';
import { AgentAvatar } from '../components/AgentAvatar';
import { Md } from '../md/Md';
import type { TaskRefInfo } from '../cards/parse';
import { useStreamText, type StreamPresence } from './streamstore';
import { useReveal } from './reveal';

/** transport fences (```nmq / ```nmauth …) render as an inert forming hint, never as a card */
export function hideCardFences(text: string): string {
  if (!text.includes('```nm')) return text;
  return text
    .replace(/```nm\w*\s*\n[\s\S]*?```/g, '\n› *question card forming…*\n')
    .replace(/```nm\w*[\s\S]*$/, '\n› *question card forming…*\n');
}

// The bubble is the ONE subscriber to the stream's text (thread/streamstore.ts): a delta renders
// this component and nothing above it. It draws the reply the way the landed message will draw it
// (the same Md, the same task-ref links, the role chip the ghost and the row both wear), so the
// hand-off to the synced row moves nothing (docs/33 §7).
export function StreamBubble({ live, role, taskRef, onOpenTask }: {
  live: StreamPresence;
  /** the agent's role chip — the ghost before this bubble and the row after it both wear it */
  role?: string | null;
  taskRef?: (n: number) => TaskRefInfo | null;
  onOpenTask?: (id: string) => void;
}) {
  const entry = useStreamText(live.key);
  // transport fences (```nmq / ```nmauth …) must NOT render as cards mid-stream: the
  // bubble has no answer wiring, so a streamed card is a dead control that eats the
  // human's clicks — they pick an option, the synced message lands, and the real card
  // mounts fresh, discarding their picks. Render an inert forming hint instead; the
  // interactive card arrives with the message. (Second replace covers the fence still
  // streaming in, before its closing ``` exists.)
  const text = useMemo(() => hideCardFences(entry?.text ?? ''), [entry?.text]);
  const done = !!entry?.done || !!live.landing;
  // design round §D: the reply TYPES in (thread/reveal.ts) — frame-paced, word by word, a set
  // distance behind the stream, and flushed quickly once it is done. Only prose types (fences
  // were already swapped for the forming hint above).
  const shown = useReveal(text, !done);
  const typing = !done || shown.length < text.length;
  // the face and the head never change while the text grows: the same elements every step, so a
  // reveal step renders the markdown's tail and nothing else
  const avatar = useMemo(() => <AgentAvatar name={live.agent} size={26} interactive />, [live.agent]);
  const head = useMemo(() => (
    <div className="head">
      <b>{live.agent}</b>
      {role ? <span className="rolechip msgrole" data-role={role}>{role}</span> : null}
      <span className="time">now</span>
    </div>
  ), [live.agent, role]);
  return (
    <div className={`msg streaming${typing ? '' : ' landed'}`} data-shown={shown.length}>
      {avatar}
      <div className="body">
        {head}
        <Md text={shown} caret={typing} taskRef={taskRef} onOpenTask={onOpenTask} />
      </div>
    </div>
  );
}
