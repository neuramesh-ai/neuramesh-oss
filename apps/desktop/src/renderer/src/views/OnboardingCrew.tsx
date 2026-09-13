// The starting team — four teammates, named and brained before the workspace exists.
// Renaming here is the first act of ownership in the product, which is why it is a step and
// not a settings screen. Split out of views/Onboarding.tsx.
import { AgentAvatar } from '../components/AgentAvatar';
import { PACKS, type Provider } from '@neuramesh/shared';
import { ModelPicker } from './onboarding-parts';

export function OnboardingCrew({ crew, setCrewAt, activePack, modelGroups }: {
  crew: Array<{ name: string; role: string; model: string }>;
  setCrewAt: (i: number, patch: { name?: string; model?: string }) => void;
  activePack: string | null;
  modelGroups: Array<{ providerId: Provider; provider: string; models: string[] }>;
}) {
  return (
    <>
          <h1 className="obtitle">Meet your <span style={{ color: 'var(--accent)' }}>crew</span>.</h1>
          <p className="obsub">{activePack
            ? <>Your orchestrator has a team. Each agent runs the brain your <b>{PACKS[activePack]!.name}</b> pack assigned. Change any name or model now, or later in Settings.</>
            : <>Your starting team: four agents that plan, build, and review. Change any name or model now, or later in Settings.</>}</p>
          <div className="obcrew">
            {/* the face IS the name (DiceBear, the app's one avatar system since the emoji-tile
                retirement) — rename an agent and its face follows, here and everywhere after */}
            {crew.map((c, i) => (
              <div key={c.role} className="obcrewcard">
                <div className="obcrewid">
                  <span className="obcrewav"><AgentAvatar name={c.name.trim().toLowerCase() || c.role} size={34} radius={9} /></span>
                  <div className="obcrewmeta">
                    <input className="obcrewname" value={c.name} onChange={(e) => setCrewAt(i, { name: e.target.value })} spellCheck={false} aria-label={`${c.role} name`} />
                    <span className="obcrewrole">{c.role}</span>
                  </div>
                </div>
                <ModelPicker value={c.model} groups={modelGroups} onChange={(m) => setCrewAt(i, { model: m })} />
              </div>
            ))}
          </div>
    </>
  );
}
