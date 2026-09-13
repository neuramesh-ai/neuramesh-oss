// THE WORKBENCH, EMPTY (2026-08-19, George) — what the panel is FOR, when it has nothing in it yet.
//
// It read: "Nothing on this conversation yet — files it writes, and its room's docs, land here."
// One sentence that says the panel is empty (which you can see), buys its only real information
// with an em dash, and never mentions the things you would actually come here to do. An empty
// state is the one moment a surface has your attention and nothing competing for it; spending it
// on an apology is a waste of the slot.
//
// NO EM DASHES anywhere in this copy — the house rule for anything a human reads (docs/35's
// briefs clause). A colon does the same work and does not perform.
//
// So it names the three kinds of thing that land here, each with the gesture that puts it there,
// and they arrive one after another rather than as a wall — the stagger is what makes a list of
// three read as an invitation instead of documentation. `--dur-enter` per row, ~70ms apart: under
// the 150ms motion budget (docs/33 §7) and finished before you have read the first line.
//
// Nothing here is a control. The panel cannot attach a repo or run a task, and a button that
// merely explains where the real button is would be a second door onto someone else's surface
// (§8). These are labels; the doing happens where it already happens.
import { IconBranch, IconFile, IconGrid } from '../ui/icons';

const ROWS: Array<{ icon: React.ReactNode; head: string; sub: string }> = [
  { icon: <IconBranch s={14} />, head: 'Files', sub: 'the session\'s worktree, browsable by branch, in the drawer below' },
  { icon: <IconFile s={14} />, head: 'Artifacts', sub: 'what the agents write here: plans, drafts, diffs' },
  { icon: <IconGrid s={14} />, head: 'Task details', sub: 'requirements, the Definition of Done, subtasks' },
];

export function WorkbenchEmpty(): React.ReactElement {
  return (
    <div className="wbslotempty" role="note">
      <p className="wbez">This panel holds what a session is making.</p>
      <ul className="wbelist">
        {ROWS.map((r, i) => (
          // the delay rides a custom property rather than inline `animationDelay`, so the whole
          // stagger collapses to nothing under prefers-reduced-motion with one CSS rule
          <li key={r.head} style={{ ['--i' as string]: i }}>
            <span className="wbeic" aria-hidden>{r.icon}</span>
            <span className="wbetx"><b>{r.head}</b>{r.sub}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
