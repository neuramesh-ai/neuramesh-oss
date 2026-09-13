// The compute panel (docs/compute-choice) — which machine answers, and on whose terms.
// Extracted from App.tsx (track A2).
import { useState } from 'react';
import { AgentAvatar } from '../components/AgentAvatar';
import { ChipMenu } from '../ui/ChipMenu';
import { availableMachines, capResetLabel, placementFor, planLabel, type ComputePrefs, type MachineCapability } from '@neuramesh/shared';
import { isOnline } from '../lib/presence';
import { refreshCompute, useCompute, type ComputeView } from './useCompute';
import { wakeNow } from './CapGate';
import { nm as nmBridge } from '../bridge/nm';
import { parseComputePrefs } from './prefs';
import { machineKindLabel } from './machine-choice';
import { NM_PLATFORM } from '../lib/platform';
import { runtimeLabel } from '../lib/runtimes';
import { fmtDur, timeAgo } from '../lib/time';
import { type AgentRow, type MachineRow, type MemberRow } from '../bridge/rows-crew';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/**
 * A CLOUD machine's extra row: the day meter, the derived reason, and the one action that can
 * change the state. Its own component because the machine row's arrow was carrying every branch
 * for both machine kinds at once, and a local laptop has none of this.
 *
 * The meter is visible BEFORE the cap, not only after: it turns warn in its last fifth, which is
 * a heads-up that costs nobody an interruption.
 */
/**
 * THE THREE FACTS A PERSON ACTUALLY ASKS OF A MACHINE: is it up, for how long, and when does it
 * go away. Every one was already in the database and none of them reached a screen.
 *
 * Each renders only when it is TRUE rather than filling the row with placeholders:
 *   · uptime needs a real start. It is NOT now() - lastWakeAt — that moves on every message, so
 *     it would read seconds on a busy workspace and days on a quiet one, and be uptime on
 *     neither. A stopped machine has no start and simply shows none.
 *   · "last seen" is the heartbeat; "worked" is last_active_at, which is what the credit meter
 *     bills. They differ, and a machine that is up but idle is worth being able to see.
 *   · the sleep window is the server's own effective number (machineIntent derives it), never a
 *     constant retyped here — that is how the last stale "60 minutes" survived so long.
 */
function MachineFacts({ state }: { state: ComputeView }) {
  const up = state.startedAt && state.status === 'online' ? fmtDur(Date.now() - Date.parse(state.startedAt)) : null;
  const idleH = state.idleStopMin ? Math.round(state.idleStopMin / 60) : null;
  const bits = [
    up ? `up ${up}` : null,
    state.lastSeenAt ? `seen ${timeAgo(state.lastSeenAt)}` : null,
    state.lastActiveAt ? `worked ${timeAgo(state.lastActiveAt)}` : null,
    idleH ? `sleeps after ${idleH}h idle` : state.idleStopMin === null ? 'never auto-sleeps' : null,
  ].filter(Boolean);
  if (!bits.length) return null;
  return <div className="cmpfacts">{bits.join(' · ')}</div>;
}

function CloudRow({ state, onUpgrade }: { state: ComputeView | null; onUpgrade?: (reason: string) => void }) {
  const [waking, setWaking] = useState(false);
  if (!state) return null;
  const cap = state.capMinutes;
  const pct = cap ? Math.min(100, Math.round((state.minutes / cap) * 100)) : 0;
  const fill = cap && state.minutes >= cap ? ' spent' : cap && state.minutes / cap >= 0.8 ? ' low' : '';
  return (
    <div className="cmpcloud">
      {cap !== null ? (
        <div className="capmeter">
          <div className="captrack"><div className={`capfill${fill}`} style={{ width: `${pct}%` }} /></div>
          <div className="caplabel">
            <span className={state.status === 'capped' ? 'capspent' : undefined}>{state.minutes} of {cap} min used today</span>
            <span>resets at {capResetLabel(Date.now())}</span>
          </div>
        </div>
      ) : <div className="caplabel"><span>{state.minutes} min today</span><span>no daily cap</span></div>}
      <div className="cmpwhy">{state.reason}</div>
      <MachineFacts state={state} />
      <div className="capacts">
        {state.status === 'capped' && <button className="btn primary sm" onClick={() => onUpgrade?.(state.reason)}>Get {planLabel('cloud')}</button>}
        {/* "Wake now" is offered only where it can succeed. A capped machine cannot be woken, and
            a button that refuses is worse than one that is not there. */}
        {(state.status === 'asleep' || state.status === 'unreachable') && (
          <button className="btn ghost sm" disabled={waking}
            onClick={() => { setWaking(true); void wakeNow((r) => onUpgrade?.(r)).finally(() => { setWaking(false); refreshCompute(); }); }}>
            {waking ? 'Waking…' : 'Wake now'}
          </button>
        )}
      </div>
    </div>
  );
}

export function ComputePanel({ machines, members, agents, selfMachineName, selfUserId, onRevoke, onUpgrade }: {
  machines: MachineRow[];
  /** open the shared upgrade surface with a reason — the cap's only way forward from here */
  onUpgrade?: (reason: string) => void;
  members: MemberRow[];
  agents: AgentRow[];
  /** confirm before un-lending — the modal owns the count of what keeps running regardless */
  onRevoke: (r: { member: MemberRow; apply: () => void }) => void;
  /** `machines` upserts on (workspace, name) and bootstrap() already reports this host's name —
   *  so the name IS the identity here, and no extra IPC bridge is needed to know which row is us */
  selfMachineName: string | null;
  selfUserId: string | null;
}) {
  const cloudState = useCompute(true);
  const nameOf = (userId?: string | null): string => {
    if (!userId) return 'unknown';
    const m = members.find((x) => x.user_id === userId);
    return m?.display_name?.trim() || (userId === selfUserId ? 'you' : 'a teammate');
  };
  const runtimesOf = (m: MachineRow): string[] => {
    try { return JSON.parse(m.runtimes ?? '[]') as string[]; } catch { return []; }
  };
  // what each machine is serving right now — an agent whose live run is hosted here
  const busyOn = (m: MachineRow): AgentRow[] => agents.filter((a) => a.hosted_on === m.name);
  // members whose requests must ride someone else's machine
  const hostless = members.filter((mem) => !machines.some((m) => m.owner_user_id === mem.user_id));

  // ── compute choice (0118): where MY requests run ──────────────────────────────────────────
  const prefs = parseComputePrefs(members.find((m) => m.user_id === selfUserId)?.compute);
  // sharesWith is load-bearing: without it machineAvailableTo answers "no" for every peer and the
  // whole panel reads "not shared" while the Agents page (which does join it) says otherwise
  const caps: MachineCapability[] = machines.map((m) => ({
    machineId: m.id, ownerUserId: m.owner_user_id ?? '', runtimes: runtimesOf(m), lastSeenAt: m.last_seen_at,
    sharesWith: parseComputePrefs(members.find((x) => x.user_id === m.owner_user_id)?.compute).shares ?? [],
  }));
  const machineName = (id: string | null): string => machines.find((m) => m.id === id)?.name ?? 'none';
  // routable agents only: an external A2A agent answers over its endpoint, not on anyone's machine
  const placeable = agents.filter((a) => !a.retired_at && a.kind !== 'remote');
  // every write carries `shares` back untouched — omitting it would silently revoke every grant
  // this member has given, which is the kind of data loss a partial update quietly causes
  // only the fields this control owns — `member.set_compute` is a partial update now, so the
  // panel no longer has to re-send `shares` defensively to avoid clobbering it
  const set = (p: ComputePrefs) => { void nm?.setCompute({ machine: p.machine ?? null, agents: p.agents ?? {} }).catch(() => {}); };
  const now = Date.now();
  // CONSENT (0119): what this member may actually reach — theirs plus what others lend them.
  const reach = availableMachines(caps, selfUserId);
  // the workspace runner is everyone's by construction (the ladder's `wakeCandidates` treats it as
  // lent), so the row never says "not shared" about it
  const canUse = (m: MachineRow) => m.kind === 'runner' || reach.some((c) => c.machineId === m.id);
  const mine = machines.filter((m) => m.owner_user_id === selfUserId);
  const lent = machines.filter((m) => m.owner_user_id !== selfUserId && canUse(m));
  const closed = machines.filter((m) => !canUse(m));

  return (
    <>
      <div className="sect" style={{ padding: '6px 0 5px' }}>Compute</div>
      <p className="wshint">Workspace agents run on members&rsquo; machines, each request on that member&rsquo;s subscription.</p>

      <div className="cmpdef">
        <span className="cmpdeflbl">Your requests run on</span>
        <ChipMenu icon="⌂" title="the machine your new conversations run on"
          label={prefs.machine ? machineName(prefs.machine) : 'Auto'}
          value={prefs.machine ?? ''}
          options={[{ value: '', label: 'Auto (the machine you ask from)' },
            ...machines.filter(canUse).map((m) => ({ value: m.id, label: `${m.name} · ${nameOf(m.owner_user_id)}` }))]}
          onPick={(v) => set({ machine: v || null, agents: prefs.agents ?? {} })} />
      </div>
      <p className="wshint">New conversations only. Existing threads stay with their files.</p>

      {placeable.length > 0 && machines.length > 1 && (
        <>
          <div className="sect">Agent placement</div>
          <div className="agplace">
            {placeable.map((a) => {
              const rt = a.runtime ?? 'claude-code';
              const eff = placementFor({ id: a.id, runtime: rt, model: a.model }, prefs, caps, selfUserId, now);
              const why = eff.why === 'agent-choice' ? 'your pick'
                : eff.why === 'default' ? 'your default'
                  : eff.why === 'origin' ? 'your machine'
                    : eff.why === 'failover' ? `no ${runtimeLabel(rt).toLowerCase()} on yours`
                      : `nobody serves ${runtimeLabel(rt).toLowerCase()}`;
              // only machines that can actually serve this agent are offerable — an incapable
              // pick would just fail over anyway, and the row's reason already says why
              const options = [{ value: '', label: 'Auto' },
                ...machines.filter((m) => canUse(m) && runtimesOf(m).includes(rt)).map((m) => ({ value: m.id, label: `${m.name} · ${nameOf(m.owner_user_id)}` }))];
              return (
                <div key={a.id} className="agplacerow">
                  <span className="agplacename"><AgentAvatar name={a.name} size={20} radius={6} /> {a.name}</span>
                  <span className="cmprt">{runtimeLabel(rt)}</span>
                  <span className="agplaceeff">
                    <span className="agplacem">{machineName(eff.machineId)}</span>
                    <span className="agplacewhy">{why}</span>
                  </span>
                  {/* a pick whose grant was revoked reads Auto, not the machine it can no longer
                      use — the effective column beside it already shows where the work really goes */}
                  <ChipMenu icon="⌂" label={(() => { const p = prefs.agents?.[a.id]; const m = p ? machines.find((x) => x.id === p) : null; return m && canUse(m) ? m.name : 'Auto'; })()}
                    title={`where your ${a.name} requests run`}
                    value={(() => { const p = prefs.agents?.[a.id]; const m = p ? machines.find((x) => x.id === p) : null; return m && canUse(m) ? p! : ''; })()}
                    options={options}
                    onPick={(v) => {
                      const next = { ...(prefs.agents ?? {}) };
                      if (v) next[a.id] = v; else delete next[a.id];
                      set({ machine: prefs.machine ?? null, agents: next });
                    }} />
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="sect">Machines available to you</div>

      {machines.length === 0 ? (
        <div className="locked"><span>No machines are serving this workspace yet.</span></div>
      ) : [...mine, ...lent, ...closed].map((m) => {
        const online = isOnline(m.last_seen_at);
        const rts = runtimesOf(m);
        const busy = busyOn(m);
        return (
          <div key={m.id} className={`cmprow${canUse(m) ? '' : ' notmine'}`}>
            <span className={`cmpdot${online ? ' on' : ''}`} aria-hidden />
            <div className="cmpbody">
              <div className="cmphead">
                <b>{m.name}</b>
                {/* rows SAY THEIR KIND (rule D9): the pill used to call a laptop "Cloud machine" */}
                <span className="cmpkind">{machineKindLabel({ kind: m.kind ?? 'local', ownerUserId: m.owner_user_id ?? null }, selfUserId, selfMachineName ? (machines.find((x) => x.name === selfMachineName)?.id ?? null) : null, m.id)}</span>
                <span className="cmpowner">{m.kind === 'runner' ? 'workspace' : nameOf(m.owner_user_id)}</span>
                {m.owner_user_id !== selfUserId && (canUse(m)
                  ? <span className="cmpshared">shared with you</span>
                  : <span className="machnoshare">not shared</span>)}
              </div>
              {/* Capability, not decoration: a machine with no runtime cannot be waited for, so
                  peers claim its member's work immediately. Saying so beats an unexplained handoff. */}
              <div className="cmpmeta">
                {rts.length
                  ? rts.map((r) => <span key={r} className="cmprt">{r}</span>)
                  : <span className="cmprt none">nothing installed, so its work runs elsewhere</span>}
              </div>
              {m.kind === 'runner' && <CloudRow state={cloudState} onUpgrade={onUpgrade} />}
            </div>
            <span className="cmpstate">
              {/* A CLOUD machine has an intent as well as a heartbeat, so "offline" is not an
                  answer for it — cloudState carries the derived one (asleep / waking / capped /
                  unreachable) and the reason. A LOCAL machine has no fleet intent at all, so it
                  keeps the plain online/offline reading it always had. */}
              {cloudState && m.kind === 'runner'
                ? <span className={`cmpmstate ${cloudState.status}`} title={cloudState.reason}>{cloudState.status}</span>
                : !online ? <span className="cmpoff">offline</span>
                  : busy.length ? <span className="cmpbusy">{busy.map((a) => a.name).join(', ')} working</span>
                    : <span className="cmpidle">standing by</span>}
            </span>
          </div>
        );
      })}

      {/* THE DESKTOP-ONLY DEFAULT (rule D9, 2026-09-04): sessions you start on this Mac run on This Mac
          or Auto. Drawn by the desktop client alone — a web-born session is never "here" — and stored
          in the member's compute prefs beside the per-agent choices, so it syncs like they do.
          Gated on "not the browser": the preview harness is desktop-hosted and must draw it too. */}
      {NM_PLATFORM !== 'web' && (
        <div className="cmpsetting" role="group" aria-label="Sessions you start on this Mac">
          <div className="k">Sessions you start on this Mac <i>desktop only</i></div>
          <div className="q">Run them on</div>
          <div className="cmpradios">
            <button className={`cmpradio${prefs.desktopSessions === 'here' ? ' on' : ''}`} aria-pressed={prefs.desktopSessions === 'here'} onClick={() => void nm?.setCompute({ desktopSessions: 'here' }).catch(() => {})}>
              <span>This Mac</span><small>your keys, your files, no relay in the path</small>
            </button>
            <button className={`cmpradio${prefs.desktopSessions !== 'here' ? ' on' : ''}`} aria-pressed={prefs.desktopSessions !== 'here'} onClick={() => void nm?.setCompute({ desktopSessions: 'auto' }).catch(() => {})}>
              <span>Auto</span><small>the cloud machine when it is awake, else this Mac</small>
            </button>
          </div>
        </div>
      )}
      {/* CONSENT (0119). Two facts per member, never collapsed: what YOU lend them (a switch —
          yours to flip) and what THEY lend you (a status — theirs). Collapsing them is how people
          end up surprised by a bill. */}
      {members.filter((mem) => mem.user_id !== selfUserId).length > 0 && (
        <>
          <div className="sect">Sharing</div>
          <p className="wshint">Lending your machines lets a teammate&rsquo;s requests run here, on your subscription.</p>
          {members.filter((mem) => mem.user_id !== selfUserId).map((mem) => {
            const iLend = (prefs.shares ?? []).includes('*') || (prefs.shares ?? []).includes(mem.user_id);
            const theirs = parseComputePrefs(mem.compute).shares ?? [];
            const theyLend = theirs.includes('*') || theirs.includes(selfUserId ?? '');
            const theirMachines = machines.filter((m) => m.owner_user_id === mem.user_id);
            // INTENT, not the resulting set. Computing it here meant expanding '*' from the
            // renderer's own member list, and on a stale replica that silently dropped everyone
            // it had not synced — turning "stop lending to one" into "stop lending to most",
            // with nothing on screen to say so (live, 2026-08-14).
            const apply = () => { void nm?.shareCompute(mem.user_id, !iLend).catch(() => {}); };
            // GRANTING is instant; REVOKING asks, because it does less than it looks like it does:
            // continuity is ungated, so their existing threads keep running here afterwards.
            const toggle = () => { if (iLend) onRevoke({ member: mem, apply }); else apply(); };
            return (
              <div key={mem.user_id} className="shrow">
                <span className="shwho"><b>{mem.display_name?.trim() || 'a teammate'}</b>
                  <span className="shsub">{theirMachines.length ? `${theirMachines.length} machine${theirMachines.length > 1 ? 's' : ''}` : 'no machine'}</span></span>
                <button type="button" className={`shsw${iLend ? ' on' : ''}`} role="switch" aria-checked={iLend}
                  aria-label={`Lend my machines to ${mem.display_name ?? 'this member'}`} onClick={toggle}><i /></button>
                <span className="shlbl">you lend</span>
                <span className="shthem">{!theirMachines.length ? <span className="shno">no machine</span>
                  : theyLend ? <span className="shyes">they lend</span> : <span className="shno">they don&rsquo;t</span>}</span>
              </div>
            );
          })}
        </>
      )}

      {hostless.length > 0 && (
        <div className="locked" style={{ marginTop: 10 }}>
          <span>
            <b>{hostless.map((m) => m.display_name?.trim() || 'a teammate').join(', ')}</b>
            {hostless.length === 1 ? ' has' : ' have'} no machine here, so their requests run on a
            teammate&rsquo;s, under that teammate&rsquo;s subscription.
          </span>
        </div>
      )}
    </>
  );
}
