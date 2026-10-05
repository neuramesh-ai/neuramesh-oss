// THE MODEL CHIP (docs/design/models-and-replies-2026-10, boards D1, D2, D7): the composer's model knob,
// for the agent the composer talks to. It reads the seat the daemon will take for THIS person
// (picks.ts seatView), and a pick is the person's own (member.set_agent_model), from their next
// message, on every interface. A provider that cannot run here puts a dot on the chip and the fix in
// the menu. An automation's session runs on the NeuraMesh brain, and the menu says so. The chip and
// its menu are drawn once (ModelChipView): the Code chip is the same view on a coding session.
import { modelLabel, THINKING_LABEL, type ThinkingLevel } from '@neuramesh/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ProviderLogo } from '../brain/providers';
import { roomOn } from '../compute/MachineChip';
import { vendorForModel } from '../lib/models';
import { ModelMenu } from './ModelMenu';
import { chipLabel, markOf, type ProviderKey, type ProviderState, type SeatView } from './picks';

/** the menu's width (.cprojpop.cmodpop): the room it needs beside the chip */
const MENU_W = 330;

/** the chip and its menu, drawn once for every model knob */
export function ModelChipView({ model, level, states, cannot, tip, menuLabel, head, foot, locked, thinking, notes, onPick, onConnect, disabled }: {
  model: string;
  level: ThinkingLevel | null;
  states: Record<ProviderKey, ProviderState>;
  /** the model's provider cannot run here: the chip wears the dot */
  cannot: boolean;
  tip: string;
  menuLabel: string;
  head: ReactNode;
  foot: ReactNode;
  locked?: boolean;
  thinking?: boolean;
  notes?: Partial<Record<ProviderKey, string>>;
  onPick: (model: string, thinking: ThinkingLevel | null) => void;
  onConnect: (provider: ProviderKey) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const [cap, setCap] = useState<number | null>(null);
  // a chip near the pane's right edge (a wrapped row, a narrow room) opens its menu leftward: the pane clips
  const [flip, setFlip] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const toggle = () => {
    setCap(Math.max(260, roomOn(anchor.current) - 24));
    const at = anchor.current?.getBoundingClientRect();
    const edge = anchor.current?.closest('.main')?.getBoundingClientRect().right ?? window.innerWidth;
    setFlip(!!at && at.left + MENU_W > edge - 8);
    setOpen((o) => !o);
  };
  const label = chipLabel(modelLabel(model));
  return (
    <div className="cchips">
      <button ref={anchor} type="button" className={`cchip cmodel${open ? ' open' : ''}`} disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`Model: ${label}`} data-tip={tip} onClick={toggle}>
        <span className="g" aria-hidden><ProviderLogo id={markOf(model)} s={13} /></span>
        <span className="lbl">{label}</span>
        {level && <span className="lv">· {THINKING_LABEL[level]}</span>}
        {cannot && <span className="wdot" aria-label="cannot run here" />}
        <span className="car" aria-hidden>▾</span>
      </button>
      {open && (
        <>
          <div className="projmenu-scrim" onClick={() => setOpen(false)} />
          <div className={`cprojpop cmodpop${flip ? ' flip' : ''}`} role="dialog" aria-label={menuLabel} style={cap ? { maxHeight: cap } : undefined}>
            <ModelMenu head={head} current={model} level={level} states={states} locked={locked} foot={foot} thinking={thinking} notes={notes}
              onPick={(m, t) => { setOpen(false); onPick(m, t); }} onConnect={(p) => { setOpen(false); onConnect(p); }} />
          </div>
        </>
      )}
    </div>
  );
}

export function ModelChip({ who, seat, states, onPick, onConnect, disabled }: {
  who: { name: string };
  seat: SeatView;
  states: Record<ProviderKey, ProviderState>;
  onPick: (model: string, thinking: ThinkingLevel | null) => void;
  onConnect: (provider: ProviderKey) => void;
  disabled?: boolean;
}) {
  const label = chipLabel(modelLabel(seat.model));
  const vendor = vendorForModel(seat.model) as ProviderKey | null;
  const cannot = !!vendor && states[vendor] !== 'ready';
  const automation = seat.source === 'automation';
  const foot = automation
    ? <>Automations run on the NeuraMesh brain.</>
    : cannot
      ? <>{vendor === 'gemini' ? 'Gemini' : vendor === 'openai' ? 'ChatGPT' : 'Claude'} cannot run on a machine you use. Until it can, <b>{who.name}</b> uses the NeuraMesh brain.</>
      : seat.source === 'thread'
        ? <>This conversation runs <b>{who.name}</b> on this model. A pick here changes it.</>
        : <><b>{who.name}</b> uses this model from your next message.</>;
  return (
    <ModelChipView model={seat.model} level={seat.thinking} states={states} cannot={cannot} tip={`${who.name} runs on ${label}`} menuLabel={`Model for ${who.name}`}
      head={<div className="cprojhint cmodhead"><b>Model</b><span>for {who.name}</span></div>} foot={foot} locked={automation}
      onPick={onPick} onConnect={onConnect} disabled={disabled} />
  );
}
