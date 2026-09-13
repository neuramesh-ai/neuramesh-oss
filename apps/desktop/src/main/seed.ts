// Pure agent-planning decision tables — boot seeds AND orchestrator hires.
// Boot-time designer seed (docs/14 rollout): workspaces onboarded before v0.11
// never seeded a designer, so the design gate dead-ends for them (request_design
// finds nobody). Given the synced facts, plan the agent.register payload — or
// the reason to stand down. Pure, so the decision table is unit-testable
// without the sync harness; the caller (startSync's dev-channel backfill) posts
// the returned command exactly like the curator seed above it.
// The hire half (planAgentHire + the card/regex constants below) is the same
// idea for the orchestrator's human-gated hiring flow: live prompt, echo stub,
// the channel-watch confirm regex, and the tests all import THIS module, so the
// card the LLM is told to emit, the card echo posts, and the line the confirm
// watch parses can never drift apart.
import { runtimeForModel, ROLE_DESCRIPTION, defaultDescription, type AgentRole } from '@neuramesh/shared';
import { HIREABLE_ROLES } from './hire';

export interface DesignerSeedFacts {
  /** any role='designer' agent already in the workspace (any machine) */
  hasDesigner: boolean;
  /** role of an existing agent named 'iris', or null — register upserts by
   * name WITHOUT changing role, so seeding over a human's same-named agent
   * would silently repoint it; we never do that */
  irisRole: string | null;
  /** the ACTIVE pack's role→model map (builtin or custom brain, resolved by the
   * caller via resolvePackRoles), or null when the workspace is unmanaged */
  packRoles: Record<AgentRole, string> | null;
  workspace: string;
  machineId: string;
  /** the #dev room to register into (mirrors the curator seed's scope) */
  channelId: string;
}

export type DesignerSeedPlan =
  | { action: 'register'; cmd: Record<string, unknown> }
  | { action: 'skip'; reason: string };

export function planDesignerSeed(f: DesignerSeedFacts): DesignerSeedPlan {
  if (f.hasDesigner) return { action: 'skip', reason: 'the workspace already has a designer' };
  if (f.irisRole) {
    return {
      action: 'skip',
      reason: `an agent named "iris" already exists (role: ${f.irisRole}) — never repoint a human's agent; add a designer from the Agents view`,
    };
  }
  // pack-aware brain so a single-provider workspace gets a designer it can run;
  // an unmanaged workspace (no pack roles) falls back to the server default.
  const model = f.packRoles?.designer ?? null;
  return {
    action: 'register',
    cmd: {
      type: 'agent.register',
      workspace: f.workspace,
      machineId: f.machineId,
      name: 'iris',
      role: 'designer',
      emoji: '🦋',
      description: ROLE_DESCRIPTION.designer,
      channels: [f.channelId],
      ...(model ? { model, runtime: runtimeForModel(model) } : {}),
    },
  };
}

// Boot-time shipper seed (docs/23 rollout): workspaces onboarded before the ship
// stage never seeded a shipper, so the release gate would dead-end for them (a
// reviewer-approved PR task waits with nobody to claim ship prep). Same doctrine
// as the designer seed above: existence-check first, pack-aware brain, and NEVER
// repoint a human's same-named agent.
export interface ShipperSeedFacts {
  /** any role='shipper' agent already in the workspace (any machine, retired included —
   * a retirement is a human call the seed must not resurrect) */
  hasShipper: boolean;
  /** role of an existing agent named 'bosun', or null */
  bosunRole: string | null;
  packRoles: Record<AgentRole, string> | null;
  workspace: string;
  machineId: string;
  channelId: string;
}

export type ShipperSeedPlan =
  | { action: 'register'; cmd: Record<string, unknown> }
  | { action: 'skip'; reason: string };

export function planShipperSeed(f: ShipperSeedFacts): ShipperSeedPlan {
  if (f.hasShipper) return { action: 'skip', reason: 'the workspace already has a shipper' };
  if (f.bosunRole) {
    return {
      action: 'skip',
      reason: `an agent named "bosun" already exists (role: ${f.bosunRole}) — never repoint a human's agent; add a shipper from the Agents view`,
    };
  }
  // old custom brains predate the shipper seat — fall back to the developer seat
  // (the same defensive fallback pack-apply uses) rather than a stranded provider.
  const model = f.packRoles?.shipper ?? f.packRoles?.developer ?? null;
  return {
    action: 'register',
    cmd: {
      type: 'agent.register',
      workspace: f.workspace,
      machineId: f.machineId,
      name: 'bosun',
      role: 'shipper',
      emoji: '🦭',
      description: ROLE_DESCRIPTION.shipper,
      brief: 'Production-readiness plans and release coordination: study the approved change, surface every manual prod step with its owner, and merge only when the checklist clears.',
      channels: [f.channelId],
      ...(model ? { model, runtime: runtimeForModel(model) } : {}),
    },
  };
}

// Boot-time marketer seed (marketing-channel plan §4.4): a marketing-kind room needs
// its crew — plume 🦚 seeds into it the way bosun seeds with the ship gate. Same
// doctrine: existence-check first, pack-aware brain, NEVER repoint a human's agent.
export interface MarketerSeedFacts {
  /** any role='marketer' agent already in the workspace (retired included — a
   * retirement is a human call the seed must not resurrect) */
  hasMarketer: boolean;
  /** role of an existing agent named 'plume', or null */
  plumeRole: string | null;
  packRoles: Record<AgentRole, string> | null;
  workspace: string;
  machineId: string;
  channelId: string;
}

export type MarketerSeedPlan =
  | { action: 'register'; cmd: Record<string, unknown> }
  | { action: 'skip'; reason: string };

export function planMarketerSeed(f: MarketerSeedFacts): MarketerSeedPlan {
  if (f.hasMarketer) return { action: 'skip', reason: 'the workspace already has a marketer' };
  if (f.plumeRole) {
    return {
      action: 'skip',
      reason: `an agent named "plume" already exists (role: ${f.plumeRole}) — never repoint a human's agent; add a marketer from the Agents view`,
    };
  }
  // custom brains may predate the marketer seat — fall back designer → developer
  // (the shipper seed's defensive idiom) rather than a stranded provider.
  const model = f.packRoles?.marketer ?? f.packRoles?.designer ?? f.packRoles?.developer ?? null;
  return {
    action: 'register',
    cmd: {
      type: 'agent.register',
      workspace: f.workspace,
      machineId: f.machineId,
      name: 'plume',
      role: 'marketer',
      emoji: '🦚',
      description: ROLE_DESCRIPTION.marketer,
      brief: 'Brand and growth: study the product and its market for real, write the brand docs, draft platform-native content in the brand voice — and never publish anything; humans approve everything outbound.',
      channels: [f.channelId],
      ...(model ? { model, runtime: runtimeForModel(model) } : {}),
    },
  };
}

export type HireableRole = (typeof HIREABLE_ROLES)[number];
export interface AgentHireFacts {
  /** proposed agent name — trimmed + lowercased, then AGENT_NAME_RE-validated */
  name: string;
  /** proposed role — must be one of HIREABLE_ROLES (checked here too: the
   * deterministic confirm path calls this without a zod gate in front) */
  role: string;
  /** the ROUTING string (0110): what this agent does + when to route work here.
   * Read by the orchestrator in list_agents and published on the A2A card, so a
   * hire without one lands as a job title the next staffing turn cannot tell apart
   * from every other agent of that role. Derived from the brief when unset. */
  description?: string | null;
  /** the INSTRUCTIONS: how this agent works, injected into every turn it takes */
  brief?: string | null;
  /** the workspace's existing agent with this name, if any */
  existing: { role: string; retired: boolean; inChannel: boolean } | null;
  /** the ACTIVE pack's role→model map (builtin or custom brain), or null when unmanaged */
  packRoles: Record<AgentRole, string> | null;
  /** the hiring orchestrator's own brain — the proven-working fallback */
  orchestrator: { model: string; runtime: string };
  workspace: string;
  machineId: string;
  channelId: string;
}

export type AgentHirePlan =
  | { action: 'register'; rehire: boolean; model: string; runtime: string; cmd: Record<string, unknown> }
  | { action: 'add_to_channel'; reason: string }
  | { action: 'refuse'; reason: string };

/**
 * The routing description for a hire, derived from the brief when the orchestrator didn't
 * write one — the same split migration 0110 applies to existing rows, kept here so a hire
 * through the deterministic confirm path (which has no LLM turn to ask) still lands routable.
 *
 * Every brief the orchestrator writes is already both strings glued together: a capability
 * clause, then behaviour ("Production-readiness plans and release coordination: study the
 * approved change…"). Take the clause before the first ':' or '.', require enough of it that
 * an abbreviation can't produce a two-word description, and cap at the server's 280.
 */
export const DESCRIPTION_MAX = 280;
export function descriptionFor(description?: string | null, brief?: string | null, role?: string | null): string | null {
  const given = (description ?? '').trim();
  if (given) return given.slice(0, DESCRIPTION_MAX);
  const b = (brief ?? '').trim();
  if (b) {
    const clause = /^([^:.]{8,})[:.](\s|$)/.exec(b)?.[1]?.trim();
    return (clause || b).slice(0, DESCRIPTION_MAX);
  }
  // neither: the role's default, so a hire with no remit still LISTS as something rather than
  // as a bare role name the next staffing turn cannot tell from any other agent of that role
  return role ? defaultDescription(role) : null;
}
