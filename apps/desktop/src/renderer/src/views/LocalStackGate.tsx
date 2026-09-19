// THE FIRST-RUN CARD — Local mode's stack states, drawn from the driver's state over IPC
// (main/localStack). Artboards A1 (the picker), A1b (installing), A2 (the engine starts), A3
// (download), A4 (the stack starts), A6 (update); `ready` is the shell. One card recipe on the
// frame (`.lsgcard`, docs/33 §8), and the card DRAWS: every decision — which state blocks, how many
// MB, which container is stopped and why — arrived in the payload, so nothing here can drift from main.
//
// The stack card is the CHAIN (the first-run round, 2026-09-18, docs/design/first-run-stack-2026-09):
// the picker's radio column becomes the status column, one node per container in boot order, a
// segment that lights once the node above it is ready. The card wears the Porch mark, which plays
// the launch grammar once at mount and then glances left and right every few seconds.
import { useState } from 'react';
import { PorchMark, Wordmark } from '../brand';
import { IconCheck } from '../ui/icons';
import type { LocalProgressItem, LocalRuntime, LocalServiceStatus, LocalStackPayload } from '../bridge/nm';

const RUNTIME_LABEL: Record<LocalRuntime, string> = { colima: 'Colima', orbstack: 'OrbStack', 'docker-desktop': 'Docker Desktop' };
const ENGINE_LABEL: Record<string, string> = { colima: 'Colima', orbstack: 'OrbStack', 'docker-desktop': 'Docker Desktop', other: 'Docker' };
const RUNTIMES: Array<{ id: LocalRuntime; fact: string; tag?: string }> = [
  { id: 'colima', fact: 'Free for every company. No password.', tag: 'recommended' },
  { id: 'orbstack', fact: 'Free for personal use. Opens its installer.' },
  { id: 'docker-desktop', fact: 'Free under 250 people. Asks for your password.' },
];
/** one phrase per container, the way the picker's rows carry one fact each */
const SERVICE_FACT: Record<string, string> = { Postgres: 'The workspace database', 'NeuraMesh API': 'The NeuraMesh server', PowerSync: 'The sync engine' };

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

/** a status row: name · ready | please wait… (the install and engine cards) */
function StatusRow({ name, ready, top }: { name: string; ready: boolean; top?: boolean }) {
  return (
    <div className={`lsgsrow${top ? ' top' : ''}`}>
      <span className="lsgnm">{name}</span>
      <span className={`lsgst${ready ? ' ok' : ''}`}>{ready ? <IconCheck s={11} /> : <span className="lsgwait" />}{ready ? 'ready' : 'please wait…'}</span>
    </div>
  );
}

/** a chain node: ready = filled, a check · starting = a dot under the wizard's spinning halo · queued = a ring · stopped = the failure ink, a cross */
function Node({ status }: { status: LocalServiceStatus }) {
  return (
    <span className={`lsgnode ${status}`} aria-hidden>
      <svg width="18" height="18" viewBox="0 0 18 18">
        {status === 'ready' && <><circle cx="9" cy="9" r="8" /><path d="m5.6 9.3 2.4 2.4 4.6-4.9" /></>}
        {status === 'starting' && <><circle className="lsghalo" cx="9" cy="9" r="8" /><circle className="lsgdot" cx="9" cy="9" r="3.2" /></>}
        {status === 'stopped' && <><circle cx="9" cy="9" r="8" /><path d="m6.4 6.4 5.2 5.2M11.6 6.4l-5.2 5.2" /></>}
        {status === 'queued' && <circle cx="9" cy="9" r="7.75" />}
      </svg>
    </span>
  );
}

/** the chain: the containers in boot order, a segment lit once the node above it is ready, the one word a failure earns */
function Chain({ services }: { services: Array<{ name: string; status: LocalServiceStatus }> }) {
  return (
    <div className="lsgchain" role="list" aria-label="Containers">
      {services.map((s, i) => (
        <div className="lsgcrow" role="listitem" key={s.name}>
          <Node status={s.status} />
          {i < services.length - 1 && <span className={`lsgseg${s.status === 'ready' ? ' lit' : ''}`} aria-hidden />}
          <span className={`lsgcname${s.status === 'queued' ? ' dimmed' : ''}`}>
            <span className="lsgnm">{s.name}</span>
            {SERVICE_FACT[s.name] && <span className="lsgfact">{SERVICE_FACT[s.name]}</span>}
          </span>
          <span className="lsgsr" aria-label={s.status}>{s.status === 'stopped' && <span className="lsgst bad">stopped</span>}</span>
        </div>
      ))}
    </div>
  );
}

function Card({ kicker, title, p, children, actions, foot }: { kicker: string; title: string; p?: string; children?: React.ReactNode; actions?: React.ReactNode; foot?: string }) {
  return (
    <div className="lsgcard" role="dialog" aria-labelledby="lsgtitle">
      <span className="lsgmark" aria-hidden><PorchMark size={40} cut="std" animated /></span>
      <span className="lsgkick">{kicker}</span>
      <h1 className="lsgtitle" id="lsgtitle">{title}</h1>
      {p && <p className="lsgp">{p}</p>}
      {children}
      {actions && <div className="lsgacts">{actions}</div>}
      {foot && <div className="lsgfoot"><span className="lsgmono">{foot}</span></div>}
    </div>
  );
}

/** the three lines on the clipboard, for a report */
function CopyDetails({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="btn quiet sm" onClick={() => { void navigator.clipboard?.writeText(lines.join('\n')); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }}>
      {copied ? 'copied ✓' : 'Copy details'}
    </button>
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
        <Card kicker="First run" title="NeuraMesh is starting up…" p="Your workspace runs in three containers. This usually takes under a minute.">
          <Chain services={s.services} />
        </Card>
      );
      break;
    case 'updating':
      card = (
        <Card kicker="Update" title="Update in progress" p={`NeuraMesh on this Mac updates to ${s.version}. Please wait…`} foot="Your threads open when the update ends">
          <div>{s.items.map((it) => <ProgressRow key={it.name} item={it} />)}</div>
        </Card>
      );
      break;
    case 'error':
      // the cause in plain words, the container's own last line in a well, what Try again does — an
      // error with no diagnosis (Colima did not start.) keeps the two-line card
      card = (
        <Card kicker="Local mode" title="NeuraMesh did not start on this Mac"
          actions={<>
            <button type="button" className="btn primary" onClick={onRescan}>Try again</button>
            <button type="button" className="btn quiet" onClick={onQuit}>Quit</button>
            {s.detail && <><span className="lsggrow" /><CopyDetails lines={[s.message, s.detail, ...(s.remedy ? [s.remedy] : [])]} /></>}
          </>}>
          <p className="lsgcause">{s.message}</p>
          {s.detail && <div className="lsgwell">{s.detail}</div>}
          {s.remedy && <p className="lsgremedy">{s.remedy}</p>}
        </Card>
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
