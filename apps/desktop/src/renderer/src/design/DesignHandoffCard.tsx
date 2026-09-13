// The design hand-off card (docs/14) — the approved round, handed to the architect.
// Extracted from App.tsx (track A2).
import { AgentAvatar } from '../components/AgentAvatar';
import { IconArrowR, IconCheck, IconExternal, IconImage } from '../ui/icons';
import { claudeDesignProjectUrl } from '@neuramesh/shared';
import { designMockupLabel, themedMockupDoc } from './plans';
import { nm as nmBridge } from '../bridge/nm';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// A durable, transcript-native Claude Design handoff. The old handoff lived in
// the composer dock and only existed while the task was `designing`, so it
// vanished at the exact moment the synced mockups became reviewable. This card
// stays in the conversation, exposes the auto-sync lifecycle, and turns every
// delivered direction into a direct entry point to the design review overlay.
export function DesignHandoffCard({
  provider,
  taskState,
  mockups,
  round,
  externalUrl,
  architectName,
  designerName,
  onOpen,
}: {
  provider: 'iris' | 'claude-design';
  taskState: string;
  mockups: Array<{ id: string; name: string; inline_content: string | null }>;
  round: number;
  externalUrl?: string | null;
  architectName?: string | null;
  // whoever actually HOLDS this round. A design phase is no longer always the seated designer's:
  // the orchestrator owns most rounds now and draws them with designer subagents (docs/29 §4d), so
  // a hardcoded "Iris" would name an agent the human never handed the task to.
  designerName?: string | null;
  onOpen: (name?: string) => void;
}) {
  const claude = provider === 'claude-design';
  const who = designerName ?? 'Iris';
  const working = taskState === 'designing';
  const ready = mockups.length > 0 && !working;
  const approved = mockups.length > 0 && !['designing', 'design_review'].includes(taskState);
  const waitingForArchitect = approved && taskState === 'planning' && !architectName;

  // Settled (design round 2026-07-28): once the decision is made, the lifecycle strip and
  // the 250px previews are status furniture. What stays is a small sealed contract — the
  // round, the title, both thumbnails, and one way back into a read-only studio.
  if (approved) {
    return (
      <div className="dhandrow">
        <section className="dcontract" aria-label="Approved design">
          <div className="dconthead">
            <span className="dcontseal" aria-hidden><IconCheck s={13} /></span>
            <div className="dcontid">
              <span className="dkick">Approved · round {round}</span>
              <strong>{designMockupLabel(mockups[0]!.name)}</strong>
            </div>
            <button className="btn sm" onClick={() => onOpen()}>Review again <IconExternal s={11} /></button>
          </div>
          <div className="dcontthumbs">
            {mockups.map((m) => (
              <button key={m.id} className="dcontthumb" onClick={() => onOpen(m.name)} title={`Open ${designMockupLabel(m.name)}`}>
                <span className="dcontshot" aria-hidden>
                  {m.inline_content
                    ? <iframe className="dhandframe" sandbox="" tabIndex={-1} srcDoc={themedMockupDoc(m.inline_content)} title="" />
                    : <span className="dhandempty"><IconImage s={16} /></span>}
                </span>
                <span className="dcontcap">{designMockupLabel(m.name)}</span>
              </button>
            ))}
          </div>
          <div className="dcontfoot">
            {waitingForArchitect
              ? 'The visual contract is saved — choose Rex’s staffing option in this thread to start the plan.'
              : architectName && taskState === 'planning'
                ? `The visual contract for the build — @${architectName} has the planning handoff.`
                : 'The visual contract for the build — the plan, the code and the review all gate on it.'}
          </div>
        </section>
      </div>
    );
  }
  const projectReady = !claude || !!externalUrl || mockups.length > 0;
  const steps = claude ? ['Project ready', 'Designing', 'Synced for review'] : ['Brief ready', 'Drafting', 'Ready for review'];
  const active = !projectReady ? 0 : working ? 1 : ready || approved ? 2 : 1;
  const heading = waitingForArchitect
    ? `Design approved · planning needs an architect`
    : approved
    ? `Design approved · round ${round}`
    : ready
      ? `${mockups.length} design${mockups.length === 1 ? '' : 's'} ready for review`
      : claude
        ? externalUrl ? `Claude Design · ${who} is working` : 'Creating the Claude Design project'
        : `${who} is drafting the mockups`;
  const copy = waitingForArchitect
    ? 'The visual contract is saved. Choose Rex’s staffing option in this thread to start the implementation plan.'
    : approved
    ? architectName && taskState === 'planning'
      ? `This design is attached as the visual contract. @${architectName} has the planning handoff.`
      : 'This design stays attached to the task as the visual contract for the build.'
    : ready
      ? claude
        ? 'The latest Claude Design snapshot is synced here. Open any direction to review it full-size.'
        : `${who} shared the latest mockups here. Open any direction to review it full-size.`
      : claude
        ? `Keep editing there. ${who} will sync the designs here automatically when they are ready.`
        : `${who} will share each reviewable direction here as soon as the round is ready.`;

  return (
    <div className="dhandrow">
    <section className={`dhand${ready || approved ? ' ready' : ' working'}`} aria-label="Design handoff">
      <div className="dhandhead">
        {/* Iris's OWN face, not a sparkle. DiceBear Thumbs is the one avatar system (docs/33 §8 —
            emoji tiles were retired for exactly this reason), and a generic sparkle on a card about a
            named teammate reads as decoration rather than identity. Claude Design keeps its 'C'
            wordmark because that card is about the external tool, not about Iris. */}
        <span className={`dhandmark${claude ? ' claude' : ''}`} aria-hidden>
          {claude ? 'C' : <AgentAvatar name="iris" size={26} />}
        </span>
        <div className="dhandtitle"><strong>{heading}</strong><span>{copy}</span></div>
        <span className={`dhandsync${ready || approved ? ' done' : ''}`}>
          {ready || approved ? <IconCheck s={12} /> : <i aria-hidden />}
          {ready || approved ? 'Synced' : 'Auto-sync on'}
        </span>
        {/* the button names the PROJECT, so it opens the project — not whichever file the
            agent's link happened to point at (George, live 2026-08-11) */}
        {claude && claudeDesignProjectUrl(externalUrl) && (
          <button className="btn sm" onClick={() => void nm?.openExternal(claudeDesignProjectUrl(externalUrl)!)}>
            Open Claude Design <IconExternal s={12} />
          </button>
        )}
      </div>

      <div className="dhandprogress" aria-label={`Design progress: ${steps[active]}`}>
        {steps.map((step, i) => {
          const done = ready || approved || i < active;
          const current = !done && i === active;
          return (
            <div key={step} className={`dhandstep${done ? ' done' : current ? ' current' : ''}`}>
              <span>{done ? <IconCheck s={10} /> : i + 1}</span>
              <b>{step}</b>
            </div>
          );
        })}
      </div>

      {mockups.length > 0 && (
        <div className="dhandpreviews">
          {mockups.map((mockup) => (
            <button key={mockup.id} className="dhandpreview" onClick={() => onOpen(mockup.name)} title={`Open ${designMockupLabel(mockup.name)} in design review`}>
              <span className="dhandclip" aria-hidden>
                {mockup.inline_content
                  ? <iframe className="dhandframe" sandbox="" tabIndex={-1} srcDoc={themedMockupDoc(mockup.inline_content)} title="" />
                  : <span className="dhandempty"><IconImage s={18} /></span>}
              </span>
              <span className="dhandpreviewmeta">
                <span><strong>{designMockupLabel(mockup.name)}</strong><small>Round {round} · synced snapshot</small></span>
                <IconArrowR s={14} />
              </span>
            </button>
          ))}
        </div>
      )}

      {mockups.length > 0 && (
        <div className="dhandfoot">
          <span>{working ? `${who} is preparing round ${round + 1}; these are the previous synced directions.` : 'Click a preview to open that direction directly.'}</span>
          <button className="btn primary sm" onClick={() => onOpen()}>Review all designs</button>
        </div>
      )}
    </section>
    </div>
  );
}
