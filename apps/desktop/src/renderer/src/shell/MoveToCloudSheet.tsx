// THE MOVE TO CLOUD SHEET — a local workspace into a Pro workspace (the source-release round,
// artboards H1 and H2; docs/33 §8). Two doors, the This Mac card and the rail's foot, through one
// module-level opener (lib/toast.ts openMoveToCloud). The sheet DRAWS what main pushes
// (moveipc.ts): the plan's numbers from the opening batch, then the batch in flight, then the
// H2 state. With no Pro cloud workspace to move into, it hands the person to the Upgrade sheet
// instead: a move into Free is refused before a row lands, so the door opens onto the buy.
import { useEffect, useState } from 'react';
import { nm as nmBridge, type MovePlanResult, type MovePush, type MoveTarget } from '../bridge/nm';
import { openUpgrade } from '../lib/toast';
import { IconCloud } from '../ui/icons';
import { fmtBytes, MOVE_COPY as C } from './move-copy';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

const ipcMessage = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '') : String(e));

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="cxrow"><span className="cxk">{k}</span><span className="cxv">{children}</span></div>;
}

/** the one sentence a refusal gets (docs/export-format.md "The response") */
function refusalLine(p: MovePush | { code?: string; message?: string; table?: string; storage?: MovePush['storage'] }): string {
  switch (p.code) {
    case 'PLAN_LIMIT': return C.refusal.PLAN_LIMIT(p.storage);
    case 'IMPORT_ORDER': return C.refusal.IMPORT_ORDER(p.table);
    case 'NOT_PERMITTED': return C.refusal.NOT_PERMITTED;
    case 'IMPORT_TOO_LARGE': return C.refusal.IMPORT_TOO_LARGE;
    default: return C.refusal.FAILED(p.message);
  }
}

function Moved({ plan, onClose }: { plan: Extract<MovePlanResult, { ok: true }>; onClose: () => void }) {
  const counts = plan.alreadyMoved?.counts ?? plan.counts;
  const bytes = plan.alreadyMoved?.totalBytes ?? plan.totalBytes;
  return (
    <div className="upmodal mvdone" role="dialog" aria-labelledby="mvtitle">
      <button className="navpin upmodalx" title="close" onClick={onClose}>✕</button>
      <span className="upeyebrow">{C.eyebrow}</span>
      <h2 className="uptitle" id="mvtitle">{C.moved.title}</h2>
      <p className="upsub">{C.moved.sub(counts['projects'] ?? 0, counts['threads'] ?? 0, fmtBytes(bytes), plan.target.name)}</p>
      <div className="upfoot">
        <button className="btn primary" onClick={() => { void nm?.moveOpen?.(); onClose(); }}>{C.moved.open(plan.target.name)}</button>
        <button className="btn" onClick={onClose}>{C.moved.done}</button>
      </div>
    </div>
  );
}

export function MoveToCloudSheet({ onClose }: { onClose: () => void }) {
  const [plan, setPlan] = useState<MovePlanResult | null>(null);
  const [push, setPush] = useState<MovePush>({ phase: 'idle' });
  const [target, setTarget] = useState<MoveTarget | null>(null);
  const [pick, setPick] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = (want?: string) => {
    if (!nm?.movePlan) return;
    setPlan(null);
    nm.movePlan(want).then((p) => { setPlan(p); if (p.ok) setTarget(p.target); }).catch((e) => setPlan({ ok: false, code: 'FAILED', message: ipcMessage(e) }));
  };
  // main owns the move: a sheet closed and re-opened mid-move picks the phase back up
  useEffect(() => {
    void nm?.moveState?.().then((s) => { if (s) setPush(s); }).catch(() => {});
    load();
    return nm?.onMove?.(setPush);
  }, []);
  // no Pro workspace to move into: the door opens the Upgrade sheet instead (docs/33 §8)
  const toUpgrade = !!plan && !plan.ok && (plan.code === 'NO_CLOUD' || plan.code === 'NOT_PRO');
  useEffect(() => { if (toUpgrade) { onClose(); openUpgrade(); } }, [toUpgrade, onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const start = async () => {
    if (busy || !target || !nm?.moveStart) return;
    setBusy(true);
    try { const r = await nm.moveStart(target.workspaceId); if (!r.ok) setPlan(r); }
    catch (e) { setPush({ phase: 'error', code: 'FAILED', message: ipcMessage(e) }); }
    finally { setBusy(false); }
  };
  const choose = (t: MoveTarget) => { setPick(false); setTarget(t); load(t.workspaceId); };

  if (toUpgrade) return null;
  const moving = push.phase === 'moving';
  const done = (plan?.ok && !!plan.alreadyMoved) || push.phase === 'done';
  const stopped = push.phase === 'ready' && push.seq !== undefined && push.seq > 1 && !!push.total;
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      {plan?.ok && done ? <Moved plan={plan} onClose={onClose} /> : (
        <div className="upmodal mvsheet" role="dialog" aria-labelledby="mvtitle">
          <button className="navpin upmodalx" title="close" onClick={onClose}>✕</button>
          <span className="upeyebrow">{C.eyebrow}</span>
          <h2 className="uptitle" id="mvtitle">{C.title(plan?.source?.name ?? '')}</h2>
          {!plan && <span className="upmono">{C.wait}</span>}
          {plan && !plan.ok && <div className="upnote" role="status">{plan.refusal ? refusalLine({ code: plan.refusal.code, storage: plan.refusal.storage, message: plan.message }) : plan.message}</div>}
          {plan?.ok && target && (
            <div className="mvfacts">
              <Row k={C.into}>
                <button type="button" className="mvchip" disabled={plan.targets.length < 2 || moving} onClick={() => setPick((v) => !v)} aria-expanded={pick}>
                  <IconCloud s={12} />{target.name}{plan.targets.length > 1 && <span className="mvcar">▾</span>}
                </button>
              </Row>
              {pick && (
                <div className="mvpick" role="listbox">
                  {plan.targets.map((t) => (
                    <button type="button" key={t.workspaceId} role="option" aria-selected={t.workspaceId === target.workspaceId} className={`mvopt${t.workspaceId === target.workspaceId ? ' on' : ''}`} onClick={() => choose(t)}>
                      <IconCloud s={12} />{t.name}<span className="upmono">{t.slug}</span>
                    </button>
                  ))}
                </div>
              )}
              <Row k={C.projects}>{plan.counts['projects'] ?? 0}</Row>
              <Row k={C.threads}>{plan.counts['threads'] ?? 0} · {C.tasks(plan.counts['tasks'] ?? 0)}</Row>
              <Row k={C.files}>{fmtBytes(plan.totalBytes)}{plan.storage && <span className="cxtag">{C.of(fmtBytes(plan.storage.allocationBytes))}</span>}</Row>
              <Row k={C.agents}>{plan.agents.length ? plan.agents.join(', ') : C.noAgents}{plan.agents.length > 0 && <span className="upmono">{C.mergeByName}</span>}</Row>
              <Row k={C.stays}>{C.staysLine}{plan.tooLarge > 0 && <> · {C.tooLarge(plan.tooLarge)}</>}</Row>
            </div>
          )}
          {push.phase === 'error' && <div className="upnote" role="status">{refusalLine(push)}</div>}
          {stopped && <div className="upnote" role="status">{C.stopped(push.seq!, push.total!)}</div>}
          {moving && (
            <div className="mvprog" role="status">
              <span className="upmono"><span className="mvwait" aria-hidden />{C.wait} · {C.batch(push.seq ?? 1, push.total ?? 1)} · {C.written(push.written ?? 0)}</span>
              <span className="mvbar"><i style={{ width: `${Math.round(((push.seq ?? 1) - 1) / Math.max(1, push.total ?? 1) * 100)}%` }} /></span>
            </div>
          )}
          <div className="upfoot">
            {moving
              ? <button className="btn quiet" onClick={() => void nm?.moveCancel?.()}>{C.cancel}</button>
              : <>
                {plan?.ok && !!target && <button className="btn primary" disabled={busy || push.phase === 'planning'} onClick={() => void start()}>{busy ? C.wait : C.move}</button>}
                <button className="btn" onClick={onClose}>{C.notNow}</button>
              </>}
            <span className="upgrow" />
            <span className="upmono">{C.foot}</span>
          </div>
        </div>
      )}
    </div>
  );
}
