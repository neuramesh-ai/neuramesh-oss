import {Modal} from '../ui/Modal';
import {anchorPoint} from '../ui/anchor';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinanceAccount, FinanceConnection } from '@neuramesh/shared';
import { nm } from '../bridge/nm';
import { DestinationRoster, useDestinationAccess } from '../destinations/DestinationAccess';
import { FinanceWorkspace } from './FinanceWorkspace';
import './finance.css';

export function FinanceHome({onConnect}:{onConnect:(provider:import('../models/picks').ProviderKey)=>void}) {
  const { access, reload: reloadAccess } = useDestinationAccess();
  const [legacy, setLegacy] = useState(false), [adopting, setAdopting] = useState(false);
  const [connection, setConnection] = useState<FinanceConnection | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const revision = ++generation.current;
    try {
      const status = await nm!.financeStatus();
      if (revision !== generation.current) return;
      setConnection(status);
      if (status.state === 'connected') {
        const result = await nm!.financeAccounts();
        if (revision !== generation.current) return;
        setAccounts(result.accounts);
      } else setAccounts([]);
      setError('');
    } catch (e) { if (revision === generation.current) { setAccounts([]);setConnection(null);setError(e instanceof Error ? e.message : 'Finance could not refresh. Try again.');void reloadAccess(); } }
  }, [reloadAccess]);
  useEffect(() => { const requests = generation; void refresh(); return () => { requests.current++; }; }, [refresh]);
  useEffect(() => {
    const pending = connection?.state === 'pending' || connection?.state === 'confirmation';
    const id = pending ? setInterval(() => { if (!document.hidden) void refresh(); }, 4000) : undefined;
    const focus = () => void refresh(); window.addEventListener('focus', focus);
    return () => { clearInterval(id); window.removeEventListener('focus', focus); };
  }, [connection?.state, refresh]);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'Could not update the connection. Try again.'); } finally { setBusy(false); }
  };
  useEffect(() => { if (connection?.state === 'disconnected' && access.canManage) void nm!.financeMigration().then(r => setLegacy(r.available)).catch(() => setLegacy(false)); }, [connection?.state, access.canManage]);
  const start = (intent: 'create' | 'connect') => void act(async () => {
    const { url } = await nm!.financeStart(intent); await nm!.financeOpen(url);
  });
  const connected = connection?.state === 'connected';
  return <div className="finance-home">
    <header className="topbar finance-head">Finance<span className="desc">Powered by Kinshi</span><DestinationRoster /></header>
    <main className="finance-content">
      {error && !disconnecting && !adopting && <div className="finance-error" role="alert"><p>{error}</p><button className="btn" disabled={busy} onClick={() => void refresh()}>Try again</button></div>}
      {!connection && !error && <p role="status">Checking your Finance connection…</p>}
      {connection?.state === 'unconfigured' && <section className="finance-empty"><p className="finance-eyebrow">NEURAMESH FINANCE</p><h1>Finance starts with your Kinshi account.</h1><p>Kinshi Finance isn’t configured on this server yet. Your administrator needs to enable the secure Kinshi connection.</p><p>Account setup will be available here once the connection is configured.</p></section>}
      {connection && !connected && connection.state !== 'unconfigured' && <ConnectionSetup canManage={access.canManage} connection={connection} busy={busy} start={start} act={act} onCancel={() => setDisconnecting(true)} />}
      {legacy && connection?.state === 'disconnected' && access.canManage && <section className="finance-permission-card"><h2>Use your existing Kinshi connection?</h2><p>Bring the connected accounts into this workspace’s Finance channel. Only the workspace owner has access until members or agents are added.</p><button className="btn" onClick={() => setAdopting(true)}>Use existing Kinshi connection</button></section>}
      {connected && <FinanceWorkspace onConnect={onConnect} connection={connection} accounts={accounts} onManage={() => void act(async () => { const { url } = await nm!.financeManage();await nm!.financeOpen(url); })} onRefreshConnection={refresh} onDisconnect={() => setDisconnecting(true)} />}
      {adopting && <Modal title="Use this connection for workspace Finance?" subtitle="Kinshi connection" origin={anchorPoint()} onClose={()=>setAdopting(false)} dismissible={!busy} escape={!busy} footer={<><button className="btn" disabled={busy} onClick={()=>setAdopting(false)}>Cancel</button><button className="btn primary" disabled={busy} onClick={()=>void act(async()=>{await nm!.financeAdopt();setAdopting(false);setLegacy(false);})}>Use for this workspace</button></>}><p>The connected Kinshi accounts and future conversations will be available to the workspace owner and the people or agents added to Finance.</p><p>This moves the connection out of the earlier personal setup.</p>{error&&<p className="finance-error" role="alert">{error}</p>}</Modal>}
      {disconnecting && <Modal title={connected?'Disconnect Kinshi?':'Cancel account setup?'} origin={anchorPoint()} onClose={()=>setDisconnecting(false)} dismissible={!busy} escape={!busy} footer={<><button className="btn" autoFocus disabled={busy} onClick={()=>setDisconnecting(false)}>Keep {connected?'connection':'setup'}</button><button className="btn" disabled={busy} onClick={()=>void act(async()=>{await nm!.financeDisconnect();setDisconnecting(false);})}>{busy?'Disconnecting…':'Disconnect'}</button></>}><p>Finance will lose access to the shared accounts. Your Kinshi account and bank connections will stay available in Kinshi.</p>{error&&<p className="finance-error" role="alert">{error}</p>}</Modal>}

    </main>
  </div>;
}

type SetupProps = {
  canManage: boolean;
  connection: FinanceConnection;
  busy: boolean;
  start: (intent: 'create' | 'connect') => void;
  act: (fn: () => Promise<void>) => Promise<void>;
  onCancel: () => void;
};
function ConnectionSetup({ connection, busy, start, act, onCancel, canManage }: SetupProps) {
  if (!canManage) return <section className="finance-empty"><h1>Workspace Finance is getting ready.</h1><p>The workspace owner needs to connect or confirm Kinshi before Finance data is available.</p></section>;
  const pending = connection.state === 'pending';
  const confirmation = connection.state === 'confirmation';
  return <section className="finance-empty">
        <p className="finance-eyebrow">NEURAMESH FINANCE</p>
        <h1>{confirmation ? 'Confirm your Kinshi account.' : pending ? 'Continue your Kinshi setup.' : 'Your workspace’s finances, in one quiet space.'}</h1>
        <p>{confirmation ? 'Check the Kinshi identity below before bringing these accounts into NeuraMesh.' : pending ? 'Finish account setup, connect a bank, and choose which accounts Finance can read. You can safely close this page and resume later.' : 'Connect Kinshi to see your account balances and sync insights here. Your Kinshi account also works independently.'}</p>
        {connection.state === 'expired' && <p role="status">Your previous connection expired. Set up a new connection to continue.</p>}
        {connection.state === 'revoked' && <p role="status">This connection was revoked. Reconnect when you’re ready.</p>}
        {confirmation && <div className="finance-consent-summary"><strong>{connection.identity?.email ?? 'Verified Kinshi account'}</strong><span>{connection.accountCount} selected account{connection.accountCount === 1 ? '' : 's'}</span><span>Balances{connection.capabilities?.includes('transactions:read')?' · Transactions and spending':''}{connection.capabilities?.includes('budgets:read')?' · Budgets':''}{connection.capabilities?.includes('budgets:write')?' · Budget changes after owner approval':''}</span><span>Expires 30 days after confirmation</span></div>}
        <SetupActions connection={connection} busy={busy} start={start} act={act} onCancel={onCancel} />
        <div className="finance-setup-steps"><span>1 · Create or sign in</span><span>2 · Connect your bank</span><span>3 · Choose accounts</span><span>4 · Confirm here</span></div>
        <p className="finance-note">Bank authorization happens securely in Kinshi. NeuraMesh never receives your bank login or permission to move money.</p>
      </section>;
}
function SetupActions({ connection, busy, start, act, onCancel }: Omit<SetupProps, 'canManage'>) {
  const pending = connection.state === 'pending';
  const confirmation = connection.state === 'confirmation';
  return <div className="finance-actions">
          {confirmation ? <button className="btn" disabled={busy || !connection.identity} onClick={() => void act(async () => { await nm!.financeConfirm(connection.identity!.id); })}>Confirm and connect</button> : <>
            <button className="btn" disabled={busy} onClick={() => start(pending ? 'connect' : 'create')}>{busy ? 'Opening Kinshi…' : pending ? 'Continue setup in Kinshi ↗' : 'Create a Kinshi account ↗'}</button>
            {!pending && <button className="btn" disabled={busy} onClick={() => start('connect')}>Connect existing Kinshi ↗</button>}
          </>}
          {(pending || confirmation) && <button className="btn" disabled={busy} onClick={() => onCancel()}>Cancel setup</button>}
        </div>;
}
