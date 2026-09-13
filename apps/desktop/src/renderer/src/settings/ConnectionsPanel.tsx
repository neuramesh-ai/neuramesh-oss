// SETTINGS › CONNECTIONS — every backend this app talks to (the source-release round, artboard D;
// docs/33 §8). It replaces the Billing tab: billing's rows (plan, seats, status, renews, the
// portal) moved into the neuramesh.app card, because a plan is a fact about a CONNECTION's
// workspace, not about the app. Three cards, top to bottom: This Mac (the local stack), neuramesh.app
// (the cloud, or the Get Pro door when there is none), and Manual setup (a server you run yourself).
// Move to Cloud (U7) is a door on the This Mac card: the move when a Pro cloud workspace exists, the
// Upgrade sheet otherwise, and no button at all once the workspace moved (move-copy.ts moveDoorFor).
import { useCallback, useEffect, useState } from 'react';
import { nm as nmBridge, type ConnectionCard, type LocalStackInfo, type LocalStackPayload } from '../bridge/nm';
import { openMoveToCloud, openUpgrade } from '../lib/toast';
import { moveDoorFor } from '../shell/move-copy';
import { IconServer } from '../ui/icons';
import { CONNECTIONS_COPY, CloudCard, CloudDoor, CustomCard, ThisMacCard } from './connections-cards';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

const ipcMessage = (e: unknown, fallback: string): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '') : fallback);

function ManualSetup({ onAdded }: { onAdded: () => void }) {
  const c = CONNECTIONS_COPY.manual;
  const [apiUrl, setApiUrl] = useState('');
  const [powersyncUrl, setPowersyncUrl] = useState('');
  const [bearer, setBearer] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const connect = async () => {
    if (busy || !nm?.connectionAddCustom) return;
    setBusy(true); setErr(null);
    try {
      const r = await nm.connectionAddCustom({ apiUrl, powersyncUrl: powersyncUrl || undefined, bearer });
      if (!r.ok) { setErr(r.message); return; }
      setApiUrl(''); setPowersyncUrl(''); setBearer('');
      onAdded();
    } catch (e) { setErr(ipcMessage(e, 'The server did not connect.')); }
    finally { setBusy(false); }
  };
  return (
    <div className="cxcard">
      <div className="cxhead"><span className="cxico"><IconServer s={15} /></span><span className="cxname">{c.name}</span></div>
      <p className="cxp dim">{c.sub}</p>
      <div className="cxfields">
        <label className="cxfield"><span>{c.api}</span><input value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="https://" spellCheck={false} autoCapitalize="off" /></label>
        <label className="cxfield"><span>{c.powersync}</span><input value={powersyncUrl} onChange={(e) => setPowersyncUrl(e.target.value)} placeholder="https://" spellCheck={false} autoCapitalize="off" /></label>
        <label className="cxfield"><span>{c.bearer}</span><input type="password" value={bearer} onChange={(e) => setBearer(e.target.value)} placeholder="nmh_…" spellCheck={false} autoCapitalize="off" /></label>
        <div className="cxfieldacts">
          <button type="button" className="btn" disabled={busy || !apiUrl.trim() || !bearer.trim()} onClick={() => void connect()}>{busy ? c.busy : c.connect}</button>
          {err && <span className="cxerr" role="alert">{err}</span>}
        </div>
      </div>
    </div>
  );
}

export function ConnectionsPanel() {
  const [cards, setCards] = useState<ConnectionCard[] | null>(null);
  const [info, setInfo] = useState<LocalStackInfo | null>(null);
  const [stack, setStack] = useState<LocalStackPayload | null>(null);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    void nm?.connectionsList?.().then(setCards).catch((e) => setErr(ipcMessage(e, 'The connections did not load.')));
  }, []);
  useEffect(() => { load(); }, [load]);
  const hasLocal = !!cards?.some((c) => c.kind === 'local');
  // the local stack's facts, only when a local connection exists — a cloud-only launch has no stack to describe
  useEffect(() => {
    if (!hasLocal || !nm?.localStackInfo) return;
    void nm.localStackInfo().then(setInfo).catch(() => {});
    void nm.localStackState?.().then(setStack).catch(() => {});
    void nm.localKeepRunningGet?.().then((r) => setKeep(r.keep)).catch(() => {});
    return nm.onLocalStack?.((p) => { setStack(p); if (p.state.phase === 'ready') void nm?.localStackInfo?.().then(setInfo).catch(() => {}); });
  }, [hasLocal]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr(null);
    try { await fn(); load(); } catch (e) { setErr(ipcMessage(e, 'That did not work.')); } finally { setBusy(null); }
  };
  const cloud = cards?.find((c) => c.kind === 'cloud');
  const local = cards?.find((c) => c.kind === 'local');
  const door = moveDoorFor(cards);
  const customs = cards?.filter((c) => c.kind === 'custom') ?? [];

  return (
    <div className="cxcol">
      {hasLocal && (
        <ThisMacCard info={info} stack={stack} keep={keep} busy={busy === 'restart'} door={door} moved={local?.moved}
          onKeep={(v) => { setKeep(v); void nm?.localKeepRunningSet?.(v).catch(() => setKeep(!v)); }}
          onRestart={() => void act('restart', async () => { const p = await nm?.localStackRestart?.(); if (p) setStack(p); })}
          onShow={(p) => void nm?.showInFolder?.(p)}
          onMove={() => (door === 'move' ? openMoveToCloud() : openUpgrade())}
          onOpenMoved={() => void nm?.moveOpen?.().catch((e) => setErr(ipcMessage(e, 'The workspace did not open.')))} />
      )}
      {cloud
        ? <CloudCard card={cloud} busy={busy === cloud.id}
            onSignOut={() => void act(cloud.id, () => nm!.connectionRemove!(cloud.id))}
            onBilling={() => void nm?.connectionBillingPortal?.(cloud.id).catch((e) => setErr(ipcMessage(e, 'The billing portal did not open.')))}
            onGetPro={() => openUpgrade()} />
        : cards && <CloudDoor onGetPro={() => openUpgrade()} />}
      {customs.map((c) => (
        <CustomCard key={c.id} card={c} busy={busy === c.id} onRemove={() => void act(c.id, () => nm!.connectionRemove!(c.id))} />
      ))}
      <ManualSetup onAdded={load} />
      {err && <div className="cxerr" role="alert">{err}</div>}
    </div>
  );
}
