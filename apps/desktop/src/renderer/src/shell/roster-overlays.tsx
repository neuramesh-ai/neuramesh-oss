// Adding people and agents to a room — the two popovers the roster's + opens.
// A room is an agent's ACL boundary, so this is a permission change wearing a friendly face.
// Extracted from App.tsx (track A4).
import { AgentAvatar } from '../components/AgentAvatar';
import { IconClose, IconSearch } from '../ui/icons';
import { Popover } from '../ui/Popover';
import { anchorPoint } from '../ui/anchor';
import { agentFocus } from '../lib/presence';
import { agentInChannel } from '@neuramesh/shared';
import { selfLabel } from '../lib/self';
import { type AgentRow, type MemberRow } from '../bridge/rows-crew';
import { type ChannelRow } from '../bridge/rows-rooms';
import { type TaskRow } from '../bridge/rows-board';
import { useEffect, useMemo, useState } from 'react';

// The searchable roster overlay — opened from the rail's "+N more" row. A flat, filterable
// directory of every active agent; picking one opens its AgentDetails. Read-only by design
// (adding an agent to a channel stays on the rail rows, where the channel context lives).
export function AddAgentsOverlay({ agents, channel, scopedTasks, onAdd, onRemove, onCreate, onConnectRemote, onClose }: {
  agents: AgentRow[];
  channel: ChannelRow;
  scopedTasks: TaskRow[];
  onAdd: (a: AgentRow) => Promise<void>;
  onRemove: (a: AgentRow) => Promise<void>;
  onCreate: (prefillName: string) => void;
  onConnectRemote: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'out' | 'in' | 'all'>('all');
  // rows mid-flight — the button shows the pending state so a slow command can't be double-fired
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const inRoom = (a: AgentRow) => agentInChannel(a.channel_ids, channel.id);

  // search spans name · role · brief, so "someone who does pricing" finds the analyst
  // without knowing its name (agents.brief is the stored specialty remit, 0056). Role
  // filter CHIPS were dropped in round 17b — typing "designer" already does that job,
  // and a row of them pushed the actual list below the fold.
  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return agents.filter((a) =>
      !needle
        || a.name.toLowerCase().includes(needle)
        || String(a.role ?? '').toLowerCase().includes(needle)
        || String(a.brief ?? '').toLowerCase().includes(needle),
    );
  }, [agents, q, channel.id]);
  const out = useMemo(() => matches.filter((a) => !inRoom(a)), [matches, channel.id]);
  const here = useMemo(() => matches.filter((a) => inRoom(a)), [matches, channel.id]);
  const shown: Array<[string, AgentRow[]]> =
    tab === 'out' ? [['Not in this room', out]]
      : tab === 'in' ? [['Already here', here]]
        : [['Not in this room', out], ['Already here', here]];
  const total = shown.reduce((n, [, rows]) => n + rows.length, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (a: AgentRow, fn: (a: AgentRow) => Promise<void>) => {
    setBusyIds((s) => new Set(s).add(a.id));
    try { await fn(a); } finally { setBusyIds((s) => { const n = new Set(s); n.delete(a.id); return n; }); }
  };

  const row = (a: AgentRow, group: string) => {
    const here_ = group === 'Already here';
    const pending = busyIds.has(a.id);
    // the orchestrator is a room's cross-cutting remit — it's seeded into every channel and
    // the server refuses to take it out, so no Remove is offered for it.
    const removable = here_ && a.role !== 'orchestrator';
    return (
      <div key={a.id} className={`aarow${here_ ? ' inroom' : ''}`}>
        <AgentAvatar name={a.name} size={30} radius={9} />
        <div className="aabody">
          <span className="aaname"><b>{a.name}</b><span className="rolechip" data-role={a.role}>{a.role}</span></span>
          <span className="aastat">{a.brief?.trim() || agentFocus(a, scopedTasks)}</span>
        </div>
        {here_ ? (
          <span className="aain">
            {removable
              ? <button className="aaremove" disabled={pending} onClick={() => void run(a, onRemove)} title={`Remove @${a.name} from #${channel.slug}`}>{pending ? '…' : 'Remove'}</button>
              : null}
            <span className="aainlbl">✓ In channel</span>
          </span>
        ) : (
          <button className="aaadd" disabled={pending} onClick={() => void run(a, onAdd)} title={`Add @${a.name} to #${channel.slug}`}>
            {pending ? '…' : '+ Add'}
          </button>
        )}
      </div>
    );
  };

  return (
    <Popover label={`Add agents to #${channel.slug}`} anchor={anchorPoint()} width={460} align="end" onClose={onClose} className="rosterovl aaovl">
      <>
        <div className="rosterhd">
          <b>Add agents</b>
          <span className="aachan"><span className="h">#</span>{channel.slug}</span>
          <button className="rosterx" aria-label="Close" onClick={onClose}><IconClose s={14} /></button>
        </div>
        <div className="rostersearch">
          <IconSearch s={15} />
          <input autoFocus placeholder="Search by name, role, or specialty…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="rosterfilters">
          <button className={`rosterchip aatab${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>All<span className="aan">{agents.length}</span></button>
          <button className={`rosterchip aatab${tab === 'in' ? ' on' : ''}`} onClick={() => setTab('in')}>In #{channel.slug}<span className="aan">{here.length}</span></button>
          <button className={`rosterchip aatab${tab === 'out' ? ' on' : ''}`} onClick={() => setTab('out')}>Not in #{channel.slug}<span className="aan">{out.length}</span></button>
        </div>
        <div className="rosterlist aalist">
          {total === 0 ? (
            <div className="rosterempty">
              {q.trim()
                ? <>No agent matches “{q.trim()}”.<div className="aaempties">Nobody in this workspace covers that yet.</div>
                  <button className="btn sm aahire" onClick={() => onCreate(q.trim())}>+ Hire an agent called “{q.trim()}”</button></>
                : tab === 'out' ? <>Everyone in this workspace is already in <b>#{channel.slug}</b>.</> : <>No agents yet.</>}
            </div>
          ) : shown.map(([group, rows]) => rows.length === 0 ? null : (
            <div key={group}>
              <div className="aagrp">{group}</div>
              {rows.map((a) => row(a, group))}
            </div>
          ))}
        </div>
        <div className="aafoot">
          <button onClick={() => onCreate('')}><span className="aafic">+</span>Create a new agent<small>hire for this channel</small></button>
          <button onClick={onConnectRemote}><span className="aafic">⇄</span>Connect a remote agent<small>another machine</small></button>
        </div>
      </>
    </Popover>
  );
}

// The people half of the room picker (0094) — same shape as AddAgentsOverlay so the two
// "+"s behave identically. Scoped to people ALREADY in the workspace: this is a roster
// move, not an invite, so it costs no seat and grants no access. Inviting someone new
// still lives in the footer, where it routes to the seat-consuming email flow.
export function AddPeopleOverlay({ members, inRoomIds, channel, meId, selfEmail, onAdd, onRemove, onInvite, onClose }: {
  members: MemberRow[];
  inRoomIds: Set<string>;
  channel: ChannelRow;
  meId: string | null;
  selfEmail: string | null | undefined;
  onAdd: (m: MemberRow) => Promise<void>;
  onRemove: (m: MemberRow) => Promise<void>;
  onInvite: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'out' | 'in' | 'all'>('all');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const label = (m: MemberRow) => (m.user_id === meId ? selfLabel(m.display_name, selfEmail) : (m.display_name ?? 'member'));

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return members.filter((m) => !needle || label(m).toLowerCase().includes(needle) || m.role.toLowerCase().includes(needle));
  }, [members, q, meId]);
  const out = useMemo(() => matches.filter((m) => !inRoomIds.has(m.user_id)), [matches, inRoomIds]);
  const here = useMemo(() => matches.filter((m) => inRoomIds.has(m.user_id)), [matches, inRoomIds]);
  const shown: Array<[string, MemberRow[]]> =
    tab === 'out' ? [['Not in this room', out]]
      : tab === 'in' ? [['Already here', here]]
        : [['Not in this room', out], ['Already here', here]];
  const total = shown.reduce((n, [, rows]) => n + rows.length, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (m: MemberRow, fn: (m: MemberRow) => Promise<void>) => {
    setBusyIds((s) => new Set(s).add(m.user_id));
    try { await fn(m); } finally { setBusyIds((s) => { const n = new Set(s); n.delete(m.user_id); return n; }); }
  };

  const row = (m: MemberRow, group: string) => {
    const here_ = group === 'Already here';
    const pending = busyIds.has(m.user_id);
    // you can't remove yourself from a room you're looking at — that would strand the view
    const removable = here_ && m.user_id !== meId;
    return (
      <div key={m.user_id} className={`aarow${here_ ? ' inroom' : ''}`}>
        <span className="aapav">{(label(m)[0] ?? 'M').toUpperCase()}</span>
        <div className="aabody">
          <span className="aaname"><b>{label(m)}</b>{m.user_id === meId && <span className="aayou">you</span>}</span>
          <span className="aastat">{m.role}</span>
        </div>
        {here_ ? (
          <span className="aain">
            {removable
              ? <button className="aaremove" disabled={pending} onClick={() => void run(m, onRemove)} title={`Remove ${label(m)} from #${channel.slug}`}>{pending ? '…' : 'Remove'}</button>
              : null}
            <span className="aainlbl">✓ In channel</span>
          </span>
        ) : (
          <button className="aaadd" disabled={pending} onClick={() => void run(m, onAdd)} title={`Add ${label(m)} to #${channel.slug}`}>
            {pending ? '…' : '+ Add'}
          </button>
        )}
      </div>
    );
  };

  return (
    <Popover label={`Add people to #${channel.slug}`} anchor={anchorPoint()} width={460} align="end" onClose={onClose} className="rosterovl aaovl">
      <>
        <div className="rosterhd">
          <b>Add people</b>
          <span className="aachan"><span className="h">#</span>{channel.slug}</span>
          <button className="rosterx" aria-label="Close" onClick={onClose}><IconClose s={14} /></button>
        </div>
        <div className="rostersearch">
          <IconSearch s={15} />
          <input autoFocus placeholder="Search teammates by name or role…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="rosterfilters">
          <button className={`rosterchip aatab${tab === 'all' ? ' on' : ''}`} onClick={() => setTab('all')}>All<span className="aan">{members.length}</span></button>
          <button className={`rosterchip aatab${tab === 'in' ? ' on' : ''}`} onClick={() => setTab('in')}>In #{channel.slug}<span className="aan">{here.length}</span></button>
          <button className={`rosterchip aatab${tab === 'out' ? ' on' : ''}`} onClick={() => setTab('out')}>Not in #{channel.slug}<span className="aan">{out.length}</span></button>
        </div>
        <div className="rosterlist aalist">
          {total === 0 ? (
            <div className="rosterempty">
              {q.trim()
                ? <>Nobody in this workspace matches “{q.trim()}”.</>
                : tab === 'out' ? <>Everyone in this workspace is already in <b>#{channel.slug}</b>.</> : <>No teammates yet.</>}
            </div>
          ) : shown.map(([group, rows]) => rows.length === 0 ? null : (
            <div key={group}>
              <div className="aagrp">{group}</div>
              {rows.map((m) => row(m, group))}
            </div>
          ))}
        </div>
        <div className="aafoot">
          <button onClick={onInvite}><span className="aafic">✉</span>Invite someone new<small>by email · uses a seat</small></button>
        </div>
      </>
    </Popover>
  );
}
