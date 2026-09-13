// The onboarding wizard's pure state machine (the mobile-cloud round S6, D16) — the browser
// wizard's order, guards and provisioning, as data and functions rather than a component.
//
// The desktop's views/Onboarding.tsx holds this in React state and refs, and the browser's
// webnm-onboard.ts holds the provisioning in a closure; the phone is the third client and would
// have been a third copy of "which step can continue" and "which commands launch a crew". So the
// rules live here: the step order and its labels, the resume rule (an abandoned wizard whose
// workspace was already minted starts at step 2, never mints a second one), the guards per step,
// the pack recommendation, the crew seeded from that pack, and the ordered command list a Launch
// posts. A client keeps the state, renders it, and posts the commands — nothing more.
import { defaultDescription } from './agentdesc';
import type { HumanCommandInput } from './commands';
import { defaultPackForProviders, isPackActivatable, packModelForRole, resolvePackRoles, runtimeForModel, type Provider } from './model-packs';
import type { AgentRole } from './states';

export const WIZARD_STEPS = ['workspace', 'machine', 'keys', 'team', 'launch'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
export const WIZARD_LABEL: Record<WizardStep, string> = { workspace: 'Workspace', machine: 'Machine', keys: 'Keys', team: 'Team', launch: 'Launch' };

/** the rooms a new workspace is born with (the desktop's DEFAULT_CHANNELS — pgstore seeds the same four) */
export const WIZARD_CHANNELS = ['general', 'build', 'research', 'marketing'] as const;

/** the starter crew: rex + the desktop's DEFAULT_TEAM, faces from its persona table (bosun's from the seat) */
export const STARTER_CREW: ReadonlyArray<{ role: AgentRole; name: string; emoji: string }> = [
  { role: 'orchestrator', name: 'rex', emoji: '🦊' },
  { role: 'designer', name: 'iris', emoji: '🦋' },
  { role: 'architect', name: 'atlas', emoji: '🦫' },
  { role: 'developer', name: 'patch', emoji: '🦉' },
  { role: 'reviewer', name: 'scout', emoji: '🐝' },
  { role: 'shipper', name: 'bosun', emoji: '🦭' },
];

export type ProviderMode = 'none' | 'subscription' | 'apikey';
export interface WizardProvider { provider: Provider; mode: ProviderMode; key: string }
export interface WizardCrewMember { role: AgentRole; name: string; emoji: string; model: string }

export interface WizardState {
  /** 1-based, so the ring and the desktop's harness driver read the same number */
  step: number;
  /** minted at the Workspace step — the id the fleet provisions the cloud machine against */
  workspaceId: string | null;
  name: string;
  slug: string;
  /** once the human edits the address it is theirs; the name stops driving it */
  slugEdited: boolean;
  providers: WizardProvider[];
  /** an explicit pack choice (the starter door); null = the recommendation for the ready providers */
  pack: string | null;
  crew: WizardCrewMember[];
  /** the Launch step's guard: the crew registered once, never twice on a Back/forward bounce */
  launched: boolean;
}

/** a friendly suggested workspace name so the field is never blank — one keystroke to replace, a tap to tweak */
export const WS_ADJ = ['Cobalt', 'Crimson', 'Lumen', 'Vertex', 'Quartz', 'Aurora', 'Onyx', 'Cedar', 'Atlas', 'Nimbus', 'Ember', 'Slate', 'Halcyon', 'Zenith', 'Indigo', 'Cinder', 'Harbor', 'Meridian', 'Summit', 'Vesper', 'Solstice', 'Basalt', 'Polar', 'Lunar', 'Sable', 'Copper'];
export const WS_NOUN = ['Labs', 'Works', 'Forge', 'Studio', 'Robotics', 'Systems', 'Dynamics', 'Collective', 'Foundry', 'Industries', 'Atelier', 'Workshop', 'Loop', 'Mesh', 'Guild', 'Engine', 'Yard', 'Union', 'Lab', 'Co'];
export const randomWorkspaceName = (): string => `${WS_ADJ[Math.floor(Math.random() * WS_ADJ.length)]!} ${WS_NOUN[Math.floor(Math.random() * WS_NOUN.length)]!}`;

/** preview the slug the server derives from a name (the desktop's slugifyName; the server still resolves collisions) */
export function workspaceSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function initialWizard(input: { name: string; resumeWorkspaceId?: string | null }): WizardState {
  const resume = input.resumeWorkspaceId ?? null;
  return {
    // resuming skips the Workspace step: its whole job is done, and re-running it would mint a
    // duplicate (the browser's resumeWorkspaceId rule — the workspace is this wizard's FIRST step)
    step: resume ? 2 : 1,
    workspaceId: resume,
    name: input.name,
    slug: workspaceSlug(input.name),
    slugEdited: false,
    providers: [{ provider: 'anthropic', mode: 'none', key: '' }, { provider: 'openai', mode: 'none', key: '' }, { provider: 'gemini', mode: 'none', key: '' }],
    pack: null,
    crew: STARTER_CREW.map((c) => ({ ...c, model: '' })),
    launched: false,
  };
}

export function wizardStep(s: WizardState): WizardStep {
  return WIZARD_STEPS[Math.min(Math.max(s.step, 1), WIZARD_STEPS.length) - 1]!;
}

/** a provider is ready with a subscription INTENT (the machine signs in later, through its terminal) or a key */
export function providerReady(p: WizardProvider): boolean {
  return p.mode === 'subscription' || (p.mode === 'apikey' && p.key.trim().length > 0);
}

export function readyProviders(s: WizardState): Array<{ provider: Provider; mode: 'subscription' | 'apikey'; key: string }> {
  return s.providers.filter(providerReady).map((p) => ({ provider: p.provider, mode: p.mode === 'subscription' ? 'subscription' : 'apikey', key: p.key.trim() }));
}

/** the pack the crew runs on: the explicit choice if the ready providers can serve it, else the recommendation */
export function wizardPack(s: WizardState): string {
  const enabled = readyProviders(s).map((p) => p.provider);
  return s.pack && isPackActivatable(s.pack, enabled) ? s.pack : defaultPackForProviders(enabled);
}

/** every crew member on the pack's brain for their role (the phone has no per-seat picker, so the pack always seeds) */
export function seedCrew(s: WizardState): WizardState {
  const pack = wizardPack(s);
  return { ...s, crew: s.crew.map((c) => ({ ...c, model: packModelForRole(pack, c.role) ?? c.model })) };
}

export function wizardCanContinue(s: WizardState): boolean {
  switch (wizardStep(s)) {
    case 'workspace': return workspaceSlug(s.slug).length >= 2 && s.name.trim().length > 0;
    // the machine never blocks: provisioning began at the Workspace step and Launch absorbs the rest
    case 'machine': return true;
    // keys are never a gate — the starter brain answers with nothing connected
    case 'keys': return true;
    case 'team': return s.crew.every((c) => c.name.trim().length >= 1 && !!c.model);
    case 'launch': return s.launched;
  }
}

export function wizardNext(s: WizardState): WizardState {
  return { ...s, step: Math.min(s.step + 1, WIZARD_STEPS.length) };
}

/** Back never returns to a Workspace step whose workspace exists — that step is done, not pending */
export function wizardBack(s: WizardState): WizardState {
  return { ...s, step: Math.max(s.step - 1, s.workspaceId ? 2 : 1) };
}

export function setWizardName(s: WizardState, name: string): WizardState {
  return { ...s, name, slug: s.slugEdited ? s.slug : workspaceSlug(name) };
}

export function setWizardSlug(s: WizardState, slug: string): WizardState {
  return { ...s, slug: slug.toLowerCase().replace(/[^a-z0-9-]/g, '-'), slugEdited: true };
}

export function setWizardProvider(s: WizardState, provider: Provider, patch: Partial<Pick<WizardProvider, 'mode' | 'key'>>): WizardState {
  return { ...s, providers: s.providers.map((p) => (p.provider === provider ? { ...p, ...patch } : p)) };
}

export function setWizardCrewName(s: WizardState, index: number, name: string): WizardState {
  return { ...s, crew: s.crew.map((c, i) => (i === index ? { ...c, name } : c)) };
}

/** the commands a Launch posts, in order — exactly the browser's onboardOverrides: the pack on the
 *  workspace, the credential intents and keys, the crew registered against the CLOUD machine (the
 *  orchestrator in every room, the pod in general + build), then the host-managed curator seat. A
 *  refusal on the workspace.update or a seat must not fail the launch; the client decides that. */
export function launchCommands(s: WizardState, workspaceId: string, machineId: string): HumanCommandInput[] {
  const pack = wizardPack(s);
  const out: HumanCommandInput[] = [{ type: 'workspace.update', workspace: workspaceId, activeModelPack: pack }];
  for (const p of readyProviders(s)) {
    out.push(p.mode === 'subscription'
      ? { type: 'credential.set', workspace: workspaceId, provider: p.provider, scope: 'workspace', authMode: 'subscription' }
      : { type: 'credential.set', workspace: workspaceId, provider: p.provider, scope: 'workspace', authMode: 'apikey', token: p.key });
  }
  const fallback = packModelForRole(pack, 'orchestrator') ?? 'claude-opus-4-8';
  for (const c of s.crew) {
    const model = c.model || packModelForRole(pack, c.role) || fallback;
    const description = defaultDescription(c.role);
    out.push({
      type: 'agent.register', workspace: workspaceId, machineId,
      name: c.name.trim().toLowerCase() || c.role, role: c.role, model, runtime: runtimeForModel(model), emoji: c.emoji,
      ...(description ? { description } : {}),
      channels: c.role === 'orchestrator' ? [...WIZARD_CHANNELS] : ['general', 'build'],
    });
  }
  const curator = resolvePackRoles(pack, [])?.curator;
  if (curator) out.push({ type: 'agent.register', workspace: workspaceId, machineId, name: 'curator', role: 'curator', model: curator, runtime: runtimeForModel(curator), channels: ['build'] });
  return out;
}
