// Capacity failover — the pure recommendation engine (docs/22). Given a model that just hit its
// usage limit, the workspace's current role→model map, everything else known-exhausted this window,
// and which provider logins are live, decide the single best move. Pure + unit-tested (the
// authpolicy/execpolicy idiom) so the daemon just executes the verdict and the renderer can preview it.
//
// The two shapes match the mockup: a same-provider FALL-FORWARD (reseat only the roles on the dead
// model to the next model in its family — no reconnect, no billing change) and, once a provider's
// whole chain is exhausted, a cross-provider SWITCH to a live alternative's -core pack. Convergence
// is structural: the fall-forward chain is finite and skips already-exhausted models, so repeated
// exhaustion walks Fable→Opus→Sonnet→(chain out)→switch provider→(none live)→hold. It never loops.
import { providerForModel, runtimeForModel, PACKS, type Provider, type Runtime } from './model-packs';
import { AGENT_ROLES, type AgentRole } from './states';

const PROVIDER_NAME: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini' };
export function providerName(p: Provider): string { return PROVIDER_NAME[p]; }

// Provider availability exactly as detectProviders() (apps/desktop/src/main/runtime/detect.ts) returns it.
export interface ProviderAvail {
  installed: boolean;
  authed: boolean;
  method: 'subscription' | 'apikey' | null;
}
export type AvailSnapshot = Record<Provider, ProviderAvail>;

// Same-provider fall-forward order: strongest → cheaper, KNOWN-good seatable downgrades within a
// runtime family. Hand-pinned (not "next id in CURRENT_MODELS") so a fallback is always sane. A usage
// cap never logs you out, so a same-provider hop needs no auth change — only a still-un-exhausted model.
//
// A RETIRED id may be a key here but never a target: an agent still seated on last generation must
// be able to fall forward, and nothing may fall onto a model the catalog no longer offers. A test
// enforces both halves.
export const FALL_FORWARD: Record<string, readonly string[]> = {
  'claude-fable-5-1': ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  'claude-opus-5': ['claude-sonnet-5', 'claude-haiku-4-5'],
  'claude-fable-5': ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  'claude-opus-4-8': ['claude-sonnet-5', 'claude-haiku-4-5'],
  'claude-sonnet-5': ['claude-haiku-4-5'],
  'claude-sonnet-4-6': ['claude-sonnet-5', 'claude-haiku-4-5'],
  'gpt-6-astra': ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.4-mini'],
  'gpt-5.6-sol': ['gpt-5.6-terra', 'gpt-5.4-mini'],
  'gpt-5.6-terra': ['gpt-5.4-mini'],
  'gpt-5.5': ['gpt-5.6-terra', 'gpt-5.4-mini'],
  'gpt-5.5-pro': ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.4-mini'],
  'gemini-3.1-pro-preview': ['gemini-3.8-flash', 'gemini-3.1-flash-lite'],
  'gemini-3.8-flash': ['gemini-3.1-flash-lite'],
  'gemini-3.5-flash': ['gemini-3.8-flash', 'gemini-3.1-flash-lite'],
};

// Which single-provider pack a cross-provider switch lands on, per provider.
export const CORE_PACK: Record<Provider, string> = {
  anthropic: 'claude-core',
  openai: 'openai-core',
  gemini: 'gemini-core',
};

// Preference when switching TO another provider (mirrors PACK_ORDER's single-provider ordering:
// Anthropic → OpenAI → Gemini). The exhausted provider is always excluded by the caller.
const SWAP_PREFERENCE: readonly Provider[] = ['anthropic', 'openai', 'gemini'];

export type Recommendation =
  // reseat exactly `roles` (the roles currently on the dead model) from `from` → `to`, same provider.
  | { kind: 'fall_forward'; provider: Provider; from: string; to: string; roles: AgentRole[] }
  // switch the whole workspace to `packId` on a different, live provider.
  | { kind: 'switch_pack'; from: Provider; provider: Provider; packId: string }
  // nothing else is signed in — connect a provider or wait for the reset; hold the work.
  | { kind: 'no_fallback'; from: Provider };

export interface FailoverInput {
  /** the model that just hit its usage cap */
  exhaustedModel: string;
  /** the workspace's current effective role → model map (resolvePackRoles of the active pack) */
  activeRoles: Record<AgentRole, string>;
  /** every model known-exhausted this window (this one included) — drives convergence on repeat hits */
  exhausted: readonly string[];
  /** detectProviders() snapshot — which logins are live right now */
  avail: AvailSnapshot;
}

// The machine payload an exhaustion card carries inside its ```nmq block (the hire-card pattern:
// the JSON rides an extra key the server extraction ignores, and the custom renderer reads it to
// draw the rich card + the daemon watcher recovers it to execute the confirmed choice). The card's
// `options` still drive the answer contract, so it degrades to a plain choice card if unrendered.
export interface FailoverCardData {
  /** the model that hit its cap */
  exhaustedModel: string;
  /** the composed best move (drives the recommended option + the roster preview) */
  recommendation: Recommendation;
  /** detectProviders() snapshot at compose time — the live-login strip */
  avail: AvailSnapshot;
  /** the pack active before the switch — what auto-revert restores */
  currentPack: string;
  /** ISO time the exhausted limit is expected to reset, if the provider exposed it */
  resetAtIso?: string | null;
  /** the scope the switch applies at (v1: always 'workspace') */
  scope: 'workspace' | 'project';
  /** whether the auto-revert box starts checked (docs/22: on by default) */
  revert: boolean;
}

/** The next model in a family's fall-forward chain that is not itself already exhausted. */
export function nextFallForward(model: string, exhausted: ReadonlySet<string>): string | null {
  for (const candidate of FALL_FORWARD[model] ?? []) {
    if (!exhausted.has(candidate)) return candidate;
  }
  return null;
}

/** The best live provider to switch to, excluding the exhausted one. Null when none is signed in. */
export function bestAlternativeProvider(exhaustedProvider: Provider, avail: AvailSnapshot): Provider | null {
  for (const p of SWAP_PREFERENCE) {
    if (p === exhaustedProvider) continue;
    if (avail[p]?.authed) return p;
  }
  return null;
}

// ── Executing a recommendation (docs/22 §9) ──────────────────────────────────────────────
// A `fall_forward` is a PER-ROLE reseat — it cannot go through the whole-pack apply (that would drag
// every other role too, and no builtin pack expresses "Opus on orchestrator/architect only"). These
// pure helpers pick exactly which agent.update calls the daemon issues, and which agents a switch
// can't touch (manual pins), so the wiring stays testable and the wall handler just executes the plan.
export interface AgentSeat {
  id: string;
  role: AgentRole;
  model: string;
  model_source?: string | null; // 'pack' | 'manual'
  kind?: string | null; // 'local' | 'remote'
  retired_at?: string | null;
}
export interface AgentUpdate { id: string; role: AgentRole; model: string; runtime: Runtime }

/** For a fall-forward, the agent.update ops: only pack-managed, non-remote, non-retired agents whose
 * role is in the recommendation AND that are still on the exhausted model. Empty for a switch_pack
 * (the caller uses the whole-pack apply path) or no_fallback. */
export function planFailoverAgentUpdates(rec: Recommendation, agents: readonly AgentSeat[]): AgentUpdate[] {
  if (rec.kind !== 'fall_forward') return [];
  const roles = new Set<AgentRole>(rec.roles);
  return agents
    .filter((a) => (a.model_source ?? 'pack') === 'pack' && (a.kind ?? 'local') !== 'remote' && !a.retired_at)
    .filter((a) => roles.has(a.role) && a.model === rec.from)
    .map((a) => ({ id: a.id, role: a.role, model: rec.to, runtime: runtimeForModel(rec.to) }));
}

/** Agents on the exhausted model that a pack/role switch CAN'T re-seat (human-pinned, model_source
 * 'manual') — the caller surfaces an honest per-agent hold for these instead of claiming a fix (§9). */
export function manualPinnedOnModel(exhaustedModel: string, agents: readonly AgentSeat[]): AgentSeat[] {
  return agents.filter((a) => a.model === exhaustedModel && a.model_source === 'manual' && !a.retired_at && (a.kind ?? 'local') !== 'remote');
}

/** Decide the single best failover move for a usage-exhausted model. Pure. */
export function composeFailover(i: FailoverInput): Recommendation {
  const exhausted = new Set(i.exhausted);
  exhausted.add(i.exhaustedModel);
  const from = providerForModel(i.exhaustedModel);
  const rolesOnModel = AGENT_ROLES.filter((r) => i.activeRoles[r] === i.exhaustedModel);

  // 1. Same-provider fall-forward — cheapest, no auth change. Only for the roles on the dead model.
  const to = nextFallForward(i.exhaustedModel, exhausted);
  if (to && rolesOnModel.length > 0) {
    return { kind: 'fall_forward', provider: from, from: i.exhaustedModel, to, roles: rolesOnModel };
  }

  // 2. The family's chain is exhausted (provider effectively out) → switch to a live alternative.
  const alt = bestAlternativeProvider(from, i.avail);
  if (alt) {
    return { kind: 'switch_pack', from, provider: alt, packId: CORE_PACK[alt] };
  }

  // 3. Nothing else live — hold the work behind a connect/wait card, never fake progress.
  return { kind: 'no_fallback', from };
}

// ── The card the daemon posts (and the preview mocks) ────────────────────────────────────
// One builder so Rex's real card and the preview harness can never drift. `label` maps a model id
// to a human name (injected — the label map lives in the renderer, not shared). Returns the assembled
// message `body` (lead line + a fenced nmq block carrying the rich `failover` payload) plus the pieces.
export interface FailoverCardContext {
  exhaustedModel: string;
  avail: AvailSnapshot;
  currentPack: string;
  resetAtIso?: string | null;
  revert?: boolean;
}
export interface BuiltFailoverCard {
  question: string;
  options: Array<{ label: string; description?: string }>;
  failover: FailoverCardData;
  body: string;
}
export function buildFailoverCard(rec: Recommendation, ctx: FailoverCardContext, label: (id: string) => string): BuiltFailoverCard {
  const failover: FailoverCardData = {
    exhaustedModel: ctx.exhaustedModel, recommendation: rec, avail: ctx.avail,
    currentPack: ctx.currentPack, resetAtIso: ctx.resetAtIso ?? null, scope: 'workspace', revert: ctx.revert ?? true,
  };
  const ex = label(ctx.exhaustedModel);
  const exProvider = providerName(providerForModel(ctx.exhaustedModel));
  let leadIn: string, question: string, options: Array<{ label: string; description?: string }>;
  if (rec.kind === 'fall_forward') {
    const roleList = rec.roles.join(' + ');
    leadIn = `**${ex} hit its usage limit.** It's on ${roleList} in your active brain, so those roles are affected — ${exProvider} meters ${ex} on its own limit, so the rest of the line is fine.`;
    question = `${ex} hit its usage limit — switch ${roleList} to ${label(rec.to)}?`;
    options = [
      { label: `Switch to ${label(rec.to)}`, description: `same ${exProvider} login · no reconnect` },
      { label: 'Keep waiting', description: `pause those roles until ${ex} resets` },
    ];
  } else if (rec.kind === 'switch_pack') {
    const packName = PACKS[rec.packId]?.name ?? rec.packId;
    leadIn = `**All of ${providerName(rec.from)} is exhausted for your plan.** I checked your other logins on this machine:`;
    question = `${providerName(rec.from)} is exhausted — switch the workspace to ${packName}?`;
    options = [
      { label: `Switch to ${packName}`, description: `${providerName(rec.provider)} login is live · no new key` },
      { label: 'Pause the team & wait', description: `hold work until ${providerName(rec.from)} resets` },
    ];
  } else {
    leadIn = `**${providerName(rec.from)} is exhausted and no other provider is signed in on this machine.** I'm holding the affected work rather than fake progress.`;
    question = `${providerName(rec.from)} is exhausted — connect another provider, or wait for the reset?`;
    options = [{ label: 'Wait for the reset', description: 'keep the work parked until it recovers' }];
  }
  const body = `${leadIn}\n\n\`\`\`nmq\n${JSON.stringify({ question, options, allowOther: true, failover })}\n\`\`\``;
  return { question, options, failover, body };
}
