import { CURRENT_MODELS, STARTER_MODEL, type CustomModelPack, type Provider } from '@neuramesh/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BRAIN_PROVIDERS, PROVIDER_RUNTIME, ProviderLogo } from '../brain/providers';
import { nm } from '../bridge/nm';
import type { CredRow } from '../bridge/rows-infra';
import type { AgentRow } from '../bridge/rows-crew';
import type { WorkspaceProjectRow } from '../bridge/rows-board';
import { openProviderSettings } from '../lib/toast';
import { modelLabel, modelServiceable, providerIdForModel } from '../lib/models';
import { IconChevron, IconCode } from '../ui/icons';
import type { EngineeringSession } from './domain';
import { projectDeveloperModel } from './model-selection';

interface ModelGroup {
  id: Provider | 'neuramesh';
  name: string;
  models: readonly string[];
}

const MODEL_GROUPS: readonly ModelGroup[] = [
  { id: 'neuramesh', name: 'NeuraMesh', models: [STARTER_MODEL] },
  ...PROVIDER_RUNTIME.map(([provider, runtime]) => ({
    id: provider,
    name: BRAIN_PROVIDERS.find((item) => item.id === provider)?.name ?? provider,
    models: CURRENT_MODELS[runtime].filter((model) => model !== STARTER_MODEL),
  })),
];

// The starter brain is a NeuraMesh product surface. Its backing model can change without
// changing what the customer selected, so the vendor model id must remain an implementation
// detail in this picker.
const modelDetail = (modelId: string) => modelId === STARTER_MODEL ? 'NeuraMesh managed' : modelId;

export function EngineeringModelSelector({ session, project, disabled, onChange }: {
  session: EngineeringSession;
  project?: Pick<WorkspaceProjectRow, 'model_pack'> | null;
  disabled: boolean;
  onChange: (modelId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [credentials, setCredentials] = useState<CredRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [customPacks, setCustomPacks] = useState<CustomModelPack[]>([]);
  const [credentialState, setCredentialState] = useState<'loading' | 'ready' | 'error'>('loading');
  const refresh = useCallback(() => {
    setCredentialState('loading');
    void nm?.credentials()
      .then((result: { credentials: CredRow[] }) => {
        setCredentials(result.credentials ?? []);
        setCredentialState('ready');
      })
      .catch(() => {
        setCredentials([]);
        setCredentialState('error');
      });
    void nm?.roster().then((result) => setAgents(result.agents ?? [])).catch(() => {});
    void nm?.modelPacks().then((result) => setCustomPacks((result.packs ?? []) as CustomModelPack[])).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    window.addEventListener('nm:brains-changed', refresh);
    return () => window.removeEventListener('nm:brains-changed', refresh);
  }, [refresh]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [open]);

  const readyProviders = useMemo(() => new Set(
    credentials.filter((credential) => credential.scope === 'workspace').map((credential) => credential.provider),
  ), [credentials]);
  const directSelection = session.modelOverride;
  const inherited = directSelection === null && session.brainPack === null;
  const defaultModel = projectDeveloperModel(session.model, project?.model_pack, agents, customPacks);
  const triggerModel = directSelection ?? session.model ?? defaultModel;
  const inheritedModel = inherited ? defaultModel : null;
  const triggerLabel = modelLabel(triggerModel);
  const choose = (modelId: string | null) => {
    onChange(modelId);
    setOpen(false);
  };
  const connect = (provider: Provider) => {
    setOpen(false);
    openProviderSettings(provider);
  };

  return (
    <span className="engmodelwrap cchips">
      <button className={`engmodeltrigger cchip${open ? ' open' : ''}`} disabled={disabled}
        onClick={() => { if (!open) refresh(); setOpen((value) => !value); }}
        aria-haspopup="dialog" aria-expanded={open} aria-label={`Model: ${triggerLabel}`}
        data-tip={`${triggerLabel} · ${directSelection ? 'This thread' : 'Project default'}`}>
        <IconCode s={12} />
        <span className="lbl" title={triggerLabel}>{triggerLabel}</span>
        <span className="car" aria-hidden><IconChevron s={10} /></span>
      </button>
      {open && (
        <>
          <div className="projmenu-scrim" onClick={() => setOpen(false)} />
          <div className="engmodelpop" role="dialog" aria-label="Code model">
            <div className="engmodelhead">
              <span><IconCode s={13} /><b>Model</b></span>
              <small>This thread</small>
            </div>
            <div className="engmodellist">
              <button className={`engmodelrow engmodeldefault${inherited ? ' on' : ''}`} onClick={() => choose(null)}>
                <span className="engmodelmark"><IconCode s={13} /></span>
                <span className="engmodelcopy">
                  <b>{modelLabel(inheritedModel ?? defaultModel)}</b>
                  <small>Project default · developer model</small>
                </span>
                <span className={`engmodelstatus${inherited ? ' on' : ''}`}>{inherited ? 'Current' : 'Use'}</span>
              </button>
              {MODEL_GROUPS.map((group) => {
                const provider = group.id === 'neuramesh' ? null : group.id;
                const platform = provider === null;
                const connected = platform || readyProviders.has(provider);
                return (
                  <section className="engmodelgroup" key={group.id} aria-label={`${group.name} models`}>
                    <div className="engmodelprovider">
                      <span><ProviderLogo id={group.id} s={15} /><b>{group.name}</b></span>
                      {platform ? <em>Included</em> : credentialState === 'loading' ? <em>Checking…</em>
                        : connected ? <em className="ready"><i />Configured</em>
                          : <button className="engmodelconnect" title={credentialState === 'error' ? 'Provider status unavailable. Open Workspace settings.' : undefined}
                            onClick={() => connect(provider)}>Connect</button>}
                    </div>
                    {group.models.map((modelId) => {
                      const selected = directSelection === modelId;
                      const current = session.model === modelId;
                      const available = modelServiceable(modelId, readyProviders) || current;
                      return (
                        <button key={modelId} className={`engmodelrow${selected ? ' on' : ''}`} disabled={!available}
                          aria-pressed={selected} title={available ? `Use ${modelLabel(modelId)} for this Code thread` : `Connect ${group.name} in Workspace settings to use this model`}
                          onClick={() => choose(modelId)}>
                          <span className="engmodelmark"><ProviderLogo id={providerIdForModel(modelId)} s={15} /></span>
                          <span className="engmodelcopy"><b>{modelLabel(modelId)}</b><small>{modelDetail(modelId)}</small></span>
                          <span className={`engmodelstatus${selected || (inherited && current) ? ' on' : ''}`}>
                            {selected ? 'Current' : inherited && current ? 'Inherited' : available ? 'Available' : credentialState === 'error' ? 'Status unavailable' : 'Not connected'}
                          </span>
                        </button>
                      );
                    })}
                  </section>
                );
              })}
            </div>
            <div className="engmodelfoot">Model access follows Workspace settings. Repository permissions stay unchanged.</div>
          </div>
        </>
      )}
    </span>
  );
}
