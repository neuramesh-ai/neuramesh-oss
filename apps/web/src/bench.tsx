// The model-benchmarks page (docs/11): leaderboard, scatter, cards, methodology.
import { useState } from 'react';
import { DATA, MODELS, modelColor, computeValues, DEFAULT_WEIGHTS, fmtUsd, fmtLatency, fmtPrimary, type BenchRole, type ValueWeights } from './benchmarks';

// The judges, named on the page. A benchmark that hides who graded it is asking to be trusted
// rather than checked, and the whole point of the cross-family rule is that it can be checked.
const JUDGE_LINE = Object.values(DATA.meta.judges ?? {}).map((m) => MODELS[m]?.label ?? m).join(', ') || 'not recorded';

// Runs per task differ by role: the objective roles repeat more than the judged ones, which also
// spend judge tokens. One number here would over-claim for whichever roles ran fewer.
const RUN_COUNTS = [...new Set(DATA.roles.flatMap((r) => r.leaderboard.map((row) => row.runs)))].sort((a, b) => a - b);
const RUNS_LABEL = RUN_COUNTS.length > 1 ? `${RUN_COUNTS[0]}–${RUN_COUNTS[RUN_COUNTS.length - 1]}` : String(RUN_COUNTS[0] ?? DATA.meta.runsPerTask);
import { downloadCard, copyCard, shareToX } from './benchshare';
import { Footer } from './shell';
import { DlNav } from './downloads';
import { BenchMarkIcon, BenchMethodology, BenchModelCards, BenchPacks } from './bench-cards';

// Ranked horizontal bars: length = field-normalized quality (0–100), whisker = 95% CI,
// right rail = the role's headline metric. The winner row is ember-ringed.
export function BenchLeaderboard({ role }: { role: BenchRole }) {
  return (
    <div className="benchlb">
      <div className="benchlbhead">
        <span>Model</span>
        <span>Quality score (0–100) · 95% CI</span>
        <span>{role.metricLabel}</span>
      </div>
      {role.leaderboard.map((r, i) => {
        const m = MODELS[r.model];
        const color = modelColor(r.model);
        const win = r.model === role.winner;
        const ciW = Math.max(0, r.ci[1] - r.ci[0]);
        return (
          <div className={`benchrow${win ? ' win' : ''}`} key={r.model}>
            <div className="benchname">
              <span className="benchrank">{i + 1}</span>
              <span className="benchmk"><BenchMarkIcon model={r.model} /></span>
              <span className="benchmodel">{m?.label ?? r.model}</span>
              {win && <span className="benchwin">winner</span>}
              {!!r.emptyAnswers && (
                <span className="benchflag" title={`${r.emptyAnswers} samples returned no text at all, after three retries each. They count as failures, so this score is held down by the shape of the answer and not only by the work.`}>
                  {r.emptyAnswers} no-answer
                </span>
              )}
            </div>
            <div className="benchtrack" title={`quality ${r.quality} · 95% CI ${r.ci[0]}–${r.ci[1]}`}>
              <div className="benchfill" style={{ width: `${r.quality}%`, background: color }} />
              <div className="benchci" style={{ left: `${r.ci[0]}%`, width: `${ciW}%` }}><i /><i /></div>
            </div>
            <div className="benchmetric">
              <b>{fmtPrimary(r, role)}</b>
              <span>{role.extraMetric ? `${Math.round((r.falseApprove ?? 0) * 100)}% false-approve` : `${fmtUsd(r.costUsd)} · ${fmtLatency(r.latencyMs)}`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Cost (log x) vs quality (y). Dot size = value under the current weights; the best-value
// model is ember-ringed and labeled. The sliders reweight quality/cost/speed live.
export function BenchScatter({ role }: { role: BenchRole }) {
  const [w, setW] = useState<ValueWeights>(DEFAULT_WEIGHTS);
  const [hover, setHover] = useState<string | null>(null);
  const rows = role.leaderboard;
  const values = computeValues(rows, w);
  const best = rows.reduce((a, b) => ((values[b.model] ?? 0) > (values[a.model] ?? 0) ? b : a));
  const W = 760, H = 452, pad = { l: 54, r: 44, t: 36, b: 52 };
  const costs = rows.map((r) => r.costUsd);
  const lmin = Math.log10(Math.min(...costs)), lmax = Math.log10(Math.max(...costs));
  const qs = rows.map((r) => r.quality);
  const qmin = Math.max(0, Math.min(...qs) - 6), qmax = Math.min(100, Math.max(...qs) + 4);
  const X = (c: number) => pad.l + ((Math.log10(c) - lmin) / (lmax - lmin || 1)) * (W - pad.l - pad.r);
  const Y = (q: number) => H - pad.b - ((q - qmin) / (qmax - qmin || 1)) * (H - pad.t - pad.b);
  const xticks = [0, 1, 2, 3].map((i) => Math.pow(10, lmin + (i / 3) * (lmax - lmin)));
  const yticks: number[] = [];
  for (let q = Math.ceil(qmin / 10) * 10; q <= qmax; q += 10) yticks.push(q);
  const total = w.quality + w.cost + w.speed || 1;
  return (
    <div className="benchscatterwrap">
      <div className="benchscatter">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cost versus quality for ${role.label}`}>
          <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="var(--line2)" />
          <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="var(--line2)" />
          {yticks.map((q) => (
            <g key={`y${q}`}>
              <line x1={pad.l} y1={Y(q)} x2={W - pad.r} y2={Y(q)} stroke="var(--line)" strokeDasharray="2 5" />
              <text x={pad.l - 10} y={Y(q) + 4} textAnchor="end" className="benchtick">{q}</text>
            </g>
          ))}
          {xticks.map((c, i) => (
            <text key={`x${i}`} x={X(c)} y={H - pad.b + 22} textAnchor="middle" className="benchtick">{fmtUsd(c)}</text>
          ))}
          <text x={(pad.l + W - pad.r) / 2} y={H - 8} textAnchor="middle" className="benchaxislabel">Cost per task (log scale)</text>
          <text x={16} y={(pad.t + H - pad.b) / 2} textAnchor="middle" className="benchaxislabel" transform={`rotate(-90 16 ${(pad.t + H - pad.b) / 2})`}>Quality score</text>
          {(() => {
            // Always-on labels: below the dot when it's near the top edge (avoids clipping), above
            // otherwise; x-clamped to the plot; top-cluster labels staggered onto two rows.
            const topThresh = pad.t + 30;
            const topDots = [...rows].filter((r) => Y(r.quality) < topThresh).sort((a, b) => X(a.costUsd) - X(b.costUsd));
            const stagger = new Map(topDots.map((r, i) => [r.model, i % 2]));
            return rows.map((r) => {
              const m = MODELS[r.model];
              const isBest = r.model === best.model;
              const rad = 7 + ((values[r.model] ?? 0) / 100) * 9;
              const cx = X(r.costUsd), cy = Y(r.quality);
              const near = cy < topThresh;
              const labelY = near ? cy + rad + 14 + (stagger.get(r.model) ? 15 : 0) : cy - rad - 9;
              const anchor = cx < pad.l + 52 ? 'start' : cx > W - pad.r - 52 ? 'end' : 'middle';
              const lx = Math.max(pad.l + 2, Math.min(W - pad.r - 2, cx));
              const hot = hover === r.model;
              return (
                <g key={r.model} onMouseEnter={() => setHover(r.model)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
                  {isBest && <circle cx={cx} cy={cy} r={rad + 6} fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={0.7} />}
                  <circle cx={cx} cy={cy} r={rad} fill={modelColor(r.model)} fillOpacity={hot || isBest ? 0.95 : 0.62} stroke={modelColor(r.model)} strokeWidth={1.5} />
                  <text x={lx} y={labelY} textAnchor={anchor} className={`benchdotlabel${isBest ? ' best' : ''}${hot ? ' hot' : ''}`}>{m?.label ?? r.model}</text>
                </g>
              );
            });
          })()}
        </svg>
      </div>
      <div className="benchsliders">
        <div className="benchslidhead">Weight the value score</div>
        {(['quality', 'cost', 'speed'] as const).map((k) => (
          <label className="benchslider" key={k}>
            <span className="benchslidname">{k}</span>
            <input type="range" min={0} max={100} value={w[k]} onChange={(e) => setW({ ...w, [k]: Number(e.currentTarget.value) })} />
            <span className="benchslidpct">{Math.round((w[k] / total) * 100)}%</span>
          </label>
        ))}
        <div className="benchslidfoot">Best value now: <b>{MODELS[best.model]?.label ?? best.model}</b></div>
      </div>
    </div>
  );
}

export function ModelBenchmarksPage({ onBack }: { onBack: () => void }) {
  const [roleId, setRoleId] = useState<string>(DATA.roles[0]?.id ?? 'developer');
  const [copied, setCopied] = useState(false);
  const role = DATA.roles.find((r) => r.id === roleId) ?? DATA.roles[0]!;
  const winnerModel = MODELS[role.winner];
  return (
    <>
      <DlNav onBack={onBack} />
      <section className="section benchhero">
        <div className="wrap">
          <div className="seyebrow">Model Benchmarks</div>
          <h1 className="stitle">The best brain for every <span className="oak">role</span></h1>
          <p className="ssub">We measure real models at the real jobs neuramesh agents do. They write code, review a diff against its Definition of Done, research, plan and route work. The tasks are private and come from our own repo. The results decide which model each role runs in the team-brain config packs.</p>
          {DATA.meta.status === 'preview' && (
            <div className="benchpreview"><span className="benchpreviewdot" /><span><b>Preview.</b> {DATA.meta.disclaimer}</span></div>
          )}
          <div className="benchstats">
            <div><b>{DATA.roles.length}</b><span>roles measured</span></div><i />
            <div><b>{DATA.models.length}</b><span>models in the field</span></div><i />
            <div><b>{RUNS_LABEL}×</b><span>runs per task</span></div><i />
            <div><b>private</b><span>held-out tasks</span></div><i />
            <div><b className="benchdate">{DATA.meta.generatedAt}</b><span>last measured</span></div>
          </div>
          <p className="benchsettings">Every model runs at its vendor default settings, with no per-model tuning. Judging is cross-family: {JUDGE_LINE}. Suite {DATA.meta.version} at commit {DATA.meta.suiteSha}.</p>
        </div>
      </section>

      <section className="benchsec alt">
        <div className="wrap">
          <div className="benchtabrow">
            <div className="benchtabs">
              {DATA.roles.map((r) => (
                <button key={r.id} className={`ospill${r.id === roleId ? ' on' : ''}`} onClick={() => setRoleId(r.id)}>{r.label}</button>
              ))}
            </div>
            <div className="benchshare">
              <button className="benchsharebtn" onClick={async () => { const ok = await copyCard(role); if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1600); } else { void downloadCard(role); } }}>{copied ? '✓ Copied' : 'Copy image'}</button>
              <button className="benchsharebtn" onClick={() => void downloadCard(role)}>Download</button>
              <button className="benchsharebtn xbtn" onClick={() => shareToX(role)}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg> Post on X</button>
            </div>
          </div>
          <div className="benchboardhead"><h2 className="stitle left">{role.label}</h2><p className="ssub left">{role.blurb}</p></div>
          <BenchLeaderboard role={role} />
          {role.winnerNote && (
            <div className="benchwinner">
              <span className="benchwinnermk benchmk"><BenchMarkIcon model={role.winner} /></span>
              <div><b>{winnerModel?.label ?? role.winner} is the best value for {role.label.toLowerCase()}.</b> <span>{role.winnerNote}</span> <span>Each pack then applies its own rule, so the seats below can differ.</span></div>
            </div>
          )}
        </div>
      </section>

      <section className="benchsec">
        <div className="wrap">
          <div className="benchboardhead"><h2 className="stitle left">Cost vs quality</h2><p className="ssub left">Quality is only half the decision. Weight it against cost and speed. The config packs are saved points on this curve.</p></div>
          <BenchScatter role={role} />
        </div>
      </section>

      <section className="benchsec alt">
        <div className="wrap">
          <div className="benchboardhead"><h2 className="stitle left">The field</h2><p className="ssub left">Every model we tested, with list pricing and its score in each role.</p></div>
          <BenchModelCards />
        </div>
      </section>

      <section className="benchsec">
        <div className="wrap">
          <div className="benchboardhead"><h2 className="stitle left">How we test</h2><p className="ssub left">Why these numbers are worth trusting, and where we stay honest about the limits.</p></div>
          <BenchMethodology />
        </div>
      </section>

      <section className="benchsec alt">
        <div className="wrap">
          <div className="benchboardhead"><h2 className="stitle left">From benchmark to brain</h2><p className="ssub left">The per-role winners become the defaults in neuramesh team-brain config packs. Pick a pack and every agent materializes onto the right model. You can also pin any model per agent, or build your own pack.</p></div>
          <BenchPacks />
          <div className="benchcta"><button className="btn primary big" onClick={onBack}>Get neuramesh →</button></div>
        </div>
      </section>
      <Footer />
    </>
  );
}
