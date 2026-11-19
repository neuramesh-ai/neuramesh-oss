// INTAKE (round 9, decisions of 2026-11-06). The structured decision on a thread's FIRST human message.
//
// WHERE AND WHY: nm-api runs intake on the NeuraMesh starter brain, the same key, model and metering as
// the project-memory refresh (project-memory-refresh.ts, chargeStarterCall). It is fast (one flash-lite
// call with a strict JSON schema), the same for every person, it needs no connected agent, and it runs
// in parallel with the machine wake. The message route calls fireIntake after the message is saved and
// does not wait for it, so intake never slows a message and never blocks one.
//
// WHAT IT DECIDES (shared/intake.ts, IntakeDecision): the kind of work, the title, a short name, the plan
// of action, any subtasks, and the workspace. nm-api then applies it in one transaction:
//   - threads.intake and the title (only while nobody named the thread),
//   - a coding ask becomes a coding thread at once: kind 'coding' and workspace_mode 'repo' (a worktree
//     of the project repository the ask belongs to) or 'scratch' (a local scratch workspace),
//   - nothing else for the other kinds: the selected agent's turn reads the decision as context.
// The plan line in the thread is drawn by the clients from threads.intake (hq thread/IntakePlan.tsx), so
// it needs no machine and no extra row.
//
// THE BUILD RULE FIRST: shared/intake-rules.ts buildRule is pure and deterministic. A hit makes the kind
// `coding` even when the model is unsure, and it is the whole decision when the starter brain cannot
// answer (no key, no credits, a timeout, bad JSON). A miss with no model decides nothing: today's
// behaviour, the orchestrator decides from its prompt.
//
// WHAT IT SKIPS: an agent's message, a task thread, an Agent Desk home thread (a
// standing conversation, not a new ask), a routine's thread, and any thread past its first turn.
import type postgres from 'postgres';
import {
  CHANGE_VERBS, CODING_MIN_CONFIDENCE, INTAKE_KINDS, INTAKE_WORKSPACES, STARTER_MODEL, STARTER_THINKING_LEVEL, buildRule, diagramAsk, intakeSlug, namesRepo, newBuildAsk, plainTitle, threadTitle,
  type BuildRuleHit, type IntakeDecision, type IntakeKind, type IntakeSubtask, type IntakeWorkspace, type WorkspaceMode,
} from '@neuramesh/shared';
import { STARTER_MODEL_URL, chargeStarterCall, ledgerFor, sqlOf, type GeminiUsage, type Ledger, type StarterFetch } from './credits';
import type { Store } from './store';
import { applyIntakeSql, type IntakeApplied } from './store/intake-apply';

/** The project facts the decision reads. Small on purpose: intake must answer in about a second. */
export * from './intake-prompt';
import { intakeConfig, INTAKE_SYSTEM, INTAKE_SCHEMA, intakePrompt, type IntakeContext, type IntakeConfig } from './intake-prompt';

const clean = (s: unknown, max: number): string => (typeof s === 'string' ? plainTitle(s).replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');

/** The title of a thread from a decision, or the heuristic over the message when the model gave none. */
function titleOf(raw: unknown, body: string): string {
  const t = clean(raw, 60).replace(/[.!?;:]+$/, '').replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
  return t || threadTitle(body).slice(0, 60);
}

/** The steps used when the rule decides alone: generic, and true for any build ask. */
export const RULE_PLAN = [
  'Read the request and set up the workspace',
  'Build the first working version',
  'Run it and check the result',
  'Report what was built and how to use it',
];

/**
 * The model's JSON, read strictly: an unknown kind or workspace, or no plan, is a bad reply (null).
 * Strings are cleaned and capped, a repoId outside the project is dropped, and at most five steps and
 * six subtasks ride one decision.
 */
export function parseIntakeReply(text: string, body: string, ctx: IntakeContext): IntakeDecision | null {
  const raw = text.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  if (!(INTAKE_KINDS as readonly unknown[]).includes(o['kind'])) return null;
  const workspace = (INTAKE_WORKSPACES as readonly unknown[]).includes(o['workspace']) ? (o['workspace'] as IntakeWorkspace) : 'none';
  const plan = (Array.isArray(o['plan']) ? o['plan'] : []).map((s) => clean(s, 140)).filter(Boolean).slice(0, 5);
  if (!plan.length) return null;
  const subtasks: IntakeSubtask[] = (Array.isArray(o['subtasks']) ? o['subtasks'] : [])
    .map((s): IntakeSubtask | null => (s && typeof s === 'object' ? { title: clean((s as Record<string, unknown>)['title'], 120), role: clean((s as Record<string, unknown>)['role'], 40) || null } : null))
    .filter((s): s is IntakeSubtask => !!s?.title)
    .slice(0, 6);
  const conf = typeof o['confidence'] === 'number' && Number.isFinite(o['confidence']) ? Math.min(1, Math.max(0, o['confidence'])) : 0;
  const repoId = typeof o['repoId'] === 'string' && ctx.repos.some((r) => r.id === o['repoId']) ? (o['repoId'] as string) : null;
  const title = titleOf(o['title'], body);
  return {
    v: 1, kind: o['kind'] as IntakeKind, confidence: Math.round(conf * 100) / 100, title,
    name: intakeSlug(clean(o['name'], 60) || title), plan, subtasks, workspace, repoId, source: 'starter', model: STARTER_MODEL,
  };
}

/** The decision when the rule decides alone (the starter brain could not answer). Null on a miss. */
export function ruleDecision(body: string, rule: BuildRuleHit): IntakeDecision | null {
  if (!rule.hit) return null;
  const title = titleOf(null, body);
  // workspace 'none' until intakeEffects decides it: a rule hit on existing code takes the primary repository
  return { v: 1, kind: 'coding', confidence: 1, title, name: intakeSlug(title), plan: [...RULE_PLAN], subtasks: [], workspace: 'none', repoId: null, source: 'rule', model: null };
}

export interface IntakeEffects {
  /** 'coding' when the thread becomes a coding thread, else null (the kind stays) */
  kind: 'coding' | null;
  workspaceMode: WorkspaceMode | null;
  repoId: string | null;
}

/**
 * The effects of a decision, as a pure decision table:
 *   coding    a rule hit, or kind coding with confidence >= CODING_MIN_CONFIDENCE. Anything else: none.
 *   repo      a repository the message names, else (only when the ask is not a new standalone thing)
 *             the decision's repoId, else the primary repository when the model said repo or the ask
 *             changes existing code.
 *   scratch   every other coding ask: a new standalone thing (newBuildAsk), or a project with no repository.
 *   none      not coding, and never for a diagram, a whiteboard or a flowchart (diagramAsk) with no rule hit.
 */
export function intakeEffects(d: IntakeDecision, body: string, ctx: IntakeContext, rule: BuildRuleHit): IntakeEffects {
  const coding = rule.hit || (d.kind === 'coding' && d.confidence >= CODING_MIN_CONFIDENCE && !diagramAsk(body));
  if (!coding) return { kind: null, workspaceMode: null, repoId: null };
  const repo = (id: string | null | undefined) => (id ? ctx.repos.find((r) => r.id === id) ?? null : null);
  const primary = ctx.repos.find((r) => r.primary) ?? ctx.repos[0] ?? null;
  const named = ctx.repos.find((r) => namesRepo(body, r.name)) ?? null;
  // a NEW standalone thing is scratch even when the project has repositories (George, 2026-11-06): the model's
  // repo, and a change verb with the primary repository, count only when the ask touches existing code
  const greenfield = newBuildAsk(body);
  const pick = named
    ?? (greenfield ? null : repo(d.repoId))
    ?? (!greenfield && (d.workspace === 'repo' || (d.workspace !== 'scratch' && rule.hit && CHANGE_VERBS.has(rule.verb ?? ''))) ? primary : null);
  return pick ? { kind: 'coding', workspaceMode: 'repo', repoId: pick.id } : { kind: 'coding', workspaceMode: 'scratch', repoId: null };
}

/** The stored decision, made consistent with its effects: the plan line shows the workspace that was set up. */
export function settleDecision(d: IntakeDecision, effects: IntakeEffects, ms: number): IntakeDecision {
  if (effects.kind !== 'coding') return { ...d, workspace: 'none', repoId: null, ms };
  return { ...d, kind: 'coding', workspace: effects.workspaceMode ?? 'scratch', repoId: effects.repoId, plan: d.plan.length ? d.plan : [...RULE_PLAN], ms };
}

/** one starter call with the strict schema, the JSON text and what the vendor says it used */
async function starterIntake(fetchFn: StarterFetch, key: string, user: string, timeoutMs: number): Promise<{ text: string; usage?: GeminiUsage }> {
  const res = await fetchFn(`${STARTER_MODEL_URL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: user }] }],
      systemInstruction: { parts: [{ text: INTAKE_SYSTEM }] },
      generationConfig: {
        temperature: 0.1, maxOutputTokens: 600, responseMimeType: 'application/json', responseSchema: INTAKE_SCHEMA,
        thinkingConfig: { thinkingLevel: STARTER_THINKING_LEVEL },
      },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await res.json().catch(() => ({}))) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; usageMetadata?: GeminiUsage };
  if (!res.ok) throw new Error(`starter brain call failed (${res.status})`);
  return { text: (payload.candidates?.[0]?.content?.parts ?? []).map((x) => x.text ?? '').join(''), usage: payload.usageMetadata };
}

/** The thread facts eligibility needs, read once. Null: no such thread. */
export interface IntakeSubject {
  workspace: string; threadId: string; projectId: string | null;
  kind: string | null; homeAgentId: string | null; scheduleId: string | null; origin: string | null; taskId: string | null;
  intake: unknown; humans: number; agents: number;
}

/** Is this thread a new ask? (pure) Agent Desk homes, routines, task threads and later turns are not. */
export function intakeEligible(s: IntakeSubject | null): boolean {
  return !!s && !s.intake && !s.homeAgentId && !s.scheduleId && s.origin !== 'routine' && !s.taskId && s.humans === 1 && s.agents === 0;
}

async function readSubject(sql: postgres.Sql, workspace: string, threadId: string): Promise<IntakeSubject | null> {
  const [t] = await sql`
    select t.project_id, t.kind, t.home_agent_id, t.schedule_id, t.origin, t.task_id, t.intake,
           (select count(*)::int from messages m where m.thread_id = t.id and m.author_kind = 'human') as humans,
           (select count(*)::int from messages m where m.thread_id = t.id and m.author_kind = 'agent') as agents
      from threads t where t.id = ${threadId}::uuid and t.workspace_id = ${workspace}::uuid`;
  if (!t) return null;
  return {
    workspace, threadId, projectId: (t['project_id'] as string | null) ?? null, kind: (t['kind'] as string | null) ?? null,
    homeAgentId: (t['home_agent_id'] as string | null) ?? null, scheduleId: (t['schedule_id'] as string | null) ?? null,
    origin: (t['origin'] as string | null) ?? null, taskId: (t['task_id'] as string | null) ?? null, intake: t['intake'] ?? null,
    humans: Number(t['humans'] ?? 0), agents: Number(t['agents'] ?? 0),
  };
}

/** The project facts a decision reads. Exported for the e2e door, which decides with no thread. */
export async function readContext(sql: postgres.Sql, s: { workspace: string; projectId: string | null }): Promise<IntakeContext> {
  const [project, repos, team, memory] = await Promise.all([
    s.projectId ? sql`select name from projects where id = ${s.projectId}::uuid` : Promise.resolve([] as postgres.Row[]),
    s.projectId ? sql`select r.id, r.org_name, r.name, pr.is_primary from project_repos pr join repos r on r.id = pr.repo_id
                       where pr.project_id = ${s.projectId}::uuid order by pr.is_primary desc, r.name limit 12` : Promise.resolve([] as postgres.Row[]),
    sql`select name, role from agents where workspace_id = ${s.workspace}::uuid and retired_at is null order by (role = 'orchestrator') desc, name limit 12`,
    s.projectId ? sql`select content from memory_blocks where project_id = ${s.projectId}::uuid and kind = 'project_summary' limit 1` : Promise.resolve([] as postgres.Row[]),
  ]);
  return {
    project: ((project[0]?.['name'] as string | undefined) ?? 'Default').slice(0, 120),
    repos: repos.map((r) => ({
      id: r['id'] as string,
      name: r['org_name'] && r['org_name'] !== 'local' ? `${r['org_name'] as string}/${r['name'] as string}` : (r['name'] as string),
      primary: !!r['is_primary'],
    })),
    team: team.map((a) => `${a['name'] as string} (${a['role'] as string})`),
    memory: ((memory[0]?.['content'] as string | undefined) ?? '').trim() || null,
  };
}

export interface IntakeDeps {
  sql: postgres.Sql;
  ledger: Ledger | null;
  fetchFn: StarterFetch;
  config: IntakeConfig;
}

export type IntakeOutcome = 'skipped' | 'no_decision' | IntakeApplied;

export interface IntakeVerdict {
  /** the settled decision (the stored shape), or null: the rule missed and the starter brain gave none */
  decision: IntakeDecision | null;
  effects: IntakeEffects;
  rule: BuildRuleHit;
  /** why the starter brain did not decide: no_key, no_credits, timeout, call_failed, bad_json, or '' */
  why: string;
  ms: number;
}

/**
 * The decision for one message, with no write: the starter brain (metered) with the strict schema, the
 * build rule beside it, and the fallbacks. runIntake applies it to a thread; the e2e door
 * (e2e-routes.ts POST /internal/e2e/intake) returns it as is.
 */
export async function decideIntake(d: Omit<IntakeDeps, 'sql'>, input: { workspace: string; body: string; ctx: IntakeContext; startedAt: number }): Promise<IntakeVerdict> {
  const rule = buildRule(input.body);
  let decision: IntakeDecision | null = null;
  let why = '';
  if (!d.config.key) why = 'no_key';
  else if (d.ledger && (await d.ledger.balance(input.workspace)).remainingMicros <= 0) why = 'no_credits';
  else {
    try {
      const reply = await starterIntake(d.fetchFn, d.config.key, intakePrompt(input.body, input.ctx), d.config.timeoutMs);
      if (d.ledger) await chargeStarterCall(d.ledger, input.workspace, reply.usage).catch(() => undefined);
      decision = parseIntakeReply(reply.text, input.body, input.ctx);
      if (!decision) why = 'bad_json';
    } catch (e) {
      why = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'call_failed';
    }
  }
  if (!decision) decision = ruleDecision(input.body, rule);
  // a diagram, a whiteboard or a flowchart is drawn, never coded, even when it is about the code
  if (decision?.kind === 'coding' && !rule.hit && diagramAsk(input.body)) decision = { ...decision, kind: 'board', workspace: 'none', repoId: null };
  const ms = Date.now() - input.startedAt;
  if (!decision) return { decision: null, effects: { kind: null, workspaceMode: null, repoId: null }, rule, why: why || 'rule_miss', ms };
  const effects = intakeEffects(decision, input.body, input.ctx, rule);
  return { decision: settleDecision(decision, effects, ms), effects, rule, why, ms };
}

/**
 * Run intake for one message and apply it. Never throws: a failure is logged and leaves today's
 * behaviour. `startedAt` is the message's time, so `ms` is the time the person waited.
 */
export async function runIntake(d: IntakeDeps, input: { workspace: string; threadId: string; body: string; startedAt: number }): Promise<IntakeOutcome> {
  try {
    const subject = await readSubject(d.sql, input.workspace, input.threadId);
    if (!intakeEligible(subject)) return 'skipped';
    const ctx = await readContext(d.sql, subject!);
    const v = await decideIntake(d, { workspace: input.workspace, body: input.body, ctx, startedAt: input.startedAt });
    if (!v.decision) {
      console.log(`thread_intake thread=${input.threadId} kind=none confidence=0 workspace=none source=none ms=${v.ms} why=${v.why}`);
      return 'no_decision';
    }
    const applied = await applyIntakeSql(d.sql, { workspace: input.workspace, threadId: input.threadId, decision: v.decision, effects: v.effects });
    console.log(`thread_intake thread=${input.threadId} kind=${v.decision.kind} confidence=${v.decision.confidence} workspace=${v.effects.workspaceMode ?? 'none'} source=${v.decision.source} ms=${v.ms}${v.rule.hit ? ` rule=${v.rule.verb}:${v.rule.noun}` : ''}${v.why ? ` why=${v.why}` : ''} applied=${applied}`);
    return applied;
  } catch (e) {
    console.error(`thread_intake thread=${input.threadId} failed: ${e instanceof Error ? e.message : String(e)}`);
    return 'skipped';
  }
}

/** createApp's door: the env, the fetch, and a hook a test uses to wait for the run. */
export interface IntakeOptions {
  fetchFn?: StarterFetch;
  env?: NodeJS.ProcessEnv;
  onRun?: (run: Promise<IntakeOutcome>) => void;
}

/**
 * Fire and forget, from the message route. Only a person's message that opened a conversation thread
 * qualifies here (cheap checks). runIntake reads the thread and decides the rest.
 */
const inflightIntake = new Map<string, Promise<IntakeOutcome>>();

export function fireIntake(
  store: Store,
  msg: { workspace: string; threadId?: string | null; taskId?: string | null; scheduleId?: string | null; body: string; createdAt?: string },
  author: { kind: string },
  opts: IntakeOptions = {},
): void {
  // a person's message only. A desktop app posts its person's message with its machine token, so the
  // machine lane is not a reason to skip: the thread checks in runIntake (no routine, first turn) are.
  if (author.kind !== 'human' || !msg.threadId || msg.taskId || msg.scheduleId || !msg.body.trim()) return;
  const config = intakeConfig(opts.env);
  const sql = sqlOf(store);
  if (!config.enabled || !sql) return;
  const existing = inflightIntake.get(msg.threadId);
  if (existing) { opts.onRun?.(existing); return; }
  const startedAt = Number.isFinite(Date.parse(msg.createdAt ?? '')) ? Date.parse(msg.createdAt!) : Date.now();
  const run = runIntake({ sql, ledger: ledgerFor(store), fetchFn: opts.fetchFn ?? ((u, i) => fetch(u, i)), config }, { workspace: msg.workspace, threadId: msg.threadId, body: msg.body, startedAt })
    .finally(() => { inflightIntake.delete(msg.threadId!); });
  inflightIntake.set(msg.threadId, run);
  opts.onRun?.(run);
  void run;
}
