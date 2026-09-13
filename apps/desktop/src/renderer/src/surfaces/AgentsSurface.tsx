// THE CREW SURFACE — every agent in the workspace, live and retired, with what each machine
// can actually serve.
//
// Split out of App(). Retired agents stay visible behind a toggle rather than vanishing: a
// rehire is re-registering the same name, so the row has to be findable.
//
// It OWNS what only it reads (state-ownership round, 2026-08-16): the alumni toggle, the retired
// filter, and the three lookups the machine rows need. What stayed in App is what App also uses —
// activeAgents, placeOf, machNameOf, refreshRoster and refreshCreds all have callers elsewhere.

import { isHouseBrain, planLabel } from '@neuramesh/shared';
import { nm } from '../bridge/nm';
import { AgentAvatar } from '../components/AgentAvatar';
import { agentLive, isOnline } from '../lib/presence';
import { runtimeLabel } from '../lib/runtimes';
import { timeAgo } from '../lib/time';
import { flashToast } from '../lib/toast';
import { IconLock, IconMachine, IconStore } from '../ui/icons';
import { useState } from 'react';
import { machineAvailableTo } from '@neuramesh/shared';
import type { Dispatch, SetStateAction } from 'react';
import type { AgentRow, MachineRow } from '../bridge/rows-crew';
import type { MainView } from '../wtabs/guests';
import type { NavDest } from '../App';
import type { placementFor } from '@neuramesh/shared';

export function AgentsSurface({ members, machineCaps, activeAgents, boot, isCloud, machNameOf, meId, placeOf, refreshCreds, refreshRoster, roster, setAddRemoteOpen, setCreateOpen, setDetailAgentId, setMarketplaceOpen, setNav, setUpgradeOpen, setView }: {
  roster: { machines: MachineRow[]; agents: AgentRow[] };
  activeAgents: AgentRow[];
  boot: { needsOnboarding: boolean; machineName: string; workspace: { name: string; slug: string } } | null;
  isCloud: boolean;
  meId: string | null;
  /** the workspace's people, for the member lookup, and the caps this machine can serve */
  members: Array<{ user_id: string; display_name?: string | null }>;
  machineCaps: Parameters<typeof machineAvailableTo>[0][];
  machNameOf: (id: string | null) => string | null;
  /** INFERRED from placementFor, never restated */
  placeOf: (a: AgentRow) => ReturnType<typeof placementFor>;
  refreshCreds: () => void;
  refreshRoster: () => void;
  setDetailAgentId: Dispatch<SetStateAction<string | null>>;
  setAddRemoteOpen: Dispatch<SetStateAction<boolean>>;
  setCreateOpen: Dispatch<SetStateAction<boolean>>;
  setMarketplaceOpen: Dispatch<SetStateAction<boolean>>;
  setUpgradeOpen: Dispatch<SetStateAction<boolean>>;
  setNav: Dispatch<SetStateAction<NavDest>>;
  setView: Dispatch<SetStateAction<MainView>>;
}) {
  const [retiredOpen, setRetiredOpen] = useState(false); // the Agents page's collapsed alumni section
  const retiredAgents = roster.agents.filter((a) => !!a.retired_at);
  const machRuntimes = (m: MachineRow): string[] => { try { return JSON.parse(m.runtimes ?? '[]') as string[]; } catch { return []; } };
  const canUse = (m: MachineRow): boolean => !!machineCaps.find((c) => c.machineId === m.id && machineAvailableTo(c, meId));
  const nameFor = (userId?: string | null): string => members.find((x) => x.user_id === userId)?.display_name?.trim() || 'a member';

  return (
      <>
        <div className="topbar">
          Agents & Machines
          <span className="desc">{activeAgents.length} agents{retiredAgents.length ? ` · ${retiredAgents.length} retired` : ''} · {roster.machines.length} machines · workspace {boot?.workspace.slug ?? '…'}</span>
          <div className="actions" style={{ display: 'flex', gap: 8 }}>
            <button className="btn" title="Re-bind every agent to its channels across all projects — fixes agents that went missing after channel or project changes" onClick={async () => { try { const r = await nm!.syncAgents(); flashToast(`Re-synced agents — ${r.registered} channel link${r.registered === 1 ? '' : 's'} restored`); void refreshRoster(); } catch { flashToast('Re-sync failed'); } }}>↻ Re-sync agents</button>
            <button className="btn" title={isCloud ? 'register another machine' : `${planLabel('cloud')} connects more machines.`} onClick={() => { if (isCloud) alert('Run neuramesh on the new machine and sign in. It registers itself (outbound-only).'); else setUpgradeOpen(true); }}>+ Add machine{!isCloud && <span className="gatelock">{planLabel('cloud')}</span>}</button>
            {/* the machines are RIGHT THERE on this page; before this there was no way to act
                on any of it — you could read "not shared" with no control in reach */}
            <button className="btn iconlabel" onClick={() => { setNav('home'); setView('compute'); }} title="where your requests run, and who lends you a machine"><IconMachine s={14} /> Compute</button>
            <button className="btn iconlabel" onClick={() => setMarketplaceOpen(true)} title="browse the A2A agent marketplace"><IconStore s={14} /> Marketplace</button>
            <button className="btn primary" onClick={() => { setCreateOpen(true); void refreshCreds(); }}>+ Create agent</button>
          </div>
        </div>
        <div className="libwrap" style={{ maxWidth: 1100 }}>
          <div className="memhead">Machines</div>
          {/* grouped by what you may actually REACH (0119): yours, lent to you, and the rest
              — shown dimmed rather than hidden, so the workspace never looks smaller than it
              is and there is always a route to more compute. */}
          <div className="fleetrow">
            {[...roster.machines].sort((x, y) => Number(canUse(y)) - Number(canUse(x))).map((m) => (
              <div key={m.id} className={`machcard${canUse(m) ? '' : ' notmine'}`}>
                <div className="machname"><IconMachine s={13} /> {m.name}
                  <span className={`chip ${isOnline(m.last_seen_at) ? 'c-done' : 'c-closed'}`}>{isOnline(m.last_seen_at) ? 'online' : 'offline'}</span>
                  {m.owner_user_id === meId ? <span className="cmphere">yours</span>
                    : canUse(m) ? <span className="cmpshared">shared</span>
                      : <span className="machnoshare">not shared</span>}
                </div>
                {/* capability, not provenance (0118): counting agents by machine_id said
                    "0 agents" about a machine able to serve seven — which is exactly what
                    made joining a workspace look broken. Say what the machine CAN do. */}
                <div className="machmeta">
                  serves <b>{activeAgents.filter((a) => a.kind !== 'remote' && machRuntimes(m).includes(a.runtime ?? 'claude-code')).length}
                  {' of '}{activeAgents.filter((a) => a.kind !== 'remote').length}</b> agents
                  {machRuntimes(m).map((r) => <span key={r} className="cmprt" style={{ marginLeft: 5 }}>{r}</span>)}
                </div>
                <div className="machmeta sub">{nameFor(m.owner_user_id)} · daemon {m.daemon_version} · {m.platform}</div>
                {/* who is on it right now — the other half of "what can I reach" */}
                {(() => {
                  const busy = activeAgents.filter((a) => a.hosted_on === m.name);
                  if (busy.length) {
                    return <div className="machrun">{busy.slice(0, 3).map((a) => (
                      <span key={a.id} className="machrunone"><AgentAvatar name={a.name} size={16} radius={5} /> {a.name}</span>
                    ))}{busy.length > 3 ? <span className="machrunmore">+{busy.length - 3}</span> : null}</div>;
                  }
                  // "offline" alone leaves the obvious question unanswered — offline since WHEN.
                  // The heartbeat is already on the row; it just was not being read (2026-09-01).
                  return <div className="machrun"><span className="machidle">
                    {isOnline(m.last_seen_at) ? 'standing by'
                      : m.last_seen_at ? `offline · last seen ${timeAgo(m.last_seen_at)}` : 'never seen'}
                  </span></div>;
                })()}
              </div>
            ))}
          </div>
          <div className="memhead" style={{ marginTop: 18 }}>Agents</div>
          <div className="fleetrow">
            {activeAgents.map((a) => (
              <div key={a.id} className="agentcard" onClick={() => { setDetailAgentId(a.id); void refreshCreds(); }}>
                <div className="agenthead">
                  <span className="agpingwrap">
                    {agentLive(a, roster.machines) && (a.status === 'working' || a.status === 'thinking' || a.status === 'review') && <span className={`agping${a.status === 'review' ? ' review' : ''}`} aria-hidden />}
                    <AgentAvatar name={a.name} size={34} radius={9} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="agentname">{a.name} <span className="rolechip" style={{ marginLeft: 6 }} data-role={a.role}>{a.role}</span>{a.kind === 'remote' ? <span className="rolechip rmchip" style={{ marginLeft: 5 }}>REMOTE</span> : a.runtime && a.runtime !== 'claude-code' && <span className="rolechip rtchip" style={{ marginLeft: 5 }}>{runtimeLabel(a.runtime)}</span>}</div>
                    <div className="agentmodel">{a.kind === 'remote' ? 'External A2A agent' : `${runtimeLabel(a.runtime)} · ${a.model}`}</div>
                    {/* WHERE IT RUNS (0119). Two different questions: `hosted_on` is live
                        truth (whose machine holds its run this second), placement is where
                        YOUR next request would go — often a different machine entirely. */}
                    {a.kind !== 'remote' && (() => {
                      // LIVE means live: hosted_on can linger after a run settles, and a stale
                      // value would claim the agent is working while hiding where your own
                      // next request would actually go
                      if (a.hosted_on && (a.status === 'working' || a.status === 'thinking' || a.status === 'review')) {
                        return <div className="agmach">⌂ <span className="live">working on</span> <span className="m">{a.hosted_on}</span></div>;
                      }
                      const p = placeOf(a);
                      const mn = machNameOf(p.machineId);
                      return mn
                        ? <div className="agmach">⌂ your requests → <span className="m">{mn}</span></div>
                        // a house-brain agent needs no runtime, so naming one would be a lie —
                        // what it is missing is an awake machine, which is a different fix
                        : isHouseBrain(a.model)
                          ? <div className="agmach">⌂ <span className="warn">waiting for a machine to wake</span></div>
                          : <div className="agmach">⌂ <span className="warn">no machine you can use serves {runtimeLabel(a.runtime).toLowerCase()}</span></div>;
                    })()}
                  </div>
                  <span className={`presence${!agentLive(a, roster.machines) ? ' off' : a.status === 'thinking' || a.status === 'working' ? ' busy' : a.status === 'online' ? '' : ' off'}`} />
                </div>
                <div className="obchans" style={{ marginTop: 8 }}>
                  {(a.channels ?? '').split(',').filter(Boolean).map((c) => (
                    <span key={c} className="chchip">#{c.trim()}</span>
                  ))}
                </div>
              </div>
            ))}
            <button className="agentcard create" onClick={() => { setCreateOpen(true); void refreshCreds(); }}>
              <span className="agcreateplus">+</span>
              <b>Create an agent</b>
              <span>name it · pick a model · register to channels</span>
            </button>
            <button className={`agentcard ext${isCloud ? '' : ' locked'}`} onClick={() => { if (isCloud) setAddRemoteOpen(true); else setUpgradeOpen(true); }} title={isCloud ? 'connect an agent by its A2A card URL' : `External agents unlock with ${planLabel('cloud')}`}>
              <div className="agexthead"><span className="agextlabel">{planLabel('cloud')} · A2A</span>{!isCloud && <span className="agextlock"><IconLock s={12} /></span>}</div>
              <b>Add external agent</b>
              <span>Hire expert agents from the marketplace over A2A.{!isCloud ? ` Unlocks with ${planLabel('cloud')}.` : ''}</span>
              {!isCloud && <span className="agextcta">Get {planLabel('cloud')}</span>}
            </button>
          </div>
          {retiredAgents.length > 0 && (
            <>
              <button className="retiredhd" onClick={() => setRetiredOpen((v) => !v)} aria-expanded={retiredOpen}>
                <span className={`retchev${retiredOpen ? ' open' : ''}`} aria-hidden>▸</span>
                Retired <span className="retcount">{retiredAgents.length}</span>
                <span className="rethint">history kept — rehire from the card</span>
              </button>
              {retiredOpen && (
                <div className="fleetrow">
                  {retiredAgents.map((a) => (
                    <div key={a.id} className="agentcard retired" onClick={() => { setDetailAgentId(a.id); void refreshCreds(); }}>
                      <div className="agenthead">
                        <AgentAvatar name={a.name} size={34} radius={9} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="agentname">{a.name} <span className="rolechip" style={{ marginLeft: 6 }} data-role={a.role}>{a.role}</span></div>
                          <div className="agentmodel">retired {a.retired_at ? new Date(a.retired_at).toLocaleDateString([], { month: 'short', day: 'numeric' }) : ''}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </>
  );
}
