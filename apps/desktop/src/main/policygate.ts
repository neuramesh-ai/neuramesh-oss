// Policy gate: the pure glue between a Claude tool call and the shared permission engine.
// Maps a tool call to a PolicyAction, evaluates it against the effective rules, and builds
// the ```nmq permission card the human answers on `ask`. Pure (the execpolicy idiom) so the
// mapping + verdict + card are unit-testable without the daemon; the I/O (reading the replica,
// posting the card, awaiting the answer) lives in the AgentHost closure that injects the gate.
// Run: pnpm exec tsx --test src/main/policygate.test.ts
import {
  classifyShellCommand,
  evaluatePolicy,
  PolicyRuleSchema,
  type PolicyAction,
  type PolicyRule,
  type PolicyVerdict,
} from '@neuramesh/shared';

// A shell token that reaches into a locked credential store (~/.ssh, ~/.aws). `cat ~/.ssh/id_rsa`
// would otherwise slip through as an ordinary shell command (classifyShellCommand → 'other' → allow),
// bypassing the locked fs.read deny that guards those paths for the Read tool. We map such a command
// to the fs.read it effectively is, so the same locked invariant fires. HEURISTIC, not a boundary:
// an obfuscated path evades it — the kernel FS sandbox (L1b) is the evasion-proof backstop. Matches a
// path CONTAINING `.ssh/`/`.aws/` (a real reach into the store), not a bare mention like `echo .ssh`.
const CRED_PATH_RE = /([^\s"'`|&;()]*\.(?:ssh|aws)\/[^\s"'`|&;()]*)/;
export function credStorePath(command: string): string | null {
  const m = CRED_PATH_RE.exec(command);
  return m ? m[1]! : null;
}

// The human-added protected paths the kernel sandbox should enforce: the target of every `fs.read`
// DENY rule with a path selector, as the HOME-relative dotpath or absolute path it guards (derived
// from the rule glob `**/<rel>/**`, `**/<rel>`, or `/abs/**`). computeFsJail already carries the
// structural credential-store floor, so this feeds it whatever ELSE a workspace chose to jail
// (e.g. `.config/gcloud`, a company secrets dir) — unifying the tool-gate policy with the sandbox.
export function protectedPathsFromRules(rules: readonly PolicyRule[]): string[] {
  const out: string[] = [];
  for (const r of rules) {
    if (r.capability !== 'fs.read' || r.verdict !== 'deny' || r.selector.kind !== 'path') continue;
    const g = r.selector.glob;
    const rel = /^\*\*\/(.+?)(?:\/\*\*)?$/.exec(g); // **/<rel>/** or **/<rel>
    if (rel && !rel[1]!.includes('*')) out.push(rel[1]!);
    else if (g.startsWith('/')) { const p = g.replace(/\/\*\*$/, ''); if (!p.includes('*')) out.push(p); }
  }
  return out;
}

// ── Claude tool call → PolicyAction (null = not gated: our own tools, todos, etc.) ──
export function toolCallToAction(toolName: string, input: Record<string, unknown>): PolicyAction | null {
  const s = (k: string): string | undefined => (typeof input[k] === 'string' ? (input[k] as string) : undefined);
  switch (toolName) {
    case 'Bash': {
      const command = s('command') ?? '';
      // a shell command reaching into ~/.ssh or ~/.aws is gated as the credential read it is, so the
      // locked deny catches the `cat ~/.ssh/id_rsa` bypass of the Read-tool guard.
      const cred = credStorePath(command);
      if (cred) return { capability: 'fs.read', path: cred };
      return { capability: 'shell.exec', command, shellClass: classifyShellCommand(command) };
    }
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { capability: 'fs.write', path: s('file_path') ?? s('notebook_path') };
    case 'Read':
    case 'NotebookRead':
      return { capability: 'fs.read', path: s('file_path') ?? s('notebook_path') };
    case 'Glob':
    case 'Grep':
      return { capability: 'fs.read', path: s('path') };
    case 'WebFetch':
      return { capability: 'net.egress', host: hostOf(s('url')) };
    default:
      if (toolName.startsWith('mcp__nm__')) return null; // our own trusted in-process tools
      if (toolName.startsWith('mcp__')) return { capability: 'tool.mcp', tool: toolName };
      return null; // WebSearch (Anthropic-managed), TodoWrite, and unknown tools are not gated here
  }
}

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

// ── Evaluate + attach a risk tier (drives the high-risk push in slice 4) ──
export interface GateOutcome {
  decision: PolicyVerdict;
  reason: string;
  risk: 'high' | 'low';
}

export function policyGateOutcome(action: PolicyAction, rules: readonly PolicyRule[]): GateOutcome {
  const d = evaluatePolicy(action, rules);
  return { decision: d.verdict, reason: d.rationale, risk: riskOf(action, d.verdict) };
}

function riskOf(action: PolicyAction, verdict: PolicyVerdict): 'high' | 'low' {
  if (verdict === 'deny') return 'high';
  if (action.capability === 'shell.exec' && (action.shellClass === 'destructive' || action.shellClass === 'pipe-to-shell')) return 'high';
  if (action.capability === 'vcs.push' || action.capability === 'net.egress') return 'high';
  return 'low';
}

// ── The human-facing permission card (an nmq decision variant; kind/risk let the UI style
// it and the push gate read the tier). Answered with Approve / Deny. ──
// The exact question text of the card — also what a reply-line answer (`**question** → …`)
// keys on, so the daemon can resolve the gate from either the decision-row flip (desktop)
// or the reply a mobile client posts. Keep it stable so both paths match.
// `where` is the already-formatted place the ask is happening — `#1042` for a board task,
// `this chat` for a chat thread (docs/34). One permission system, two contexts: a caller
// passing a raw number would have silently produced "in 1042", so the caller formats it
// (taskWhere / CHAT_WHERE) and this stays a pure string join.
export function permissionQuestion(action: PolicyAction, agentName: string, where: string): string {
  return `${agentName} wants to ${actionSummary(action)} in ${where}. Approve?`;
}

export function buildPermissionCardBody(action: PolicyAction, outcome: GateOutcome, agentName: string, where: string, summary?: string): string {
  const q = {
    question: permissionQuestion(action, agentName, where),
    // display-only fields (v0.33): `question` stays the answer/supersede key, so it keeps the
    // inline (truncated) command that makes it unique per ask; the UI renders these instead —
    // command-free title, the agent's own summary, and the FULL command for a code block.
    title: `${agentName} wants to ${actionTitle(action)} in ${where}`,
    ...(summary ? { summary } : {}),
    ...(action.capability === 'shell.exec' && action.command ? { command: action.command } : {}),
    kind: 'permission',
    risk: outcome.risk,
    capability: action.capability,
    reason: outcome.reason,
    options: [{ label: 'Approve' }, { label: 'Deny' }],
    allowOther: false,
  };
  return '```nmq\n' + JSON.stringify(q) + '\n```';
}

// The command-free phrasing for the card's display title — same wording as actionSummary
// except shell commands, whose full text moves to the card's `command` block.
function actionTitle(action: PolicyAction): string {
  return action.capability === 'shell.exec' ? 'run a shell command' : actionSummary(action);
}

// ── Intent elicitation (v0.33.1): when a gated call carries no in-call description (Write/
// Edit/WebFetch/MCP calls have no description field; Bash usually does), the daemon asks the
// AGENT'S OWN model — same provider, same creds — to state its intent before the card posts,
// grounded in the task and the exact action. The card never shows a canned label: if this
// fails, the summary line is simply absent. Pure builders so the prompt + cleanup are testable.
export function intentPrompt(action: PolicyAction, agentName: string, where: string, taskTitle: string): { system: string; user: string } {
  // a chat has no title to quote, so the clause is dropped rather than rendered as ("")
  const doing = taskTitle ? `mid-task on ${where} ("${taskTitle}")` : `mid-conversation in ${where}`;
  return {
    system: `You are ${agentName}, an agent ${doing}. One of your tool calls needs human approval before it runs. Reply with ONE plain sentence (under 140 characters) stating what the action does and why you need it right now — first person, specific, no hedging, no markdown, no surrounding quotes.`,
    user: JSON.stringify(actionFacts(action)),
  };
}

/** How a board task names itself on a permission card. */
export function taskWhere(taskNumber: number): string {
  return `#${taskNumber}`;
}

/** …and how a chat thread does (docs/34) — it has no number, and it never gets one. */
export const CHAT_WHERE = 'this chat';

function actionFacts(action: PolicyAction): Record<string, string | undefined> {
  switch (action.capability) {
    case 'shell.exec':
      return { capability: action.capability, command: action.command };
    case 'fs.write':
    case 'fs.read':
      return { capability: action.capability, path: action.path };
    case 'net.egress':
      return { capability: action.capability, host: action.host };
    case 'tool.mcp':
      return { capability: action.capability, tool: action.tool };
    default:
      return { capability: action.capability };
  }
}

// One line, no wrapping quotes/backticks, hard cap — model output made card-safe.
export function cleanIntent(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/^["'`]+|["'`]+$/g, '').trim().slice(0, 200);
}

function actionSummary(action: PolicyAction): string {
  switch (action.capability) {
    case 'shell.exec':
      return `run a shell command: \`${trunc(action.command ?? '', 140)}\``;
    case 'fs.write':
      return `write \`${action.path ?? 'a file'}\``;
    case 'fs.read':
      return `read \`${action.path ?? 'a file'}\``;
    case 'net.egress':
      return `reach \`${action.host ?? 'a host'}\` over the network`;
    case 'pkg.install':
      return `install a package`;
    case 'tool.mcp':
      return `use the tool \`${action.tool ?? ''}\``;
    case 'vcs.push':
      return `push to git`;
  }
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── Replica policy rows → validated PolicyRule[] (a malformed row is dropped, never crashes
// the gate). Rows arrive from PowerSync with selector as JSON text and locked as 0/1. ──
export interface PolicyRowLite {
  id: string;
  scope: string;
  capability: string;
  selector: unknown;
  verdict: string;
  rationale?: string | null;
  locked?: number | boolean | null;
}

export function rowsToRules(rows: readonly PolicyRowLite[]): PolicyRule[] {
  const out: PolicyRule[] = [];
  for (const r of rows) {
    let selector: unknown = r.selector;
    if (typeof selector === 'string') {
      try {
        selector = JSON.parse(selector);
      } catch {
        continue;
      }
    }
    const parsed = PolicyRuleSchema.safeParse({
      id: r.id,
      scope: r.scope,
      capability: r.capability,
      selector,
      verdict: r.verdict,
      rationale: r.rationale ?? undefined,
      locked: Boolean(r.locked),
    });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
