// The marketing setup card (docs/39) — the guided first run of a marketing room, and the
// connectors it offers to plug in. Extracted from App.tsx (track A2).
import { AgentAvatar } from '../components/AgentAvatar';
import { MARKETING_SETUP_FLOW, setupProgress } from '@neuramesh/shared';
import { nm as nmBridge } from '../bridge/nm';
import { openUpgrade } from '../lib/toast';
import { IconBranch } from '../ui/icons';

import { type ConnectorRow } from '../bridge/rows-content';
import { type RepoUI } from '../bridge/rows-board';
import { useCallback, useEffect, useMemo, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// The marketing HQ's front door (marketing-channel plan §4.3, mockup scene 02): a marketing
// room with no profile is GREETED — a normal left-formatted agent message from whoever runs
// setup (the room's marketer, else the orchestrator): a beat of live status, then a question
// card. Answers are UI: type the product URL or take the project-site suggestion pill, name
// the goal, pick focus pills, go. Free on every plan — the paywall sits on
// schedule.*/content.*, never here. Submitting runs marketing.setup (profile onto
// channels.marketing) and posts the answers as the first message of the bootstrap
// CONVERSATION thread (round 4 — analysis is a chat thread, never a board task); the
// daemon's recognizer skips the LLM wake for it and kicks the one-shot bootstrap schedule.
export const MARKETING_FOCUS: Array<[string, string]> = [['social', 'Social'], ['content', 'Content'], ['seo', 'SEO'], ['email', 'Email'], ['ads', 'Paid ads']];

// The publish targets offered during marketing setup — one row per platform the publish pass can
// actually post to (connectors.ts POSTERS), same icons and order as the room's Connections list.
// Setup used to offer X alone, so the one screen where someone decides where their content goes
// showed a quarter of the answer while the room's own list showed all four.
//
// The note is the caveat that changes whether you'd bother connecting it AT ALL, not a feature
// list: Instagram refuses text-only posts and needs a linked business account, and TikTok can only
// drop a private draft into your inbox for you to finish in their app.
export const SETUP_CONNECTORS: Array<[provider: 'x' | 'linkedin' | 'instagram' | 'tiktok', icon: string, label: string, note: string]> = [
  ['x', '𝕏', 'X (Twitter)', ''],
  ['linkedin', 'in', 'LinkedIn', ''],
  ['instagram', '◫', 'Instagram', '· business account, image required'],
  ['tiktok', '♪', 'TikTok', '· drafts to your inbox'],
];

// Step 5, release drafts (docs/design/release-drafts-2026-09 §4.7): the answer the step persists
// (setup.step) and marketing.setup plants from — the repository, a free one-shot (`now`) and the
// daily watch (`watch`, a Team routine). A type alias, not an interface, so it passes as the
// bridge's Record<string, unknown> step value.
type ReleaseAnswer = { repoId: string; slug: string; now: boolean; watch: boolean };
const STEP_IDS = ['product', 'goal', 'focus', 'connect', 'releases'] as const;
type StepId = (typeof STEP_IDS)[number];

export function MarketingSetupCard({ channel, agent, projectWebsite, onDone, onSkip }: {
  /** the id + profile are all the wizard reads — loosened from ChannelRow so the SETUP TASK
   * thread (which holds only those two) can mount the same card the room does */
  channel: { id: string; marketing?: string | null };
  agent: { name: string; role: string; emoji?: string | null };
  projectWebsite?: string | null;
  onDone: (anchor?: { threadId?: string; taskId?: string }) => void;
  /** absent = no "Skip for now" (the task thread: closing the task IS the opt-out) */
  onSkip?: () => void;
}) {
  // the agent "arrives": live status first, then the card fades in (.ghostmsg, ≤150ms rule)
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => setArrived(true), reduce ? 0 : 850);
    return () => clearTimeout(t);
  }, []);
  // RESUMABLE (setupflows.ts, 2026-08-09): the card seeds from the synced profile and lands on
  // the first incomplete step, because every answered step now WRITES as it lands (setup.step).
  // The old card held all four answers in React state and committed once at the end — which is
  // exactly why abandoning it lost everything and the room held nothing to come back to.
  const seeded = useMemo(() => {
    try { return JSON.parse(channel.marketing ?? '{}') as { website?: string; goal?: string; focus?: string[]; releases?: Partial<ReleaseAnswer> }; } catch { return {}; }
  }, [channel.marketing]);
  // the flow is DATA (setupflows.ts): the count and the last step follow it, never a literal here
  const LAST = Math.min(MARKETING_SETUP_FLOW.steps.length, STEP_IDS.length) - 1;
  const [step, setStep] = useState(() => {
    const next = setupProgress(MARKETING_SETUP_FLOW, channel.marketing ?? null).next;
    return Math.min(LAST, Math.max(0, STEP_IDS.indexOf((next ?? 'product') as StepId)));
  });
  const [website, setWebsite] = useState(seeded.website ?? '');
  const [goal, setGoal] = useState(seeded.goal ?? '');
  const [focus, setFocus] = useState<Set<string>>(new Set(seeded.focus?.length ? seeded.focus : ['social', 'content']));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // step 5: the repository comes from the room's project (nm:channel-meta), the switches default
  // on, and both stay disabled until a repository exists — the server refuses them without one
  const [repoId, setRepoId] = useState<string | null>(seeded.releases?.repoId ?? null);
  const [relNow, setRelNow] = useState(seeded.releases?.now ?? true);
  const [relWatch, setRelWatch] = useState(seeded.releases?.watch ?? true);
  const [meta, setMeta] = useState<{ repos: RepoUI[]; projectId: string | null } | null>(null);
  const [attachUrl, setAttachUrl] = useState('');
  const [attachOpen, setAttachOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const onReleases = STEP_IDS[step] === 'releases';
  const loadMeta = useCallback(async () => {
    const m = await nm?.channelMeta(channel.id).catch(() => null);
    if (m) setMeta({ repos: m.repos, projectId: m.projects[0]?.id ?? null });
    return m?.repos ?? [];
  }, [channel.id]);
  useEffect(() => { if (onReleases) void loadMeta(); }, [onReleases, loadMeta]);
  // the project's repository: the one chosen here, else the one primary to the room's project,
  // else the first attached
  const repo = useMemo(() => {
    const repos = meta?.repos ?? [];
    return repos.find((r) => r.id === repoId) ?? repos.find((r) => !!meta?.projectId && (r.primary_project_ids ?? '').split(',').includes(meta.projectId)) ?? repos[0] ?? null;
  }, [meta, repoId]);
  // no repository, or nothing switched on = the step is skipped, and nothing is sent
  const releases = (): ReleaseAnswer | null => (repo && (relNow || relWatch) ? { repoId: repo.id, slug: `${repo.org_name}/${repo.name}`, now: relNow, watch: relWatch } : null);
  const stepValue = (id: StepId): string | string[] | ReleaseAnswer | undefined =>
    id === 'product' ? website.trim() : id === 'goal' ? goal.trim() : id === 'focus' ? [...focus] : id === 'releases' ? releases() ?? undefined : undefined;
  // a step persists as it lands, best-effort — a write that fails must never trap the human on
  // a step (the profile catches up on the following one, or at completion)
  const persist = (id: StepId) => {
    const value = stepValue(id);
    if (value !== undefined && (typeof value === 'string' ? value : Array.isArray(value) ? value.length : true)) {
      void nm?.setupStep(channel.id, MARKETING_SETUP_FLOW.id, id, value).catch(() => {});
    }
  };
  // Next persists the step it LEAVES
  const advance = (to: number) => { persist(STEP_IDS[step]!); setStep(to); };
  // connector status is a synced row — poll lightly while the card is up so the ✓ lands
  // moments after the external-browser OAuth completes (the billing focus-refresh idiom)
  const [conns, setConns] = useState<ConnectorRow[]>([]);
  useEffect(() => {
    // scoped to THIS room's project (0106) — an unscoped call showed another project's account
    const load = () => { void nm?.connectors(channel.id).then((r) => setConns(r.connectors)).catch(() => {}); };
    load();
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, []);
  // Every network the publish pass can actually post to (connectors.ts POSTERS), not just X.
  // Setup offered X alone while the room's own Connections list offered four, so the one moment
  // a person is deciding where their content goes showed them a quarter of the answer.
  const connOf = (p: string) => conns.find((c) => c.provider === p && c.status === 'connected');
  const connected = SETUP_CONNECTORS.filter(([p]) => connOf(p)).length;
  const toggle = (k: string) => setFocus((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n.size ? n : prev; });
  const attach = async () => {
    const url = attachUrl.trim();
    if (!url) return;
    setAttaching(true); setErr('');
    try {
      const r = await nm?.repoAdd({ url: /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`, projectId: meta?.projectId ?? undefined });
      if (!r?.ok) throw new Error('The repository did not attach.');
      setRepoId(r.repoId); setAttachOpen(false); setAttachUrl('');
      // the API answers before the replica holds the row (one PowerSync hop): re-read until it lands,
      // or the chip and both switches stay dark on a repository that DID attach (live harness, 2026-09-18)
      for (let i = 0; i < 25 && !(await loadMeta()).some((x) => x.id === r.repoId); i++) await new Promise((res) => setTimeout(res, 400));
    } catch (e) { setErr(e instanceof Error ? e.message : 'The repository did not attach.'); }
    setAttaching(false);
  };
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const rel = releases();
      // the last step persists as it lands like every other, so a failed submit is a pause
      if (rel) persist('releases');
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const r = await nm?.marketingSetup(channel.id, website.trim(), [...focus], goal.trim() || undefined, rel ? { ...rel, at: '09:00', tz } : undefined);
      if (!r?.ok) throw new Error('Setup did not stick.');
      // the human's answers open whichever session owns the first-run (round 3, one-session
      // rule): the setup TASK's thread when the room has one — docs, close and playbook
      // subtasks all land there — else the legacy conversation, whose birth this message is
      // (server-side transactional birth; the daemon starts the analysis where it finds it)
      const lines = [`**Marketing HQ setup**`];
      if (website.trim()) lines.push(`Website: ${website.trim()}`);
      if (goal.trim()) lines.push(`Goal: ${goal.trim()}`);
      lines.push(`Focus: ${[...focus].join(', ')}`);
      if (rel) lines.push(`Releases: ${rel.slug}${rel.now ? ' · draft the latest now' : ''}${rel.watch ? ' · watch daily' : ''}`);
      if (r.taskId) await nm?.sendThread(r.taskId, channel.id, lines.join('\n')).catch(() => {});
      else if (r.threadId) await nm?.send(channel.id, lines.join('\n'), { threadId: r.threadId }).catch(() => {});
      onDone(r.taskId ? { taskId: r.taskId } : r.threadId ? { threadId: r.threadId } : undefined);
      // the daily watch is a Team routine: Free refuses it, the answer says so, and the Upgrade
      // sheet opens once the card has yielded — the one-shot ran either way
      if (r.releases?.watch === 'plan_limit') openUpgrade();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Setup failed. Try again.'); setBusy(false); }
  };
  return (
    <div className="msg">
      <AgentAvatar name={agent.name} emoji={agent.emoji} role={agent.role} />
      <div className="body">
        <div className="head"><b>{agent.name}</b><span className="rolechip" data-role={agent.role}>{agent.role}</span></div>
        {!arrived ? (
          <div className="liveact" style={{ marginTop: 4 }} aria-live="polite">
            <span className="liveact-ind" /><span className="liveact-txt">getting the channel ready…</span>
          </div>
        ) : (
          <div className="ghostmsg">
            <p>Welcome to the marketing HQ. Point me at the product and the crew takes it from there. It is the same loop as your build channels, aimed at growth.</p>
            {/* one question at a time, the QuestionFlow idiom (round 7): n/N chip, Next
                advances, Back retreats, the last step submits. Same qcard skeleton as the
                in-thread stepper so the two read as one component family. */}
            <div className="qcard mksetup">
              <div className="qhead">
                <span className="qcount">{step + 1}/{LAST + 1}</span>
                {step === 0 && 'Where does your product live?'}
                {step === 1 && <>What's the goal? <span className="mkqopt">(optional)</span></>}
                {step === 2 && 'What should the crew focus on?'}
                {step === 3 && <>Connect where you publish <span className="mkqopt">(optional)</span></>}
                {onReleases && <>Announce your releases? <span className="mkqopt">(optional)</span></>}
              </div>
              {step === 0 && (
                <div className="mkq">
                  <div className="mkurlrow">
                    <input autoFocus value={website} onChange={(e) => setWebsite(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') advance(1); }} placeholder="yourproduct.com" spellCheck={false} aria-label="Product website" />
                  </div>
                  {!!projectWebsite && website !== projectWebsite && (
                    <div className="sugrow" style={{ marginTop: 6 }}>
                      <button type="button" className="sug" onClick={() => setWebsite(projectWebsite)}>Use the project site · {projectWebsite.replace(/^https?:\/\//, '')}</button>
                    </div>
                  )}
                </div>
              )}
              {step === 1 && (
                <div className="mkq">
                  <div className="mkurlrow">
                    <input autoFocus value={goal} onChange={(e) => setGoal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') advance(2); }} placeholder="e.g. get our first 100 users" maxLength={300} aria-label="Marketing goal" />
                  </div>
                </div>
              )}
              {step === 2 && (
                <div className="mkq">
                  <div className="mkfocus" role="group" aria-label="Focus areas">
                    {MARKETING_FOCUS.map(([k, l]) => (
                      <button key={k} type="button" className={focus.has(k) ? 'on' : ''} onClick={() => toggle(k)}>{l}</button>
                    ))}
                  </div>
                </div>
              )}
              {step === 3 && (
                <div className="mkq">
                  {SETUP_CONNECTORS.map(([provider, icon, label, note]) => {
                    const conn = connOf(provider);
                    return (
                      <div className="mkconnrow" key={provider}>
                        <span className="mkconnico" aria-hidden>{icon}</span>
                        <span className="mkconnname">{label}{note && !conn ? <span className="mkqopt"> {note}</span> : null}</span>
                        {conn
                          ? <span className="mkconnok">✓ {conn.handle || 'connected'}</span>
                          : <button type="button" className="btn sm mkconnbtn" onClick={() => { void nm?.connectorStart(channel.id, provider); }}>Connect</button>}
                      </div>
                    );
                  })}
                </div>
              )}
              {/* step 5 (release drafts §4.7): the repository as a chip, the accounts the drafts
                  go to (read-only — connecting is step 4's job), and the two switches */}
              {onReleases && (
                <div className="mkq">
                  <div className="mkqlabel">{repo ? 'Repository' : 'Attach a repository'}</div>
                  {repo && !attachOpen ? (
                    <div className="mkrepo">
                      <span className="repochip"><IconBranch s={12} />{repo.org_name}/{repo.name}<span className="br">· {repo.default_branch}</span></span>
                      <button type="button" className="btn ghost sm" onClick={() => setAttachOpen(true)}>Change</button>
                    </div>
                  ) : (
                    <div className="mkrepo">
                      <div className="mkurlrow">
                        <input autoFocus value={attachUrl} onChange={(e) => setAttachUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void attach(); }} placeholder="github.com/owner/repo" spellCheck={false} aria-label="Repository URL" />
                      </div>
                      <button type="button" className="btn sm" disabled={attaching || !attachUrl.trim()} onClick={() => void attach()}>{attaching ? 'Please wait…' : 'Attach'}</button>
                      {repo && <button type="button" className="btn ghost sm" onClick={() => { setAttachOpen(false); setAttachUrl(''); }}>Cancel</button>}
                    </div>
                  )}
                  <div className="mkqlabel">Drafts go to every connected account</div>
                  {SETUP_CONNECTORS.map(([provider, icon, label]) => {
                    const conn = connOf(provider);
                    return conn ? (
                      <div className="mkconnrow" key={provider}>
                        <span className="mkconnico" aria-hidden>{icon}</span>
                        <span className="mkconnname">{label}</span>
                        <span className="mkconnok">✓ {conn.handle || 'connected'}</span>
                      </div>
                    ) : null;
                  })}
                  {connected < 2 && <div className="mkqnote">Connect more in step 4</div>}
                  <div className="mkqlabel">When</div>
                  <div className="togrow">
                    <span><span className="lbl">Draft the latest release now</span><span className="sub">free on every plan</span></span>
                    <button type="button" role="checkbox" aria-checked={relNow} aria-label="Draft the latest release now" className={`mkcb${relNow ? ' on' : ''}`} disabled={!repo} onClick={() => setRelNow(!relNow)}>{relNow ? '✓' : ''}</button>
                  </div>
                  <div className="togrow">
                    <span><span className="lbl">Watch the repository daily</span><span className="sub">09:00 · one session per release that ships a feature · a Team routine</span></span>
                    <button type="button" role="switch" aria-checked={relWatch} aria-label="Watch the repository daily" className={`shsw${relWatch ? ' on' : ''}`} disabled={!repo} onClick={() => setRelWatch(!relWatch)}><i /></button>
                  </div>
                </div>
              )}
              <div className="mkqfoot">
                {step < LAST ? (
                  <button className="btn primary sm" onClick={() => advance(step + 1)}>Next →</button>
                ) : (
                  <button className="btn primary sm" disabled={busy} onClick={() => void go()}>{busy ? 'Starting…' : 'Put the crew to work →'}</button>
                )}
                {step > 0 && <button className="btn ghost sm" onClick={() => setStep(step - 1)}>‹ Back</button>}
                {step === 0 && onSkip && <button className="btn ghost sm" title="The card hides here. The setup waits in your queue as its own item, so you can finish it any time." onClick={onSkip}>Skip for now</button>}
              </div>
              {err && <div className="acterr" style={{ marginTop: 8 }}>{err}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
