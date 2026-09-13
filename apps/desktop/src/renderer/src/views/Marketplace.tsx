// The agent marketplace — the catalogue a workspace hires from.
// Extracted from App.tsx (track A2).
import { planLabel } from '@neuramesh/shared';
import { IconLock, IconSearch } from '../ui/icons';
import { Wordmark } from '../brand';
import { flashToast } from '../lib/toast';
import { useState } from 'react';

// A2A agent marketplace listings (handoff Marketplace.dc.html allAgents()). Sample data —
// wire to a real registry API later; the card shape (verified · rating · installs · tasks ·
// category · skills) is the contract.
export interface MktAgent { name: string; emoji: string; cat: string; catKey: string; by: string; verified: boolean; color: string; soft: string; rating: string; installs: string; tasks: string; skills: string[]; desc: string; featured: boolean }

export const MARKETPLACE_AGENTS: MktAgent[] = [
  { name: 'Pixel', emoji: '🎨', cat: 'Design', catKey: 'design', by: 'by neuramesh', verified: true, color: 'var(--violet)', soft: 'var(--violet-soft)', rating: '4.9', installs: '18.2k', tasks: '2.1M', skills: ['design-systems', 'react', 'css'], desc: 'Implements UI from a design system with pixel-faithful components, tokens, and a11y baked in.', featured: true },
  { name: 'Axe', emoji: '♿', cat: 'Frontend', catKey: 'frontend', by: 'by Deque', verified: true, color: 'var(--green)', soft: 'var(--green-soft)', rating: '4.8', installs: '24.6k', tasks: '5.4M', skills: ['wcag', 'audit', 'fix'], desc: 'Scans every route for accessibility violations and ships the fixes with before/after evidence.', featured: true },
  { name: 'Sentinel', emoji: '🛡️', cat: 'Security', catKey: 'security', by: 'by Snyk', verified: true, color: 'var(--accent)', soft: 'var(--accent-soft)', rating: '4.9', installs: '31.0k', tasks: '8.8M', skills: ['cve-scan', 'secrets', 'sbom'], desc: 'Continuously audits dependencies and secrets, opens patch PRs, and gates risky merges.', featured: true },
  { name: 'Proof', emoji: '🧪', cat: 'Testing', catKey: 'testing', by: 'by neuramesh', verified: true, color: 'var(--blue)', soft: 'var(--blue-soft)', rating: '4.7', installs: '14.9k', tasks: '3.2M', skills: ['unit', 'e2e', 'coverage'], desc: 'Generates meaningful tests, raises coverage to target, and keeps the suite green.', featured: false },
  { name: 'Schema', emoji: '🗄️', cat: 'Data', catKey: 'data', by: 'by community', verified: false, color: 'var(--warm)', soft: 'var(--warm-soft)', rating: '4.6', installs: '9.3k', tasks: '1.1M', skills: ['sql', 'migrations', 'indexes'], desc: 'Designs schemas, writes safe migrations, and reviews query plans for hot paths.', featured: false },
  { name: 'Migrate', emoji: '🔀', cat: 'Frontend', catKey: 'frontend', by: 'by Vercel', verified: true, color: 'var(--violet)', soft: 'var(--violet-soft)', rating: '4.8', installs: '12.4k', tasks: '990k', skills: ['codemods', 'upgrades', 'next'], desc: 'Runs framework and library migrations with codemods, then verifies the build end to end.', featured: false },
  { name: 'Perf', emoji: '⚡', cat: 'Frontend', catKey: 'frontend', by: 'by community', verified: false, color: 'var(--warm)', soft: 'var(--warm-soft)', rating: '4.6', installs: '11.7k', tasks: '1.4M', skills: ['profiling', 'bundles', 'lcp'], desc: 'Profiles real user metrics, trims bundles, and fixes the regressions it finds.', featured: false },
  { name: 'Helm', emoji: '⛵', cat: 'DevOps', catKey: 'devops', by: 'by HashiCorp', verified: true, color: 'var(--blue)', soft: 'var(--blue-soft)', rating: '4.7', installs: '8.1k', tasks: '720k', skills: ['terraform', 'k8s', 'ci'], desc: 'Writes and reviews infrastructure as code, plans changes, and guards production drift.', featured: false },
  { name: 'Scribe', emoji: '📝', cat: 'Docs', catKey: 'docs', by: 'by neuramesh', verified: true, color: 'var(--green)', soft: 'var(--green-soft)', rating: '4.8', installs: '13.5k', tasks: '2.6M', skills: ['api-docs', 'guides', 'changelogs'], desc: 'Keeps docs in lockstep with the code — API references, guides, and release notes.', featured: false },
  { name: 'Triage', emoji: '🐛', cat: 'Backend', catKey: 'backend', by: 'by community', verified: false, color: 'var(--accent)', soft: 'var(--accent-soft)', rating: '4.5', installs: '7.6k', tasks: '880k', skills: ['repro', 'bisect', 'labels'], desc: 'Reproduces incoming bugs, bisects the cause, and files a clean, actionable ticket.', featured: false },
  { name: 'Polyglot', emoji: '🌍', cat: 'Frontend', catKey: 'frontend', by: 'by community', verified: false, color: 'var(--blue)', soft: 'var(--blue-soft)', rating: '4.6', installs: '6.9k', tasks: '610k', skills: ['i18n', 'extract', 'review'], desc: 'Extracts strings, manages locale catalogs, and reviews translations in context.', featured: false },
  { name: 'Sentry', emoji: '📡', cat: 'Backend', catKey: 'backend', by: 'by Sentry', verified: true, color: 'var(--violet)', soft: 'var(--violet-soft)', rating: '4.8', installs: '15.2k', tasks: '4.0M', skills: ['tracing', 'alerts', 'rca'], desc: 'Wires observability, triages incidents from traces, and proposes root-cause fixes.', featured: false },
];

export const MKT_CATS: Array<[string, string]> = [['all', 'All agents'], ['frontend', 'Frontend'], ['backend', 'Backend'], ['security', 'Security'], ['testing', 'Testing'], ['devops', 'DevOps'], ['data', 'Data'], ['design', 'Design'], ['docs', 'Docs']];

export function MktCard({ a, isCloud, onAdd }: { a: MktAgent; isCloud: boolean; onAdd: (a: MktAgent) => void }) {
  return (
    <div className="mktcard">
      <div className="mktcardhead">
        <span className="mktav" style={{ background: a.soft }}>{a.emoji}</span>
        <div className="mktcardname">
          <div className="mktnamerow"><b>{a.name}</b>{a.verified && <span className="mktverif" title="verified publisher">✓</span>}</div>
          <div className="mktby">{a.by}</div>
        </div>
        <span className="mktcat" style={{ color: a.color, background: a.soft }}>{a.cat}</span>
      </div>
      <p className="mktdesc">{a.desc}</p>
      <div className="mktskills">{a.skills.map((s) => <span key={s} className="mktskill">{s}</span>)}</div>
      <div className="mktfoot">
        <span className="mktstat" title="rating">★ <b>{a.rating}</b></span>
        <span className="mktstat" title="installs">↓ {a.installs}</span>
        <span className="mkta2a">A2A 1.0</span>
        <button className={`btn mktadd${isCloud ? ' primary' : ''}`} title={isCloud ? `add ${a.name} to your workspace` : `A2A agents unlock with ${planLabel('cloud')}`} onClick={() => onAdd(a)}>
          {isCloud ? 'Add' : <><IconLock s={11} /> Cloud</>}
        </button>
      </div>
    </div>
  );
}

// A2A marketplace — full-screen in-app surface (handoff 01–03-marketplace.png). Browse freely;
// "Add to workspace" gates on isCloud (F6) → the shared upgrade modal.
export function Marketplace({ isCloud, onUpgrade, onClose }: { isCloud: boolean; onUpgrade: () => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const query = q.trim().toLowerCase();
  const filtered = MARKETPLACE_AGENTS.filter(
    (a) => (cat === 'all' || a.catKey === cat) && (!query || a.name.toLowerCase().includes(query) || a.by.toLowerCase().includes(query) || a.skills.some((s) => s.includes(query))),
  );
  const featured = MARKETPLACE_AGENTS.filter((a) => a.featured);
  const showFeatured = cat === 'all' && !query;
  const add = (a: MktAgent) => { if (isCloud) { flashToast(`Added ${a.name} to your workspace`); } else onUpgrade(); };
  return (
    <div className="mktwrap">
      <div className="mktbar">
        <Wordmark size={17} />
        <span className="teambadge">Marketplace</span>
        <div className="mktsearch">
          <IconSearch s={15} />
          <input placeholder="Search agents, skills, publishers…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <button className="navpin" title="close marketplace" onClick={onClose}>✕</button>
        <button className="btn dark" onClick={() => flashToast('Publishing opens with a verified publisher account')}>Publish agent</button>
      </div>
      <div className="mktbody">
        <div className="mkteyebrow">A2A Agent Marketplace</div>
        <h1 className="mkttitle">Hire an expert agent for any task.</h1>
        <p className="mktsub">Carefully built, battle-tested specialists — accessibility, security, migrations, performance. Add one to your mesh and it works alongside your team over the open A2A protocol.</p>
        {!isCloud && (
          <div className="mktgate">
            <span className="mktgateico"><IconLock s={19} /></span>
            <div className="mktgatebody">
              <b>External agents are a {planLabel('cloud')} feature</b>
              <span>You are on {planLabel('free')}. Browse freely. Marketplace agents over A2A unlock with {planLabel('cloud')}.</span>
            </div>
            <button className="btn primary" onClick={onUpgrade}>Get {planLabel('cloud')}</button>
          </div>
        )}
        <div className="mktchips">
          {MKT_CATS.map(([k, label]) => (
            <button key={k} className={`mktchip${cat === k ? ' on' : ''}`} onClick={() => setCat(k)}>{label}</button>
          ))}
        </div>
        {showFeatured && (
          <>
            <div className="mktsecthead">Featured this week <span>hand-picked by the neuramesh team</span></div>
            <div className="mktgrid">{featured.map((a) => <MktCard key={a.name} a={a} isCloud={isCloud} onAdd={add} />)}</div>
          </>
        )}
        <div className="mktsecthead">{showFeatured ? 'All agents' : `${filtered.length} agent${filtered.length === 1 ? '' : 's'}`}</div>
        {filtered.length === 0 ? (
          <div className="empty">No agents match “{q}”{cat !== 'all' ? ` in ${MKT_CATS.find((c) => c[0] === cat)?.[1]}` : ''}.</div>
        ) : (
          <div className="mktgrid">{filtered.map((a) => <MktCard key={a.name} a={a} isCloud={isCloud} onAdd={add} />)}</div>
        )}
        <div className="mktpublish">
          <div className="mktgatebody">
            <b>Built something great?</b>
            <span>Publish your agent to the A2A marketplace and let every neuramesh team hire it.</span>
          </div>
          <button className="btn dark" onClick={() => flashToast('Publishing opens with a verified publisher account')}>Publish agent →</button>
        </div>
      </div>
    </div>
  );
}
