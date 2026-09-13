// Agent contracts — the authoritative statement of how an agent behaves, and the pure half of
// reading one.
//
// The contracts themselves are YAML (defaults/agents/*.yaml) and they are the DELIVERABLE: a
// reviewed, diffable statement of behaviour, carrying the status docs/33 carries for design. This
// module owns their SHAPE and the two pure operations on them — substitution and precedence — so
// both are unit-testable without a filesystem. The fs layer lives in the daemon (main/contracts.ts).
//
// Why this exists at all: the orchestrator's channel prompt was a 14,559-character template
// literal inside a 9,292-line file. Changing behaviour meant hunting backticks — and a nested
// backtick in a prompt string broke the build once. Behaviour that cannot be read cannot be
// reviewed.

/** One agent's contract, as authored in YAML. */
export interface AgentContract {
  version: number;
  role: string;
  /** the routing string — SYNCED, because other agents and the A2A card read it */
  description?: string;
  /** the standing rules — MACHINE-LOCAL, because they govern how this host behaves */
  instructions?: string;
  /** prompt templates, substituted per turn */
  prompt?: Record<string, string>;
}

/**
 * Substitute `${name}` placeholders from `vars`.
 *
 * An UNKNOWN placeholder is left intact rather than blanked. That is deliberate: a typo'd
 * variable then shows up as a literal `${wrongName}` in the prompt — visible, greppable, and
 * fixable — where blanking it would silently delete whichever rule it sat inside, and the only
 * symptom would be an agent quietly not doing something.
 */
export function composePrompt(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\$\{([A-Za-z_$][\w$.]*)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? (vars[name] ?? '') : whole);
}

/**
 * Which instructions govern this agent, on THIS machine.
 *
 * Precedence — local file › synced baseline › shipped contract (founder ruling 2026-08-06,
 * docs/design/agent-instructions-and-task-policy-2026-08 §B.1):
 *
 *  · `local`    — what this machine's user wrote in the agent overlay. Always wins, silently.
 *                 Local-first means the agent running HERE behaves how this machine says, and a
 *                 configured machine is not a conflict to be reconciled.
 *  · `baseline` — `agents.brief`, synced. What the orchestrator wrote at hire, and what a fresh
 *                 machine inherits before anyone has configured it.
 *  · `shipped`  — the contract's own `instructions`, the factory floor.
 *
 * Blank-but-present is NOT a value: a user who clears the field is asking for the layer below,
 * not for an agent with no instructions at all.
 */
export function resolveInstructions(layers: {
  local?: string | null;
  baseline?: string | null;
  shipped?: string | null;
}): string | null {
  for (const v of [layers.local, layers.baseline, layers.shipped]) {
    const t = (v ?? '').trim();
    if (t) return t;
  }
  return null;
}

/** Has this machine's user diverged from the layer beneath? (drives the overlay's Reset state) */
export function isLocalOverride(local?: string | null, beneath?: string | null): boolean {
  const l = (local ?? '').trim();
  return !!l && l !== (beneath ?? '').trim();
}
