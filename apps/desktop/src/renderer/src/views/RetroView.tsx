// The agent retro (docs/13) — extracted from App.tsx (track A: leaf views).
import { useEffect, useState } from 'react';
import { IconCheck, IconInbox, IconMedal, IconMemory, IconSkill, IconTrend } from '../ui/icons';
import { nm } from '../bridge/nm';
import { AgentAvatar } from '../components/AgentAvatar';
import { fmtDur } from '../lib/time';
import { RETRO_RANGES, type RetroPayload, type RetroRange } from '@neuramesh/shared';
// ── Agent Retro (docs/14) — every number arrives from /v1/retro, which derives
// it from the append-only events log, lifecycle stamps, lessons, and skills.
// Levels are recomputed from history server-side; this view renders, it never
// invents. Offline shows the last-known payload with an explicit "as of" banner.
export const RETRO_METRIC_LABEL: Record<string, string> = {
  firstTry: 'first-try pass',
  caught: 'caught before merge',
  planFirstPass: 'plan first pass',
  routed: 'tasks routed',
};
import { Select } from '../ui/Select';

export function RetroView() {
  const [range, setRangeRaw] = useState<RetroRange>(() => {
    const v = localStorage.getItem('nm:retroRange');
    return v === 'lastweek' || v === 'month' || v === 'quarter' ? v : 'week';
  });
  const [data, setData] = useState<RetroPayload | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null); // set when showing the offline cache
  const [err, setErr] = useState('');
  const setRange = (v: string) => {
    const r: RetroRange = v === 'lastweek' || v === 'month' || v === 'quarter' ? v : 'week';
    setRangeRaw(r);
    localStorage.setItem('nm:retroRange', r);
  };
  useEffect(() => {
    let dead = false;
    setErr('');
    const cacheKey = `nm:retroCache:${range}`;
    void nm?.retro(range)
      .then((p) => {
        if (dead) return;
        setData(p);
        setAsOf(null);
        try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), p })); } catch { /* storage full — cache is best-effort */ }
      })
      .catch((e) => {
        if (dead) return;
        try {
          const c = JSON.parse(localStorage.getItem(cacheKey) || '') as { at: number; p: RetroPayload };
          setData(c.p);
          setAsOf(new Date(c.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }));
        } catch {
          setData(null);
          setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 120) : 'could not load the retro');
        }
      });
    return () => { dead = true; };
  }, [range]);

  const window = data ? `${new Date(data.from).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(Date.parse(data.to) - 1).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : '';
  const cycleDelta = data && data.org.avgCycleMs != null && data.org.prevAvgCycleMs != null && data.org.prevAvgCycleMs > 0
    ? Math.round(((data.org.prevAvgCycleMs - data.org.avgCycleMs) / data.org.prevAvgCycleMs) * 100)
    : null; // positive = faster
  const anyImprovement = !!data && (data.org.leveledUp > 0 || data.agents.some((a) => (a.headline.deltaPoints ?? 0) > 0));
  const latestCurve = data ? [...data.curve].reverse().find((c) => c.rate != null) : null;

  return (
    <>
      <div className="topbar">
        <span style={{ fontWeight: 700 }}>Retro</span>
        <span className="desc">{window}</span>
        <div className="actions">
          <span className="mcq-range">
            <Select
              value={range}
              width={128}
              title="time frame"
              options={(Object.keys(RETRO_RANGES) as RetroRange[]).map((k) => ({ value: k, label: RETRO_RANGES[k].label }))}
              onChange={setRange}
            />
          </span>
        </div>
      </div>
      <div className="mcwrap">
        {asOf && <div className="rtstale">offline — showing data as of {asOf}</div>}
        {!data && !err && <div className="mcquiet">Computing the record…</div>}
        {!data && err && (
          <div className="mchero">
            <h3>The retro needs the API</h3>
            <p>{err} — the record derives from the server-side events log, and no cached copy exists yet for this window.</p>
          </div>
        )}
        {data && (
          <>
            <div className="mcgreet">
              <h2>{anyImprovement ? 'Your org got measurably better.' : 'The record, as it stands.'}</h2>
            </div>
            <div className="mcstats rtstats">
              <div className="mcstat ok"><div className="n">{data.org.accepted}</div><div className="l">accepted {RETRO_RANGES[range].label.toLowerCase()}{data.org.acceptedPrev > 0 ? ` · ${data.org.accepted >= data.org.acceptedPrev ? '↗' : '↘'} vs ${data.org.acceptedPrev}` : ''}</div></div>
              <div className="mcstat"><div className="n">{data.org.avgCycleMs != null ? fmtDur(data.org.avgCycleMs) : '—'}</div><div className="l">avg claim → accepted{cycleDelta != null ? ` · ${cycleDelta >= 0 ? `${cycleDelta}% faster` : `${Math.abs(cycleDelta)}% slower`} than ${RETRO_RANGES[range].prev}` : ''}</div></div>
              <div className="mcstat"><div className="n">{data.org.lessons}</div><div className="l">{data.org.lessons === 1 ? 'lesson written to memory' : 'lessons written to memory'}</div></div>
              <div className="mcstat act"><div className="n">{data.org.leveledUp}</div><div className="l">{data.org.leveledUp === 1 ? 'agent leveled up' : 'agents leveled up'}</div></div>
            </div>

            <div className="rtgrid">
              {data.agents.map((a) => {
                const h = a.headline;
                const label = RETRO_METRIC_LABEL[h.kind] ?? h.kind;
                return (
                  <div key={a.id} className={`mcpanel rtcard${a.leveledUp ? ' up' : ''}`}>
                    {a.leveledUp && <span className="rtup"><IconMedal s={11} /> leveled up</span>}
                    <div className="rthead">
                      <AgentAvatar name={a.name} size={28} />
                      <div className="rtwho"><b>{a.name}</b><span>{a.role}</span></div>
                      <span className="rtlv" title={`xp ${a.xp} — recomputed from full history on every load, nothing stored`}>lv.{a.level}</span>
                    </div>
                    <div className="rthl">
                      {h.deltaPoints != null ? (
                        <><b className={h.deltaPoints >= 0 ? 'good' : 'bad'}>{h.deltaPoints >= 0 ? '+' : ''}{h.deltaPoints}pt</b> {label} · {Math.round((h.rate ?? 0) * 100)}%</>
                      ) : h.kind === 'routed' ? (
                        <><b>{h.n}</b> {label}</>
                      ) : h.rate != null ? (
                        <><b>{Math.round(h.rate * 100)}%</b> {label} · {h.n} of {h.d}</>
                      ) : h.d > 0 ? (
                        <><b>{h.n} of {h.d}</b> {label} <span className="rtsmall">small sample</span></>
                      ) : (
                        <span className="rtquiet">quiet window — no {label} activity</span>
                      )}
                    </div>
                    <div className={`mcspark rtspark${a.spark.length > 14 ? ' dense' : ''}`} role="img" aria-label={`activity per ${a.spark.length > 13 ? 'day' : 'bucket'}: ${a.spark.join(', ')}`}>
                      {a.spark.map((n, i) => (
                        <i key={i} title={`${n} action${n === 1 ? '' : 's'}`} style={{ height: `${Math.max(4, (n / Math.max(1, ...a.spark)) * 100)}%` }} />
                      ))}
                    </div>
                    <div className="rtxp">
                      <span>XP to lv.{a.level + 1}</span>
                      <span>{Math.round(a.progress * 100)}%</span>
                    </div>
                    <div className="rtbar"><i style={{ width: `${Math.round(a.progress * 100)}%` }} /></div>
                    <div className="rtcounts">
                      <span title="tasks accepted in this window"><IconCheck s={11} /> {a.counts.accepted}</span>
                      <span title="reviews given"><IconInbox s={11} /> {a.counts.reviews}</span>
                      <span title="lessons from this agent's tasks"><IconMemory s={11} /> {a.counts.lessons}</span>
                      <span title="skills proposed"><IconSkill s={11} /> {a.counts.skillsProposed}</span>
                    </div>
                    {a.learned && <div className="rtlearned"><IconMemory s={12} /> <span><b>learned:</b> {a.learned}</span></div>}
                  </div>
                );
              })}
              {data.agents.length === 0 && <div className="mcquiet">No agents registered yet — the record starts when the crew does.</div>}
            </div>

            <div className="mcpanel rtcurvewrap">
              <div className="mcq-h"><span className="mcq-ic"><IconTrend s={14} /></span>Compounding curve
                <span className="mcq-count">org first-try pass · last 8 weeks</span>
              </div>
              {latestCurve ? (
                <div className="mcthru"><b>{Math.round((latestCurve.rate ?? 0) * 100)}%</b> latest measured week</div>
              ) : (
                <div className="mcquiet">Not enough reviewed work yet — bars appear once a week carries {3}+ approvals.</div>
              )}
              <div className="rtcurve">
                {data.curve.map((c) => (
                  <div key={c.weekStart} className="rtcurvecol" title={`wk of ${new Date(c.weekStart).toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${c.rate != null ? `${Math.round(c.rate * 100)}% of ${c.d}` : `${c.n} of ${c.d} — below the floor`}`}>
                    {c.rate != null ? <i style={{ height: `${Math.max(6, c.rate * 100)}%` }} /> : <i className="gap" />}
                  </div>
                ))}
              </div>
            </div>

            <div className="mcpanel rtlessons">
              <div className="mcq-h"><span className="mcq-ic"><IconMemory s={14} /></span>Learnings distilled into memory
                <span className="mcq-count">{data.lessons.length === 1 ? '1 lesson' : `${data.lessons.length} lessons`}</span>
              </div>
              {data.lessons.length === 0 ? (
                <div className="mcquiet">None this window — lessons land when review corrections teach something durable.</div>
              ) : (
                data.lessons.map((l, i) => (
                  <div key={i} className="rtlesson">
                    <span className="mcq-ic"><IconMemory s={12} /></span>
                    <span className="rtlessontxt">{l.learner ? <b>{l.learner} · </b> : null}{l.content}</span>
                    {l.taskNumber != null && <span className="rtlessontask">#{l.taskNumber}</span>}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
