// Surfaces, pricing, and the close (docs/designs/foundry-landing-fast-to-done.md §07, §08, close).
import { useEffect, useRef } from 'react';
import { trackOnce } from './analytics';
import { useSession } from './auth';
import { CLOSE, HQ_URL, PRICING, SURFACES } from './copy';
import { Head } from './fast';
import { Glyph, IconArrow, IconLock } from './icons';
import { shotFor, useTheme } from './theme';
import type { Nav, Screen } from './shell';

// Free is the download, Pro is the /pro handoff (docs/design/oss-release-2026-09 D3). Keyed by
// the plan's name so the card and its door change together in copy.ts.
const PLAN_DOOR: Record<string, Screen> = { Free: 'downloads', Pro: 'pro' };

export function Surfaces() {
  const a = SURFACES.anchor;
  const theme = useTheme();
  return (
    <section className="wrap l-sec l-tight" id="surfaces">
      <Head n={SURFACES.n} kicker={SURFACES.kicker} title={SURFACES.title} muted={SURFACES.titleMuted} lead={SURFACES.lead} />
      <div className="l-anchor" data-reveal>
        <div>
          <p className="l-k">{a.kicker}</p>
          <h3>{a.title}</h3>
          <p className="l-p">{a.body}</p>
        </div>
        <div className="l-shot">
          <div className="l-chrome"><div className="l-dots"><i /><i /><i /></div><div className="l-url"><IconLock />{a.url}</div></div>
          <img src={shotFor('home-web', theme)} alt={a.alt} width={960} height={579} loading="lazy" decoding="async" />
        </div>
      </div>
      <div className="l-surf" data-reveal-stagger>
        {SURFACES.cards.map((c) => (
          <div className="l-scard" key={c.title}><span className="l-ic"><Glyph name={c.icon} size={20} /></span><h3>{c.title}</h3><p className="l-p">{c.body}</p></div>
        ))}
      </div>
    </section>
  );
}

export function Pricing({ nav }: { nav: Nav }) {
  const headRef = useRef<HTMLDivElement>(null);
  // pricing_view fires once per VISIT, observed on the compact head (a tall section can exceed
  // 2x a small viewport, where no whole-section ratio is reachable). No IO → skip.
  useEffect(() => {
    const el = headRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) { trackOnce('pricing_view'); io.disconnect(); }
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <section className="wrap l-sec l-tight" id="pricing">
      <div className="l-pricehead" ref={headRef} data-reveal>
        <p className="l-k"><b>{PRICING.n}</b> {PRICING.kicker}</p>
        <h2 className="l-h2">{PRICING.title} <span>{PRICING.titleMuted}</span></h2>
        <p className="l-p">{PRICING.lead}</p>
      </div>
      <div className="l-plans" data-reveal-stagger>
        {PRICING.plans.map((p) => (
          <div className={`l-plan${p.featured ? ' feat' : ''}`} key={p.name}>
            <div className="l-pn">{p.name} <span className={`l-chip${p.accent ? ' acc' : ''}`}>{p.chip}</span></div>
            <div className="l-price">{p.price} {p.per && <small>{p.per}</small>}</div>
            <p className="l-p">{p.tag}</p>
            <ul className="l-pl">{p.feats.map((f) => <li key={f}>{f}</li>)}</ul>
            <button className={`btn${p.featured ? ' primary' : ''}`} onClick={() => nav(PLAN_DOOR[p.name] ?? 'downloads')}>{p.cta}</button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Close({ nav }: { nav: Nav }) {
  const { signedIn } = useSession();
  return (
    <section className="wrap l-sec l-tight" id="start">
      <div className="l-close" data-reveal>
        <p className="l-k">{CLOSE.kicker}</p>
        <h2 className="l-h2">{CLOSE.title}</h2>
        <p className="l-p">{CLOSE.line}</p>
        {signedIn
          ? <a className="btn big" href={HQ_URL}>Open your workspace <IconArrow /></a>
          : <button className="btn big" onClick={() => nav('downloads')}>{CLOSE.cta} <IconArrow /></button>}
      </div>
    </section>
  );
}
