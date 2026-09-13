// A room's opening card — what this channel is for, shown until it has a history.
// Extracted from App.tsx (track A2).
import { Fragment, useMemo } from 'react';
import { IconAgents, IconBranch, IconUser } from '../ui/icons';
import { type AgentRow, type MemberRow } from '../bridge/rows-crew';
import { type ChannelHistoryRow, type ChannelPersonRow, type ChannelRow } from '../bridge/rows-rooms';

// The head of a room's feed (round 17). A fresh channel used to render one grey line —
// "No messages in #build yet" — a dead end with no agents, no repo, and no way to get either
// without going back to the rail. This is the beginning of the scroll, so it never covers
// messages: hero → setup cards → papertrail → the first thing anyone said.
//
// The cards are self-retiring. Each one hides the moment its job is done, so a working room
// keeps only the hero and the trail; an empty state that stays after you've filled it is a nag.
export function ChannelIntro({ channel, projectName, roomAgents, roomPeople, members, meId, history, hasRepo, onAddAgents, onAddPeople, onAttachRepo, onSetTopic }: {
  channel: ChannelRow;
  projectName: string | null;
  roomAgents: AgentRow[];
  roomPeople: ChannelPersonRow[];
  members: MemberRow[];
  meId: string | null;
  history: ChannelHistoryRow[];
  hasRepo: boolean;
  onAddAgents: () => void;
  onAddPeople: () => void;
  onAttachRepo: () => void;
  onSetTopic: () => void;
}) {
  // actor id → display name. A null actor is the honest answer for rows predating 0093:
  // the trail line renders without a name rather than guessing or hiding the fact.
  const nameOf = (kind: string | null, id: string | null): string | null => {
    if (!id) return null;
    if (kind === 'human') {
      if (meId && id === meId) return 'You';
      return members.find((m) => m.user_id === id)?.display_name ?? 'a teammate';
    }
    return (history ?? []).find((h) => h.agent_id === id)?.name ?? roomAgents.find((a) => a.id === id)?.name ?? 'an agent';
  };
  const dayOf = (iso: string | null) => (iso ? new Date(iso).toDateString() : '');
  const dayLabel = (iso: string | null) => (iso
    ? new Date(iso).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
    : 'Earlier');
  const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');

  // Joins collapse by (day, who brought them in) — "geo added rex, atlas and 3 others" reads
  // as one act, which is what it was; five separate lines would bury the room's first message.
  const trail = useMemo(() => {
    const rows: Array<{ at: string | null; icon: React.ReactNode; body: React.ReactNode; key: string }> = [];
    const creator = nameOf(channel.created_by_kind ?? null, channel.created_by ?? null);
    rows.push({
      key: 'created',
      at: channel.created_at ?? null,
      icon: <span className="trhash">#</span>,
      body: creator ? <><b>{creator}</b> created this channel</> : <>This channel was created</>,
    });
    const groups = new Map<string, { at: string | null; by: string | null; kind: string | null; names: ChannelHistoryRow[] }>();
    // fed by an async bridge read — a bridge without it (or a failed load) must not blank the room
    for (const h of history ?? []) {
      const k = `${dayOf(h.created_at)}|${h.created_by ?? ''}`;
      const g = groups.get(k) ?? { at: h.created_at, by: h.created_by, kind: h.created_by_kind, names: [] };
      g.names.push(h);
      groups.set(k, g);
    }
    for (const [k, g] of groups) {
      const who = nameOf(g.kind, g.by);
      const shown = g.names.slice(0, 3);
      const rest = g.names.length - shown.length;
      const list = (
        <>
          {shown.map((n, i) => <Fragment key={n.agent_id}><b>{n.name}</b>{i < shown.length - 1 ? ', ' : ''}</Fragment>)}
          {rest > 0 ? <> and <b>{rest} {rest === 1 ? 'other' : 'others'}</b></> : null}
        </>
      );
      rows.push({
        key: `join-${k}`,
        at: g.at,
        icon: <IconAgents s={13} />,
        // no actor (pre-0093 memberships, or the orchestrator auto-seeded at room creation)
        // → the agents are the subject: "rex joined", not "someone added rex".
        body: who ? <><b>{who}</b> added {list}</> : <>{list} joined</>,
      });
    }
    // people joins read the same way (0094). The backfill and the creator seed carry no actor,
    // so those render "X joined" — only a deliberate add gets "someone added X".
    const pGroups = new Map<string, { at: string | null; by: string | null; names: ChannelPersonRow[] }>();
    for (const p of roomPeople) {
      const k = `${dayOf(p.created_at)}|${p.created_by ?? ''}`;
      const g = pGroups.get(k) ?? { at: p.created_at, by: p.created_by, names: [] };
      g.names.push(p);
      pGroups.set(k, g);
    }
    for (const [k, g] of pGroups) {
      const who = nameOf('human', g.by);
      const shown = g.names.slice(0, 3);
      const rest = g.names.length - shown.length;
      const nameFor = (p: ChannelPersonRow) => (meId && p.user_id === meId ? 'You' : (p.display_name ?? 'a teammate'));
      const list = (
        <>
          {shown.map((n, i) => <Fragment key={n.user_id}><b>{nameFor(n)}</b>{i < shown.length - 1 ? ', ' : ''}</Fragment>)}
          {rest > 0 ? <> and <b>{rest} {rest === 1 ? 'other' : 'others'}</b></> : null}
        </>
      );
      rows.push({
        key: `pjoin-${k}`,
        at: g.at,
        icon: <IconUser s={13} />,
        body: who ? <><b>{who}</b> added {list}</> : <>{list} joined</>,
      });
    }
    return rows.sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  }, [channel.id, channel.created_at, channel.created_by, history, roomPeople, members, meId]);

  // each card is an unfinished job; a done job leaves no card behind
  const needsAgents = roomAgents.length <= 1; // the auto-seeded orchestrator doesn't count as staffing
  // people is now a ROOM roster (0094), so a new room has only its creator and the card shows
  // beside Add agents — which is the point: a room is staffed with both.
  const needsPeople = roomPeople.length <= 1;
  const needsRepo = channel.kind !== 'marketing' && !hasRepo;
  const cards = [
    needsAgents && (
      <button key="agents" className="introcard" onClick={onAddAgents}>
        <span className="introic"><IconAgents s={17} /></span>
        <span className="introgrow"><b>Add agents</b><small>Bring the crew that'll do the work here.</small></span>
      </button>
    ),
    needsPeople && (
      <button key="people" className="introcard" onClick={onAddPeople}>
        <span className="introic"><IconUser s={17} /></span>
        <span className="introgrow"><b>Add people</b><small>Bring teammates into this channel.</small></span>
      </button>
    ),
    needsRepo && (
      <button key="repo" className="introcard" onClick={onAttachRepo}>
        <span className="introic"><IconBranch s={17} /></span>
        <span className="introgrow"><b>Attach a repo</b><small>Point this channel at the code it ships.</small></span>
      </button>
    ),
  ].filter(Boolean);

  let lastDay = '';
  return (
    <div className="chanintro">
      <div className="introhero">
        <div className="introtile" aria-hidden>{channel.kind === 'marketing' ? '◁' : '#'}</div>
        <h4>#{channel.slug}</h4>
        <p className="introsub">
          This is the beginning of <b>#{channel.slug}</b>{projectName ? <>, in the <b>{projectName}</b> project</> : null}.{' '}
          {channel.topic?.trim()
            ? <span className="introtopic">{channel.topic.trim()}</span>
            : <button className="introlink" onClick={onSetTopic}>Add a topic</button>}
        </p>
      </div>
      {cards.length > 0 && <div className="introcards">{cards}</div>}
      <div className="introtrail">
        {trail.map((r) => {
          const day = dayOf(r.at);
          const divider = day !== lastDay ? (lastDay = day, dayLabel(r.at)) : null;
          return (
            <Fragment key={r.key}>
              {divider && <div className="introday"><span>{divider}</span></div>}
              <div className="trrow">
                <span className="tric" aria-hidden>{r.icon}</span>
                <span className="trtxt">{r.body}</span>
                <span className="trts">{timeOf(r.at)}</span>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
