// Model config packs — the single source of truth for which brain each agent role gets by
// default. A pack is a named role→model map curated from benchmarks; a workspace activates one
// (if it has the required providers) and every pack-managed agent materializes onto that model.
// Consumed by control-api (curator + hired-later resolution, the model allow-list) and the
// desktop app (onboarding defaults, the settings/onboarding pack pickers).
//
// Model ids are VERIFIED CURRENT as of 2026-09-07 (see docs/10-model-packs.md). Re-verify the
// newest GA model per provider before each release and update CURRENT_MODELS + the packs.

import { AGENT_ROLES, type AgentRole } from './states';
import { STARTER_MODEL } from './rates';

/** Credential-provider vocabulary (matches provider_credentials.provider + the onboarding picker). */
export type Provider = 'anthropic' | 'openai' | 'gemini';
/** Runtime that serves a model (matches the agents.runtime enum). */
export type Runtime = 'claude-code' | 'codex' | 'gemini';

// The models we OFFER today, per runtime — the current generation, GA-first. This is the
// catalog the renderer's RUNTIME_OPTS mirrors and the packs draw from.
export const CURRENT_MODELS: Record<Runtime, readonly string[]> = {
  // 2026-09-07 catalog pass. fable-5-1: Anthropic's most capable ($10/$50/MTok, always-on
  // thinking, needs 30-day retention — not ZDR-compatible), successor to fable-5 at the same
  // price. opus-5: the default recommendation for most work ($5/$25), successor to opus-4-8.
  // sonnet-5: near-Opus coding at $2/$10 (the scheduled rise to $3/$15 was cancelled), and the
  // 2026-09 run's developer seat in four packs — the fastest of the seven models that tied at 100%.
  'claude-code': ['claude-fable-5-1', 'claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  // gpt-6-astra: OpenAI's flagship (2026-09, $10/$50/MTok). It needs codex-cli >= 0.153.0 —
  // CODEX_MIN_VERSION in apps/desktop/src/main/runtime/cli.ts upgrades the CLI rather than let
  // runResilient silently downgrade the turn to the account default (the gpt-5.6-luna lesson).
  // gpt-5.6-sol: the previous flagship, now $4/$20 (promo through 2026-11-21). gpt-5.6-terra:
  // the mid tier at $2/$12, and the 2026-09 run's openai-core developer seat (100% at the lowest
  // cost of the models that tied there). gpt-5.6-luna stays OUT: a lite-tier model holds no working
  // seat (founder rule), so offering it would only invite a bad manual pick.
  codex: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.4-mini'],
  // STARTER_MODEL is the HOUSE brain (rates.ts): the platform serves it from its own key, so it is
  // the one id in this catalog a workspace can run without connecting anything. It is catalogued
  // like any other model — the server allow-list, the packs and the pickers all derive from here —
  // and what makes it free to the user is the metered proxy, not a special case in the catalog.
  // gemini-3.8-flash: Google's most capable Flash (GA, $0.75/$3.75 introductory through
  // 2026-12-31), successor to 3.5 Flash, which Google now lists as legacy. There is still NO
  // Gemini 3.5 Pro or 3.8 Pro in the API, and no Flash-Lite past 3.5, so the Pro tier remains the
  // 3.1 preview and the house brain remains 3.5 Flash-Lite.
  gemini: ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite', STARTER_MODEL],
};

// Retired-but-still-routable ids that may already be stored on agents from earlier onboarding.
// Accepted by the server allow-list (so existing agents stay editable) but no longer offered.
export const LEGACY_MODELS: readonly string[] = [
  'gemini-2.5-pro', 'gemini-2.5-flash', 'gpt-5', 'gpt-5.1-codex', 'gpt-5-codex',
  // Superseded 2026-09-08 by the generation that replaced them, each at the same price or less.
  // They stay routable so an agent already seated on one keeps working and stays editable; they
  // are simply no longer OFFERED, and no pack seats them. FALL_FORWARD carries each of them onto
  // a current model, so a capacity failover can never land an agent on a retired id.
  'claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-5.5', 'gpt-5.5-pro', 'gemini-3.5-flash',
];

/** The closed set of model ids the server accepts (current + legacy). Garbage is rejected. */
export const MODEL_IDS: readonly string[] = [
  ...CURRENT_MODELS['claude-code'], ...CURRENT_MODELS.codex, ...CURRENT_MODELS.gemini, ...LEGACY_MODELS,
];
export const MODEL_ID_SET: ReadonlySet<string> = new Set(MODEL_IDS);

/** model id → its credential provider (by family prefix). */
export function providerForModel(id: string): Provider {
  if (id.startsWith('claude')) return 'anthropic';
  if (id.startsWith('gpt') || id.startsWith('o')) return 'openai';
  if (id.startsWith('gemini')) return 'gemini';
  throw new Error(`providerForModel: unknown model family for "${id}"`);
}

/** model id → the runtime that serves it (by family prefix). */
export function runtimeForModel(id: string): Runtime {
  if (id.startsWith('claude')) return 'claude-code';
  if (id.startsWith('gpt') || id.startsWith('o')) return 'codex';
  return 'gemini';
}

export interface ModelPack {
  id: string;
  name: string;
  tagline: string;
  /** role → model id, covering all 8 AgentRole values (worker aliases developer). */
  roles: Record<AgentRole, string>;
  /** Measured median wall-clock per bench task (docs/11), as display strings ("6.6s") — rendered
   * as muted toks on the pack's roster rows. Only packs whose identity IS speed carry this (fast
   * today); a benched working role missing from the map renders as "curated". Re-stamp on every
   * docs/11 re-run, same discipline as the seats themselves. */
  latency?: Partial<Record<AgentRole, string>>;
  /** The platform serves this pack's models from its OWN key, so it requires no credential of the
   * user's — `packRequiredProviders` returns none for it and it is activatable from a standing
   * start. The flag is what makes that true; deriving it from the model ids cannot, because the
   * house brain is a Gemini id and the derivation would demand a Gemini key nobody has. */
  platform?: true;
}

/** Sentinel for "no pack is managing this workspace" — agents' current models stand.
 * Shown in the UI as "Manual" to keep it distinct from user-authored custom brains. */
export const CUSTOM_PACK_ID = 'custom';

/** The platform-provided pack (see PACKS.starter) — a real builtin id, not a sentinel. */
export const STARTER_PACK_ID = 'starter';

// ── Custom brains — user-authored packs ─────────────────────────────────────
// A workspace can save named role→model maps of its own (custom_model_packs table,
// NOT PowerSync-replicated — read via GET /v1/model-packs like workspace settings).
// Their ids are `custom:<uuid>`, so they can never collide with builtin pack ids or
// the CUSTOM_PACK_ID sentinel, and `workspaces.active_model_pack` can hold either kind.
export const CUSTOM_PACK_PREFIX = 'custom:';
export function isCustomPackId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(CUSTOM_PACK_PREFIX);
}

/** A user-authored brain: same shape a builtin pack resolves to, plus nothing magic. */
export interface CustomModelPack {
  id: string; // `custom:<uuid>`
  name: string;
  roles: Record<AgentRole, string>;
  updatedAt?: string;
}

/** The roles pickers preview on a pack card — the five working roles (the design stage,
 * docs/14, made designer one of them; sales/curator stay a compact support line). */
export const PACK_PREVIEW_ROLES: readonly AgentRole[] = ['orchestrator', 'architect', 'developer', 'reviewer', 'designer', 'marketer'];
/** Light roles shown as the secondary "support" line (worker stays hidden — it aliases developer). */
export const PACK_SUPPORT_ROLES: readonly AgentRole[] = ['shipper', 'sales', 'curator'];

// Six curated packs plus the platform floor. Reasoning grounded in daemon role load: architect
// runs the mixture-of-agents plan pipeline, developer runs real code, and designer studies a
// codebase + drafts production-grade mockups (an FSM party since docs/14) → strong brains;
// orchestrator (routing) and reviewer (bounded DoD gating) → fast-strong; sales/curator are light
// → cheap. ultracode/balanced/fast put the reviewer on a different family for independent judgment.
//
// SEATS ARE MEASURED — suite v1.1, 2026-09-08, 13 models over 5 roles at commit ee7195f1. See
// docs/11-model-benchmarks.md, neuramesh.app/model-benchmarks, and the seat write-up in
// docs/design/model-benchmarks-2026-09/seat-recommendation.md. Quality scores in the notes below
// are that run's, out of 100.
//
// What the 2026-09 run changed, and why:
//  - developer: SEVEN models tied at exactly 100%, so the seat breaks on cost and speed rather
//    than skill. claude-sonnet-5 is the fastest of them (11.8s) and the second cheapest, which is
//    why it holds the seat in four packs. That tie is also the case for the private repo-derived
//    fixtures parked in docs/design/model-benchmarks-v2-2026-09 — a role where everyone scores
//    full marks has stopped measuring anything.
//  - reviewer: gpt-6-astra is the only perfect score (F1 1.00, zero false approvals) and its
//    interval clears the runner-up, so it wins outright rather than on value.
//  - ultracode's gate MOVED from anthropic+gemini to anthropic+openai. It is the "best per role"
//    pack and OpenAI now holds three of the four working seats on merit.
//  - the Gemini architect seat no longer needs the preview exception: gemini-3.8-flash beats the
//    3.1 Pro preview on planning (87 vs 84) at under half the cost and half the latency. The
//    Gemini DEVELOPER seat still needs it — 3.1 Pro is the only Gemini model that reached 100%.
//
// EXCEPTION 1 (directed, not measured): claude-sonnet-5 holds the orchestrator seat in claude-core
// and balanced by founder decision (2026-09-08), and is the server's register-time default. The
// measurement supports it (95, statistically level with the leaders, $0.014, 7.7s) but the
// decision came first.
// EXCEPTION 2 (directed, not measured): claude-fable-5-1 holds the claude-core ARCHITECT seat by
// founder decision (2026-09-08), against a measured claude-sonnet-5 at 88 to Fable's 78, at eight
// times the cost and twice the latency. Re-run docs/11 to confirm or revert.
// EXCEPTION 3: designer seats are CURATED, not measured — the suite has no design dimension yet
// (visual grading needs its own harness; docs/14 §8 tracks it). Each pack seats its strongest
// frontend/aesthetic brain; Anthropic models lead on design taste, so the mixed packs stay
// Anthropic for the designer.
// EXCEPTION 4: shipper seats are CURATED (docs/23) — release-readiness judgment is low-volume but
// risk-weighted, so it sits at or above the reviewer's tier.
// EXCEPTION 5: fast seats take the fastest FULL-STRENGTH model per role at a q>=90 floor, and
// mini/lite-tier models (gpt-5.4-mini, gemini-3.1-flash-lite) hold NO working seat — they sprint
// the bench but are not trusted for real work (founder rule, locked by test). The 2026-09 numbers
// put gemini-3.8-flash on three of its four seats: orchestrator 5.4s q96, reviewer 2.5s q90,
// architect 15.0s q87 (the only seat under the floor, and still the fastest thing near it), with
// claude-sonnet-5 on developer at 11.8s q100.
//   NOTE: gpt-5.4-mini won research, planning AND orchestration outright in this run. The founder
//   rule keeps it off working seats, so it holds none. That is the strongest argument the bench
//   has produced against the rule, and it is recorded rather than acted on.
export const PACKS: Record<string, ModelPack> = {
  ultracode: {
    id: 'ultracode', name: 'Ultracode', tagline: 'Best-in-market brain per role, mixing providers',
    roles: {
      orchestrator: 'gpt-5.6-sol', architect: 'gpt-6-astra', developer: 'claude-sonnet-5', worker: 'claude-sonnet-5',
      reviewer: 'gpt-6-astra', designer: 'claude-opus-5', shipper: 'claude-fable-5-1', sales: 'claude-sonnet-5', curator: 'claude-haiku-4-5', marketer: 'claude-opus-5',
    },
  },
  balanced: {
    id: 'balanced', name: 'Balanced', tagline: 'Cost + performance across providers',
    roles: {
      orchestrator: 'claude-sonnet-5', architect: 'gemini-3.8-flash', developer: 'claude-sonnet-5', worker: 'claude-sonnet-5',
      reviewer: 'gemini-3.8-flash', designer: 'claude-sonnet-5', shipper: 'claude-sonnet-5', sales: 'claude-haiku-4-5', curator: 'claude-haiku-4-5', marketer: 'claude-sonnet-5',
    },
  },
  fast: {
    id: 'fast', name: 'Fast', tagline: 'Fastest full-strength brain per role, mixing providers',
    roles: {
      orchestrator: 'gemini-3.8-flash', architect: 'gemini-3.8-flash',
      developer: 'claude-sonnet-5', worker: 'claude-sonnet-5',
      reviewer: 'gemini-3.8-flash', designer: 'claude-sonnet-5', shipper: 'claude-sonnet-5',
      sales: 'claude-haiku-4-5', curator: 'claude-haiku-4-5', marketer: 'claude-sonnet-5',
    },
    latency: {
      orchestrator: '5.4s', architect: '15.0s', developer: '11.8s', worker: '11.8s', reviewer: '2.5s',
    },
  },
  'claude-core': {
    id: 'claude-core', name: 'Claude Core', tagline: 'Best per role on Anthropic',
    roles: {
      orchestrator: 'claude-sonnet-5', architect: 'claude-fable-5-1', developer: 'claude-sonnet-5', worker: 'claude-sonnet-5',
      reviewer: 'claude-fable-5-1', designer: 'claude-sonnet-5', shipper: 'claude-opus-5', sales: 'claude-sonnet-5', curator: 'claude-haiku-4-5', marketer: 'claude-sonnet-5',
    },
  },
  'openai-core': {
    id: 'openai-core', name: 'OpenAI Core', tagline: 'Best per role on OpenAI',
    roles: {
      orchestrator: 'gpt-5.6-sol', architect: 'gpt-6-astra', developer: 'gpt-5.6-terra', worker: 'gpt-5.6-terra',
      reviewer: 'gpt-6-astra', designer: 'gpt-5.6-sol', shipper: 'gpt-5.6-sol', sales: 'gpt-5.4-mini', curator: 'gpt-5.4-mini', marketer: 'gpt-5.6-sol',
    },
  },
  'gemini-core': {
    id: 'gemini-core', name: 'Gemini Core', tagline: 'Best per role on Gemini',
    roles: {
      orchestrator: 'gemini-3.8-flash', architect: 'gemini-3.8-flash', developer: 'gemini-3.1-pro-preview', worker: 'gemini-3.1-pro-preview',
      reviewer: 'gemini-3.1-pro-preview', designer: 'gemini-3.8-flash', shipper: 'gemini-3.1-pro-preview', sales: 'gemini-3.1-flash-lite', curator: 'gemini-3.1-flash-lite', marketer: 'gemini-3.8-flash',
    },
  },
  // The house brain (starter-brain round, 2026-08-28). The pack a workspace runs on before it
  // connects anything of its own — the only one that is activatable with ZERO providers, which is
  // the entire reason it exists.
  //
  // EVERY seat takes the starter model, and that is deliberate rather than generous. The settled
  // design is orchestrator-only — worker agents wait for a real brain — but a pack cannot express
  // that: `roles` is a TOTAL map, every picker non-null-asserts `packModelForRole(id, role)` and
  // then derives a provider logo from it, `seatModel` fills a gap with the DEVELOPER seat (so an
  // unset role would silently inherit one nobody chose), and the wizard's Team step refuses to
  // continue while a crew row has no model. Seating a Claude or OpenAI id instead would be worse
  // twice over: it names a brain the workspace has no key for, and it drags that provider into
  // `packRequiredProviders`, locking the one pack that must never lock.
  //
  // "Orchestrator only" is a SPEND rule, and it is enforced where spending happens — the metered
  // proxy is the only place the platform key exists, so it is the only place credit can be drawn.
  // A catalog entry has no notion of who pays and must not pretend to.
  starter: {
    id: STARTER_PACK_ID, name: 'NeuraMesh Starter', tagline: 'Runs on us — no provider to connect',
    platform: true,
    roles: {
      orchestrator: STARTER_MODEL, architect: STARTER_MODEL, developer: STARTER_MODEL, worker: STARTER_MODEL,
      reviewer: STARTER_MODEL, designer: STARTER_MODEL, shipper: STARTER_MODEL, sales: STARTER_MODEL, curator: STARTER_MODEL, marketer: STARTER_MODEL,
    },
  },
};

/** Stable display order for the pickers: best/broadest first, single-provider packs after, and the
 * platform pack last — it is the floor a workspace stands on, not an opinion competing with them. */
export const PACK_ORDER: readonly string[] = ['ultracode', 'balanced', 'fast', 'claude-core', 'openai-core', 'gemini-core', STARTER_PACK_ID];

/** Providers a role→model map needs configured — DERIVED from the models so it can never
 * drift. Works for builtin packs and custom brains alike. */
export function requiredProvidersForRoles(roles: Record<string, string>): Provider[] {
  const set = new Set<Provider>();
  for (const id of Object.values(roles)) set.add(providerForModel(id));
  return [...set];
}

/** Providers a role→model map needs that are NOT yet enabled (the "connect X" affordance). */
export function missingProvidersForRoles(roles: Record<string, string>, enabled: readonly Provider[]): Provider[] {
  return requiredProvidersForRoles(roles).filter((p) => !enabled.includes(p));
}

/** Is this role→model map activatable given the enabled/ready providers? */
export function rolesActivatable(roles: Record<string, string>, enabled: readonly Provider[]): boolean {
  return missingProvidersForRoles(roles, enabled).length === 0;
}

/** Providers a builtin pack needs configured (unknown pack id → none). A `platform` pack needs
 * none by construction — the platform holds the credential, so deriving one from its model ids
 * would demand a key the user is precisely NOT being asked for. */
export function packRequiredProviders(packId: string): Provider[] {
  const pack = PACKS[packId];
  if (!pack || pack.platform) return [];
  return requiredProvidersForRoles(pack.roles);
}

/** Is this pack activatable given the set of enabled/ready providers? */
export function isPackActivatable(packId: string, enabled: readonly Provider[]): boolean {
  return packRequiredProviders(packId).every((p) => enabled.includes(p));
}

/** Providers a pack needs that are NOT yet enabled (for the "connect X" affordance). */
export function missingProviders(packId: string, enabled: readonly Provider[]): Provider[] {
  return packRequiredProviders(packId).filter((p) => !enabled.includes(p));
}

/** The model a pack assigns to a role (CUSTOM_PACK_ID / unknown pack → null). */
export function packModelForRole(packId: string, role: AgentRole): string | null {
  return PACKS[packId]?.roles[role] ?? null;
}

/**
 * Resolve ANY active-pack id to its role→model map: builtin from the catalog, `custom:<uuid>`
 * from the workspace's saved custom brains (caller fetches those — only needed when
 * isCustomPackId(packId)), the sentinel/unknown → null (unmanaged; current models stand).
 */
export function resolvePackRoles(packId: string | null | undefined, custom: readonly CustomModelPack[]): Record<AgentRole, string> | null {
  if (!packId || packId === CUSTOM_PACK_ID) return null;
  const builtin = PACKS[packId];
  if (builtin) return builtin.roles;
  if (!isCustomPackId(packId)) return null;
  return custom.find((p) => p.id === packId)?.roles ?? null;
}

/**
 * A THREAD's brain override (docs/10 §15, `mockups/brain-config.html`): role → model, for one
 * conversation. Not a pack — a short list of deliberate exceptions, stored on `threads`.
 */
export type BrainOverride = Partial<Record<AgentRole, string>>;

const ROLE_SET: ReadonlySet<string> = new Set(AGENT_ROLES);

/**
 * Read an override out of the `threads.brain_override` column — as the parsed jsonb or as the
 * raw text PowerSync hands the client.
 *
 * It DROPS what it cannot honour rather than storing it: an unknown role nothing would ever read,
 * and — the one that matters — a model outside the server's allow-list, which would resolve a seat
 * onto something the runtime refuses. This is the gate that lets `seatModel` trust its input, and
 * it is why the daemon parses before it resolves.
 *
 * An override that drops to nothing is **null, not `{}`**: an empty object on the column would
 * read as "this thread has an override" everywhere that tests for absence, and would put a
 * "0 changed here" pill on a conversation nobody changed.
 */
export function parseBrainOverride(raw: unknown): BrainOverride | null {
  let v = raw;
  if (typeof v === 'string') {
    if (!v.trim()) return null;
    try { v = JSON.parse(v); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out: BrainOverride = {};
  let any = false;
  for (const [role, model] of Object.entries(v as Record<string, unknown>)) {
    if (!ROLE_SET.has(role)) continue;
    if (typeof model !== 'string' || !MODEL_ID_SET.has(model)) continue;
    out[role as AgentRole] = model;
    any = true;
  }
  return any ? out : null;
}

/** What goes back on the column. Ruling 7 — Reset is the WHOLE override, so empty means empty. */
export function serializeBrainOverride(o: BrainOverride | null | undefined): string | null {
  const parsed = o ? parseBrainOverride(o) : null;
  return parsed ? JSON.stringify(parsed) : null;
}

/** How many roles this conversation actually changed — the pill's "2 changed here". */
export function brainOverrideCount(o: BrainOverride | null | undefined): number {
  return o ? Object.keys(parseBrainOverride(o) ?? {}).length : 0;
}

/** One seat as the pill and the roles overlay show it. */
export interface BrainSeat {
  role: AgentRole;
  name: string;
  emoji: string | null;
  /** what this seat WILL run on its next wake — the resolved answer, not the pack's intent */
  model: string;
  /** the thread override is what decided it (drives the warm chip + the "N changed" count) */
  changed: boolean;
  /** a human pin — nothing below it can move this seat, and the UI must not pretend otherwise */
  pinned: boolean;
}

/**
 * The cast: who holds each role here, and what each one will actually run.
 *
 * The mockup's whole first claim is that the pill stops naming a pack and starts naming PEOPLE,
 * and this is where "what will patch run" gets answered — through the same `seatModel` the daemon
 * resolves with, so the roles table and the next wake cannot disagree. One agent per role (the
 * first registered wins), because a role is a seat and the overlay changes what a seat runs.
 */
/**
 * The order a CAST reads in, which is not the order roles are declared in.
 *
 * `AGENT_ROLES` is the wire enum — a closed set, ordered by when each role was added — and sorting
 * a human-facing list by it put the reviewer above the orchestrator. The **orchestrator leads**:
 * it is the room's owner and the model most work is routed through (George, 2026-07-31). The rest
 * follow the order the pack cards already preview in, so the Roles tab and the Packs tab describe
 * the same team in the same sequence rather than two orders of the same nine seats.
 */
const CAST_ORDER: readonly AgentRole[] = [
  ...PACK_PREVIEW_ROLES,
  ...PACK_SUPPORT_ROLES,
  ...AGENT_ROLES.filter((r) => !PACK_PREVIEW_ROLES.includes(r) && !PACK_SUPPORT_ROLES.includes(r)),
];
const castRank = (role: AgentRole): number => {
  const i = CAST_ORDER.indexOf(role);
  return i < 0 ? CAST_ORDER.length : i; // an unknown role sorts last rather than first
};

export function brainCast(input: {
  agents: ReadonlyArray<{ name: string; role: string; model: string; modelSource?: string | null; emoji?: string | null }>;
  projectPack?: string | null;
  custom?: readonly CustomModelPack[];
  threadOverride?: BrainOverride | null;
}): BrainSeat[] {
  const override = parseBrainOverride(input.threadOverride);
  const seen = new Set<string>();
  const out: BrainSeat[] = [];
  for (const a of input.agents) {
    if (!(ROLE_SET.has(a.role)) || seen.has(a.role)) continue;
    seen.add(a.role);
    const role = a.role as AgentRole;
    const pinned = (a.modelSource ?? 'pack') === 'manual';
    const model = seatModel({
      role, currentModel: a.model, modelSource: a.modelSource,
      projectPack: input.projectPack, custom: input.custom, threadOverride: override,
    });
    out.push({ role, name: a.name, emoji: a.emoji ?? null, model, changed: !pinned && !!override?.[role] && model === override[role], pinned });
  }
  return out.sort((x, y) => castRank(x.role) - castRank(y.role));
}

/**
 * The model an agent actually runs for work in a given PROJECT (docs/10 per-project brains) and,
 * since docs/10 §15, in a given CONVERSATION.
 *
 * Workspace packs are MATERIALIZED into agents.model when applied, so `currentModel` already
 * carries the workspace default. A project pack cannot be materialized the same way — one
 * agent row has one model column, and the same agent works across projects — so it is
 * resolved here, per run, from the project's override. A thread override is the same shape of
 * problem one level narrower, so it resolves in the same place.
 *
 * Precedence, most specific first:
 *   1. a human's manual pin (model_source='manual') — the most deliberate intent there is,
 *      and the UI already promises "Pinned · reset to pack default". A project pack must
 *      never quietly undo it, and neither may a thread.
 *   2. the THREAD's brain override, by role. It names exactly the roles it changes and does
 *      **not** fall back to the developer seat the way a pack does: a pack is a complete
 *      opinion about every seat, an override is a list of exceptions, and spilling one role's
 *      exception onto another would be a change nobody asked for.
 *   3. the project's pack override, by role (unknown role → the developer seat, matching
 *      how the failover switch fills gaps).
 *   4. `currentModel` — the workspace pack's materialized value, or a legacy/unmanaged model.
 *
 * Resolved per WAKE, like everything else here, which is what makes "mid-run turns finish on the
 * model they started with" true by construction rather than by a guard.
 */
export function seatModel(input: {
  role: AgentRole;
  currentModel: string;
  modelSource?: string | null;
  projectPack?: string | null;
  custom?: readonly CustomModelPack[];
  threadOverride?: BrainOverride | null;
}): string {
  if ((input.modelSource ?? 'pack') === 'manual') return input.currentModel;
  const override = parseBrainOverride(input.threadOverride)?.[input.role];
  if (override) return override;
  const roles = resolvePackRoles(input.projectPack, input.custom ?? []);
  if (!roles) return input.currentModel;
  return roles[input.role] ?? roles.developer ?? input.currentModel;
}

/** Display name for ANY active-pack id (sentinel → 'Manual'; unknown → null). */
export function resolvePackName(packId: string | null | undefined, custom: readonly CustomModelPack[]): string | null {
  if (!packId || packId === CUSTOM_PACK_ID) return 'Manual';
  return PACKS[packId]?.name ?? custom.find((p) => p.id === packId)?.name ?? null;
}

/**
 * The sensible default pack for a brand-new workspace given its configured providers.
 * Anthropic+Gemini → balanced (cost-aware, the one-click ultracode upgrade sits above it);
 * a single provider → that provider's -core pack (Anthropic-first on ties). Identity packs
 * (fast) are opt-in choices, never defaults.
 *
 * **None → the platform pack**, since the starter-brain round: a workspace with no provider is no
 * longer a workspace with no answer. It used to return null and onboarding gated on connecting
 * something first — the wall this round removes.
 */
export function defaultPackForProviders(ready: readonly Provider[]): string {
  const has = (p: Provider) => ready.includes(p);
  if (has('anthropic') && has('gemini')) return 'balanced';
  if (has('anthropic')) return 'claude-core';
  if (has('openai')) return 'openai-core';
  if (has('gemini')) return 'gemini-core';
  return STARTER_PACK_ID;
}

/** Fail fast (everywhere) if a pack references a model id not in the allow-list. */
export function assertPacksValid(): void {
  for (const pack of Object.values(PACKS)) {
    for (const [role, id] of Object.entries(pack.roles)) {
      if (!MODEL_ID_SET.has(id)) {
        throw new Error(`model-packs: pack "${pack.id}" role "${role}" references unknown model "${id}"`);
      }
    }
  }
}
assertPacksValid();
