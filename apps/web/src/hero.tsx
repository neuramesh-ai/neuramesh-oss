// The hero: the claim, the two doors, and the product as it is (a real capture, never a hand-built
// frame). docs/designs/foundry-landing-fast-to-done.md, hero + D5.
import { useSession } from './auth';
import { PorchLive } from './brand';
import { HERO, HQ_URL } from './copy';
import { rd } from './fast';
import { IconArrow, IconLock } from './icons';
import { demoFor, useTheme } from './theme';
import type { Nav } from './shell';

export function Hero({ nav }: { nav: Nav }) {
  const { signedIn } = useSession();
  return (
    <header className="wrap l-hero" id="top">
      <span className="l-mark" data-reveal><PorchLive size={70} /></span>
      <h1 className="l-h1" data-reveal style={rd(70)}>{HERO.headline[0]}<br />{' '}{HERO.headline[1]}</h1>
      <p className="l-kicker" data-reveal style={rd(120)}>{HERO.kicker}</p>
      <p className="l-lead" data-reveal style={rd(160)}>{HERO.lead}</p>
      <div className="l-cta" data-reveal style={rd(200)}>
        {signedIn
          ? <a className="btn primary big" href={HQ_URL}>{HERO.ctaSignedIn} <IconArrow /></a>
          : <button className="btn primary big" onClick={() => nav('downloads')}>{HERO.cta} <IconArrow /></button>}
        {/* the second door is Pro, not a second download: the phone is Pro-only, so its QR lives on /downloads */}
        {!signedIn && <button className="btn big" onClick={() => nav('pro')}>{HERO.ctaPro}</button>}
      </div>
      <div className="l-facts" data-reveal style={rd(260)}>
        {HERO.facts.map((f, i) => <span key={f}>{i > 0 && <i aria-hidden />}{f}</span>)}
      </div>
    </header>
  );
}

// The product under the hero: a REAL first run of the desktop app, recorded over its own debug
// port (docs/design/oss-release-2026-09), from the stack's boot card through the wizard to the
// shell, Settings › Connections and the Upgrade sheet. A video, muted and looping, with a poster
// for the first paint. The frame pushes in after the copy lands.
export function Stage() {
  const demo = demoFor('first-run', useTheme());
  return (
    <div className="l-stagewrap">
      <div className="l-push" data-reveal style={rd(320)}>
        <div className="l-stage" data-reveal>
          <div className="l-cap"><span>{HERO.frame.room}</span><i /><span>{HERO.frame.task}</span><i /><span className="l-live"><em />live</span></div>
          <div className="l-win">
            <div className="l-chrome">
              <div className="l-dots"><i /><i /><i /></div>
              <div className="l-url"><IconLock />{HERO.frame.url}</div>
            </div>
            <video key={demo.src} src={demo.src} poster={demo.poster} width={1280} height={768} autoPlay muted loop playsInline preload="metadata" aria-label={HERO.frame.alt} />
          </div>
        </div>
      </div>
    </div>
  );
}
