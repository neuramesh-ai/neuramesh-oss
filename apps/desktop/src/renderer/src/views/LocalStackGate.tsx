// THE FIRST-RUN CARD — Local mode's stack states, drawn from the driver's state over IPC
// (main/localStack). Artboards A1 (the picker), A1b (installing), A2 (the engine starts), A3
// (download), A4 (the stack starts), A6 (update); `ready` is the shell. One card recipe on the
// frame (`.lsgcard`, docs/33 §8), and the card DRAWS: every decision — which state blocks, how many
// MB — arrived in the payload, so nothing here can drift from main.
import { Wordmark } from '../brand';
import { IconCheck } from '../ui/icons';
import type { LocalProgressItem, LocalRuntime, LocalStackPayload } from '../bridge/nm';

const RUNTIME_LABEL: Record<LocalRuntime, string> = { colima: 'Colima', orbstack: 'OrbStack', 'docker-desktop': 'Docker Desktop' };
const ENGINE_LABEL: Record<string, string> = { colima: 'Colima', orbstack: 'OrbStack', 'docker-desktop': 'Docker Desktop', other: 'Docker' };
const RUNTIMES: Array<{ id: LocalRuntime; fact: string; tag?: string }> = [
  { id: 'colima', fact: 'Free for every company. No password.', tag: 'recommended' },
  { id: 'orbstack', fact: 'Free for personal use. Opens its installer.' },
  { id: 'docker-desktop', fact: 'Free under 250 people. Asks for your password.' },
];

const mb = (bytes: number | null): string => (bytes === null ? '' : `${Math.round(bytes / 1e6)} MB`);

/** a download row: name · size · a bar that is bytes over total, never a clock */
function ProgressRow({ item }: { item: LocalProgressItem }) {
  const pct = item.total ? Math.min(100, Math.round((item.bytes / item.total) * 100)) : 0;
  return (
    <div className="lsgprow">
      <span className="lsgnm">{item.done && <IconCheck s={13} />}{item.name}</span>
      <span className="lsgsz">{mb(item.total)}</span>
      <span className={`lsgbar${item.total ? '' : ' idle'}`}><i style={{ width: `${item.done ? 100 : pct}%` }} /></span>
    </div>
  );
}

/** a status row: name · ready | please wait… */
function StatusRow({ name, ready, top }: { name: string; ready: boolean; top?: boolean }) {
  return (
    <div className={`lsgsrow${top ? ' top' : ''}`}>
      <span className="lsgnm">{name}</span>
      <span className={`lsgst${ready ? ' ok' : ''}`}>{ready ? <IconCheck s={11} /> : <span className="lsgwait" />}{ready ? 'ready' : 'please wait…'}</span>
    </div>
  );
}

function Card({ kicker, title, p, children, actions, foot }: { kicker: string; title: string; p: string; children?: React.ReactNode; actions?: React.ReactNode; foot?: string }) {
  return (
    <div className="lsgcard" role="dialog" aria-labelledby="lsgtitle">
      <span className="lsgkick">{kicker}</span>
      <h1 className="lsgtitle" id="lsgtitle">{title}</h1>
      <p className="lsgp">{p}</p>
      {children}
      {actions && <div className="lsgacts">{actions}</div>}
      {foot && <div className="lsgfoot"><span className="lsgmono">{foot}</span></div>}
    </div>
  );
}

export function LocalStackGate({ payload, onPick, onInstall, onRescan, onQuit }: {
  payload: LocalStackPayload;
  onPick: (runtime: LocalRuntime) => void;
  onInstall: () => void;
  onRescan: () => void;
  onQuit: () => void;
}) {
  const s = payload.state;
  let card: React.ReactNode;
  switch (s.phase) {
    case 'no-engine':
      card = (
        <Card kicker="Local mode" title="Choose a container runtime" p="NeuraMesh runs in containers on this Mac. The app installs the runtime you pick."
          actions={<><button type="button" className="btn primary" onClick={onInstall}>Install {RUNTIME_LABEL[s.picked]}</button><button type="button" className="btn" onClick={onRescan}>Scan again</button></>}
          foot="Your data stays on this Mac">
          <div className="lsgrows" role="radiogroup" aria-label="Container runtime">
            {RUNTIMES.map((r) => (
              <button type="button" key={r.id} className={`lsgrow${s.picked === r.id ? ' on' : ''}`} role="radio" aria-checked={s.picked === r.id} onClick={() => onPick(r.id)}>
                <span className={`lsgradio${s.picked === r.id ? ' on' : ''}`} aria-hidden />
                <span className="lsgnm">{RUNTIME_LABEL[r.id]}</span>
                <span className="lsgfact">{r.fact}</span>
                {r.tag && <span className="lsgtag">{r.tag}</span>}
              </button>
            ))}
          </div>
        </Card>
      );
      break;
    case 'installing': {
      const colima = s.runtime === 'colima';
      card = (
        <Card kicker="Local mode" title={`${RUNTIME_LABEL[s.runtime]} installs`} p="Please wait…"
          foot={colima ? 'No password needed · 2 CPUs · 4 GB' : 'Finish the install in its window'}>
          <div>
            {s.items.map((it) => <ProgressRow key={it.name} item={it} />)}
            <StatusRow name={colima ? 'Virtual machine' : 'Installer'} ready={s.vm === 'ready'} top />
          </div>
        </Card>
      );
      break;
    }
    case 'engine-starting': {
      const name = ENGINE_LABEL[s.engine] ?? 'Docker';
      card = (
        <Card kicker="Local mode" title={`${name} starts`} p="Please wait…" foot="Usually under 30 seconds">
          <div><StatusRow name="Virtual machine" ready={false} /></div>
        </Card>
      );
      break;
    }
    case 'downloading':
      card = (
        <Card kicker="First run" title="Download in progress" p={`This happens once.${payload.aboutMb ? ` About ${payload.aboutMb} MB.` : ''} Please wait…`}
          actions={<><span className="lsggrow" /><button type="button" className="btn quiet sm" onClick={onQuit}>Quit</button></>}>
          <div>{s.items.map((it) => <ProgressRow key={it.name} item={it} />)}</div>
        </Card>
      );
      break;
    case 'starting':
      card = (
        <Card kicker="First run" title="The local stack starts" p="Please wait…" foot="Ports open on 127.0.0.1 only">
          <div>{s.services.map((sv) => <StatusRow key={sv.name} name={sv.name} ready={sv.ready} />)}</div>
        </Card>
      );
      break;
    case 'updating':
      card = (
        <Card kicker="Update" title="Update in progress" p={`The local stack updates to ${s.version}. Please wait…`} foot="Your threads open when the update ends">
          <div>{s.items.map((it) => <ProgressRow key={it.name} item={it} />)}</div>
        </Card>
      );
      break;
    case 'error':
      card = (
        <Card kicker="Local mode" title="The local stack did not start" p={s.message}
          actions={<><button type="button" className="btn primary" onClick={onRescan}>Try again</button><button type="button" className="btn quiet" onClick={onQuit}>Quit</button></>} />
      );
      break;
    case 'probing':
    case 'ready':
      card = null;
  }
  return (
    <div className="lsgate">
      <div className="lsgtop"><Wordmark size={14} /></div>
      <div className="lsgcenter">{card}</div>
    </div>
  );
}
