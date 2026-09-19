// THE FIRST-RUN DOORS (docs/design/first-run-doors-2026-09, artboards D1 to D6): the screen a fresh
// install sees BEFORE anything builds. Where should your workspace live: This Mac (the stack, then
// the local wizard) or The cloud (the hosted sign-up, then the wizard resumes), with Sign in beside
// Continue for a person who has an account. The same card recipe as the stack states (`.lsgcard`,
// docs/33 §8) with the picker's radio rows, each row wearing its glyph. The card draws main's state
// (main/firstrun.ts) and decides nothing: which page opens, when the wait expires, where the shell
// lands afterwards all arrive over IPC.
import { useState } from 'react';
import { Wordmark } from '../brand';
import { IconCloud, IconMachine } from '../ui/icons';
import type { FirstRunDoor as Door, FirstRunState } from '../bridge/nm';
import { Card, StatusRow } from './LocalStackGate';

/** every sentence a person reads on the doors, in one place (CLAUDE.md #11) — the artboards' words */
export const FIRST_RUN_COPY = {
  kicker: 'First run',
  title: 'Where should your workspace live?',
  sub: 'Pick one now. You can upgrade to the cloud at any time.',
  mac: { name: 'This Mac', fact: 'No account. Three containers on this Mac. Your keys stay here.' },
  cloud: { name: 'The cloud', fact: '500 free credits to start. Sync across desktop, web and mobile.' },
  continue: 'Continue →',
  signin: 'Sign in',
  foot: 'Have an account? Sign in opens neuramesh.app',
  wait: {
    title: 'Finish in your browser',
    signup: 'Sign up on neuramesh.app. This window waits.',
    signin: 'Sign in on neuramesh.app. This window waits.',
    row: 'neuramesh.app',
    reopen: 'Open the page again',
    cancel: 'Cancel',
    foot: 'Your session lands back in this window',
  },
  expired: { cause: 'The browser did not finish.', remedy: 'Try again opens the page with a fresh code.', retry: 'Try again' },
  landing: { title: 'Signed in', sub: 'Your workspace opens. Please wait…' },
  error: { title: 'That did not work', retry: 'Try again', cancel: 'Back' },
} as const;

type Place = 'local' | 'cloud';
const PLACES: Array<{ id: Place; name: string; fact: string; glyph: React.ReactNode }> = [
  { id: 'local', name: FIRST_RUN_COPY.mac.name, fact: FIRST_RUN_COPY.mac.fact, glyph: <IconMachine s={16} /> },
  { id: 'cloud', name: FIRST_RUN_COPY.cloud.name, fact: FIRST_RUN_COPY.cloud.fact, glyph: <IconCloud s={16} /> },
];

/** the two places as radio rows: arrows move the pick, Enter continues */
function Places({ pick, onPick, onContinue }: { pick: Place; onPick: (p: Place) => void; onContinue: () => void }) {
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); onPick(pick === 'local' ? 'cloud' : 'local'); }
    if (e.key === 'Enter') { e.preventDefault(); onContinue(); }
  };
  return (
    <div className="lsgrows" role="radiogroup" aria-label="Where your workspace lives" onKeyDown={onKey}>
      {PLACES.map((p) => (
        <button type="button" key={p.id} className={`lsgrow place${pick === p.id ? ' on' : ''}`} role="radio" aria-checked={pick === p.id} onClick={() => onPick(p.id)} onDoubleClick={onContinue}>
          <span className={`lsgradio${pick === p.id ? ' on' : ''}`} aria-hidden />
          <span className="lsgglyph" aria-hidden>{p.glyph}</span>
          <span className="lsgnm">{p.name}</span>
          <span className="lsgfact">{p.fact}</span>
        </button>
      ))}
    </div>
  );
}

export function FirstRunDoor({ state, onChoose, onReopen, onCancel }: {
  state: FirstRunState;
  onChoose: (door: Door) => void;
  onReopen: () => void;
  onCancel: () => void;
}) {
  const [pick, setPick] = useState<Place>('local');
  const C = FIRST_RUN_COPY;
  let card: React.ReactNode;
  switch (state.phase) {
    case 'choose':
      card = (
        <Card kicker={C.kicker} title={C.title} p={C.sub} foot={C.foot}
          actions={<><button type="button" className="btn primary" onClick={() => onChoose(pick)}>{C.continue}</button><span className="lsggrow" /><button type="button" className="btn" onClick={() => onChoose('signin')}>{C.signin}</button></>}>
          <Places pick={pick} onPick={setPick} onContinue={() => onChoose(pick)} />
        </Card>
      );
      break;
    case 'waiting':
      card = (
        <Card kicker={C.kicker} title={C.wait.title} p={state.door === 'cloud' ? C.wait.signup : C.wait.signin} foot={C.wait.foot}
          actions={<><button type="button" className="btn" onClick={onReopen}>{C.wait.reopen}</button><button type="button" className="btn quiet" onClick={onCancel}>{C.wait.cancel}</button></>}>
          <div><StatusRow name={C.wait.row} ready={false} /></div>
        </Card>
      );
      break;
    case 'landing':
      card = <Card kicker={C.kicker} title={C.landing.title} p={C.landing.sub} />;
      break;
    case 'expired':
      card = (
        <Card kicker={C.kicker} title={C.wait.title}
          actions={<><button type="button" className="btn primary" onClick={() => onChoose(state.door)}>{C.expired.retry}</button><button type="button" className="btn quiet" onClick={onCancel}>{C.wait.cancel}</button></>}>
          <p className="lsgcause">{C.expired.cause}</p>
          <p className="lsgremedy">{C.expired.remedy}</p>
        </Card>
      );
      break;
    case 'error':
      card = (
        <Card kicker={C.kicker} title={C.error.title}
          actions={<><button type="button" className="btn primary" onClick={() => onChoose(state.door)}>{C.error.retry}</button><button type="button" className="btn quiet" onClick={onCancel}>{C.error.cancel}</button></>}>
          <p className="lsgcause">{state.message}</p>
        </Card>
      );
      break;
    case 'done':
      card = null;
  }
  return (
    <div className="lsgate">
      <div className="lsgtop"><Wordmark size={14} /></div>
      <div className="lsgcenter">{card}</div>
    </div>
  );
}
