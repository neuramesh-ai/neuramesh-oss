// Runs (docs/29) in the thread — the card for a stretch of synced work and the dock that
// collects them. Extracted from App.tsx (track A3).
import { ActivityItems, LEG_ACT_ROWS } from './AgentGhost';
import { AgentAvatar } from '../components/AgentAvatar';
import { IconAgents, IconCheck, ProviderMark } from '../ui/icons';
import { Orb } from '../ui/Orb';
import { groupActivity } from '../activity';
import { isRunOpen, runFraction, subtreeSize, type RunState } from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { orbStateFor } from '../views/SessionList';
import { parseSeat, rollupChips, runClock, type RunTree } from '../runs/runs';
import { plainTitle } from '../room-tabs';
import { timeAgo } from '../lib/time';
import { type AgentRow, type LogRow } from '../bridge/rows-crew';
import { useEffect, useMemo, useState } from 'react';
import { selfMachine } from '../lib/self';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/** Past this depth a branch shows a count instead of its children — depth is unbounded, attention is not. */
export const RUN_COLLAPSE_DEPTH = 2;

/**
 * A run row's state mark.
 *
 * RUNNING wears a thinking orb (the 2026-08-06 design round), the same one rex wears in a thread
 * — "the state IS the animation". A task's progress was still drawing the pre-orb `.legdot`
 * pulse, so the two surfaces told the same story in two different visual languages: an agent
 * working in a thread breathed, and the identical agent working a task blinked a generic dot.
 *
 * SETTLED rows keep the check / pause-bar / stop glyphs. That is deliberate, and the same rule
 * the typewriter follows: a finished thing never animates. The orb marks a live moment only.
 */
export function RunMark({ state, step, role }: { state: string; step?: string | null; role?: string | null }) {
  if (state === 'running') return <Orb state={orbStateFor(step ?? '', null, role ?? null)} label={step ?? 'working'} />;
  if (state === 'done') return <IconCheck s={11} />;
  // parked (docs/harness/05) is a PAUSE BAR PAIR, not a colour: the runs card is monochrome by
  // design — "SHAPE carries state (pulse / check / bar)" — and bar was already in that vocabulary.
  if (state === 'parked') return <span className="legpark" aria-hidden><i /><i /></span>;
  return <span className="legstop" aria-hidden />;
}

export function LegActivity({ runId, hostedOn, depth = 0, live = true }: { runId: string; hostedOn?: string | null; depth?: number; live?: boolean }) {
  const [rows, setRows] = useState<LogRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    void nm?.agentLogs({ runId, limit: 120 }).then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [runId]);
  // live: a running leg keeps writing, so append its rows as they land
  useEffect(() => nm?.watchAgentLogs((row) => {
    if (row.run_id === runId) setRows((prev) => [...(prev ?? []).slice(-119), row]);
  }), [runId]);
  // NARRATION IS KEPT. The old filter dropped it and left only tool rows, which is why the thread
  // read as a bare command log while the panel read as an agent thinking out loud — the prose
  // between the calls ("The design system is well-established, I'll match its tokens") is the part
  // a human actually understands, and it was the one part the thread threw away.
  const items = useMemo(() => groupActivity(rows ?? []).filter((it) => it.t !== 'event'), [rows]);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (id: number) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // A running block keeps to its tail so the thread doesn't become a scroll of history. A SETTLED
  // one shows everything: the leg is closed by hand at that point, and this fold is now the only
  // way to the full story — the "view subagent activity" escalation that used to reach the panel
  // is gone. Slicing unconditionally (as this did) capped a finished leg at its last five steps.
  const last = live ? items.slice(-LEG_ACT_ROWS) : items;
  // Served by SOMEONE ELSE'S machine (0114). `agent_logs` is machine-local and deliberately not
  // synced — code and tool arguments never leave the machine that ran them — so the rows are on
  // that laptop, not missing. This is the ONE thing worth saying in place of steps, because the
  // absence has a cause the human can act on ("look on sam-mbp").
  const elsewhere = !!hostedOn && !!selfMachine && hostedOn !== selfMachine;
  // NOTHING, rather than "no tool calls recorded yet". An empty log is not news: if there are no
  // steps, there are no steps, and a line saying so is one more thing to read on a card that is
  // already several rows deep. Silence is the honest rendering of nothing.
  if (!last.length && !elsewhere) return null;
  return (
    // `activitylog` on purpose: the row styling lives under that class, and duplicating it for the
    // thread is how the two drifted apart in the first place. `threadact` trims the panel's height.
    // The steps carry the LEG'S OWN depth (`d1/d2/d3`, the same ladder `.leg` climbs). Without it
    // every block sat at one flat indent, so a depth-2 leg's steps rendered further LEFT than the
    // leg they belong to — reading as the grandparent's work, sandwiched between its siblings.
    <div className={`legact logwrap activitylog threadact d${Math.min(depth, 3)}`}>
      {/* No "view subagent activity ›" escalation: every leg's steps already fold open from its
          own row, so the button repeated the affordance beside it — one per leg, which on a wide
          fan-out was more button than content. The full panel is still one click from the card's
          "view full activity". */}
      {!last.length
        ? <span className="actempty">ran on {hostedOn} — its step log stays on that machine</span>
        : <ActivityItems items={last} open={open} toggle={toggle} />}
    </div>
  );
}

/**
 * One leg row and everything under it, recursively.
 *
 * Depth is the indent (`.leg.d1/.d2/.d3`, capped) — a deep tree reads as a ladder rather than as
 * stripes because only an OPENED row carries a fill. Past RUN_COLLAPSE_DEPTH a branch states its
 * size instead of expanding, and clicking it opens that branch alone.
 *
 * The row itself is a button: clicking unfolds this leg's own activity in place (docs/29). Before
 * this it was inert, and the card's single Activity button opened the ORCHESTRATOR's panel — so a
 * fan-out of five subagents offered no way to ask what any one of them was doing.
 */
export function RunLeg({ node, root }: { node: RunTree; root: boolean }) {
  const [open, setOpen] = useState(node.depth < RUN_COLLAPSE_DEPTH);
  // Steps stream in WHILE the leg runs and fold away when it settles, leaving the heading as
  // the landmark (with its step count and the arrow to re-open). Progress you have to click for
  // is progress nobody sees; a finished thread of expanded tool calls is a wall.
  const [peek, setPeek] = useState(node.run.state === 'running');
  const l = node.run;
  // Fires only on the transition, so a human who deliberately opens a settled leg keeps it open.
  useEffect(() => { if (l.state !== 'running') setPeek(false); }, [l.state]);
  const below = subtreeSize(node);
  const cls = l.state === 'running' ? 'on' : l.state === 'done' ? 'done' : l.state === 'parked' ? 'parked' : 'stopped';
  const depthCls = `d${Math.min(node.depth, 3)}`;
  const collapsed = below > 0 && !open;
  const seat = parseSeat(l.seat);
  return (
    <>
      <div className={`leg ${cls} ${depthCls}${node.legs.length ? ' sub' : ''}${peek ? ' open' : ''}`}>
        <button type="button" className="legbtn" aria-expanded={peek} onClick={() => setPeek((p) => !p)}
          title={peek ? 'hide this subagent’s steps' : 'show this subagent’s steps'}>
          {/* the orb reads the leg's OWN step, so a searching leg and a composing one are visibly
              different moments rather than one generic pulse */}
          <span className="legmark"><RunMark state={l.state} step={l.step} /></span>
          <span className={`legname${l.state === 'running' && !l.step ? ' shine' : ''}`}>{plainTitle(l.title)}</span>
          {collapsed ? null : l.state === 'running' ? (
            // keyed on the text so the sheen + enter replay when the step advances — the same
            // treatment `.liveact-txt` gets in a thread, which is what made progress read as
            // movement there and as a static line here
            <span className="legverb shine" key={l.step ?? 'starting'}>{l.step ?? 'starting'}</span>
          ) : l.summary ? (
            <span className="legverb">{l.summary}</span>
          ) : null}
          <span className="legpeek">{peek ? '▾ steps' : 'steps ›'}</span>
        </button>
        {/* the seat: which config this leg runs on, and whose. It moved here from the board card —
            with the orchestrator owning tasks, the assignee is rex on every one of them. */}
        {seat && (
          <span className="legseat" data-tip={seat.from ? `inherits @${seat.from}’s seat · ${seat.model}` : `no specialist in this room — role default · ${seat.model}`}>
            {/* the PROVIDER, not an initial: at a glance the row says which vendor is serving this
                step. A dashed ring marks a role default, so "whose config" is still legible. */}
            <span className={`seatmark${seat.from ? '' : ' fallback'}`}><ProviderMark model={seat.model} /></span>
            {seat.label}
          </span>
        )}
        {collapsed && (
          <button type="button" className="legmore" onClick={() => setOpen(true)}>
            {below} below{l.state === 'running' ? ' · running' : ''} ▸
          </button>
        )}
        {l.total > 0 && <span className="legnum">{l.done}/{l.total}</span>}
      </div>
      {peek && <LegActivity runId={l.id} hostedOn={l.machine_name} depth={node.depth} live={l.state === 'running'} />}
      {open && node.legs.map((child) => <RunLeg key={child.run.id} node={child} root={false} />)}
      {void root}
    </>
  );
}

export function RunCard({ tree, agent, onActivity }: { tree: RunTree; agent?: AgentRow | null; onActivity?: (a: AgentRow) => void }) {
  const { run, legs } = tree;
  const live = isRunOpen(run.state as RunState);
  // elapsed ticks only while the run is open — a settled card shows the time it TOOK
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const iv = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [live]);
  const [open, setOpen] = useState(true);
  // a settled run folds itself away: the story is told, the row stays as the receipt
  useEffect(() => { if (!live) setOpen(false); }, [live]);
  const frac = runFraction({ state: run.state as RunState, done: run.done, total: run.total });
  return (
    <div className={`msg runmsg${live ? ' live' : ''}`} data-run={run.id}>
      {agent ? <AgentAvatar name={agent.name} size={26} /> : <span className="av" aria-hidden>·</span>}
      <div className="body">
        <div className="head">
          <b>{agent?.name ?? 'agent'}</b>
          {agent?.role ? <span className="rolechip msgrole" data-role={agent.role}>{agent.role}</span> : null}
          <span className="time">{live ? 'now' : timeAgo(run.ended_at ?? run.started_at)}</span>
        </div>
        <div className="runcard">
          <button type="button" className="runhead" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={open ? 'collapse' : 'show the steps'}>
            {/* LIVE wears the orb, like every other live-agent moment. Settled keeps the ring —
                there it is a completion RECEIPT (a filled fraction), not a spinner, and an orb
                cannot say "3 of 5 done". The numbers survive on the step row either way. */}
            {live
              ? <Orb state={orbStateFor(run.step ?? '', null, agent?.role ?? null)} label={run.step ?? 'working'} />
              : <span className="rring settled" style={{ ['--frac' as string]: `${Math.round(frac * 100)}%` }} aria-hidden />}
            <span className="runtitle">{run.title}</span>
            <span className="runmeta">
              {/* WHOSE machine (0114). An agent is a workspace-level resource that runs on a
                  member's own laptop under their own subscription, so "rex is working" is only
                  half the story — this is the other half, and the reason a run can keep going
                  when your own machine is asleep. Absent on runs from before the column existed. */}
              {run.machine_name && (
                <span className="runhost" data-tip={`served by ${run.machine_name} — this member's machine and subscription`}>
                  <IconAgents s={11} />{run.machine_name}
                </span>
              )}
              <span className={`chip c-run-${run.state}`}>{run.state}</span>
              <span className="runclock">{runClock(run)}</span>
            </span>
          </button>
          {open && (
            <div className="runlegs">
              {/* the live root row: `run.step` is what the human reads to know something is
                  happening, so it carries the sheen. It rendered as a plain .legname before,
                  which is why a card whose legs had all finished sat visually dead. */}
              {live && (
                <div className="leg on">
                  <span className="legmark"><RunMark state={run.state} step={run.step} role={agent?.role} /></span>
                  {/* keyed like the thread's live line: the step is the thing that moves, so it
                      must visibly move when it changes */}
                  <span className="legname shine" key={run.step ?? 'working'}>{run.step ?? 'working'}</span>
                  {run.total > 0 && <span className="legnum">{run.done}/{run.total}</span>}
                </div>
              )}
              {/* The ROOT's own steps, streaming. `run.step` is a single humanized verb, so a turn
                  that spawned designers and wrote three files read as "taking stock" for minutes
                  while the activity panel filled with sixteen steps. The child-leg fix did not cover
                  this: until a subagent leg EXISTS there is no RunLeg to expand. */}
              {live && <LegActivity runId={run.id} hostedOn={run.machine_name} />}
              {legs.map((child) => <RunLeg key={child.run.id} node={child} root />)}
              {!live && run.summary && <div className="leg done"><span className="legmark"><IconCheck s={11} /></span><span className="legname">{run.summary}</span></div>}
            </div>
          )}
          {/* the subtree roll-up, so a COLLAPSED card still states its shape (docs/harness/10 §3) */}
          {legs.length > 0 && (
            <div className="runroll">
              {rollupChips(tree).map((c) => <span key={c} className="rollchip">{c}</span>)}
            </div>
          )}
          {live && agent && (
            <div className="runfoot">
              {/* "full" because each leg row now opens its OWN activity — this one is the
                  whole tree's, and the label has to say which of the two it is */}
              <button type="button" className="runbtn" onClick={() => onActivity?.(agent)}>view full activity</button>
              <span className="runnote">{run.kind === 'work' ? 'the report posts here when it lands' : 'replying here'}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
