// The compute intro (docs/compute-choice) — the one-time explanation of whose machine
// answers. Extracted from App.tsx (track A4).
import { Modal } from '../ui/Modal';
import { availableMachines, type MachineCapability } from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { parseComputePrefs } from './prefs';
import { type AgentRow, type MachineRow, type MemberRow } from '../bridge/rows-crew';
import { useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

/**
 * The join moment (0118): shown ONCE per workspace, when this member's own machine could serve
 * but their compute choice is unset. The choice IS the config — picking a machine writes the
 * pref; Skip leaves origin affinity. Dismissal is machine-local (localStorage), so the card
 * never nags and never syncs.
 */
export function ComputeIntro({ workspaceName, machines, members, agents, selfUserId, selfMachineName, askChannelId, onDone }: {
  workspaceName: string;
  machines: MachineRow[];
  members: MemberRow[];
  agents: AgentRow[];
  selfUserId: string | null;
  selfMachineName: string | null;
  /** where a "request access" ask is posted — the room its owner will actually see */
  askChannelId?: string | null;
  onDone: () => void;
}) {
  const runtimesOf = (m: MachineRow): string[] => { try { return JSON.parse(m.runtimes ?? '[]') as string[]; } catch { return []; } };
  const nameOf = (userId?: string | null): string =>
    members.find((x) => x.user_id === userId)?.display_name?.trim() || (userId === selfUserId ? 'yours' : 'a teammate');
  const placeable = agents.filter((a) => !a.retired_at && a.kind !== 'remote');
  const serves = (m: MachineRow): number => placeable.filter((a) => runtimesOf(m).includes(a.runtime ?? 'claude-code')).length;
  const [pick, setPick] = useState<string | null>(machines.find((m) => m.name === selfMachineName)?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  // ── which of three worlds is this member in? (0119) ───────────────────────────────────────
  // A: they have a capable machine → pick one. B: none of their own, but lent one → tell them
  // whose subscription is paying. C: neither → the only state that is a dead end unless it
  // carries the ask, which is why "Request access" exists at all.
  const caps: MachineCapability[] = machines.map((m) => ({
    machineId: m.id, ownerUserId: m.owner_user_id ?? '', lastSeenAt: m.last_seen_at, runtimes: runtimesOf(m),
    sharesWith: parseComputePrefs(members.find((x) => x.user_id === m.owner_user_id)?.compute).shares ?? [],
  }));
  const mineCapable = machines.filter((m) => m.owner_user_id === selfUserId && runtimesOf(m).length);
  const lent = availableMachines(caps, selfUserId)
    .filter((c) => c.ownerUserId !== selfUserId && c.runtimes.length)
    .map((c) => machines.find((m) => m.id === c.machineId)!).filter(Boolean);
  const world: 'pick' | 'lent' | 'none' = mineCapable.length ? 'pick' : lent.length ? 'lent' : 'none';
  const ownersToAsk = members.filter((mem) => mem.user_id !== selfUserId
    && machines.some((m) => m.owner_user_id === mem.user_id && runtimesOf(m).length));
  const ask = async (owner: MemberRow) => {
    if (!askChannelId) return;
    const name = owner.display_name?.trim() || 'there';
    setAsked(owner.user_id);
    // a plain message in a room they read — not an nmq card, which is an AGENT asking a human.
    // A person asking a person is a message, and the answer is a switch in Settings → Compute.
    await nm?.send(askChannelId, `@${name}, could you share your compute with me? My machine has no provider sign-in, so nothing can run for me here yet. Settings → Compute → Sharing.`)
      .catch(() => setAsked(null));
  };
  const use = async () => {
    if (!pick) return onDone();
    setBusy(true);
    try { await nm?.setCompute({ machine: pick }); } catch { /* the panel can retry */ }
    onDone();
  };
  if (world === 'lent') {
    const m = lent[0]!;
    const owner = members.find((x) => x.user_id === m.owner_user_id)?.display_name?.trim() || 'a teammate';
    return (
      <Modal title={`Your agents run on ${owner}’s machine`} onClose={onDone}>
        <p className="wshint">You have no machine serving {workspaceName} yet, so {owner} lent you theirs. Your requests run there, on their subscription.</p>
        {lent.map((x) => (
          <div key={x.id} className="cmprow">
            <span className="cmpdot on" aria-hidden />
            <div className="cmpbody">
              <div className="cmphead"><b>{x.name}</b><span className="cmpowner">{nameOf(x.owner_user_id)}</span><span className="cmpshared">shared with you</span></div>
              <div className="cmpmeta">{runtimesOf(x).map((r) => <span key={r} className="cmprt">{r}</span>)}
                <span className="cmppicknote">serves {serves(x)} of {placeable.length} agents</span></div>
            </div>
          </div>
        ))}
        <div className="cmpintroactions"><button className="btn primary" onClick={onDone}>Got it</button></div>
        <p className="cmpintrofine">Sign in to a provider on this machine to run them here instead.</p>
      </Modal>
    );
  }

  if (world === 'none') {
    return (
      <Modal title="No compute available yet" onClose={onDone}>
        <p className="wshint">Agents need a machine to run on. Nobody has lent you one, and this machine has no provider sign-in.</p>
        {machines.filter((m) => m.owner_user_id !== selfUserId).map((m) => (
          <div key={m.id} className="cmprow notmine">
            <span className="cmpdot" aria-hidden />
            <div className="cmpbody">
              <div className="cmphead"><b>{m.name}</b><span className="cmpowner">{nameOf(m.owner_user_id)}</span><span className="machnoshare">not shared</span></div>
              <div className="cmpmeta">{runtimesOf(m).map((r) => <span key={r} className="cmprt">{r}</span>)}</div>
            </div>
          </div>
        ))}
        <div className="cmpintroactions">
          {ownersToAsk.length && askChannelId ? (
            <button className="btn primary" disabled={!!asked} onClick={() => { void ask(ownersToAsk[0]!); }}>
              {asked ? 'Asked' : `Request access from ${ownersToAsk[0]!.display_name?.trim() || 'a teammate'}`}
            </button>
          ) : null}
          <button className="btn" onClick={onDone}>Close</button>
        </div>
        <p className="cmpintrofine">Or sign in to Claude, Codex or Gemini on this machine to serve your own.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Where should your agents run?" onClose={onDone}>
      <p className="wshint">{workspaceName}&rsquo;s agents run on members&rsquo; machines, each request on that member&rsquo;s subscription.</p>
      {machines.map((m) => (
        <button key={m.id} type="button" className={`cmppick${pick === m.id ? ' sel' : ''}`} onClick={() => setPick(m.id)}>
          <span className="cmppickradio" aria-hidden />
          <span className="cmpbody">
            <span className="cmphead"><b>{m.name}</b><span className="cmpowner">{nameOf(m.owner_user_id)}</span>
              {m.name === selfMachineName && <span className="cmphere">this machine</span>}</span>
            <span className="cmpmeta">{runtimesOf(m).map((r) => <span key={r} className="cmprt">{r}</span>)}
              <span className="cmppicknote">serves {serves(m)} of {placeable.length} agents</span></span>
          </span>
        </button>
      ))}
      <div className="cmpintroactions">
        <button className="btn primary" disabled={busy || !pick} onClick={() => { void use(); }}>{busy ? 'Saving…' : 'Use this machine'}</button>
        <button className="btn" onClick={onDone}>Skip</button>
      </div>
      <p className="cmpintrofine">New conversations only. Existing threads stay with their files. Settings → Compute.</p>
    </Modal>
  );
}
