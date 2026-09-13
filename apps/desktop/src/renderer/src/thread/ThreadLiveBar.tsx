// The thread's live bar — who is working in here right now.
// Extracted from App.tsx (track A3).
import { AgentAvatar } from '../components/AgentAvatar';
import { IconMachine } from '../ui/icons';
import { Orb } from '../ui/Orb';
import { deepestActive, isRunOpen, type RunState } from '@neuramesh/shared';
import { isWatchableRun, runClock, type RunTree } from '../runs/runs';
import { orbStateFor } from '../views/SessionList';
import { plainTitle } from '../room-tabs';
import { type AgentRow } from '../bridge/rows-crew';
import { useEffect, useRef, useState } from 'react';
import { selfMachine } from '../lib/self';

/**
 * The resting line (docs/29 direction B): one row above the composer, in the beats-ticker slot.
 *
 * It exists for the moment the card scrolls out of the transcript — NOT to say the same thing
 * twice. While its own card is on screen the dock stands down, because two live surfaces telling
 * one story is the exact regression docs/26 spent a release deleting. The check rides the elapsed
 * tick this component already runs; no observer, no second timer.
 */
/**
 * Live work in THIS thread, said at the top of it (George, 2026-08-13).
 *
 * The gap it fills: a chat wake's story is told by the GHOST, and the ghost is local IPC — it
 * only exists on the machine running the agent. `RunDock` deliberately suppresses bare wakes for
 * that reason (`isWatchableRun`), which is right locally and leaves a viewer on ANY OTHER machine
 * watching messages appear out of nowhere. `runs` is synced, so the same moment is legible
 * everywhere; this renders it, and names the machine, which is the other half of the answer under
 * shared compute.
 *
 * Shown only when the work is NOT on this machine: locally the ghost and the run card already
 * tell it, and a third indicator for one story is the regression docs/26 spent a release deleting.
 */
export function ThreadLiveBar({ trees, agents }: { trees: RunTree[]; agents: AgentRow[] }) {
  const open = trees.filter((t) => isRunOpen(t.run.state as RunState));
  if (!open.length) return null;
  const t = open[open.length - 1]!;
  const host = t.run.machine_name ?? null;
  // unknown host = an older daemon that never stamped machine_id; treat it as elsewhere rather
  // than hide the bar, since "somewhere you cannot see" is exactly what needs saying
  if (host && selfMachine && host === selfMachine) return null;
  const agent = agents.find((a) => a.id === t.run.agent_id) ?? null;
  const deepest = deepestActive(t);
  const step = deepest?.node.run.step ?? t.run.step ?? 'working';
  return (
    <div className="tlivebar" role="status">
      <Orb state={orbStateFor(step, null, agent?.role ?? null)} label={step} />
      {agent && <AgentAvatar name={agent.name} size={18} radius={6} />}
      {agent && <b className="tlivename">{agent.name}</b>}
      {/* "is working", not the step. The ORB already carries the state (searching / composing /
          weaving read differently), so spelling the verb out again was noise on a bar whose job
          is just "someone is on this, over there" (George, 2026-08-13). The full step is still
          on the run card and in the activity panel for anyone who wants it. */}
      <span className="tliveverb shine">is working</span>
      <span className="tlivehost"><IconMachine s={11} />{host ?? 'another machine'}</span>
    </div>
  );
}

export function RunDock({ trees, agents, onOpen, scrollRef }: { trees: RunTree[]; agents: AgentRow[]; onOpen?: (a: AgentRow) => void; scrollRef?: React.RefObject<HTMLDivElement | null> }) {
  const [, tick] = useState(0);
  const [cardOnScreen, setCardOnScreen] = useState(false);
  const runIdRef = useRef<string | null>(null);
  useEffect(() => {
    const check = () => {
      const box = scrollRef?.current;
      const id = runIdRef.current;
      if (!box || !id) { setCardOnScreen(false); return; }
      const card = box.querySelector(`[data-run="${id}"]`);
      if (!card) { setCardOnScreen(false); return; }
      const c = card.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      setCardOnScreen(c.bottom > b.top + 8 && c.top < b.bottom - 8);
    };
    check();
    const iv = setInterval(() => { tick((n) => n + 1); check(); }, 1000);
    const box = scrollRef?.current;
    box?.addEventListener('scroll', check, { passive: true });
    return () => { clearInterval(iv); box?.removeEventListener('scroll', check); };
  }, [scrollRef]);
  // a bare wake is the ghost's story, and the ghost is already telling it in this very thread —
  // docking a second live line for the same turn is the exact "three indicators, one story"
  // regression docs/26 spent a release deleting
  const openRuns = trees.filter((t) => isRunOpen(t.run.state as RunState) && isWatchableRun(t));
  if (!openRuns.length) return null;
  const t = openRuns[openRuns.length - 1]!;
  runIdRef.current = t.run.id;
  if (cardOnScreen) return null; // its card is right there — say it once
  const agent = agents.find((a) => a.id === t.run.agent_id) ?? null;
  // The DEEPEST running leaf, plus the path to it (docs/harness/10 §4.1). With a tree three levels
  // deep, naming the root would report "three directions" while the actual work is two levels down —
  // true of the run, useless about the work. The path is what keeps a scrolled-away tree honest.
  const deepest = deepestActive(t);
  const path = deepest ? deepest.path.filter(Boolean).map(plainTitle) : [];
  const line = deepest && deepest.node.depth > 0
    ? `${path.join(' › ')}${deepest.node.run.step ? ` — ${deepest.node.run.step}` : ''}`
    : t.run.step ?? t.run.title;
  return (
    <button type="button" className="rundock" onClick={() => agent && onOpen?.(agent)} title="what's running — open activity">
      {/* the dock only ever shows LIVE work, and `.dockmeta` already prints "2/5" — so the ring
          was carrying nothing the text did not, and carrying it as a spinner */}
      <Orb state={orbStateFor(t.run.step ?? '', null, agent?.role ?? null)} label={t.run.step ?? 'working'} />
      {agent && <span className="dockname">{agent.name}</span>}
      <span className="dockverb shine">{line}</span>
      <span className="dockmeta">{t.run.total > 0 ? `${t.run.done}/${t.run.total} · ` : ''}{runClock(t.run)}</span>
    </button>
  );
}
