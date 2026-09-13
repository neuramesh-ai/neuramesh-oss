// The new-chat stage (docs/35) — where ⌘N lands. Extracted from App.tsx (track A4).
import { AgentAvatar, ProjLogo } from '../components/AgentAvatar';
import { AttachButton, AttachTray, consumeWbAttach, useAttachments } from '../composer/attach';
import { BrainChip } from '../brain/BrainChip';
import { ComposerInput } from '../composer/ComposerInput';
import { ConnectorMarks } from '../composer/ConnectorMarks';
import { HomeLedger, type HomeLedgerProps } from './HomeLedger';
import { HomeWatermark } from '../brand';
import { IconClose, IconGrid, IconSend, IconSkill } from '../ui/icons';
import { MentionButton, filesFromPaste, type ComposerPerson } from '../thread/parts';

import { agentInChannel, type BrainOverride, type Provider, type SessionOrigin, type ThreadMode } from '@neuramesh/shared';
import { errMsg } from '../lib/text';
import { flashToast } from '../lib/toast';
import { readBrainDraft } from '../brain/draft';
import { type AgentRow } from '../bridge/rows-crew';
import { type ChannelRow } from '../bridge/rows-rooms';
import { type SkillPackRow, type SkillRow } from '../bridge/rows-content';
import { type WorkspaceProjectRow } from '../bridge/rows-board';
import { useEffect, useState, type ReactNode } from 'react';
import { CapGate } from '../compute/CapGate';
import { HostedGate } from '../shell/HostedGate';
import { useCompute } from '../compute/useCompute';

/**
 * The room's "you can just ask" cap, sitting at the top of a composer box.
 *
 * Mentions are how work starts here and nothing on screen said so — the placeholder's "@ mention"
 * is a syntax note, not an invitation. It names a ROOM'S orchestrator (never a hardcoded "rex":
 * the name is per workspace, and a room may have been staffed with someone else), and the name is
 * a button, so reading the hint and acting on it are one gesture.
 */
export function ComposerHint({ lead, onInsert }: { lead: AgentRow; onInsert: (name: string) => void }) {
  return (
    <div className="chint">
      <AgentAvatar name={lead.name} emoji={lead.emoji} size={15} radius={4} role={lead.role} />
      {/* docs/34 §14: one composer, one consequence — the orchestrator triages every send and
          decides what becomes a task, so the hint no longer branches on a mode. */}
      <span>
        Mention{' '}
        <button type="button" className="chintat" onClick={() => onInsert(lead.name)}>@{lead.name}</button>{' '}
        or another teammate whenever you want their help.
      </span>
    </div>
  );
}

/** An IPC failure as a human sentence — the Electron wrapper prefix is noise, not information. */
/** the orchestrator a given room would route through — the one this hint should introduce */
export function leadFor(agents: AgentRow[], channelId: string | null | undefined): AgentRow | null {
  if (!channelId) return null;
  return agents.find((a) => a.role === 'orchestrator' && !a.retired_at && agentInChannel(a.channel_ids, channelId)) ?? null;
}

/** the ghost recipe — three asks the stage offers before you type */
const SUGGESTIONS = ['Give me ideas', 'What moved while I was away?', 'Plan the next release'];

// ── THE LANDING (the shell round 2026-08-10, re-merged 2026-08-16) ───────────────────────────
// ⌘N, the nav's pill, a project head's ＋ — and now boot itself — land HERE. Home stopped being a
// screen: two of its three sections were already rendering elsewhere (Recent is the nav tree and
// ⌘Y over the same derivation; In flight is the tree's live rows and the tab-0 pulse), and the
// third — the needs-you queue — became the bell on the strip's rail. What is left is what a
// landing is for: a greeting, and the composer.
//
// The greeting and the invitation to work are ONE display line, not two stacked serif sentences
// (the report line George deleted from Home was exactly that mistake). The project name inside it
// IS the project switcher — the chips-row pill, promoted into the sentence: one control, one
// fact. Picking it moves the active project so the tree follows, and retargets the room chip.
export function NewChatStage({ agents, projects, activeProjectId, channels, defaultChannelId, people, skills, packs, plan, greeting, composeSignal, initialTarget, initialDraft, topSections, onSend, onOpenThread, onPickProject, onNewProject, onAllProjects, onBrainConnect, onSetProjectPack, onUpgrade, onSeeUsage, machineChip, sessionBirth, ledger, hostedGate }: {
  agents: AgentRow[];
  projects: WorkspaceProjectRow[];
  activeProjectId: string;
  channels: ChannelRow[]; // the ACTIVE project's rooms — the #room chip's send-time targets
  defaultChannelId: string | null;
  people: ComposerPerson[];
  skills: SkillRow[];
  packs: SkillPackRow[];
  plan: string; /** a free hosted workspace (shell/hostedrule.ts): the gate card IS the stage, as the cap card is */ hostedGate?: boolean;
  /** the human's first name — `null` while the profile is still resolving */
  greeting: string | null;
  composeSignal?: number;
  /** rendered above the headline — today the workspace-invitation cards (0113) */
  topSections?: React.ReactNode;
  /** the channel the composer should adopt when the next focus signal fires — null resets */
  initialTarget?: string | null;
  /** a pre-written ask the next focus signal drops into the composer (a playbook pill is a
   * PRE-DRAFTED MESSAGE, never a command — the human still sends). null leaves the draft alone */
  initialDraft?: string | null;
  onSend: (channelId: string, text: string, opts: { id?: string; attachments?: { id: string; name: string; mime: string }[]; threadId: string; rootMessageId?: string; threadMode?: ThreadMode; brainOverride?: BrainOverride | null; threadMachineId?: string | null; threadOrigin?: SessionOrigin | null }) => Promise<unknown>;
  /** WHERE this session runs (rule D9): the shell draws the chip (it owns the fleet) and says what the birth message writes — `threads.machine_id` + `threads.origin` (0134) */
  machineChip?: (value: string | null, onPick: (machineId: string | null) => void) => ReactNode;
  sessionBirth?: (chosen: string | null) => { threadMachineId: string | null; threadOrigin: SessionOrigin };
  onOpenThread: (threadId: string, channelId?: string) => void;
  onPickProject: (projectId: string) => void;
  onNewProject: () => void;
  onAllProjects: () => void;
  onBrainConnect: (provider: Provider) => void;
  onSetProjectPack?: (packId: string) => Promise<void>;
  onUpgrade: (reason: string) => void;
  /** the cap gate's second door — Compute, where the meter and "Wake now" live */
  onSeeUsage: () => void;
  /** the thread list under the composer (docs/design/home-threads-2026-09) — the shell hands over the
   * same rows and marks the rail, the bell and ⌘Y read; absent on a client that has no history yet */
  ledger?: HomeLedgerProps;
}) {
  // no machine can run, so the stage shows WHY instead of a composer that cannot deliver
  const capped = useCompute(true)?.status === 'capped';
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  // a door just opened this composer — adopt whatever channel (and pre-written ask) it carried
  // (round 2, ⑦; the draft: marketing-os round — a null draft leaves what the human was typing)
  useEffect(() => {
    if (!composeSignal) return;
    setTarget(initialTarget ?? null);
    if (initialDraft != null) setDraft(initialDraft);
  }, [composeSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  const [chanPop, setChanPop] = useState(false);
  const [projPop, setProjPop] = useState(false);
  const [machine, setMachine] = useState<string | null>(null); // the chip's choice for the NEXT send; null = Auto
  const [attachedSkill, setAttachedSkill] = useState<{ name: string; pack?: string | null } | null>(null);
  const [cmention, setCmention] = useState(0); // nonce → the @ button types "@" + opens the picker
  const [hfocus, setHfocus] = useState(0); // nonce → focuses the composer (the hint's @name insert)
  useEffect(() => { if (composeSignal) setHfocus((n) => n + 1); }, [composeSignal]);
  const atts = useAttachments(plan, onUpgrade);
  const targetChan = channels.find((c) => c.id === target) ?? channels.find((c) => c.id === defaultChannelId) ?? channels[0] ?? null;
  const sendDraft = async () => {
    const text = draft.trim();
    const attSpecs = atts.specs();
    if ((!text && !attSpecs.length) || !targetChan || sending || atts.busy) return;
    setSending(true);
    const marker = attachedSkill ? `‹skill:${attachedSkill.name}${attachedSkill.pack ? `@${attachedSkill.pack}` : ''}› ` : '';
    const threadId = crypto.randomUUID();
    const msgId = atts.msgId();
    try {
      // this message IS the thread's root (docs/31): the server births + names the thread on it,
      // and the docs/34 mode + the pill's brain draft ride the birth message — this send BIRTHS
      // the conversation, so what the pill was showing is what the conversation starts on
      await onSend(targetChan.id, marker + consumeWbAttach(text), { id: msgId, attachments: attSpecs, threadId, rootMessageId: msgId, brainOverride: readBrainDraft(), ...sessionBirth?.(machine) });
      setDraft('');
      setMachine(null);
      setAttachedSkill(null);
      atts.reset();
      // the send animates into its thread — the TARGET room rides along (docs/32)
      onOpenThread(threadId, targetChan.id);
    } catch (e) { flashToast(errMsg(e)); }
    finally { setSending(false); }
  };
  const ap = projects.find((p) => p.id === activeProjectId);
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  // with rows to read, the stage is a page you read down: top-aligned, on the reading column, scrolling
  const ledgered = (ledger?.rows.length ?? 0) > 0;
  return (
    <div className={`stagewrap${ledgered ? ' ledgered' : ''}`}>
      {/* the identity, behind the stage now that the stage owns the composer — it recedes the
          moment there is something to read (fill is "how much is on this page") */}
      <HomeWatermark fill={draft || ledgered ? 1 : 0} />
      <div className="stagecol">
        {topSections}
        {/* Home's date line, kept: the one fact a landing owes you before it asks a question */}
        <div className="stageeyebrow">{new Date().toLocaleDateString([], { weekday: 'long' })} · {new Date().toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
        <h1 className="stagehead">
          {hello}{greeting ? `, ${greeting}` : ''}.{' '}
          <span className="stageq">What&rsquo;s next in{' '}<span className="stageproj">
            {projPop && (
              <>
                <div className="projmenu-scrim" onClick={() => setProjPop(false)} />
                <div className="chpop projpop stagepop" role="menu">
                  {projects.filter((p) => p.status === 'active').map((p) => (
                    <button key={p.id} className={p.id === activeProjectId ? 'on' : ''} role="menuitem"
                      onClick={() => {
                        setProjPop(false);
                        if (p.id !== activeProjectId) {
                          // the room chip follows: the new project's rooms are a different set
                          setTarget(null);
                          onPickProject(p.id);
                        }
                      }}>
                      <ProjLogo logo={p.logo_url} name={p.name || p.slug} size={15} />
                      {p.slug}
                    </button>
                  ))}
                  <div className="chpopsep" />
                  <button role="menuitem" className="chpopact" onClick={() => { setProjPop(false); onNewProject(); }}>＋ New project</button>
                  <button role="menuitem" className="chpopact" onClick={() => { setProjPop(false); onAllProjects(); }}><IconGrid s={11} /> All projects</button>
                </div>
              </>
            )}
            <button type="button" className="stageprojbtn" onClick={() => setProjPop((v) => !v)}
              aria-haspopup="menu" aria-expanded={projPop} data-tip="Switch project — or make one">
              {ap?.slug ?? '…'}
            </button>
          </span>?</span>
        </h1>
        {/* STATE-BASED (George, 2026-08-29): when no machine can run, the cap card IS the stage.
            A composer that cannot deliver is a trap, and suggestion pills below it are an
            invitation to press something that does nothing. Both are replaced, not decorated. */}
        {capped ? <CapGate variant="stage" onUpgrade={onUpgrade} onSeeUsage={onSeeUsage} /> : hostedGate ? <HostedGate variant="stage" /> : <>
        <div className="hcomposer cbox stagebox">
          {(() => {
            // the stage lands in ONE room (the chip), so it introduces THAT room's orchestrator
            const lead = leadFor(agents, targetChan?.id);
            if (!lead) return null;
            return <ComposerHint lead={lead} onInsert={(nm2) => {
              setDraft((d) => `${d}${d && !/\s$/.test(d) ? ' ' : ''}@${nm2} `);
              setHfocus((n) => n + 1);
            }} />;
          })()}
          {attachedSkill && (
            <div className="skillattach">
              <span className="skillchip"><IconSkill s={12} /> skill: {attachedSkill.name}{attachedSkill.pack ? ` · ${attachedSkill.pack}` : ''}</span>
              <button className="skillattachx" title="remove" onClick={() => setAttachedSkill(null)}><IconClose s={12} /></button>
            </div>
          )}
          <AttachTray items={atts.items} onRemove={atts.remove} />
          <ComposerInput
            value={draft}
            onChange={setDraft}
            onSend={() => void sendDraft()}
            people={people}
            skills={skills}
            packs={packs}
            attachedSkill={attachedSkill}
            onPickSkill={setAttachedSkill}
            onClearSkill={() => setAttachedSkill(null)}
            onOpenSkills={() => {}}
            onPaste={(e) => { const fs = filesFromPaste(e); if (fs.length) { e.preventDefault(); atts.addFiles(fs); } }}
            placeholder={'Describe the work, or just ask. Use @ to mention an agent or a user, and / for skills.'}
            mentionSignal={cmention}
            focusSignal={hfocus}
          />
          <div className="hrow">
            {/* the chip menu anchors to ITS OWN chip (2026-08-07) — the wrapper is the context.
                No project chip in this row: the headline carries that fact now. */}
            <span className="chipmenu">
              {chanPop && targetChan && (
                <>
                  <div className="projmenu-scrim" onClick={() => setChanPop(false)} />
                  <div className="chpop" role="menu">
                    {channels.map((c) => (
                      <button key={c.id} className={c.id === targetChan.id ? 'on' : ''} role="menuitem" onClick={() => { setTarget(c.id); setChanPop(false); }}>
                        <span className="h">#</span> {c.slug}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button className="hchip chan" onClick={() => setChanPop((v) => !v)} disabled={!targetChan} aria-haspopup="menu" aria-expanded={chanPop} data-tip="The room this lands in">
                <span className="h">#</span> {targetChan?.slug ?? '…'} <span className="cv">⌄</span>
              </button>
            </span>
            {machineChip?.(machine, setMachine)}
            {(() => {
              // the SAME pill as the thread composer (docs/10 §15) — one switcher, every surface
              return <BrainChip
                onConnect={onBrainConnect}
                project={ap ? { id: ap.id, name: ap.name, pack: ap.model_pack ?? null } : null}
                onSetProjectPack={onSetProjectPack}
                castAgents={targetChan ? agents.filter((a) => agentInChannel(a.channel_ids, targetChan.id)) : []}
              />;
            })()}
            <MentionButton onMention={() => setCmention((n) => n + 1)} />
            <AttachButton onFiles={atts.addFiles} count={atts.count} max={atts.limits.maxPerMessage} />
            <span style={{ flex: 1 }} />
            <button className="hsend" disabled={sending || atts.busy || (!draft.trim() && !atts.count) || !targetChan} onClick={() => void sendDraft()} data-tip="Send · ↵" aria-label={atts.busy ? 'Uploading attachments' : 'Send'}>
              {sending || atts.busy ? '…' : <IconSend s={20} />}
            </button>
          </div>
          {/* THE FOOT (docs/design/composer-foot-2026-09, 2026-09-11): the cap's material mirrored at
              the bottom of the same card — one object, three zones. Left, the ghost recipe: a pill is
              a PRE-DRAFTED MESSAGE, never a command (the rex-pills ruling), so clicking fills the
              draft and focuses, and the human still sends. Right, the connector marks. With a draft
              in the box the pills leave and the marks stay; the foot keeps its height so nothing
              jumps (the settle control's reserved-seat rule, docs/33 §4). */}
          <div className={`cfoot${draft ? ' drafting' : ''}`}>
            <div className="cfootpills" aria-hidden={!!draft}>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="cfootpill" tabIndex={draft ? -1 : 0} onClick={() => { setDraft(s); setHfocus((n) => n + 1); }}>{s}</button>
              ))}
            </div>
            <ConnectorMarks channelId={targetChan?.id ?? null} marketing={targetChan?.marketing} />
          </div>
        </div>
        {ledger && <HomeLedger {...ledger} />}
        </>}
      </div>
    </div>
  );
}
