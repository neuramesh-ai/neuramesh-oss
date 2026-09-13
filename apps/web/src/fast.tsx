// The proof strip, "why fast works", and the vetted experts (docs/designs/foundry-landing-fast-to-done.md §01, §02).
import type { CSSProperties } from 'react';
import { ClaudeMark, GeminiMark, OpenAIMark, Porch } from './brand';
import { EXPERTS, FAST, PROOF, type Cell } from './copy';
import { Glyph, IconArrow } from './icons';
import type { Nav } from './shell';

export const rd = (ms: number) => ({ '--rd': `${ms}ms` } as CSSProperties);

// section head: numbered mono kicker, the two-tone title, and the lead on the right
export function Head({ n, kicker, title, muted, lead }: { n: string; kicker: string; title: string; muted: string; lead: string }) {
  return (
    <div className="l-head" data-reveal>
      <div>
        <p className="l-k"><b>{n}</b> {kicker}</p>
        <h2 className="l-h2">{title} <span>{muted}</span></h2>
      </div>
      <p className="l-p">{lead}</p>
    </div>
  );
}

export function Cells({ cells, hash }: { cells: Cell[]; hash?: boolean }) {
  return (
    <div className={`l-grid4 c${cells.length}`} data-reveal-stagger>
      {cells.map((c) => (
        <div className="l-cell" key={c.n}>
          <span className="l-n">{c.n}</span>
          <h3>{hash && <span className="l-hash">#</span>}{c.title}</h3>
          <p className="l-p">{c.body}</p>
          <div className="l-tag"><i />{c.tag}</div>
        </div>
      ))}
    </div>
  );
}

const BYOS_MARKS = [<ClaudeMark key="c" />, <OpenAIMark key="o" />, <GeminiMark key="g" />];

export function ProofStrip() {
  return (
    <div className="wrap">
      <div className="l-proof" data-reveal>
        <p className="l-k">{PROOF.kicker}</p>
        <div className="l-marks">
          <span className="l-mark"><Porch size={20} />{PROOF.house}<em>{PROOF.houseTag}</em></span>
          {PROOF.byos.map((name, i) => <span className="l-mark" key={name}>{BYOS_MARKS[i]}{name}</span>)}
        </div>
        <p className="l-p l-proofline">{PROOF.line}</p>
      </div>
    </div>
  );
}

export function WhyFast() {
  return (
    <section className="wrap l-sec" id="fast">
      <Head n={FAST.n} kicker={FAST.kicker} title={FAST.title} muted={FAST.titleMuted} lead={FAST.lead} />
      <Cells cells={FAST.cells} />
    </section>
  );
}

export function Experts({ nav }: { nav: Nav }) {
  return (
    <section className="wrap l-sec l-tight" id="experts">
      <Head n={EXPERTS.n} kicker={EXPERTS.kicker} title={EXPERTS.title} muted={EXPERTS.titleMuted} lead={EXPERTS.lead} />
      <div className="l-experts" data-reveal-stagger>
        {EXPERTS.cards.map((x) => (
          <div className="l-xp" key={x.title}>
            <div className="l-xptop"><span className="l-ic"><Glyph name={x.icon} /></span><h3>{x.title}</h3></div>
            <p className="l-p">{x.body}</p>
            <div className="l-xpbot"><button className="l-hire" onClick={() => nav('signup')}>{EXPERTS.hire} <IconArrow size={12} /></button></div>
          </div>
        ))}
      </div>
      <p className="l-note" data-reveal>{EXPERTS.note}</p>
    </section>
  );
}
