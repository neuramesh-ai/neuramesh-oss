// THE MACHINE CHIP (docs/design/desktop-code-bridge-2026-09, rule D9; George, 2026-09-04) — the
// composer's third knob, beside the room chip and the brain pill: WHERE this session will run, said
// in the same chip idiom, with the reason in its popover. It designates the SESSION; per-agent
// choices stay in the Compute panel (D10). The list is the Compute panel's rows, one line each —
// glyph · name · owner · state — with Auto first and the forecast marked. A machine the member may
// not use is not drawn at all; an offline one is drawn dim and cannot be picked.
//
// The chip is a FORECAST (compute/machine-choice.ts): the ladder decides at claim time, on the
// machines awake then. The DESIGNATION the send writes is narrower — the chip's choice, or the
// desktop default's Mac — so a forecast of "Cloud" never pins a session to a machine that fell
// asleep between the reading and the send.
import { useRef, useState } from 'react';
import { machineOnline, type SessionOrigin } from '@neuramesh/shared';
import type { MachineRow, MemberRow } from '../bridge/rows-crew';
import { choosableMachines, forecastMachine, type ChoiceMachine } from './machine-choice';
import { parseComputePrefs } from './prefs';
import { IconAuto, IconCloud, IconMachine } from '../ui/icons';

/** px between the chip and the edge of the nearest ancestor that clips its overflow, on the side the menu
 *  opens: above by default, BELOW on the ledgered Home, where the composer stands at the top of the page and
 *  tokens.css turns every composer menu downward (`.stagewrap.ledgered .hcomposer .cprojpop`). The cap has
 *  to measure the side the CSS picks, or a Home menu would be squeezed to the room above a chip that opens
 *  down. */
function roomOn(el: HTMLElement | null): number {
  if (!el) return 600;
  const down = !!el.closest('.stagewrap.ledgered');
  const r = el.getBoundingClientRect();
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (getComputedStyle(p).overflowY !== 'visible') {
      const pr = p.getBoundingClientRect();
      return down ? pr.bottom - r.bottom : r.top - pr.top;
    }
  }
  return down ? window.innerHeight - r.bottom : r.top;
}

export function MachineChip({ machines, members, selfUserId, selfMachineName, origin, value, onPick, cloud, disabled }: {
  machines: MachineRow[];
  members: MemberRow[];
  selfUserId: string | null;
  /** the desktop's own row, by name (the Compute panel's rule: the name IS the identity); null in the browser */
  selfMachineName: string | null;
  origin: SessionOrigin;
  /** the session's explicit choice; null = Auto */
  value: string | null;
  onPick: (machineId: string | null) => void;
  /** the fleet's word on the cloud machine, when the client has it (useCompute) */
  cloud?: { status: string; reason: string } | null;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // the menu opens UPWARD from the chip; its height is capped by the room above the chip INSIDE the
  // nearest clipping ancestor (the conversation sheet, the Code column — both overflow:hidden),
  // measured at open — a member with a dozen dead laptops scrolls the list, never loses Auto
  const anchor = useRef<HTMLButtonElement>(null);
  const [cap, setCap] = useState<number | null>(null);
  const toggle = () => { setCap(Math.max(220, roomOn(anchor.current) - 24)); setOpen((o) => !o); };
  const now = Date.now();
  const selfMachineId = selfMachineName ? machines.find((m) => m.name === selfMachineName)?.id ?? null : null;
  const prefsOf = (userId: string | null | undefined) => parseComputePrefs(members.find((m) => m.user_id === userId)?.compute);
  const prefs = prefsOf(selfUserId);
  const rows: ChoiceMachine[] = machines.map((m) => ({
    id: m.id, name: m.name, kind: m.kind ?? 'local', ownerUserId: m.owner_user_id ?? null, lastSeenAt: m.last_seen_at ?? null,
    sharesWith: prefsOf(m.owner_user_id).shares,
  }));
  const choosable = choosableMachines(rows, selfUserId, now);
  const forecast = forecastMachine({ origin, chosen: value, prefs, machines: rows, selfUserId, selfMachineId, now });
  const current = forecast.machineId ? rows.find((m) => m.id === forecast.machineId) ?? null : null;
  const online = (m: ChoiceMachine) => machineOnline({ machineId: m.id, ownerUserId: '', runtimes: [], lastSeenAt: m.lastSeenAt }, now);
  const isCloud = (m: ChoiceMachine) => m.kind === 'runner' || m.kind === 'member';
  // the kind is an SVG from the icon set, the same weight as the pill's (George, 2026-09-05: the text
  // glyphs drew a bold cloud beside a hairline house); a cloud machine is a plain cloud HERE — the
  // rows are a list of places, so "cloud" alone reads — while the status pill draws the badged
  // machine; Auto is the fork, never a sparkle and not a letter
  const glyph = (m: ChoiceMachine | null) => (m ? (isCloud(m) ? <IconCloud s={13} /> : <IconMachine s={13} />) : <IconAuto s={13} />);
  const nameOf = (m: ChoiceMachine) => (m.id === selfMachineId ? 'This Mac' : m.kind === 'runner' ? 'Cloud' : m.name);
  // a teammate's machine says whose it is; your own and the workspace runner need no owner line (George, 2026-09-05: less text)
  const ownerOf = (m: ChoiceMachine) => (m.kind === 'runner' || m.ownerUserId === selfUserId ? null : members.find((x) => x.user_id === m.ownerUserId)?.display_name?.trim() || 'a teammate');
  // the state is an ICON at the row's right, its word in the tooltip: a cloud machine has an intent as
  // well as a heartbeat (the pill's derivation); a laptop has only the heartbeat
  const stateOf = (m: ChoiceMachine): { icon: string; word: string; tone: 'on' | 'waking' | 'sleep' | 'off' } => {
    if (m.kind === 'runner' && cloud) {
      if (cloud.status === 'online') return { icon: '●', word: 'awake', tone: 'on' };
      if (cloud.status === 'waking') return { icon: '●', word: 'waking', tone: 'waking' };
      if (cloud.status === 'asleep') return { icon: '☾', word: 'asleep · wakes on send', tone: 'sleep' };
    }
    return online(m) ? { icon: '●', word: 'online', tone: 'on' } : { icon: '○', word: 'offline', tone: 'off' };
  };
  const pickable = (m: ChoiceMachine) => isCloud(m) || online(m);
  const sub = forecast.why === 'chosen' ? 'chosen for this session'
    : forecast.why === 'here' ? 'sessions you start on this Mac run here'
      : forecast.why === 'cloud' ? 'the cloud machine is awake'
        : forecast.why === 'this-machine' ? 'no cloud machine is awake' : 'the ladder decides on send';
  const label = current ? nameOf(current) : 'Auto';
  return (
    <div className="cchips">
      <button ref={anchor} className={`cchip cmach${open ? ' open' : ''}${value ? '' : ' auto'}`} disabled={disabled} aria-haspopup="menu" aria-expanded={open}
        data-tip={`Runs on ${label} · ${sub}`} onClick={toggle}>
        <span className="g" aria-hidden>{glyph(current)}</span><span className="lbl">{label}</span><span className="car" aria-hidden>▾</span>
      </button>
      {open && (
        <>
          <div className="projmenu-scrim" onClick={() => setOpen(false)} />
          <div className="cprojpop cmachpop" role="menu" style={cap ? { maxHeight: cap } : undefined}>
            <div className="cprojhint">Run this session on</div>
            <button role="menuitemradio" aria-checked={value === null} className={`cprojitem${value === null ? ' on' : ''}`} onClick={() => { onPick(null); setOpen(false); }}>
              <span className="cprojglyph">{glyph(null)}</span>
              <span className="cprojtxt"><b>Auto</b><span className="cmachsub">{origin === 'desktop' ? (prefs.desktopSessions === 'here' ? 'this Mac by default' : 'cloud when awake · else this Mac') : 'cloud when awake'}</span></span>
              {value === null && <span className="cprojck">✓</span>}
            </button>
            {choosable.map((m) => {
              const st = stateOf(m);
              const on = value === m.id;
              const can = pickable(m);
              return (
                <button key={m.id} role="menuitemradio" aria-checked={on} disabled={!can} className={`cprojitem${on ? ' on' : ''}${can ? '' : ' off'}`}
                  onClick={() => { if (!can) return; onPick(m.id); setOpen(false); }}>
                  <span className="cprojglyph">{glyph(m)}</span>
                  <span className="cprojtxt"><b>{nameOf(m)}</b>{ownerOf(m) && <span className="cmachsub">{ownerOf(m)}</span>}</span>
                  <span className={`cmachst ${st.tone}`} role="img" aria-label={st.word} data-tip={st.word}>{st.icon}</span>
                  {/* the row Auto resolves to right now: "default" when the desktop default says so, else what Auto happens to read */}
                  {forecast.machineId === m.id && !value && <span className="cprojtag">{forecast.why === 'here' ? 'default' : 'auto'}</span>}
                  {on && <span className="cprojck">✓</span>}
                </button>
              );
            })}
            {!choosable.length && <div className="cprojempty">No machine is registered to this workspace yet.</div>}
            <div className="cmachfoot">
              {origin === 'desktop'
                ? <><b>Default: {prefs.desktopSessions === 'here' ? 'This Mac' : 'Auto'}</b> · change in Compute</>
                : <><b>Browser sessions prefer the cloud</b> · pick a machine for this one</>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
