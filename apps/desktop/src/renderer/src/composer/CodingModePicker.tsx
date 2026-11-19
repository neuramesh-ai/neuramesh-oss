import { useEffect, useId, useRef, useState } from 'react';
import type { EngineeringControls } from '@neuramesh/shared';
import { IconCheck } from '../ui/icons';
import { ComposerMenuPanel } from './ComposerMenuPanel';

const choices = {
  plan: { label: 'Plan', description: 'Inspect the repository and propose a work plan.' },
  act: { label: 'Act', description: 'Make changes and run checks.' },
} as const;

export function CodingModePicker({ mode, disabled, onChange }: {
  mode: EngineeringControls['mode'];
  disabled: boolean;
  onChange: (mode: EngineeringControls['mode']) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const select = (value: EngineeringControls['mode']) => {
    setOpen(false);
    trigger.current?.focus();
    if (!disabled && value !== mode) onChange(value);
  };
  return <>
    <button type="button" ref={trigger} className="cchip coding-mode-chip"
      disabled={disabled} aria-label={'Coding mode: ' + choices[mode].label} aria-haspopup="menu"
      aria-expanded={open && !disabled} aria-controls={open && !disabled ? menuId : undefined}
      onClick={() => setOpen(current => !current)} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); }
      }}>
      <span className="lbl">{choices[mode].label}</span><span className="car" aria-hidden="true">▴</span>
    </button>
    {open && !disabled && <ComposerMenuPanel trigger={trigger} id={menuId} label="Coding mode" className="coding-mode-menu" dismiss={setOpen}>
      {(['plan', 'act'] as const).map(value => <button type="button" key={value} role="menuitemradio" aria-checked={value === mode} onClick={() => select(value)}>
        <span><b>{choices[value].label}</b><small>{choices[value].description}</small></span>
        {value === mode && <IconCheck s={14} />}
      </button>)}
    </ComposerMenuPanel>}
  </>;
}
