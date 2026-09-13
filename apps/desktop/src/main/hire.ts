// The hire ladder's copy and shapes — role list, name rule, and the card the human answers.
// Split out of seed.ts.


// ── Orchestrator hiring (human-gated agent creation) ────────────────────────
// The orchestrator may staff its room, but never silently: it posts the hire
// card, the human clicks (or replies), and only then does an agent.register go
// out. Never orchestrator (auto-joins every channel in the workspace) and never
// curator (a host-managed workspace singleton).
export const HIREABLE_ROLES = ['worker', 'developer', 'reviewer', 'architect', 'designer', 'sales', 'shipper', 'marketer'] as const;

// mirrors the agent.register name constraint in control-api commands.ts
export const AGENT_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;

export const hireQuestion = (chanSlug: string, taskNumber?: number): string =>
  `Hire a new agent for #${chanSlug}${taskNumber ? ` to take #${taskNumber}` : ''}?`;

export const hireAcceptLabel = (name: string, role: string): string => `Hire @${name} (${role})`;

export const HIRE_DECLINE_LABEL = 'Not now';
