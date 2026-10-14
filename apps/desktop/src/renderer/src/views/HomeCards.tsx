// THE STAGE'S CARDS (George 2026-09-30: the thread list under the composer "might be an antipattern").
// What a person can do with NeuraMesh, where the list stood. The list's rows live in the rail, the bell
// and ⌘Y already, so the stage keeps one job: start something. A card fills the composer with a first
// line that the orchestrator can act on, and the person still sends. The routine card is one of them
// since the routine writer (2026-10-01): rex writes the routine with the person, who then schedules it.
import type { ReactNode } from 'react';
import { IconCode, IconCompose, IconGlobe, IconRocket, IconRoutineClock, IconWhiteboard } from '../ui/icons';

interface HomeCard { title: string; line: string; icon: ReactNode; prompt: string | null }

const CARDS: HomeCard[] = [
  { title: 'Ship a feature', line: 'rex plans it. Agents build it after you approve.', icon: <IconRocket s={13} />, prompt: 'Plan and build a feature: ' },
  { title: 'Code with an agent', line: 'Build and fix code in your repository.', icon: <IconCode s={13} />, prompt: 'In our repository, ' },
  { title: 'Draft a week of posts', line: 'neuramesh drafts them. You approve each post.', icon: <IconCompose s={13} />, prompt: 'Draft a week of X posts about ' },
  { title: 'Research a topic', line: 'Get answers from the web, with sources.', icon: <IconGlobe s={13} />, prompt: 'Research ' },
  { title: 'Schedule a routine', line: 'Run work every day or every week.', icon: <IconRoutineClock s={13} />, prompt: null },
  { title: 'Sketch on a whiteboard', line: 'Draw ideas and diagrams with your agents.', icon: <IconWhiteboard s={13} />, prompt: 'Sketch a diagram of ' },
];

export function HomeCards({ onPrompt, onRoutine }: { onPrompt: (text: string) => void; onRoutine: () => void }) {
  return (
    <div className="stagecards">
      {CARDS.map((c) => (
        <button key={c.title} type="button" className="stagecard" onClick={() => c.prompt === null ? onRoutine() : onPrompt(c.prompt)}>
          <span className="stagecardico" aria-hidden>{c.icon}</span>
          <span className="stagecardt">{c.title}</span>
          <span className="stagecardd">{c.line}</span>
        </button>
      ))}
    </div>
  );
}
