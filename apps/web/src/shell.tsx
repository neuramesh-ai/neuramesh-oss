// The frame every screen sits in: nav, footer, the scroll-reveal hook.
import { useEffect, useRef, useState } from 'react';
import { track } from './analytics';
import { BrandLockup } from './brand';
import { useSession } from './auth';
import { AccountMenu } from './account';
import { FOOTER, HQ_URL, NAV } from './copy';

export type Screen = 'landing' | 'join' | 'signup' | 'downloads' | 'welcome' | 'terms' | 'privacy' | 'support' | 'billing-success' | 'billing-cancel' | 'billing-portal' | 'desktop-signin' | 'model-benchmarks' | 'pro';

// Scroll reveal: observe every [data-reveal]/[data-reveal-stagger] and add `.in` on entry.
// Only active when main.tsx opted into `.rvl` (motion welcome + IO present). A failsafe reveals
// everything if IntersectionObserver never fires (hidden preview pane, exotic env), so content
// can never get stuck hidden. Runs on Landing mount, re-scanning after each SPA return.
export function useScrollReveal() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains('rvl')) return; // reduced motion / no IO → already visible
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal], [data-reveal-stagger]'));
    if (!els.length) return;
    let ioAlive = false;
    const io = new IntersectionObserver((entries, obs) => {
      ioAlive = true;
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target); }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });
    els.forEach((el) => io.observe(el));
    const t = window.setTimeout(() => { if (!ioAlive) els.forEach((el) => el.classList.add('in')); }, 700);
    return () => { io.disconnect(); window.clearTimeout(t); };
  }, []);
}

export type Nav = (to: Screen) => void;

export function Nav({ nav }: { nav: Nav }) {
  const { signedIn } = useSession();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  // The collapsed nav is a real disclosure: Escape closes (focus returns to the button),
  // first link takes focus on open, and Tab cycles inside until it's closed.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenu(false); menuBtnRef.current?.focus(); return; }
      if (e.key !== 'Tab') return;
      const links = menuRef.current?.querySelectorAll<HTMLAnchorElement>('a');
      const first = links?.[0]; const last = links?.[links.length - 1];
      if (!first || !last) return;
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    };
    document.addEventListener('keydown', onKey);
    menuRef.current?.querySelector('a')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [menu]);
  return (
    <nav className="nav">
      <div className="wrap inner">
        <a className="brand" href="/"><BrandLockup /></a>
        <div className="navlinks">
          {NAV.links.map(([href, label]) => <a key={href} href={href}>{label}</a>)}
        </div>
        <div className="navright">
          {signedIn
            ? <><AccountMenu /><a className="btn primary sm" href={HQ_URL}>{NAV.open}</a></>
            : <><a className="btn sm navghost" href={HQ_URL}>{NAV.signin}</a><button className="btn primary sm" onClick={() => nav('downloads')}>{NAV.start}</button></>}
          <button ref={menuBtnRef} className="menubtn" aria-expanded={menu} aria-label={menu ? 'Close menu' : 'Open menu'} onClick={() => setMenu((m) => !m)}>{menu ? '✕' : '☰'}</button>
        </div>
      </div>
      {menu && (
        <div className="mnav" ref={menuRef}>
          {NAV.links.map(([href, label]) => <a key={href} href={href} onClick={() => setMenu(false)}>{label}</a>)}
          <a href="/downloads">Download</a>
        </div>
      )}
    </nav>
  );
}

// Footer is shared by every screen; benchmarks lives here (demoted from primary nav per the
// design contract). Plain <a href> links: full navigation is fine off the landing screen.
export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="fgrid">
          <div className="fbrand">
            <a className="brand" href="/"><BrandLockup /></a>
            <p>{FOOTER.line}</p>
          </div>
          <div>
            <div className="fh">Product</div>
            <a className="fl" href="/#experts">Experts</a>
            <a className="fl" href="/downloads">Download</a>
            <a className="fl" href="/#pricing">Pricing</a>
            <a className="fl" href="/model-benchmarks" onClick={() => track('benchmarks_footer_click')}>Model benchmarks</a>
          </div>
          <div>
            <div className="fh">Resources</div>
            <a className="fl" href="/support">Support</a>
            <a className="fl" href="https://github.com/alonge-dev/neuramesh-desktop-releases" target="_blank" rel="noreferrer">Releases</a>
          </div>
          <div>
            <div className="fh">Company</div>
            <a className="fl" href="https://x.com/_neuramesh" target="_blank" rel="noreferrer">X</a>
            <a className="fl" href={FOOTER.source.url} target="_blank" rel="noreferrer">GitHub</a>
            <a className="fl" href="/terms">Terms</a>
            <a className="fl" href="/privacy">Privacy</a>
          </div>
        </div>
        <div className="fbot"><span>{FOOTER.legal}</span><a className="right" href={FOOTER.source.url} target="_blank" rel="noreferrer">{FOOTER.source.line} ↗</a></div>
      </div>
    </footer>
  );
}
