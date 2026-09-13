// Downloads: the release feed, arch detection, version history.
import { useEffect, useState } from 'react';
import { track } from './analytics';
import { BrandLockup, IconApple, IconDownload } from './brand';
import { APP_STORE_URL, DOWNLOAD_ROWS } from './copy';
import { Glyph } from './icons';
import { Footer } from './shell';

export const DL_STEPS = [
  { n: 1, t: 'Install and open', d: 'Drag it to Applications and open it. It is a normal desktop app.' },
  { n: 2, t: 'Pick a container runtime', d: 'The app sets up a small local stack on your Mac. Colima by default, no password.' },
  { n: 3, t: 'Meet your crew', d: 'The wizard connects a brain you already pay for and hires your first agents.' },
];

// ── Downloads, wired to the public releases repo. electron-builder publishes the
// signed .dmg + .zip + latest-mac.yml there (the main repo is private, so it can't
// serve public downloads). We list EVERY release (version history) with its per-arch
// builds; before the first release the API returns nothing → links fall back to the
// GitHub releases page, never a dead control. ──
export const RELEASES_REPO = 'alonge-dev/neuramesh-desktop-releases';

export const RELEASES_ALL_API = `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=30`;

export const RELEASES_PAGE = `https://github.com/${RELEASES_REPO}/releases`;

export const ARM_RE = /arm64|aarch64|silicon/i;

export type Arch = 'apple-silicon' | 'intel' | 'universal';

export type DlFile = { url: string; mb: number; arch: Arch };

export type Release = { tag: string; version: string; date: string; prerelease: boolean; url: string; files: DlFile[] };

export type ReleasesState = { state: 'loading' | 'ready' | 'none'; releases: Release[] };

export const ARCH_LABEL: Record<Arch, string> = { 'apple-silicon': 'Apple Silicon', intel: 'Intel', universal: 'Universal' };

export const ARCH_ORDER: Record<Arch, number> = { 'apple-silicon': 0, intel: 1, universal: 2 };

// electron-builder names the arm64 build "…-arm64.dmg" but the Intel build with NO
// arch suffix ("…-<version>.dmg") — so a .dmg with no arm64/universal token is x64.
export function classifyDmgs(assets: Array<{ name: string; browser_download_url: string; size: number }> | undefined): DlFile[] {
  return (assets ?? [])
    .filter((a) => /\.dmg$/i.test(a.name))
    .map((a) => {
      const n = a.name.toLowerCase();
      const arch: Arch = /universal/.test(n) ? 'universal' : ARM_RE.test(n) ? 'apple-silicon' : 'intel';
      return { url: a.browser_download_url, mb: Math.max(1, Math.round(a.size / 1048576)), arch };
    })
    .sort((a, b) => ARCH_ORDER[a.arch] - ARCH_ORDER[b.arch]);
}

export function useReleases(): ReleasesState {
  const [st, setSt] = useState<ReleasesState>({ state: 'loading', releases: [] });
  useEffect(() => {
    let live = true;
    fetch(RELEASES_ALL_API, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: Array<{ tag_name?: string; published_at?: string; created_at?: string; prerelease?: boolean; html_url?: string; assets?: Array<{ name: string; browser_download_url: string; size: number }> }>) => {
        if (!live) return;
        const releases: Release[] = (Array.isArray(data) ? data : [])
          .map((r) => ({
            tag: String(r.tag_name ?? ''),
            version: String(r.tag_name ?? '').replace(/^v/, ''),
            date: r.published_at ?? r.created_at ?? '',
            prerelease: !!r.prerelease,
            url: r.html_url ?? RELEASES_PAGE,
            files: classifyDmgs(r.assets),
          }))
          .filter((r) => r.files.length > 0)
          .sort((a, b) => Date.parse(b.date || '0') - Date.parse(a.date || '0'));
        setSt(releases.length ? { state: 'ready', releases } : { state: 'none', releases: [] });
      })
      .catch(() => { if (live) setSt({ state: 'none', releases: [] }); });
    return () => { live = false; };
  }, []);
  return st;
}

// Best-effort CPU detection: high-entropy UA gives the real architecture; absent it,
// default to Apple Silicon (every Mac sold since 2020) + surface Intel as an alt.
export function useIsAppleSilicon(): boolean {
  const [arm, setArm] = useState(true);
  useEffect(() => {
    const ua = (navigator as unknown as { userAgentData?: { getHighEntropyValues?: (h: string[]) => Promise<{ architecture?: string }> } }).userAgentData;
    ua?.getHighEntropyValues?.(['architecture']).then((v) => { if (v?.architecture) setArm(v.architecture === 'arm'); }).catch(() => {});
  }, []);
  return arm;
}

export const fmtReleaseDate = (iso: string): string => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export type OSId = 'macos' | 'windows' | 'linux';

export const OS_TABS: Array<{ id: OSId; label: string; ready: boolean }> = [
  { id: 'macos', label: 'macOS', ready: true },
  { id: 'windows', label: 'Windows', ready: false },
  { id: 'linux', label: 'Linux', ready: false },
];

// Shared chrome for the standalone download/welcome screens.
export function DlNav({ onBack }: { onBack: () => void }) {
  return (
    <nav className="nav">
      <div className="wrap inner">
        <button className="brand" onClick={onBack}><BrandLockup /></button>
      </div>
    </nav>
  );
}

// Arch-detected primary download + alternate-arch links. Shared by the standalone
// downloads page and the post-signup screen.
// `screen` rides every download_click so the funnel denominator stays honest — this
// component also renders on /welcome, which would otherwise emit clicks with no matching
// page_view and silently over-count the downloads ratio.
export function RecommendedDownload({ state, latest, isArm, screen }: { state: ReleasesState['state']; latest: Release | undefined; isArm: boolean; screen: 'downloads' | 'welcome' }) {
  const wantArch: Arch = isArm ? 'apple-silicon' : 'intel';
  const primary = latest?.files.find((f) => f.arch === wantArch) ?? latest?.files[0];
  const alts = latest && primary ? latest.files.filter((f) => f !== primary) : [];
  if (state === 'loading') {
    return <button className="btn primary dlbtn" disabled><IconApple /><span>Download for Mac<small>Checking latest release…</small></span></button>;
  }
  if (!primary || !latest) {
    return <a className="btn primary dlbtn" href={RELEASES_PAGE} target="_blank" rel="noreferrer"><IconApple /><span>Download for Mac<small>Releases on GitHub →</small></span></a>;
  }
  return (
    <>
      <a className="btn primary dlbtn" href={primary.url} onClick={() => track('download_click', { platform: primary.arch, screen })}><IconApple /><span>Download for Mac<small>{ARCH_LABEL[primary.arch]} · {primary.mb} MB · v{latest.version}</small></span></a>
      <div className="dlalts">
        {alts.length > 0 ? (
          alts.map((f, i) => <span key={f.url}>{i > 0 && ' · '}<a className="dlaltlink" href={f.url} onClick={() => track('download_click', { platform: f.arch, screen })}>{ARCH_LABEL[f.arch]}</a></span>)
        ) : (
          <>Intel <span className="soon">(soon)</span></>
        )}
        {' · '}Windows <span className="soon">(soon)</span> · Linux <span className="soon">(soon)</span>
      </div>
    </>
  );
}

// The version-history list + OS filter (shared block).
export function VersionHistory({ state, releases }: { state: ReleasesState['state']; releases: Release[] }) {
  const [showAll, setShowAll] = useState(false);
  const [os, setOS] = useState<OSId>('macos');
  const latest = releases[0] as Release | undefined;
  const visible = showAll ? releases : releases.slice(0, 6);
  return (
    <>
      <div className="dlvhead">
        <h2>All versions</h2>
        <div className="osfilter" role="tablist" aria-label="Platform">
          {OS_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={os === t.id}
              className={`ospill${os === t.id ? ' on' : t.ready ? '' : ' off'}`}
              onClick={() => setOS(t.id)}
            >
              {t.label}{!t.ready && <span className="soontag">soon</span>}
            </button>
          ))}
        </div>
      </div>
      {os !== 'macos' ? (
        <div className="dlempty">neuramesh for {OS_TABS.find((t) => t.id === os)?.label} comes later. macOS is available today.</div>
      ) : state === 'loading' ? (
        <div className="dlempty">Loading releases…</div>
      ) : releases.length === 0 ? (
        <div className="dlempty">No public releases yet. <a href={RELEASES_PAGE} target="_blank" rel="noreferrer">Check GitHub</a>.</div>
      ) : (
        <>
          <ul className="vlist">
            {visible.map((r) => (
              <li className="vrow" key={r.tag}>
                <div className="vmeta">
                  <span className="vver">neuramesh {r.version}</span>
                  {r === latest && <span className="vtag latest">Latest</span>}
                  {r.prerelease && <span className="vtag beta">Beta</span>}
                  {fmtReleaseDate(r.date) && <span className="vdate">{fmtReleaseDate(r.date)}</span>}
                </div>
                <div className="vdl">
                  {r.files.map((f) => (
                    <a className="vchip" key={f.url} href={f.url} onClick={() => track('download_click', { platform: f.arch, screen: 'downloads', source: 'history' })}><IconDownload /> {ARCH_LABEL[f.arch]} <span className="vsz">{f.mb} MB</span></a>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {releases.length > visible.length && (
            <button className="vshowall" onClick={() => setShowAll(true)}>Show all {releases.length} versions</button>
          )}
          <p className="vnote">Apple Silicon &amp; Intel both supported · macOS 12+ · auto-updates once installed.</p>
        </>
      )}
    </>
  );
}

// The iPhone companion is Pro-only (D5), so its door is here, not beside the free hero button. A
// code you can scan, and the link for a hand already holding the phone. Store links carry no
// country segment, so Apple sends each visitor to their own storefront.
export function PhoneDownload() {
  const row = APP_STORE_URL ? DOWNLOAD_ROWS.iphone : DOWNLOAD_ROWS.iphonePending;
  return (
    <div className="dlphone">
      <div className={`l-dlrow${APP_STORE_URL ? '' : ' off'}`}>
        <span className="l-dlic"><Glyph name="phone" size={16} /></span>
        <span><b>{row.title}</b><small>{row.sub}</small></span>
        <em>{row.tag}</em>
      </div>
      {APP_STORE_URL && (
        <div className="l-dlqr">
          <img src="/qr-appstore.svg" width={132} height={132} alt={`QR code that opens ${APP_STORE_URL}`} />
          <div className="l-dlqrsd">
            <span>{DOWNLOAD_ROWS.qr.scan}</span>
            <a className="go" href={APP_STORE_URL} target="_blank" rel="noreferrer">{DOWNLOAD_ROWS.qr.open} →</a>
          </div>
        </div>
      )}
    </div>
  );
}

// /downloads — the standalone downloads page: recommended build up top, then the
// full version history by platform & chip. No signup/onboarding chrome.
export function DownloadsPage({ onBack }: { onBack: () => void }) {
  const { state, releases } = useReleases();
  const isArm = useIsAppleSilicon();
  const latest = releases[0] as Release | undefined;
  return (
    <>
      <DlNav onBack={onBack} />
      <section className="section dlpage">
        <div className="wrap dlpagewrap">
          <header className="dlphead">
            <span className="dleyebrow">neuramesh desktop</span>
            <h1>Download neuramesh for <span className="oak">Mac</span></h1>
            <p className="lead">Your agents run on your own machine, with your own keys. Signed &amp; notarized by Apple · macOS 12 or later · Apple Silicon &amp; Intel.</p>
            <div className="dlpick"><RecommendedDownload state={state} latest={latest} isArm={isArm} screen="downloads" /></div>
          </header>
          <PhoneDownload />
          <VersionHistory state={state} releases={releases} />
        </div>
      </section>
      <Footer />
    </>
  );
}
