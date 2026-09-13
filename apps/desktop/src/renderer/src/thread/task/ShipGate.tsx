// The ship gate in the task panel (docs/23) — the release-plan card, the approve/bounce row,
// and the verifying row that exists only for the failure path.
//
// Ticks are COMMANDS: the server decides who may check what (an agent can never tick a human
// item) and refuses the shipper's merge until the list clears. Nothing here is a local edit.
//
// Split out of thread/TaskThread.tsx as a hook rather than components: it builds the same JSX
// values the panel already built, in the same order, so the render tree is unchanged.
import { useMemo, useState } from 'react';
import { nm as nmBridge } from '../../bridge/nm';
import type { ShipPlan } from '@neuramesh/shared';
import type { ArtifactUI, TaskRow } from '../../bridge/rows-board';

const nm = nmBridge;

type ComposerMode = 'request_changes' | 'revise_design' | 'revise_ship_plan' | 'revise_plan' | null;

export function useShipGate(d: {
  task: TaskRow;
  busy: boolean;
  setBusy: (v: boolean) => void;
  actErr: string;
  setActErr: (v: string) => void;
  act: (type: string, fb?: string, opts?: { silentThread?: boolean }) => Promise<void>;
  agentName: (id: string | null) => string | null;
  openSubs: Array<{ id: string }>;
  composerMode: ComposerMode;
  setComposerMode: React.Dispatch<React.SetStateAction<ComposerMode>>;
  canReview: boolean;
  latestShipPlan: ArtifactUI | undefined;
  openPlan: (name?: string) => void;
  onPreview: (name?: string) => void;
}) {
  const { task, busy, setBusy, actErr, setActErr, act, agentName, openSubs, composerMode, setComposerMode, canReview, latestShipPlan, openPlan, onPreview } = d;
// Ship gate (docs/23): the release plan + owner-tagged checklist, live in the dock
// while the task is in ship_review (approve/bounce) and releasing (tick the boxes).
// Ticks are commands — the server enforces who may check what (an agent can never
// tick a human item) and refuses the shipper's merge until the list clears.
const shipPlan = useMemo<ShipPlan | null>(() => {
  if (!task.ship_plan) return null;
  try { return JSON.parse(task.ship_plan) as ShipPlan; } catch { return null; }
}, [task.ship_plan]);
const [shipAddOpen, setShipAddOpen] = useState(false);
const [shipAddTitle, setShipAddTitle] = useState('');
const tickShipItem = async (itemId: string, state: 'pending' | 'done' | 'na') => {
  if (!nm || busy) return;
  setBusy(true); setActErr('');
  try { await nm.shipItem(task.id, itemId, state); }
  catch (e) { setActErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 110) : 'could not update the item'); }
  finally { setBusy(false); }
};
const addShipItem = async () => {
  if (!nm || busy || !shipAddTitle.trim()) return;
  setBusy(true); setActErr('');
  try { await nm.shipItemAdd(task.id, shipAddTitle.trim()); setShipAddTitle(''); setShipAddOpen(false); }
  catch (e) { setActErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 110) : 'could not add the item'); }
  finally { setBusy(false); }
};
const shipCard = shipPlan && (task.state === 'ship_review' || task.state === 'releasing') ? (
  <div className="shipcard">
    <div className="shiphead">
      <span className="shipt">Release plan · v{shipPlan.round}</span>
      <span className={`riskchip risk-${shipPlan.risk}`}>{shipPlan.risk}</span>
      <span className="shipmeta">
        {task.state === 'releasing'
          ? `${shipPlan.items.filter((i) => i.state !== 'pending').length}/${shipPlan.items.length}`
          : `${shipPlan.items.length} item${shipPlan.items.length === 1 ? '' : 's'}${shipPlan.items.filter((i) => i.owner === 'human').length ? ` · ${shipPlan.items.filter((i) => i.owner === 'human').length} need you` : ''}`}
      </span>
    </div>
    {shipPlan.summary && <div className="shipsum">{shipPlan.summary}</div>}
    {shipPlan.items.map((i) => {
      const done = i.state !== 'pending';
      const tickable = task.state === 'releasing' && !busy;
      const who = i.owner === 'human' ? 'you' : i.owner === 'agent' ? `@${agentName(i.agentId) ?? 'agent'}` : 'shipper';
      return (
        <div key={i.id} className={`shiprow${done ? ' done' : ''}${i.owner === 'human' && !done && task.state === 'releasing' ? ' you' : ''}`}>
          <button
            className="shiptick"
            disabled={!tickable}
            title={task.state === 'releasing' ? (done ? 'untick' : `mark done${i.owner === 'human' ? '' : ` (${who}'s item)`}`) : 'the checklist arms once the plan is approved'}
            onClick={() => void tickShipItem(i.id, done ? 'pending' : 'done')}
          >
            {done ? (
              <svg className="ckc" viewBox="0 0 17 17"><circle cx="8.5" cy="8.5" r="8" /><path d="M5.4 8.9l2.1 2.1 4-4.6" /></svg>
            ) : (
              <span className="beatring" />
            )}
          </button>
          <span className="ti" title={i.detail || i.title}>{i.title}</span>
          {done && i.checkedBy && <span className="who">{i.checkedBy.kind === 'human' ? 'you' : agentName(i.checkedBy.id) ?? 'agent'}{i.state === 'na' ? ' · n/a' : ''}</span>}
          <span className={`ownchip${i.owner === 'human' ? ' youchip' : ''}`}>{who}</span>
        </div>
      );
    })}
    {task.state === 'releasing' && (
      <div className="shipfoot">
        {shipAddOpen ? (
          <div className="tbounce" style={{ margin: 0 }}>
            <input value={shipAddTitle} onChange={(e) => setShipAddTitle(e.target.value)} placeholder="a late-found step — re-arms the merge until checked" autoFocus
              onKeyDown={(e) => e.key === 'Enter' && shipAddTitle.trim() && void addShipItem()} />
            <button className="btn sm" disabled={busy || !shipAddTitle.trim()} onClick={() => void addShipItem()}>Add</button>
          </div>
        ) : (
          <button className="btn ghost sm" disabled={busy} onClick={() => setShipAddOpen(true)}>+ Add item</button>
        )}
        <span className="shiplock">⌀ {agentName(shipPlan.shipperId) ?? 'the shipper'} merges the moment every box clears — nothing ships early</span>
      </div>
    )}
  </div>
) : null;

// Ship gate action bar: approving the release plan is the human sign-off that
// arms the checklist (HUMAN_ONLY, like design approval); the direct accept stays
// one step away — the gate is a paved road, never a cage.
// `shipping` is the shipper's drafting stage — it used to render NOTHING, which
// is how a quiet shipper became a dead end. The human keeps both levers here:
// add another round of notes (revise_ship_plan, legal as a self-loop) or accept
// straight past the gate.
const shipActions = task.state === 'ship_review' || task.state === 'releasing' || task.state === 'shipping' ? (
  <>
    <div className="tactions">
      {task.state === 'ship_review' && (
        <button className="btn accept" disabled={busy || openSubs.length > 0} onClick={() => void act('task.approve_ship_plan')} title={openSubs.length ? `${openSubs.length} subtask(s) open — finish or cancel them first` : 'approve the release plan — owners tick their items, the shipper merges when the list clears'}>✓ Approve release plan</button>
      )}
      {(task.state === 'ship_review' || task.state === 'shipping') && (
        <button
          className="btn"
          disabled={busy}
          aria-pressed={composerMode === 'revise_ship_plan'}
          onClick={() => { if (composerMode === 'revise_ship_plan') setComposerMode(null); else setComposerMode('revise_ship_plan'); }}
          title={task.state === 'shipping' ? 'add another round of notes — the shipper redrafts the plan' : 'send the plan back to the shipper — arms the reply box below'}
        >Request changes</button>
      )}
      {canReview && (
        <button className="btn" disabled={busy} onClick={() => (latestShipPlan ? openPlan(latestShipPlan.name) : onPreview())} title="open the release plan — comment block-by-block, approve, or request changes">Open plan ↗</button>
      )}
      <button className="btn ghost" disabled={busy} onClick={() => void act('task.accept')} title="skip the gate — accept & merge now (the human escape hatch)">Skip gate — accept</button>
      {actErr && <span className="acterr">{actErr}</span>}
    </div>
  </>
) : null;

// Verifying (docs/23 v2): merged — the shipper's host is watching the release
// land (post-merge CI + pipelines; evidence posts to the thread). Normally
// zero-click; this row exists for the failure path: Accept overrides a red or
// hung verdict, Request changes bounces a fix-forward round (fresh PR).
const verifyingActions = task.state === 'verifying' ? (
  <div className="tactions">
    {latestShipPlan && (
      <button className="btn" disabled={busy} onClick={() => openPlan(latestShipPlan.name)} title="the approved release plan (read-only)">Open plan ↗</button>
    )}
    <button
      className="btn"
      disabled={busy}
      aria-pressed={composerMode === 'request_changes'}
      onClick={() => { if (composerMode === 'request_changes') setComposerMode(null); else setComposerMode('request_changes'); }}
      title="the PR is already merged — this bounces a fix-forward round (the next submit opens a fresh PR)"
    >Request changes</button>
    <button className="btn ghost" disabled={busy} onClick={() => void act('task.accept')} title="accept over the verification verdict — your call, recorded in the events log">Accept anyway</button>
    {actErr && <span className="acterr">{actErr}</span>}
  </div>
) : null;
  return { shipActions, shipCard, verifyingActions };
}
