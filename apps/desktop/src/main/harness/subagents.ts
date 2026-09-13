// Subagents (docs/harness/04) — founder ruling 2026-07-31.
//
// "An agent may fan out as many subagents as the work needs, to any depth. If it fans them out, it
// owns that workflow." Ownership is the invariant that makes unbounded fan-out safe — not a depth cap,
// which an earlier draft proposed and which was wrong: it confused *how work is assigned and accepted*
// (the board) with *how an agent decomposes its own work* (not ours to cap).
//
// Three things make it safe, and all three are here or in shared:
//   1. A subagent has NO `agents` row → no board identity to act with. Enforced by absence.
//   2. Its toolset is `toolsFor('leg', role)` → no board command exists to call (toolbus).
//   3. Its budget is a slice of its parent's remainder → recursion terminates on physics
//      (`sliceBudget` in shared), never on a permission a model could argue with.
//
// Run: pnpm exec tsx --test src/main/harness/subagents.test.ts
import { sliceBudget, type AgentRole, type BudgetSpec, type TurnKind } from '@neuramesh/shared';

export interface SpawnSpec {
  /** → model + prompt via resolvePackRoles; roles are CONFIG, never a permission tier */
  role: AgentRole;
  prompt: string;
  /** explicit model override; must pass the server's allow-list, like a thread brain override */
  model?: string;
  /** a REQUEST, intersected with what the parent can actually afford */
  budget?: Partial<BudgetSpec>;
  label?: string;
}

export interface SpawnDecision {
  ok: boolean;
  /** the budget the child actually gets (null when refused) */
  budget: BudgetSpec | null;
  reason?: string;
}

/**
 * Can this parent afford this child, and on what budget?
 *
 * Pure, because this single function is the recursion terminator and therefore the thing most worth
 * testing. A refusal is not an error condition — it is the design working: an unbounded-depth fan-out
 * halts because budget is finite.
 *
 * `share` divides the REMAINDER, so N children each take a slice of what is left rather than of the
 * original — which is what stops a wide fan-out overcommitting a parent.
 */
export function planSpawn(remaining: BudgetSpec, spec: SpawnSpec, share = 0.5): SpawnDecision {
  const slice = sliceBudget(remaining, share);
  if (!slice) {
    return { ok: false, budget: null, reason: `not enough budget left to run a ${spec.role} subagent (${Math.round(remaining.wallMs / 1000)}s, ${remaining.contextTokens} tokens remain)` };
  }
  // an explicit request may only ever NARROW what the parent can afford
  const wallMs = Math.min(slice.wallMs, spec.budget?.wallMs ?? slice.wallMs);
  const contextTokens = Math.min(slice.contextTokens, spec.budget?.contextTokens ?? slice.contextTokens);
  return { ok: true, budget: { wallMs, contextTokens } };
}

/**
 * Divide a parent's remainder across a whole fan-out, in order.
 *
 * Later children get smaller slices, and the ones past the floor are REFUSED rather than silently
 * dropped — the #1015 lesson: a silent truncation reads as "we ran all of them".
 */
export function planFanout(remaining: BudgetSpec, specs: readonly SpawnSpec[], share = 0.5): Array<{ spec: SpawnSpec; decision: SpawnDecision }> {
  let left = { ...remaining };
  return specs.map((spec) => {
    const decision = planSpawn(left, spec, share);
    if (decision.ok && decision.budget) {
      left = {
        wallMs: left.wallMs - decision.budget.wallMs,
        contextTokens: left.contextTokens - decision.budget.contextTokens,
      };
    }
    return { spec, decision };
  });
}

// ── Ownership: the parent answers for its subtree ─────────────────────────────────────────────
export type ChildState = 'running' | 'done' | 'failed' | 'stopped';

export interface ChildRecord {
  turnId: string;
  role: AgentRole;
  label: string;
  state: ChildState;
  summary?: string;
}

/**
 * A parent's view of its subtree. The parent's turn does NOT settle until this is closed — already the
 * de-facto pattern in `startDeepWork` (mapCapped → synthesis → parent.settle); the harness makes it
 * structural for every turn kind.
 */
export class Subtree {
  private children = new Map<string, ChildRecord>();
  constructor(readonly parentTurnId: string) {}

  add(rec: ChildRecord): void { this.children.set(rec.turnId, rec); }

  settle(turnId: string, state: Exclude<ChildState, 'running'>, summary?: string): void {
    const rec = this.children.get(turnId);
    if (rec) this.children.set(turnId, { ...rec, state, ...(summary ? { summary } : {}) });
  }

  open(): ChildRecord[] { return [...this.children.values()].filter((c) => c.state === 'running'); }
  all(): ChildRecord[] { return [...this.children.values()]; }

  /** The parent may only settle when nothing below it is still running. */
  get closed(): boolean { return this.open().length === 0; }

  /**
   * The line a parent reports. A failed child is NAMED, never omitted — today's leg-failure path
   * already does this ("a dead leg is REPORTED, not hidden: partial research the human can see the
   * holes in beats a tidy report that quietly covered four angles instead of five").
   */
  rollup(): string {
    const all = this.all();
    if (!all.length) return '';
    const done = all.filter((c) => c.state === 'done').length;
    const bad = all.filter((c) => c.state === 'failed' || c.state === 'stopped');
    const byRole = new Map<string, number>();
    for (const c of all) byRole.set(c.role, (byRole.get(c.role) ?? 0) + 1);
    const roles = [...byRole.entries()].map(([r, n]) => `${n} ${r}${n === 1 ? '' : 's'}`).join(', ');
    const failed = bad.length ? ` · ${bad.length} failed (${bad.map((c) => c.label).join(', ')})` : '';
    return `${roles} · ${done}/${all.length} done${failed}`;
  }
}

// ── Guards ────────────────────────────────────────────────────────────────────────────────────
/**
 * A subagent's turn kind is always `leg`, whatever its role.
 *
 * Role and kind are orthogonal and confusing them is the mistake that would reintroduce the bug the
 * ruling removed: a "designer subagent" is a `leg` SEATED as a designer — it must not inherit a
 * `design` turn's board tools just because its role says designer.
 */
export function childKind(): TurnKind { return 'leg'; }

/**
 * A subagent inherits its parent's policy and may only ever NARROW it.
 *
 * Intersection by restrictiveness: for any capability, the more restrictive of (parent, requested)
 * wins. A `locked` workspace rule is therefore locked all the way down, at any depth.
 */
export function narrowPolicy<T extends { capability: string; verdict: 'allow' | 'ask' | 'deny'; locked?: boolean }>(
  parent: readonly T[],
  requested: readonly T[],
): T[] {
  const rank = { allow: 0, ask: 1, deny: 2 } as const;
  const out = [...parent];
  for (const r of requested) {
    if (r.locked) continue; // a child cannot mint a locked rule
    const i = out.findIndex((p) => p.capability === r.capability && !p.locked);
    if (i < 0) { out.push(r); continue; }
    if (rank[r.verdict] > rank[out[i]!.verdict]) out[i] = r; // narrower only
  }
  return out;
}
