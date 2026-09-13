// Providers, brains and the sandbox — the panels of workspace settings that decide what
// agents may run on and with. Split out of settings/WorkspaceSettings.tsx.
import { BRAIN_PROVIDERS, ProviderLogo } from '../brain/providers';
import { BrainBuilder } from '../brain/BrainBuilder';
import { CUSTOM_PACK_ID, PACKS, PACK_ORDER, PACK_PREVIEW_ROLES, PACK_SUPPORT_ROLES, isPackActivatable, missingProviders, missingProvidersForRoles, resolvePackRoles, rolesActivatable, type AgentRole, type CustomModelPack, type Provider } from '@neuramesh/shared';

import { ProviderCard, type ProviderMode } from './providerui';

import { modelLabel, providerIdForModel } from '../lib/models';
import { nm as nmBridge } from '../bridge/nm';
import { type CredRow, type ProviderId, type ProviderStatus } from '../bridge/rows-infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Workspace "Model providers" — the same ProviderCard flow as onboarding, but persisting to
// the credential store as you go: switch a provider to your subscription once you've logged
// in, or drop in / replace an API key later. Mode reflects what's actually saved.
export function ProviderSettings({ creds, onSaved, focus }: { creds: CredRow[]; onSaved: () => void; focus?: string | null }) {
  const [detection, setDetection] = useState<Record<ProviderId, ProviderStatus> | null>(null);
  const [setupOpen, setSetupOpen] = useState<ProviderId | null>(null);
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [drafts, setDrafts] = useState<Record<ProviderId, { mode: ProviderMode; key: string }>>({
    anthropic: { mode: 'none', key: '' }, openai: { mode: 'none', key: '' }, gemini: { mode: 'none', key: '' },
  });

  // Seed a card's mode from its saved credential — but only while untouched, so saving one
  // provider (which reloads creds) never wipes an edit in progress on another.
  useEffect(() => {
    setDrafts((d) => {
      const next = { ...d };
      for (const bp of BRAIN_PROVIDERS) {
        const s = creds.find((c) => c.scope === 'workspace' && c.provider === bp.id);
        if (s && next[bp.id].mode === 'none' && next[bp.id].key === '') next[bp.id] = { mode: s.authMode, key: '' };
      }
      return next;
    });
  }, [creds]);

  // Probe this machine for installed CLIs + existing subscription logins.
  useEffect(() => {
    if (detection) return;
    let alive = true;
    void nm?.detectProviders().then((dd) => {
      if (!alive || !dd) return;
      setDetection(dd);
      setSetupOpen((s) => (s && dd[s]?.authed ? null : s));
    }).catch(() => {
      if (alive) setDetection({ anthropic: { installed: true, authed: false, method: null }, openai: { installed: false, authed: false, method: null }, gemini: { installed: false, authed: false, method: null } });
    });
    return () => { alive = false; };
  }, [detection]);

  const persist = async (id: ProviderId, authMode: 'subscription' | 'apikey', token?: string) => {
    if (!nm) return;
    setBusy(id);
    try {
      await nm.setCredential(authMode === 'apikey' ? { scope: 'workspace', provider: id, authMode, token } : { scope: 'workspace', provider: id, authMode });
      onSaved();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="obbrains" style={{ marginTop: 4 }}>
      {BRAIN_PROVIDERS.map((bp) => {
        const saved = creds.find((c) => c.scope === 'workspace' && c.provider === bp.id);
        const draft = drafts[bp.id];
        return (
          <ProviderCard
            key={bp.id}
            bp={bp}
            status={detection?.[bp.id]}
            probing={!detection}
            mode={draft.mode}
            keyValue={draft.key}
            keyPlaceholder={saved?.authMode === 'apikey' && saved.last4 ? `····${saved.last4} — replace` : bp.place}
            ready={!!saved}
            setupOpen={setupOpen === bp.id}
            busy={busy === bp.id}
            highlight={focus === bp.id}
            onMode={(m) => {
              setDrafts((d) => ({ ...d, [bp.id]: { ...d[bp.id], mode: m } }));
              if (m === 'subscription') void persist(bp.id, 'subscription'); // no secret to enter — save now
            }}
            onKey={(key) => setDrafts((d) => ({ ...d, [bp.id]: { ...d[bp.id], key } }))}
            onKeyCommit={() => {
              const k = draft.key.trim();
              if (k) void persist(bp.id, 'apikey', k).then(() => setDrafts((d) => ({ ...d, [bp.id]: { ...d[bp.id], key: '' } })));
            }}
            onToggleSetup={() => setSetupOpen(setupOpen === bp.id ? null : bp.id)}
            onRefresh={() => setDetection(null)}
          />
        );
      })}
    </div>
  );
}

// One pack card's roster: the five working roles (designer included, docs/14) + a muted
// support line for sales/curator — the full truth without the clutter (worker aliases developer).
export function PackRoster({ roles, latency }: { roles: Record<AgentRole, string>; latency?: Partial<Record<AgentRole, string>> }) {
  return (
    <>
      <div className="packroster">
        {PACK_PREVIEW_ROLES.map((role) => {
          const m = roles[role]!;
          return (
            <span key={role} className="packrolerow">
              <ProviderLogo id={providerIdForModel(m)} s={12} />
              <span className="packrolename">{role}</span>
              <span className="packarrow">→</span>
              <span className="packmodelname">{modelLabel(m)}</span>
              {latency && (latency[role]
                ? <span className="packlat">{latency[role]}</span>
                : <span className="packlat cur">curated</span>)}
            </span>
          );
        })}
      </div>
      <div className="packsupport">support · {PACK_SUPPORT_ROLES.map((r) => `${r} → ${modelLabel(roles[r]!)}`).join(' · ')}</div>
    </>
  );
}

// Team brains — pick a curated model-config pack OR a custom brain (a model per agent role).
// Activating one re-points every PACK-MANAGED agent at once; agents pinned by hand keep their
// brain. A brain is only activatable once the providers its models need are configured (above);
// otherwise it shows what to connect. The active pack + custom brains are read from the
// control-api (workspaces/custom_model_packs aren't PowerSync-replicated); the composer's Brain
// pill mutates the same state, so both listen for the nm:brains-changed broadcast.
export function PackSelector({ creds, onConnect }: { creds: CredRow[]; onConnect?: (provider: Provider) => void }) {
  const [active, setActive] = useState<string>(CUSTOM_PACK_ID);
  const [custom, setCustom] = useState<CustomModelPack[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [builder, setBuilder] = useState<{ edit: CustomModelPack | null } | null>(null);
  const refresh = useCallback(() => {
    void nm?.workspaceSettings().then((s) => setActive(s.activeModelPack ?? CUSTOM_PACK_ID)).catch(() => {});
    void nm?.modelPacks().then((r) => setCustom((r.packs ?? []) as CustomModelPack[])).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    window.addEventListener('nm:brains-changed', refresh);
    return () => window.removeEventListener('nm:brains-changed', refresh);
  }, [refresh]);
  // CONFIGURED set (presence of a workspace-scoped credential row) — not live machine state, so
  // activation never flickers when a subscription login briefly drops. Matches ProviderSettings.
  const enabled = useMemo(() => [...new Set(creds.filter((c) => c.scope === 'workspace').map((c) => c.provider))] as Provider[], [creds]);
  const provName = (p: Provider) => BRAIN_PROVIDERS.find((b) => b.id === p)?.name ?? p;
  const apply = async (id: string) => {
    if (!nm || busy || id === active) return;
    setBusy(id);
    try { await nm.applyPack(id); setActive(id); window.dispatchEvent(new Event('nm:brains-changed')); }
    catch { /* leave the prior pack active on failure */ } finally { setBusy(null); }
  };
  const badge = (on: boolean, ok: boolean) =>
    on ? <span className="packbadge on">✓ Active</span> : ok ? <span className="packbadge">Apply</span> : <span className="packbadge off">Locked</span>;
  return (
    <div className="packsel">
      <div className="packselhd">
        <b>Team brains</b>
        <span>A curated model per role — or build your own. Switching re-points every pack-managed agent at once; agents you've pinned by hand stay as they are.</span>
      </div>
      <div className="packgrid">
        {PACK_ORDER.map((id) => {
          const pack = PACKS[id]!;
          const ok = isPackActivatable(id, enabled);
          const miss = missingProviders(id, enabled);
          const on = active === id;
          const inner = (
            <>
              <div className="packcardtop">
                <span className="packname">{pack.name}</span>
                {badge(on, ok)}
              </div>
              <div className="packtag">{pack.tagline}</div>
              <PackRoster roles={pack.roles} latency={pack.latency} />
              {busy === id && <div className="packneeds">Applying…</div>}
            </>
          );
          // activatable → the whole card applies on click; locked → a static card with a "Connect X"
          // CTA that jumps to the Providers tab (a disabled button would swallow that click).
          return ok ? (
            <button key={id} type="button" className={`packcard${on ? ' on' : ''}`} disabled={busy !== null} onClick={() => void apply(id)}>{inner}</button>
          ) : (
            <div key={id} className="packcard off">
              {inner}
              <button type="button" className="packconnect" onClick={() => onConnect?.(miss[0]!)}>Connect {miss.map(provName).join(' + ')} →</button>
            </div>
          );
        })}
        {/* custom brains — a div card (Apply/Edit are separate buttons, never nested) */}
        {custom.map((cp) => {
          const ok = rolesActivatable(cp.roles, enabled);
          const miss = missingProvidersForRoles(cp.roles, enabled);
          const on = active === cp.id;
          return (
            <div key={cp.id} className={`packcard${on ? ' on' : ''}${ok ? '' : ' off'}`}>
              <div className="packcardtop">
                <span className="packname">{cp.name}</span>
                {badge(on, ok)}
              </div>
              <div className="packtag">Custom · yours</div>
              <PackRoster roles={cp.roles} />
              {busy === cp.id && <div className="packneeds">Applying…</div>}
              <div className="packcardacts">
                {ok && !on && <button type="button" className="packmini primary" disabled={busy !== null} onClick={() => void apply(cp.id)}>Apply</button>}
                {!ok && <button type="button" className="packconnect" style={{ marginTop: 0 }} onClick={() => onConnect?.(miss[0]!)}>Connect {miss.map(provName).join(' + ')} →</button>}
                <button type="button" className="packmini" onClick={() => setBuilder({ edit: cp })}>Edit</button>
              </div>
            </div>
          );
        })}
        <button type="button" className="packcard newbrain" onClick={() => setBuilder({ edit: null })}>
          <span className="packname">＋ New custom brain</span>
          <span className="packtag">Pick a model per role, name it, activate it — yours to tune.</span>
        </button>
      </div>
      {builder && (
        <BrainBuilder
          initial={builder.edit}
          seedRoles={resolvePackRoles(active, custom) ?? PACKS['balanced']!.roles}
          enabled={enabled}
          onClose={() => setBuilder(null)}
          onDone={() => { setBuilder(null); window.dispatchEvent(new Event('nm:brains-changed')); }}
        />
      )}
    </div>
  );
}
