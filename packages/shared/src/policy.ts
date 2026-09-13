// Permission policy: the deterministic gate that decides whether an agent action is
// allowed, denied, or must ask a human. Pure (the states.ts / execpolicy.ts idiom) so
// the whole allow/ask/deny decision is unit-testable without a host, and — crucially —
// so enforcement is plain code with no model in the path. The invariant this encodes:
// an agent's *intent* is governed by rules the agent cannot talk its way past. A
// prompt-injected agent still cannot exceed its policy, because evaluatePolicy() is
// deterministic and the rules came from context the attacker never controlled.
//
// The sandbox (containment plan L1) is the complementary hard floor: it makes a `deny`
// physically binding. This module decides the verdict; the runtime + sandbox enforce it.
import { z } from 'zod';

// ── Capabilities: the classes of action an agent takes ───────────────────────
export const POLICY_CAPABILITIES = [
  'fs.read',
  'fs.write',
  'shell.exec',
  'net.egress',
  'pkg.install',
  'tool.mcp',
  'vcs.push',
] as const;
export type PolicyCapability = (typeof POLICY_CAPABILITIES)[number];

// ── Verdicts, ordered least→most restrictive (index = restrictiveness) ───────
export const POLICY_VERDICTS = ['allow', 'ask', 'deny'] as const;
export type PolicyVerdict = (typeof POLICY_VERDICTS)[number];
const RESTRICTIVENESS: Record<PolicyVerdict, number> = { allow: 0, ask: 1, deny: 2 };

// ── Scopes, ordered least→most specific (a task rule beats a workspace rule) ──
export const POLICY_SCOPES = ['workspace', 'project', 'channel', 'agent', 'task'] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];
const SPECIFICITY: Record<PolicyScope, number> = {
  workspace: 0,
  project: 1,
  channel: 2,
  agent: 3,
  task: 4,
};

// ── Shell command classes (what classifyShellCommand buckets a command into) ──
export const SHELL_CLASSES = ['build', 'test', 'vcs', 'network', 'destructive', 'pipe-to-shell', 'other'] as const;
export type ShellClass = (typeof SHELL_CLASSES)[number];

// ── Selector: how a rule narrows within a capability (a small, ReDoS-free DSL) ─
export const PolicySelectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('any') }),
  z.object({ kind: z.literal('path'), glob: z.string().min(1) }),
  z.object({ kind: z.literal('host'), glob: z.string().min(1) }),
  z.object({ kind: z.literal('shellClass'), value: z.enum(SHELL_CLASSES) }),
  z.object({ kind: z.literal('tool'), name: z.string().min(1) }),
  z.object({ kind: z.literal('registry'), name: z.string().min(1) }),
  z.object({ kind: z.literal('flag'), name: z.string().min(1) }),
]);
export type PolicySelector = z.infer<typeof PolicySelectorSchema>;

// ── A rule ───────────────────────────────────────────────────────────────────
export const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(POLICY_SCOPES),
  capability: z.enum(POLICY_CAPABILITIES),
  selector: PolicySelectorSchema,
  verdict: z.enum(POLICY_VERDICTS),
  rationale: z.string().max(400).optional(),
  /** workspace hard invariant — evaluated first, cannot be overridden by any scope */
  locked: z.boolean().optional(),
});
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

// ── An action to evaluate (normalized descriptors the enforcer matches on) ────
export interface PolicyAction {
  capability: PolicyCapability;
  path?: string; // fs.read / fs.write
  host?: string; // net.egress
  command?: string; // shell.exec — raw, for the human-facing prompt
  shellClass?: ShellClass; // shell.exec — classified (see classifyShellCommand)
  tool?: string; // tool.mcp
  registry?: string; // pkg.install
  flags?: readonly string[]; // e.g. ['--force'] for vcs.push
}

// ── The decision evaluatePolicy returns ──────────────────────────────────────
export interface PolicyDecision {
  verdict: PolicyVerdict;
  rationale: string;
  /** the rule that fired, or null when the capability default was used */
  ruleId: string | null;
  source: 'locked' | 'rule' | 'default';
}

// Fallback when no rule matches. net.egress defaults to `ask` so an unknown host prompts
// (the allowlist model); shell/tool/push default to `ask` (safe); fs/pkg default to
// `allow` because the sandbox already confines *where* they can act.
export const DEFAULT_VERDICTS: Record<PolicyCapability, PolicyVerdict> = {
  'fs.read': 'allow',
  'fs.write': 'allow',
  'shell.exec': 'ask',
  'net.egress': 'allow', // allowed by default; the L1 sandbox egress proxy enforces the allowlist
  'pkg.install': 'allow',
  'tool.mcp': 'ask',
  'vcs.push': 'ask',
};

// ── Safe glob → RegExp (bounded; no nested quantifiers, so no catastrophic backtracking).
// Paths: `**` = any depth, `*` = one segment. Hosts: `*.` = any-subdomain suffix.
function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}
function pathGlobToRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob.charAt(i);
    if (ch === '*') {
      if (glob.charAt(i + 1) === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else {
      re += escapeRe(ch);
    }
  }
  return new RegExp('^' + re + '$');
}
export function matchPathGlob(path: string, glob: string): boolean {
  return pathGlobToRe(glob).test(path);
}
export function canonicalPolicyHost(value: string): string | null {
  const trimmed = value.trim().replace(/\.+$/, '');
  if (!trimmed) return null;
  try {
    const hostname = new URL(`http://${trimmed}`).hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '');
    return hostname || null;
  } catch { return null; }
}
export function matchHostGlob(host: string, glob: string): boolean {
  const h = canonicalPolicyHost(host);
  const wildcard = glob.trim().startsWith('*.');
  const g = canonicalPolicyHost(wildcard ? glob.trim().slice(2) : glob);
  if (!h || !g) return false;
  if (wildcard) {
    const suffix = `.${g}`;
    return h === g || h.endsWith(suffix);
  }
  return h === g;
}

// ── Selector match ────────────────────────────────────────────────────────────
export function matchesSelector(action: PolicyAction, sel: PolicySelector): boolean {
  switch (sel.kind) {
    case 'any':
      return true;
    case 'path':
      return action.path != null && matchPathGlob(action.path, sel.glob);
    case 'host':
      return action.host != null && matchHostGlob(action.host, sel.glob);
    case 'shellClass':
      return action.shellClass === sel.value;
    case 'tool':
      return action.tool === sel.name;
    case 'registry':
      return action.registry === sel.name;
    case 'flag':
      return action.flags != null && action.flags.includes(sel.name);
  }
}

// ── The gate. Locked invariants first, then most-specific-wins first-match, else default.
export function evaluatePolicy(action: PolicyAction, rules: readonly PolicyRule[]): PolicyDecision {
  const candidates = rules
    .filter((r) => r.capability === action.capability)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      // locked first, then most-specific scope, then stable by original order
      const la = a.r.locked ? 1 : 0;
      const lb = b.r.locked ? 1 : 0;
      if (la !== lb) return lb - la;
      const sa = SPECIFICITY[a.r.scope];
      const sb = SPECIFICITY[b.r.scope];
      if (sa !== sb) return sb - sa;
      return a.i - b.i;
    });

  for (const { r } of candidates) {
    if (matchesSelector(action, r.selector)) {
      return {
        verdict: r.verdict,
        rationale: r.rationale ?? defaultRationale(r.capability, r.verdict),
        ruleId: r.id,
        source: r.locked ? 'locked' : 'rule',
      };
    }
  }
  const verdict = DEFAULT_VERDICTS[action.capability];
  return { verdict, rationale: defaultRationale(action.capability, verdict), ruleId: null, source: 'default' };
}

function defaultRationale(cap: PolicyCapability, verdict: PolicyVerdict): string {
  if (verdict === 'ask') return `${cap} is set to ask — a human should confirm this action.`;
  if (verdict === 'deny') return `${cap} is denied by policy.`;
  return `${cap} is allowed by policy.`;
}

// ── Authoring guardrail: a child scope may tighten but not loosen a locked parent rule.
// Returns whether `child` verdict is permitted given a governing `parent` verdict.
export function canTighten(parentVerdict: PolicyVerdict, childVerdict: PolicyVerdict): boolean {
  return RESTRICTIVENESS[childVerdict] >= RESTRICTIVENESS[parentVerdict];
}

// ── Shell classifier: buckets a raw command so shell.exec rules can target a class.
// A heuristic, not a security boundary — the sandbox is the backstop for a misclassified
// command. Reliable on the security-relevant buckets (destructive, pipe-to-shell); loose
// on build/test. Normalizes whitespace and checks the leading verb + notable patterns.
const DESTRUCTIVE_RE = [
  /\brm\s+(?:[^|;&]*\s)?-{1,2}(?:[a-z]*[rf]|recursive|force)/i, // rm -rf, rm -r -f, rm -fr, rm --recursive/--force
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bchmod\s+-R\b/i,
  /\bchown\s+-R\b/i,
  /\b(dd|mkfs|shred|fdisk)\b/i,
  /\bsudo\b/i,
  /:\(\)\s*\{.*\}/, // fork bomb shape
  />\s*\/dev\/sd/i,
];
const PIPE_TO_SHELL_RE = /\b(curl|wget|fetch)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|python|node|ruby|perl)\b/i;
const NETWORK_RE = /\b(curl|wget|nc|ncat|netcat|ssh|scp|telnet|ftp)\b/i;
const BUILD_RE = /\b(build|compile|tsc|webpack|vite|make|cargo\s+build|go\s+build|gradle|mvn)\b/i;
// Test RUNNERS only — not the POSIX `test`/`[ ` conditional builtin (e.g. `test -f x`),
// which is an ordinary file check, not a test suite.
const TEST_RE = /\b(vitest|jest|pytest|mocha|rspec)\b|\b(cargo|go)\s+test\b|\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/i;
const VCS_RE = /\bgit\b|\bgh\b|\bhg\b/i;

export function classifyShellCommand(raw: string): ShellClass {
  const cmd = raw.trim();
  if (PIPE_TO_SHELL_RE.test(cmd)) return 'pipe-to-shell';
  for (const re of DESTRUCTIVE_RE) if (re.test(cmd)) return 'destructive';
  if (NETWORK_RE.test(cmd)) return 'network';
  if (TEST_RE.test(cmd)) return 'test';
  if (BUILD_RE.test(cmd)) return 'build';
  if (VCS_RE.test(cmd)) return 'vcs';
  return 'other';
}

// ── The default workspace baseline (matches the settings-UI mockup). Seeded on
// workspace creation; every rule is a row the human can change. ids are stable so
// re-seeding is idempotent and overrides bind predictably.
export function defaultBaselineRules(): PolicyRule[] {
  const ws = (
    id: string,
    capability: PolicyCapability,
    selector: PolicySelector,
    verdict: PolicyVerdict,
    rationale: string,
    locked = false,
  ): PolicyRule => ({ id: `base.${id}`, scope: 'workspace', capability, selector, verdict, rationale, locked });
  return [
    // hard invariants — cannot be loosened by any project/agent/task
    ws('deny-cred-stores', 'fs.read', { kind: 'path', glob: '**/.ssh/**' }, 'deny', 'Never read SSH keys.', true),
    ws('deny-aws', 'fs.read', { kind: 'path', glob: '**/.aws/**' }, 'deny', 'Never read cloud credentials.', true),
    ws('deny-pipe-to-shell', 'shell.exec', { kind: 'shellClass', value: 'pipe-to-shell' }, 'deny', 'Never pipe a download straight into a shell.', true),
    // filesystem
    ws('fs-write', 'fs.write', { kind: 'any' }, 'allow', 'Writes are confined to the task worktree by the sandbox.'),
    ws('fs-read', 'fs.read', { kind: 'any' }, 'allow', 'Reads are allowed; credential stores are hard-denied above.'),
    // shell
    ws('shell-destructive', 'shell.exec', { kind: 'shellClass', value: 'destructive' }, 'ask', 'Destructive commands need a human OK.'),
    ws('shell-build', 'shell.exec', { kind: 'shellClass', value: 'build' }, 'allow', 'Build commands are routine.'),
    ws('shell-test', 'shell.exec', { kind: 'shellClass', value: 'test' }, 'allow', 'Test commands are routine.'),
    ws('shell-network', 'shell.exec', { kind: 'shellClass', value: 'network' }, 'allow', 'Network commands are allowed; the sandbox egress proxy enforces the allowlist.'),
    ws('shell-vcs', 'shell.exec', { kind: 'shellClass', value: 'vcs' }, 'allow', 'git/gh commands are routine (push/PR run host-side).'),
    ws('shell-other', 'shell.exec', { kind: 'shellClass', value: 'other' }, 'allow', 'Ordinary commands are allowed.'),
    // network egress — allowed by default. The policy layer doesn't nag; the L1 sandbox egress
    // proxy is what enforces a host allowlist at the network layer. Flip this to ask/deny to restrict.
    ws('egress', 'net.egress', { kind: 'any' }, 'allow', 'Egress is allowed by default; the sandbox enforces the allowlist.'),
    // packages, tools, vcs
    ws('pkg', 'pkg.install', { kind: 'any' }, 'allow', 'Installing from allowlisted registries is allowed.'),
    ws('tool-unknown', 'tool.mcp', { kind: 'any' }, 'ask', 'Unknown tools need a human OK on first use.'),
    ws('vcs-force', 'vcs.push', { kind: 'flag', name: '--force' }, 'ask', 'Force-push needs a human OK.'),
  ];
}

// Merge persisted override rules on top of the code baseline: an override replaces the
// baseline rule targeting the same capability + selector (a persisted rule gets its own
// uuid, so we key by what it *targets*, not by id), and a rule targeting something new is
// appended. The daemon builds the effective rule list this way, so changing the code
// baseline updates every workspace automatically while human-authored overrides still win.
// The selector is canonicalized (sorted keys) so a jsonb round-trip can't reorder it out
// of a match.
function canon(v: unknown): string {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
function ruleSig(r: PolicyRule): string {
  return r.capability + ' ' + canon(r.selector);
}
export function mergePolicies(base: readonly PolicyRule[], overrides: readonly PolicyRule[]): PolicyRule[] {
  const bySig = new Map<string, PolicyRule>();
  for (const r of base) bySig.set(ruleSig(r), r);
  for (const o of overrides) bySig.set(ruleSig(o), o);
  return [...bySig.values()];
}
