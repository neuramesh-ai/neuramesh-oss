// Choosing the brain pack during first run — the collapsed card of what you picked, and the
// full grid behind "Change". A locked pack keeps its card and offers the way back to Keys,
// because a disabled button swallows the only question the human has ("why not this one?").
// Split out of views/Onboarding.tsx.
import { BRAIN_PROVIDERS, ProviderLogo } from '../brain/providers';
import { PACKS, PACK_ORDER, PACK_PREVIEW_ROLES, isPackActivatable, missingProviders, packModelForRole, type Provider } from '@neuramesh/shared';
import { modelLabel, providerIdForModel } from '../lib/models';

export function OnboardingPacks({ activePack, packsExpanded, setPacksExpanded, choosePack, enabledList, recommendedPack, setStep }: {
  activePack: string;
  packsExpanded: boolean;
  setPacksExpanded: (v: boolean | ((e: boolean) => boolean)) => void;
  choosePack: (id: string) => void;
  enabledList: Provider[];
  recommendedPack: string | null;
  setStep: (n: number) => void;
}) {
  return (
    <>
            <div className="obpacksect">
              <span className="obsect" style={{ margin: 0 }}>Team brains</span>
              <button type="button" className="obpacktoggle" aria-label="Change pack" onClick={() => setPacksExpanded((e) => !e)}>{packsExpanded ? 'Done ▴' : 'Change ▾'}</button>
            </div>
            {/* collapsed → just the CHOSEN pack's card, roster and all (click to change) */}
            <div className={`obcollapse${packsExpanded ? '' : ' open'}`}>
              <div>
                <button type="button" className="obpack on obpacksumcard" onClick={() => setPacksExpanded(true)}>
                  <span className="obpacktop">
                    <span className="obpackname">{PACKS[activePack]!.name}</span>
                    {activePack === recommendedPack && <span className="obpackrec">Recommended</span>}
                  </span>
                  <span className="obpacktag">{PACKS[activePack]!.tagline}</span>
                  <span className="packroster">
                    {PACK_PREVIEW_ROLES.map((role) => {
                      const m = packModelForRole(activePack, role)!;
                      return (
                        <span key={role} className="packrolerow">
                          <ProviderLogo id={providerIdForModel(m)} s={11} />
                          <span className="packrolename">{role}</span>
                          <span className="packarrow">→</span>
                          <span className="packmodelname">{modelLabel(m)}</span>
                        </span>
                      );
                    })}
                  </span>
                </button>
              </div>
            </div>
            {/* expanded → the full picker with per-role rosters */}
            <div className={`obcollapse${packsExpanded ? ' open' : ''}`}>
              <div>
                <div className="obpacks">
                  {PACK_ORDER.map((id) => {
                    const pk = PACKS[id]!;
                    const ok = isPackActivatable(id, enabledList);
                    const miss = missingProviders(id, enabledList);
                    const body = (
                      <>
                        <span className="obpacktop">
                          <span className="obpackname">{pk.name}</span>
                          {ok && id === recommendedPack && <span className="obpackrec">Recommended</span>}
                          {!ok && <span className="obpackrec lock">Locked</span>}
                        </span>
                        <span className="obpacktag">{pk.tagline}</span>
                        <span className="packroster">
                          {PACK_PREVIEW_ROLES.map((role) => {
                            const m = packModelForRole(id, role)!;
                            return (
                              <span key={role} className="packrolerow">
                                <ProviderLogo id={providerIdForModel(m)} s={11} />
                                <span className="packrolename">{role}</span>
                                <span className="packarrow">→</span>
                                <span className="packmodelname">{modelLabel(m)}</span>
                              </span>
                            );
                          })}
                        </span>
                      </>
                    );
                    // activatable → the whole card picks the pack (and collapses); locked → a static
                    // card with a "Connect X" CTA that jumps back to Keys (a disabled button would swallow it).
                    return ok ? (
                      <button key={id} type="button" className={`obpack${activePack === id ? ' on' : ''}`} onClick={() => choosePack(id)}>{body}</button>
                    ) : (
                      <div key={id} className="obpack off">
                        {body}
                        <button type="button" className="obpackconnect" onClick={() => setStep(2)}>Connect {miss.map((p) => BRAIN_PROVIDERS.find((b) => b.id === p)?.name ?? p).join(' + ')} →</button>
                      </div>
                    );
                  })}
                </div>
                <div className="obhint" style={{ paddingLeft: 0, marginTop: 8 }}>a model per role — your whole crew follows your pick (tune any of them next). Connect more providers in Keys to unlock the rest; change any brain later in Settings → Brains.</div>
              </div>
            </div>
    </>
  );
}
