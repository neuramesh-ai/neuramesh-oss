// A2A 1.0 Agent Card (docs/03 §4). Generated from an agent row at registration
// and stored in agents.card, served read-only for discovery and shown in the
// roster. The x-neuramesh extension carries our routing facts (machine, runtime,
// channels, repos, role); the review extension lets external agents opt into our
// work→review→done round-trip. No secrets — only what's already team-visible.

export const A2A_REVIEW_EXTENSION = 'https://neuramesh.app/a2a/ext/review/v1';

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface AgentCard {
  name: string;
  description: string;
  version: string;
  url: string;
  capabilities: { streaming: boolean; pushNotifications: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ASkill[];
  securitySchemes: Record<string, { type: string; scheme: string }>;
  extensions: string[];
  'x-neuramesh': {
    agentId: string;
    role: string;
    runtime: string;
    model: string;
    machine: string | null;
    channels: string[];
    repos: string[];
    kind: 'local' | 'remote';
  };
}

// role → the A2A skill the agent advertises (skill matching = card skills ∩ task
// requirements). Keep terse; the description is what an external orchestrator reads.
const ROLE_SKILL: Record<string, A2ASkill> = {
  developer: { id: 'code-implementation', name: 'Code implementation', description: 'Implements code changes in a worktree with tests, diffs, and screenshots as evidence.', tags: ['code', 'implementation', 'tests'] },
  worker: { id: 'task-execution', name: 'Task execution', description: 'Executes a scoped board task and submits artifacts for review.', tags: ['execution', 'artifacts'] },
  reviewer: { id: 'code-review', name: 'Code review', description: 'Reviews delivered artifacts against the requirements and approves or requests changes.', tags: ['review', 'quality'] },
  orchestrator: { id: 'orchestration', name: 'Orchestration', description: 'Decomposes requests into board tasks and fans them out to matched agents.', tags: ['orchestration', 'routing'] },
  architect: { id: 'planning', name: 'Implementation planning', description: 'Drafts implementation plans (mixture-of-agents) for review before execution.', tags: ['planning', 'design'] },
  designer: { id: 'design', name: 'Design', description: 'Produces UI/visual deliverables with rendered evidence.', tags: ['design', 'ui'] },
  curator: { id: 'skill-curation', name: 'Skill curation', description: 'Imports and curates the team skill library (skill packs).', tags: ['skills', 'curation'] },
  sales: { id: 'sales', name: 'Sales', description: 'Sales and go-to-market tasks.', tags: ['sales'] },
  shipper: { id: 'release-readiness', name: 'Release readiness', description: 'Studies reviewer-approved changes, drafts production-readiness plans with owner-tagged checklists, and coordinates the release through merge.', tags: ['release', 'deploy', 'shipping'] },
};

const ROLE_DESC: Record<string, string> = {
  developer: 'NeuraMesh developer agent — implements board tasks in a worktree and submits artifacts.',
  worker: 'NeuraMesh worker agent — executes scoped tasks and submits artifacts.',
  reviewer: 'NeuraMesh reviewer agent — gates done against the requirements.',
  orchestrator: 'NeuraMesh orchestrator — owns a channel, decomposes requests, and fans out work.',
  architect: 'NeuraMesh architect — drafts implementation plans for review.',
  designer: 'NeuraMesh designer agent — UI/visual deliverables with evidence.',
  curator: 'NeuraMesh curator — manages the team skill library.',
  sales: 'NeuraMesh sales agent.',
  shipper: 'NeuraMesh shipper — production-readiness plans and release coordination for approved work.',
};

export interface AgentCardInput {
  agentId: string;
  name: string;
  role: string;
  runtime: string;
  model: string;
  machine?: string | null;
  channels: string[];
  repos?: string[];
  kind?: 'local' | 'remote';
  baseUrl?: string; // logical identity base; the card's own canonical URL
  // This agent's own routing description (agents.description) — what it does and when to
  // route work to it. A2A calls this the field a client agent reads "to determine an
  // agent's suitability", which is exactly what it is here; the ROLE_DESC default only
  // says what the ROLE is, so a card without it advertises a job title, not an agent.
  description?: string | null;
}

export function buildAgentCard(input: AgentCardInput): AgentCard {
  const base = input.baseUrl ?? 'https://neuramesh.app';
  const skill = ROLE_SKILL[input.role] ?? { id: input.role, name: input.role, description: `NeuraMesh ${input.role} agent.`, tags: [input.role] };
  return {
    name: input.name,
    description: input.description?.trim() || ROLE_DESC[input.role] || `NeuraMesh ${input.role} agent.`,
    version: '1.0.0',
    url: `${base}/a2a/agents/${input.agentId}`,
    capabilities: { streaming: true, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json', 'image/png'],
    skills: [{ ...skill, inputModes: ['text/plain'], outputModes: ['text/plain', 'application/json', 'image/png'] }],
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    extensions: [A2A_REVIEW_EXTENSION],
    'x-neuramesh': {
      agentId: input.agentId,
      role: input.role,
      runtime: input.runtime,
      model: input.model,
      machine: input.machine ?? null,
      channels: input.channels,
      repos: input.repos ?? [],
      kind: input.kind ?? 'local',
    },
  };
}
