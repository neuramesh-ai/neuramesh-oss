// INTAKE (round 9, 2026-11-06): the structured decision taken on a thread's first human message.
//
// nm-api asks the NeuraMesh starter brain for it, so intake is fast and does not depend on the model
// the person connected. The decision is stored on `threads.intake` (0177) and drives the deterministic
// effects: the title, the thread kind, the workspace (a worktree of a repository, or a local scratch
// workspace when the project has no repository), and the first visible plan line. The person's selected
// agent then does the work, with the decision in its context.
//
// This file is the CONTRACT between the intake service (control-api), the coding runtime (machined)
// and the clients (hq, desktop). Change it only together with all three.

/** What kind of work the ask is. `coding` is anything that builds, changes or fixes software. */
export const INTAKE_KINDS = ['chat', 'question', 'coding', 'content', 'research', 'board'] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

/** Which workspace the work needs. `none` for a plain answer. */
export const INTAKE_WORKSPACES = ['none', 'scratch', 'repo'] as const;
export type IntakeWorkspace = (typeof INTAKE_WORKSPACES)[number];

/** For a coding thread: a worktree of a project repository, or a local scratch workspace. */
export const WORKSPACE_MODES = ['repo', 'scratch'] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export interface IntakeSubtask {
  title: string;
  /** the team role best placed to do it, when the ask splits across roles */
  role?: string | null;
}

export interface IntakeDecision {
  /** schema version of this object */
  v: 1;
  kind: IntakeKind;
  /** 0 to 1. A coding route needs CODING_MIN_CONFIDENCE, or a hit of the deterministic build rule */
  confidence: number;
  /** the thread title, at most 60 characters, plain words */
  title: string;
  /** a short kebab-case name for the ask (the scratch workspace directory and the branch), at most 40 characters */
  name: string;
  /** 2 to 5 short steps, in the order the agent will do them */
  plan: string[];
  /** empty when one agent does the whole ask */
  subtasks: IntakeSubtask[];
  workspace: IntakeWorkspace;
  /** the project repository the work belongs to, when workspace is `repo` */
  repoId?: string | null;
  /** who decided: the starter brain, the deterministic rule only (the brain was unavailable), or an agent */
  source: 'starter' | 'rule' | 'agent';
  /** the model that decided, for the log */
  model?: string | null;
  /** milliseconds from the message to the decision */
  ms?: number | null;
}

/** Below this, a coding guess with no rule hit stays a conversation, and the selected agent decides. */
export const CODING_MIN_CONFIDENCE = 0.6;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Read a stored decision off a replica row (text) or an API payload (object). Null when absent or malformed. */
export function intakeOf(value: unknown): IntakeDecision | null {
  let v: unknown = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!isObj(v) || v['v'] !== 1) return null;
  if (!(INTAKE_KINDS as readonly unknown[]).includes(v['kind'])) return null;
  if (!(INTAKE_WORKSPACES as readonly unknown[]).includes(v['workspace'])) return null;
  if (typeof v['title'] !== 'string' || typeof v['name'] !== 'string' || !Array.isArray(v['plan'])) return null;
  return v as unknown as IntakeDecision;
}

export function workspaceModeOf(value: unknown): WorkspaceMode | null {
  return value === 'repo' || value === 'scratch' ? value : null;
}
