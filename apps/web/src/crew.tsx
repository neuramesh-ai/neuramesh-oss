// The crew, the "in every room" strip, and the rules (docs/designs/foundry-landing-fast-to-done.md §05, §06).
import { CREW, IN_EVERY_ROOM, RULES, type Perm } from './copy';
import { Head } from './fast';
import { IconShield } from './icons';

// The roster is a grid of cards, one per mate, with the face the product draws for that agent
// (public/avatars, rendered by og/avatars.mjs from the app's own DiceBear call). The tile stays
// neutral and the role lives on a chip, as in the app. The eighth card is the hire.
export function Crew() {
  return (
    <section className="wrap l-sec" id="crew">
      <Head n={CREW.n} kicker={CREW.kicker} title={CREW.title} muted={CREW.titleMuted} lead={CREW.lead} />
      <div className="l-crew" data-reveal-stagger>
        {CREW.roster.map((m) => (
          <div className="l-mate" key={m.name}>
            <div className="l-matetop">
              <span className="l-face"><img src={`/avatars/${m.name}.svg`} alt="" width={56} height={56} loading="lazy" decoding="async" /></span>
              <span className={`l-dot${m.on ? ' on' : ''}`} />
            </div>
            <div className="l-mateid"><b>{m.name}</b><em>{m.role}</em></div>
            <p className="l-st">{m.status}</p>
          </div>
        ))}
        <div className="l-mate hire">
          <div className="l-matetop"><span className="l-face plus">+</span></div>
          <div className="l-mateid"><b>{CREW.hire.split('.')[0]}</b><em>A2A</em></div>
          <p className="l-st">{CREW.hire.split('. ')[1]}</p>
        </div>
      </div>
      <div className="l-strip" data-reveal-stagger>
        <p className="l-k">{IN_EVERY_ROOM.kicker}</p>
        {IN_EVERY_ROOM.items.map((it) => <div className="l-mini" key={it.title}><h3>{it.title}</h3><p className="l-p">{it.body}</p></div>)}
      </div>
    </section>
  );
}

const Pk = ({ v }: { v: [Perm, string] }) => <span className={`l-pk ${v[0]}`}>{v[1]}</span>;

export function Rules() {
  const m = RULES.matrix;
  return (
    <section className="wrap l-sec" id="rules">
      <Head n={RULES.n} kicker={RULES.kicker} title={RULES.title} muted={RULES.titleMuted} lead={RULES.lead} />
      <div className="l-rules">
        <div className="l-rl" data-reveal>
          {RULES.list.map((r, i) => <div key={r}><b>{String(i + 1).padStart(2, '0')}</b><span>{r}</span></div>)}
        </div>
        <div className="l-matrix" data-reveal>
          <div className="l-mhead"><IconShield />{m.title}<span className="l-enf">{m.tag}</span></div>
          <table>
            <thead><tr>{m.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {m.rows.map((r) => (
                <tr key={r.agent}><td>{r.agent}<small>{r.role}</small></td><td><Pk v={r.build} /></td><td><Pk v={r.marketing} /></td><td><Pk v={r.repo} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
