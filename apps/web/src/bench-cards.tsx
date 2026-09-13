// Benchmark cards, methodology and packs — the read-only half of the bench page.
import { DATA, MODELS, modelColor, fmtUsd, fmtPrimary } from './benchmarks';
import { ClaudeMark, GeminiMark, OpenAIMark } from './brand';

// ── /model-benchmarks — public leaderboard measuring each model at each neuramesh role.
// Data is benchmarks.v1.json (the packages/bench harness output); every chart is pure
// SVG/CSS in the Ember Weave palette, so both themes and the mobile breakpoint just work. ──
export const MARK_FOR = { claude: ClaudeMark, openai: OpenAIMark, gemini: GeminiMark } as const;

export function BenchMarkIcon({ model }: { model: string }) {
  const m = MODELS[model];
  const Mark = MARK_FOR[m ? DATA.providers[m.provider].mark : 'claude'];
  return <Mark />;
}

export function BenchModelCards() {
  return (
    <div className="benchcards">
      {DATA.models.map((m) => (
        <div className="benchcard" key={m.id}>
          <div className="benchcardhead">
            <span className="benchcardmk"><BenchMarkIcon model={m.id} /></span>
            <div><b>{m.label}</b><span className="benchcardby">{DATA.providers[m.provider].label}</span></div>
          </div>
          <div className="benchprice">{fmtUsd(m.pricing.inPer1M)} / {fmtUsd(m.pricing.outPer1M)} <span>per 1M tokens in/out</span></div>
          <div className="benchchips">
            {DATA.roles.map((role) => {
              const row = role.leaderboard.find((r) => r.model === m.id);
              if (!row) return null;
              return <span className="benchchip" key={role.id} style={{ borderLeftColor: modelColor(m.id) }}>{role.label} <b>{fmtPrimary(row, role)}</b></span>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function BenchMethodology() {
  const M = DATA.methodology;
  // The headings say what the body says. Three of these used to describe a different suite:
  // judging had already shipped while the card still called it "coming next", and the run count
  // was never ten. A heading that contradicts its own paragraph costs more trust than it buys.
  const items: [string, string | undefined][] = [
    ['Private, held-out tasks', M.contamination],
    ['Objective where it can be', M.objective],
    ['Repeated runs, real intervals', M.variance],
    ['Cost and speed are first-class', M.value],
    ['Honest judging', M.judge],
    ['A refusal is not a score', M.refusals],
  ];
  return (
    <div className="benchmethod">
      {items.map(([h, body]) => (
        <div className="benchmethoditem" key={h}><h3>{h}</h3><p>{body}</p></div>
      ))}
    </div>
  );
}

export function BenchPacks() {
  return (
    <div className="benchpackgrid">
      {DATA.packs.map((p) => (
        <div className="benchpack" key={p.id}>
          <div className="benchpackhead"><b>{p.label}</b><span>{p.tagline}</span></div>
          <div className="benchpackroles">
            {DATA.roles.map((role) => {
              const id = p.roles[role.id];
              const m = id ? MODELS[id] : undefined;
              return (
                <div className="benchpackrole" key={role.id}>
                  <span className="benchpackrolelabel">{role.label}</span>
                  <span className="benchpackmodel">{m && <span className="benchmk sm"><BenchMarkIcon model={m.id} /></span>}{m?.label ?? id ?? '—'}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
