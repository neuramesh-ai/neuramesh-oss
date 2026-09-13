// The agents' footprint (docs/40) — extracted from App.tsx (track A: leaf views).
import { useEffect, useState } from 'react';
import { NeedsMachine, useOnWeb } from '../compute/NeedsMachine';
import type { FootprintBerthUI, FootprintPayloadUI, FootprintPlanItemUI, FootprintReply, FootprintSnapshot } from '../bridge/rows-infra';
import { nm } from '../bridge/nm';
// ── Agents' footprint (worktree-berths round, docs/design/worktree-berths-2026-08 §5) ─────────
// Machine-scoped disk truth: a Home briefing card (glance + Reclaim now) and a destination with
// the history chart. Both own their fetch (the RetroView pattern) — this is IPC to the daemon,
// never synced rows, the same by-construction exception as Memory. Sizes are APPARENT bytes and
// every surface says so; series identity rides the --viz-* tokens on every mark (validated
// six-checks per theme — the card bar, the area bands, the breakdown dots wear the same hues).
/** the Clean-up preview's plain words, one label per plan group */
const FP_PLAN_LABELS: Record<FootprintPlanItemUI['kind'], (n: number) => string> = {
  finished: (n) => `finished task workspace${n === 1 ? '' : 's'}`,
  submitted: (n) => `submitted workspace${n === 1 ? '' : 's'} (rebuilds in seconds)`,
  dependencies: (n) => `older dependency set${n === 1 ? '' : 's'}`,
  repos: (n) => `repo${n === 1 ? '' : 's'} with no open tasks`,
};
import { Orb } from '../ui/Orb';

export const fmtBytes = (n: number): string => (n >= 0.95e9 ? `${(n / 1e9).toFixed(n >= 10e9 ? 0 : 1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

/** The history chart: hand-rolled stacked area (the repo has no chart lib by design), crosshair +
 *  tooltip by default, honest empty state until sweeps have produced enough samples to mean. */
export function FootprintChart({ history }: { history: FootprintSnapshot[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const W = 760, H = 190, PADL = 36, PADR = 10, PADT = 8, PADB = 20;
  const pts = history.map((s) => ({ at: s.at, berths: s.berths.bytes / 1e9, donors: s.donorsBytes / 1e9, clones: s.clonesBytes / 1e9 }));
  if (pts.length < 3) {
    return <div className="fpchartempty">History appears after a few clean-ups.{pts.length ? ` ${pts.length} sample${pts.length === 1 ? '' : 's'} so far.` : ''}</div>;
  }
  const n = pts.length - 1;
  const maxY = Math.max(1, Math.ceil(Math.max(...pts.map((p) => p.berths + p.donors + p.clones)) * 1.15));
  const x = (i: number): number => PADL + (i / n) * (W - PADL - PADR);
  const y = (v: number): number => PADT + (1 - v / maxY) * (H - PADT - PADB);
  // user-facing series names — the internal berths/donors/clones vocabulary stays in the daemon
  const SERIES: Array<['clones' | 'donors' | 'berths', string, string]> = [
    ['clones', 'repos', 'var(--viz-clones)'],
    ['donors', 'dependencies', 'var(--viz-donors)'],
    ['berths', 'workspaces', 'var(--viz-berths)'],
  ];
  // `h` is the band's thickness at the right edge, where its label sits. On a machine with
  // nothing cached every series is 0.0 GB, so all three bands collapse to the SAME mid and their
  // labels stacked into unreadable mush (George, live). A band you cannot see is a band with
  // nothing to say — the legend under the chart still names all three.
  const bands: Array<{ key: string; label: string; color: string; d: string; mid: number; h: number }> = [];
  const base = pts.map(() => 0);
  for (const [key, label, color] of SERIES) {
    const lows = [...base];
    pts.forEach((p, i) => { base[i] = base[i]! + p[key]; });
    const up = pts.map((_, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(base[i]!).toFixed(1)}`).join('');
    const down = pts.map((_, i) => `L${x(n - i).toFixed(1)},${y(lows[n - i]!).toFixed(1)}`).join('');
    bands.push({ key, label, color, d: up + down + 'Z', mid: y((lows[n]! + base[n]!) / 2), h: Math.abs(y(lows[n]!) - y(base[n]!)) });
  }
  const day = (iso: string): string => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  const hovPt = hov !== null ? pts[hov] : null;
  return (
    <div className="fpchartwrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Disk use over ${pts.length} samples: task workspaces, dependencies and repos in gigabytes, ${day(pts[0]!.at)} to ${day(pts[n]!.at)}.`}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHov(Math.max(0, Math.min(n, Math.round(((px - PADL) / (W - PADL - PADR)) * n))));
        }}
        onMouseLeave={() => setHov(null)}>
        {[0.25, 0.5, 0.75].map((f) => (
          <g key={f}>
            <line x1={PADL} y1={y(maxY * f)} x2={W - PADR} y2={y(maxY * f)} stroke="color-mix(in srgb, var(--text) 8%, transparent)" strokeWidth="1" />
            <text x={PADL - 6} y={y(maxY * f) + 3} textAnchor="end" className="fpaxis">{Math.round(maxY * f)}G</text>
          </g>
        ))}
        {bands.map((b) => <path key={b.key} d={b.d} fill={b.color} stroke="var(--card)" strokeWidth="2" />)}
        {bands.filter((b) => b.h >= 13).map((b) => <text key={`l-${b.key}`} x={W - PADR - 4} y={b.mid + 3} textAnchor="end" className="fpbandlabel">{b.label}</text>)}
        <text x={x(0)} y={H - 6} textAnchor="start" className="fpaxis">{day(pts[0]!.at)}</text>
        <text x={x(n)} y={H - 6} textAnchor="end" className="fpaxis">{day(pts[n]!.at)}</text>
        {hov !== null && <line x1={x(hov)} y1={PADT} x2={x(hov)} y2={H - PADB} stroke="var(--ring)" strokeWidth="1" />}
      </svg>
      {hovPt && (
        <div className="fptip" style={{ left: `calc(${((x(hov!) / W) * 100).toFixed(1)}% - 66px)` }}>
          <div className="d">{new Date(hovPt.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
          {SERIES.slice().reverse().map(([k, label, c]) => <div key={k} className="r"><i style={{ background: c }} />{label}<b>{(hovPt[k]).toFixed(1)} GB</b></div>)}
          <div className="r sum">total<b>{(hovPt.berths + hovPt.donors + hovPt.clones).toFixed(1)} GB</b></div>
        </div>
      )}
    </div>
  );
}

/** The quick footprint read, once — the ring and the workspace face's Footprint row both need
 *  this number and neither should own the fetch (Home's corner ring retired with Home, 2026-08-16;
 *  its gauge moved onto the row that opens the destination). Quick only, never a cold scan. */
export function useFootprint(): FootprintPayloadUI | null {
  const [p, setP] = useState<FootprintPayloadUI | null>(null);
  useEffect(() => {
    let dead = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const ask = (): void => {
      void nm?.footprintGet(true).then((r) => {
        if (dead) return;
        if (r.ready) setP(r.payload);
        else retry = setTimeout(ask, 5000); // the daemon is warming the scan
      }).catch(() => {});
    };
    ask();
    return () => { dead = true; if (retry) clearTimeout(retry); };
  }, []);
  return p;
}

/** …as a percentage of the budget, or null while unread / when there is nothing to report. */
export function footprintPctOf(p: FootprintPayloadUI | null): number | null {
  if (!p || (!p.nm.totalBytes && !p.fleet.length)) return null;
  return Math.max(1, Math.round(Math.min(1, p.nm.totalBytes / Math.max(1, p.nm.budgetBytes)) * 100));
}

/** The corner ring: working-space use against the clean-up budget, as one glance — calm under
 *  60%, warn above. Click opens the footprint view. */
export function FootprintRing({ onOpen }: { onOpen: () => void }) {
  const p = useFootprint();
  if (!p || (!p.nm.totalBytes && !p.fleet.length)) return null;
  const frac = Math.min(1, p.nm.totalBytes / Math.max(1, p.nm.budgetBytes));
  const pct = Math.max(1, Math.round(frac * 100));
  const tone = frac < 0.6 ? 'var(--done)' : 'var(--warn)';
  const R = 8, C = 2 * Math.PI * R;
  const fleetB = p.fleet.reduce((a, f) => a + f.bytes, 0);
  return (
    <button className="fpring" onClick={onOpen}
      title={`Agent disk: ${fmtBytes(p.nm.totalBytes)} of ${fmtBytes(p.nm.budgetBytes)}${fleetB ? ` · other agent tools ${fmtBytes(fleetB)}` : ''}`}
      aria-label={`Agents' footprint: ${pct}% of the disk budget in use. Opens the footprint view.`}>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r={R} fill="none" stroke="color-mix(in srgb, var(--text) 12%, transparent)" strokeWidth="2.5" />
        <circle cx="10" cy="10" r={R} fill="none" stroke={tone} strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={`${(Math.max(0.04, frac) * C).toFixed(2)} ${C.toFixed(2)}`} transform="rotate(-90 10 10)" />
      </svg>
      <span className="fpringpct" style={frac >= 0.6 ? { color: 'var(--warn)' } : undefined}>{pct}%</span>
    </button>
  );
}

/** The destination: hero stats · the history chart · breakdown rows · the fleet well. */
export function FootprintView() {
  // ABOVE every early return: a hook after a conditional return is the "rendered more hooks than
  // during the previous render" crash, and this component has three of those returns below.
  const onWeb = useOnWeb();
  const [reply, setReply] = useState<FootprintReply | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    let dead = false;
    void nm?.footprintGet(false).then((r) => { if (!dead) setReply(r); })
      .catch((e) => { if (!dead) setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 120) : 'could not measure this machine'); });
    return () => { dead = true; };
  }, []);
  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setConfirmOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmOpen]);
  if (err) return <div className="fpempty">{err}</div>;
  // BEFORE the scan state, or the scan state is a lie. On web footprintGet() is a stub that
  // returns { ready: false } forever, so the orb below spun an indefinite "Measuring this
  // machine" about a machine it was never measuring. Not gated on whether a machine is AWAKE:
  // the relay carries pty channels only, so no machine can answer this question yet.
  if (onWeb) {
    return <NeedsMachine what="The agents' footprint"
      detail="It measures that machine's own disk, which the browser cannot read." />;
  }
  // the first open pays a real disk measurement (seconds) — a live orb carries the wait, not a
  // bare sentence. 'searching' per the docs/33 state map: this IS a scan.
  if (!reply || !reply.ready) {
    return (
      <div className="fploading">
        <Orb state="searching" size={64} label="Measuring this machine" />
        <div className="fploadinglbl">Measuring this machine</div>
      </div>
    );
  }
  const p = reply.payload;
  const fleetB = p.fleet.reduce((a, f) => a + f.bytes, 0);
  const stateLabel = (b: FootprintBerthUI): string => {
    const s = (b.state ?? 'unknown').replace(/_/g, ' ');
    return b.cls === 'warm' ? `${s} · can be freed` : s;
  };
  const meter = (b: number, max: number): string => `${Math.max(3, (b / Math.max(1, max)) * 100)}%`;
  const maxRow = Math.max(1, ...p.nm.berths.map((b) => b.bytes), ...p.nm.donors.map((d) => d.bytes), ...p.nm.clones.map((c) => c.bytes));
  const maxFleet = Math.max(1, ...p.fleet.map((f) => f.bytes));
  return (
    <div className="fpview">
      <div className="fpstats">
        <div className="fpstat"><div className="n">{fmtBytes(p.nm.totalBytes)}</div><div className="l">NeuraMesh working space on this Mac</div></div>
        <div className="fpstat"><div className="n">{fmtBytes(p.nm.reclaimableBytes)}</div><div className="l">can be freed now</div></div>
        {fleetB > 0 && <div className="fpstat warnv"><div className="n">{fmtBytes(fleetB)}</div><div className="l">other agent tools on this Mac</div></div>}
      </div>
      <div className="fpviz">
        <div className="fpvizhead">
          <span className="fpviztitle">Disk use over time</span>
          <span className="fpvizlegend">
            <span><i style={{ background: 'var(--viz-berths)' }} />workspaces</span>
            <span><i style={{ background: 'var(--viz-donors)' }} />dependencies</span>
            <span><i style={{ background: 'var(--viz-clones)' }} />repos</span>
          </span>
          <span className="fpconfirmwrap">
            <button className="btn" disabled={busy || p.nm.reclaimableBytes === 0}
              title={p.nm.reclaimableBytes === 0 ? 'Nothing to free right now' : undefined}
              aria-haspopup="dialog" aria-expanded={confirmOpen}
              onClick={() => setConfirmOpen((o) => !o)}>Clean up</button>
            {confirmOpen && (
              // a TRUE preview: these lines are the sweeper's own verdict, itemized, so what the
              // user confirms is exactly what runs. A popover, not a modal: routine housekeeping
              // never dims the room.
              <div className="fpconfirm" role="dialog" aria-label="Clean up preview">
                <div className="d">This will remove</div>
                {p.nm.plan.map((it) => (
                  <div key={it.kind} className="r">{it.count} {FP_PLAN_LABELS[it.kind](it.count)}<b>{fmtBytes(it.bytes)}</b></div>
                ))}
                <div className="safe">Active work is never touched. Anything removed can be rebuilt.</div>
                <div className="acts">
                  <button className="btn" disabled={busy} onClick={() => {
                    setBusy(true); setNote('');
                    void nm?.footprintReclaim().then((r) => {
                      setBusy(false); setConfirmOpen(false);
                      if (r.ready) setReply(r);
                      setNote(r.snapshot ? `Freed ${fmtBytes(r.snapshot.reclaimedBytes)}` : 'No agent daemon on this Mac');
                    }).catch(() => { setBusy(false); setConfirmOpen(false); setNote('Clean-up failed'); });
                  }}>Clean up · {fmtBytes(p.nm.reclaimableBytes)}</button>
                  <button className="btn ghost" onClick={() => setConfirmOpen(false)}>Cancel</button>
                </div>
              </div>
            )}
          </span>
        </div>
        <FootprintChart history={p.history} />
        {note && <div className="fpdone show" style={{ marginTop: 6 }}>{note}</div>}
      </div>
      {p.nm.berths.length > 0 && <div className="fpsec">Task workspaces</div>}
      {p.nm.berths.slice().sort((a, b) => b.bytes - a.bytes).map((b) => (
        <div key={b.taskNumber} className="fprow">
          <span className="dot" style={{ background: b.cls === 'warm' ? 'color-mix(in srgb, var(--viz-berths) 45%, transparent)' : 'var(--viz-berths)' }} />
          <span className="nm">nm-{b.taskNumber}{b.title ? <em> · {b.title}</em> : null}</span>
          <span className="meter"><i style={{ width: meter(b.bytes, maxRow), background: b.cls === 'warm' ? 'color-mix(in srgb, var(--viz-berths) 45%, transparent)' : 'var(--viz-berths)' }} /></span>
          <span className="val">{stateLabel(b)} · <b>{fmtBytes(b.bytes)}</b></span>
        </div>
      ))}
      {p.nm.donors.length > 0 && <div className="fpsec">Saved dependencies</div>}
      {p.nm.donors.map((d) => (
        <div key={`${d.repoId}-${d.hash}`} className="fprow">
          <span className="dot" style={{ background: 'var(--viz-donors)' }} />
          <span className="nm">{d.repoName ?? d.repoId.slice(0, 8)}<em> · reused by new workspaces</em></span>
          <span className="meter"><i style={{ width: meter(d.bytes, maxRow), background: 'var(--viz-donors)' }} /></span>
          <span className="val"><b>{fmtBytes(d.bytes)}</b></span>
        </div>
      ))}
      {p.nm.clones.length > 0 && <div className="fpsec">Cached repos</div>}
      {p.nm.clones.map((c) => (
        <div key={c.repoId} className="fprow">
          <span className="dot" style={{ background: 'var(--viz-clones)' }} />
          <span className="nm">{c.repoName ?? c.repoId.slice(0, 8)}<em>{c.openTasks ? ` · ${c.openTasks} open task${c.openTasks === 1 ? '' : 's'}` : ' · no open tasks'}</em></span>
          <span className="meter"><i style={{ width: meter(c.bytes, maxRow), background: 'var(--viz-clones)' }} /></span>
          <span className="val"><b>{fmtBytes(c.bytes)}</b></span>
        </div>
      ))}
      {p.fleet.length > 0 && (
        <>
          <div className="fpsec">Other agent tools on this Mac</div>
          <div className="fpfleet">
            {p.fleet.map((f) => (
              <div key={f.path} className="fprow">
                <span className="nm">{f.tool}<em> · {f.path.replace(/^\/Users\/[^/]+/, '~')}</em></span>
                <span className="meter"><i style={{ width: meter(f.bytes, maxFleet), background: 'var(--warn)' }} /></span>
                <span className="val">{f.count} worktree{f.count === 1 ? '' : 's'} · <b className="warnv">{fmtBytes(f.bytes)}</b>{f.oldestMs ? <> · oldest {new Date(f.oldestMs).toLocaleDateString([], { month: 'short', day: 'numeric' })}</> : null}</span>
              </div>
            ))}
            <div className="fpfleetfoot">NeuraMesh never touches these. Clean up from the owning tool.</div>
          </div>
        </>
      )}
      <div className="fpnote">Sizes are as listed on disk. Workspaces and saved dependencies share storage, so real use is smaller.</div>
    </div>
  );
}
