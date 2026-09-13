// THE REPORT CARD (docs/design/marketing-os-2026-08) — a scored playbook deliverable worn as
// a scorecard: kicker · the dial · serif title · basis line · dimension bars · fix-first ·
// the gaps line (never hidden — the honesty spine on the card face) · Open/Save/Re-measure.
// Two doors, one body: the ‹report:id› marker (self-contained like ArticleCard — it reads its
// own artifact row) and the delivery strip's markdown branch (a doc that PARSES as a report
// renders as one everywhere, the articles.ts one-parse rule). A doc that fails `reportFrom`
// never gets a dial — the parser and the runner's shape guard share that refusal.
import {
  playbookAsk,
  playbookById,
  playbookOfReport,
  reportFacts,
  reportFrom,
  reportTrend,
  type Playbook,
  type ReportMeta,
} from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { useEffect, useMemo, useState } from 'react';
import type { ArticleRow } from './ArticleCard';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

export interface ReportOpen {
  label: string;
  file: string;
  doc: string;
}

/** the dial — the docs/25 conic ring at card scale, riding --viz-score */
function Dial({ score, size = 58 }: { score: number; size?: number }) {
  return (
    <div className="repdial" style={{ width: size, height: size, ['--frac' as never]: String(score / 100) }} aria-label={`score ${score} of 100`}>
      <b>{score}</b>
      <span>/100</span>
    </div>
  );
}

/** one body both doors render — dial, title/basis, dims, fix-first, gaps */
export function ReportBody({ meta, delta, prevWhen }: { meta: ReportMeta; delta?: number | null; prevWhen?: string | null }) {
  return (
    <>
      <div className="repmain">
        <Dial score={meta.score} />
        <div className="reptxt">
          <div className="reptitle">{meta.title}</div>
          <div className="repbasis">{reportFacts(meta)}</div>
          {typeof delta === 'number' && (
            <div className={`repdelta${delta < 0 ? ' down' : ''}`}>
              {delta >= 0 ? '▲' : '▼'} {delta >= 0 ? '+' : ''}{delta}{prevWhen ? ` vs ${new Date(prevWhen).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
            </div>
          )}
        </div>
      </div>
      {meta.dims.length > 0 && (
        <div className="repdims">
          {meta.dims.map((d) => (
            <div key={d.label} className="repdim">
              <span>{d.label}</span>
              <div className="repbar"><i style={{ width: `${d.score}%` }} /></div>
              <b>{d.score}</b>
            </div>
          ))}
        </div>
      )}
      {meta.fixFirst > 0 && <div className="repfix"><b>Fix these first ({meta.fixFirst})</b></div>}
      <div className="repgaps"><span className="k">Couldn't determine</span><span>{meta.gaps || 'nothing — every dimension was inspectable'}</span></div>
    </>
  );
}

/** the delivery strip's door — compact, inside .filecanvas (the FileCard head owns Open) */
export function ReportFileBody({ name, content }: { name: string; content: string }) {
  const meta = useMemo(() => reportFrom(name, content), [name, content]);
  if (!meta) return null;
  return <div className="repcard infile"><ReportBody meta={meta} /></div>;
}

function useReport(id: string): { row: ArticleRow | null; meta: ReportMeta | null; gone: boolean; refresh: () => void } {
  const [row, setRow] = useState<ArticleRow | null>(null);
  const [gone, setGone] = useState(false);
  const refresh = () => {
    void nm?.artifact(id).then(
      (r) => { setRow(r.artifact); setGone(!r.artifact); },
      () => setGone(true),
    );
  };
  useEffect(() => { refresh(); }, [id]);
  const meta = useMemo(() => (row?.inline_content ? reportFrom(row.name, row.inline_content) : null), [row?.name, row?.inline_content]);
  return { row, meta, gone, refresh };
}

/** the trend — sibling runs of the same playbook in the same room, one read per card */
function useDelta(row: ArticleRow | null, pb: string | null): { delta: number | null; prevWhen: string | null } {
  const [state, setState] = useState<{ delta: number | null; prevWhen: string | null }>({ delta: null, prevWhen: null });
  const chan = row?.channel_id ?? null;
  useEffect(() => {
    if (!pb || !chan || !row) { setState({ delta: null, prevWhen: null }); return; }
    void nm?.channelArtifacts(chan).then((r) => {
      const runs = r.artifacts
        .filter((a) => a.inline_content)
        .map((a) => {
          const m = reportFrom(a.name, a.inline_content!);
          return { id: a.id, created_at: a.created_at, score: m?.score, of: playbookOfReport(a.name, m?.title ?? null) };
        })
        .filter((a): a is { id: string; created_at: string; score: number; of: string } => typeof a.score === 'number' && a.of === pb);
      const t = reportTrend(runs);
      // the delta belongs to THIS run, not blindly to the latest — an old card must not wear
      // a newer run's arithmetic
      if (t.latest?.id === row.id) setState({ delta: t.delta, prevWhen: t.prevAt });
      else setState({ delta: null, prevWhen: null });
    }).catch(() => setState({ delta: null, prevWhen: null }));
  }, [pb, chan, row?.id]);
  return state;
}

function remeasureArgs(pb: Playbook): { cadence: string; atTime?: string; weekday?: number; runAt?: string } | null {
  const r = pb.remeasure;
  if (!r) return null;
  if ('days' in r) {
    const at = new Date();
    at.setDate(at.getDate() + r.days);
    at.setHours(9, 0, 0, 0);
    return { cadence: 'once', runAt: at.toISOString() };
  }
  return { cadence: r.cadence, atTime: '09:00', weekday: r.cadence === 'weekly' ? new Date().getDay() : undefined };
}

export function ReportCard({ id, onOpen }: { id: string; onOpen?: (r: ReportOpen) => void }) {
  const { row, meta, gone, refresh } = useReport(id);
  const pbId = row ? playbookOfReport(row.name, meta?.title ?? null) : null;
  const { delta, prevWhen } = useDelta(row, pbId);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  if (gone) return <div className="repcard repgone">this report is no longer here</div>;
  if (!row || !meta) return <div className="repcard repgone">loading report…</div>;
  const pb = playbookById(pbId);
  const saved = (row.promoted ?? 0) > 0;
  const shelve = async () => {
    setBusy(true);
    try { await nm?.promoteArtifact(row.id); refresh(); } finally { setBusy(false); }
  };
  // the SchedRecsCard idiom: one click arms; a Free workspace's 402 routes to the upgrade
  // card via nm:plan-limit, so a create failure closes silently here
  const arm = async () => {
    if (!pb || !row.channel_id) return;
    const args = remeasureArgs(pb);
    if (!args) return;
    setBusy(true);
    try {
      await nm?.scheduleCreate({ channelId: row.channel_id, title: `Re-run: ${pb.title}`, prompt: playbookAsk(pb), routine: true, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', ...args });
      setArmed(true);
    } catch { /* 402 → upgrade card */ } finally { setBusy(false); }
  };
  return (
    <div className="repcard">
      <div className="repkick">
        <span className="k">Report · {pb ? pb.title : 'scored deliverable'}</span>
        {saved && <span className="chip artsaved">★ in Files</span>}
      </div>
      <ReportBody meta={meta} delta={delta} prevWhen={prevWhen} />
      <div className="repacts">
        <button className="btn primary sm" disabled={!row.inline_content}
          onClick={() => row.inline_content && onOpen?.({ label: meta.title, file: row.name, doc: row.inline_content })}>
          Open report
        </button>
        {!saved && <button className="btn ghost sm" disabled={busy} onClick={() => void shelve()}>Save to Files</button>}
        {pb?.remeasure && row.channel_id && (armed
          ? <span className="reparmed">armed · {pb.remeasure.label}</span>
          : <button className="btn ghost sm" disabled={busy} onClick={() => void arm()}>{pb.remeasure.label[0]!.toUpperCase() + pb.remeasure.label.slice(1)}</button>)}
      </div>
    </div>
  );
}
