import { describe, it, expect } from 'vitest';
import {
  PACKS, PACK_ORDER, MODEL_ID_SET, MODEL_IDS, LEGACY_MODELS, CURRENT_MODELS, CUSTOM_PACK_ID, STARTER_PACK_ID,
  providerForModel, runtimeForModel, packRequiredProviders, isPackActivatable,
  missingProviders, packModelForRole, defaultPackForProviders, assertPacksValid,
  isCustomPackId, requiredProvidersForRoles, missingProvidersForRoles, rolesActivatable,
  PACK_PREVIEW_ROLES, PACK_SUPPORT_ROLES, resolvePackRoles, resolvePackName, seatModel,
  type Provider,
} from '../src/model-packs';
import { AGENT_ROLES, type AgentRole } from '../src/states';
import { STARTER_MODEL } from '../src/rates';

const ALL_ROLES: AgentRole[] = ['worker', 'developer', 'reviewer', 'orchestrator', 'designer', 'sales', 'architect', 'curator'];

describe('catalog integrity', () => {
  it('every pack model is a known, routable id (no hallucinated/typo ids)', () => {
    expect(() => assertPacksValid()).not.toThrow();
    for (const pack of Object.values(PACKS)) {
      for (const id of Object.values(pack.roles)) expect(MODEL_ID_SET.has(id)).toBe(true);
    }
  });

  it('every pack covers all 8 agent roles', () => {
    for (const pack of Object.values(PACKS)) {
      for (const role of ALL_ROLES) expect(pack.roles[role], `${pack.id}.${role}`).toBeTruthy();
    }
  });

  it('worker aliases developer in every pack', () => {
    for (const pack of Object.values(PACKS)) expect(pack.roles.worker).toBe(pack.roles.developer);
  });

  it('PACK_ORDER lists exactly the defined packs', () => {
    expect([...PACK_ORDER].sort()).toEqual(Object.keys(PACKS).sort());
  });

  it('MODEL_IDS contains the current per-runtime catalog', () => {
    for (const ids of Object.values(CURRENT_MODELS)) for (const id of ids) expect(MODEL_ID_SET.has(id)).toBe(true);
  });
});

describe('provider/runtime derivation', () => {
  it('maps model families to credential providers', () => {
    expect(providerForModel('claude-opus-4-8')).toBe('anthropic');
    expect(providerForModel('gpt-5.5')).toBe('openai');
    expect(providerForModel('gemini-3.5-flash')).toBe('gemini');
  });
  it('maps model families to runtimes', () => {
    expect(runtimeForModel('claude-sonnet-4-6')).toBe('claude-code');
    expect(runtimeForModel('gpt-5.4-mini')).toBe('codex');
    expect(runtimeForModel('gemini-3.1-flash-lite')).toBe('gemini');
  });
});

describe('required providers (derived, never hand-maintained)', () => {
  it('single-provider packs need exactly that provider', () => {
    expect(packRequiredProviders('claude-core')).toEqual(['anthropic']);
    expect(packRequiredProviders('openai-core')).toEqual(['openai']);
    expect(packRequiredProviders('gemini-core')).toEqual(['gemini']);
  });
  it('cross-provider packs need each family they reference', () => {
    // ultracode moved to anthropic+openai in the 2026-09 reseat: it is the best-per-role pack and
    // OpenAI won three of its four working seats. balanced stays anthropic+gemini.
    expect(packRequiredProviders('ultracode').sort()).toEqual(['anthropic', 'openai']);
    expect(packRequiredProviders('balanced').sort()).toEqual(['anthropic', 'gemini']);
    expect(packRequiredProviders('fast').sort()).toEqual(['anthropic', 'gemini']);
  });
  it('CUSTOM sentinel requires nothing', () => {
    expect(packRequiredProviders(CUSTOM_PACK_ID)).toEqual([]);
  });
});

describe('activation gating', () => {
  it('claude-core activatable iff Anthropic enabled', () => {
    expect(isPackActivatable('claude-core', ['anthropic'])).toBe(true);
    expect(isPackActivatable('claude-core', ['openai'])).toBe(false);
  });
  it('ultracode needs BOTH Anthropic and OpenAI; names the missing one', () => {
    expect(isPackActivatable('ultracode', ['anthropic'])).toBe(false);
    expect(missingProviders('ultracode', ['anthropic'])).toEqual(['openai']);
    expect(isPackActivatable('ultracode', ['anthropic', 'openai'])).toBe(true);
    expect(missingProviders('ultracode', ['anthropic', 'openai'])).toEqual([]);
  });
});

describe('onboarding default pack from configured providers', () => {
  const cases: Array<[Provider[], string | null]> = [
    [['anthropic', 'gemini'], 'balanced'],
    [['anthropic', 'openai', 'gemini'], 'balanced'],
    [['anthropic'], 'claude-core'],
    [['anthropic', 'openai'], 'claude-core'], // Anthropic-first on a non-balanced mix
    [['openai'], 'openai-core'],
    [['openai', 'gemini'], 'openai-core'], // OpenAI before Gemini
    [['gemini'], 'gemini-core'],
    [[], 'starter'], // no providers → the house brain (starter-brain round); it used to be null
  ];
  for (const [ready, expected] of cases) {
    it(`[${ready.join(',') || 'none'}] → ${expected}`, () => {
      expect(defaultPackForProviders(ready)).toBe(expected);
    });
  }
});

describe('role resolution', () => {
  it('returns the pack model for a role', () => {
    expect(packModelForRole('claude-core', 'architect')).toBe('claude-fable-5-1');
    expect(packModelForRole('openai-core', 'curator')).toBe('gpt-5.4-mini');
  });
  it('returns null for the CUSTOM sentinel / unknown pack', () => {
    expect(packModelForRole(CUSTOM_PACK_ID, 'developer')).toBeNull();
    expect(packModelForRole('nope', 'developer')).toBeNull();
  });
});

describe('benchmark reseat 2026-09-08 (suite v1.1 — revert only with bench evidence)', () => {
  it('claude-sonnet-5 is the DEFAULT Claude orchestrator (directed, and measured level with the leaders)', () => {
    expect(PACKS['claude-core']!.roles.orchestrator).toBe('claude-sonnet-5');
    expect(PACKS['balanced']!.roles.orchestrator).toBe('claude-sonnet-5');
  });
  it('claude-fable-5-1 holds the claude-core architect seat (DIRECTED against the measurement)', () => {
    // measured claude-sonnet-5 88 vs claude-fable-5-1 78, at an eighth of the cost and half the
    // latency. Founder decision 2026-09-08; a later run confirms or reverts it.
    expect(PACKS['claude-core']!.roles.architect).toBe('claude-fable-5-1');
  });
  it('gpt-6-astra takes both seats it won outright: review (only perfect F1) and planning', () => {
    expect(CURRENT_MODELS.codex).toContain('gpt-6-astra');
    expect(PACKS['ultracode']!.roles.reviewer).toBe('gpt-6-astra');
    expect(PACKS['openai-core']!.roles.reviewer).toBe('gpt-6-astra');
    expect(PACKS['ultracode']!.roles.architect).toBe('gpt-6-astra');
    expect(PACKS['openai-core']!.roles.architect).toBe('gpt-6-astra');
  });
  it('claude-sonnet-5 holds the developer seat wherever Anthropic is available', () => {
    // seven models tied at exactly 100%, so the seat broke on speed and cost: sonnet-5 was the
    // fastest of them and the second cheapest
    for (const pack of ['ultracode', 'balanced', 'fast', 'claude-core'] as const) {
      expect(PACKS[pack]!.roles.developer, pack).toBe('claude-sonnet-5');
      expect(PACKS[pack]!.roles.worker, pack).toBe('claude-sonnet-5');
    }
  });
  it('the Gemini architect seat no longer needs the preview exception, but the developer seat still does', () => {
    // 3.8 Flash (GA) beat the 3.1 Pro preview on planning at under half the cost and latency…
    expect(PACKS['gemini-core']!.roles.architect).toBe('gemini-3.8-flash');
    // …but 3.1 Pro is the only Gemini model that reached 100% on coding
    expect(PACKS['gemini-core']!.roles.developer).toBe('gemini-3.1-pro-preview');
  });
  it('every superseded id is retired from the catalog but still routable', () => {
    for (const id of ['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-5.5', 'gpt-5.5-pro', 'gemini-3.5-flash']) {
      expect(MODEL_IDS, `${id} must stay routable for agents already on it`).toContain(id);
      expect(LEGACY_MODELS, `${id} must be retired`).toContain(id);
      for (const pack of PACK_ORDER) {
        expect(Object.values(PACKS[pack]!.roles), `${pack} seats retired ${id}`).not.toContain(id);
      }
    }
  });
  it('the mini tier won three roles and still holds no working seat (founder rule)', () => {
    // gpt-5.4-mini won research, planning and orchestration outright in this run
    for (const pack of PACK_ORDER) {
      if (PACKS[pack]!.platform) continue;
      for (const role of [...PACK_PREVIEW_ROLES, 'shipper' as const, 'worker' as const]) {
        expect(['gpt-5.4-mini', 'gemini-3.1-flash-lite'], `${pack}.${role}`).not.toContain(PACKS[pack]!.roles[role]);
      }
    }
  });
});

describe('fast pack (fastest full-strength seat per role, founder rule: no mini/lite working seats)', () => {
  it('holds the measured + curated seats (re-seated on the 2026-09 latencies)', () => {
    expect(packModelForRole('fast', 'orchestrator')).toBe('gemini-3.8-flash');
    expect(packModelForRole('fast', 'architect')).toBe('gemini-3.8-flash');
    expect(packModelForRole('fast', 'developer')).toBe('claude-sonnet-5');
    expect(packModelForRole('fast', 'reviewer')).toBe('gemini-3.8-flash');
    expect(packModelForRole('fast', 'designer')).toBe('claude-sonnet-5');
    expect(packModelForRole('fast', 'shipper')).toBe('claude-sonnet-5');
    expect(packModelForRole('fast', 'sales')).toBe('claude-haiku-4-5');
    expect(packModelForRole('fast', 'curator')).toBe('claude-haiku-4-5');
  });
  it('no mini/lite-tier model holds a WORKING seat (haiku allowed on support only)', () => {
    const smallTier = ['gpt-5.4-mini', 'gemini-3.1-flash-lite'];
    for (const role of [...PACK_PREVIEW_ROLES, 'shipper' as const, 'worker' as const]) {
      expect(smallTier, `fast.${role}`).not.toContain(PACKS['fast']!.roles[role]);
    }
  });
  it('reviewer sits on a different family than the developer (independent judgment)', () => {
    expect(providerForModel(PACKS['fast']!.roles.reviewer)).not.toBe(providerForModel(PACKS['fast']!.roles.developer));
  });
  it('needs exactly anthropic + gemini — the same gate as the other cross-provider packs', () => {
    expect(packRequiredProviders('fast').sort()).toEqual(['anthropic', 'gemini']);
  });
  it('sits after balanced in PACK_ORDER (cross-provider packs first)', () => {
    expect(PACK_ORDER.indexOf('fast')).toBe(2);
    expect(PACK_ORDER.indexOf('fast')).toBeLessThan(PACK_ORDER.indexOf('claude-core'));
  });
  it('is never an onboarding default for any provider combination', () => {
    const all: Provider[] = ['anthropic', 'openai', 'gemini'];
    for (let mask = 0; mask < 8; mask++) {
      const ready = all.filter((_, i) => mask & (1 << i));
      expect(defaultPackForProviders(ready)).not.toBe('fast');
    }
  });
  it('carries measured latency toks for the benched working roles (worker mirrors developer)', () => {
    const lat = PACKS['fast']!.latency!;
    for (const role of ['orchestrator', 'architect', 'developer', 'worker', 'reviewer'] as const) {
      expect(lat[role], `latency.${role}`).toMatch(/^\d+(\.\d+)?s$/);
    }
    expect(lat.worker).toBe(lat.developer);
    expect(lat.designer).toBeUndefined(); // curated seat — no bench dimension yet
  });
});

describe('starter pack (2026-08-28 — the house brain: the one pack that needs no credential)', () => {
  it('is activatable from a standing start — the entire reason it exists', () => {
    expect(packRequiredProviders(STARTER_PACK_ID)).toEqual([]);
    expect(isPackActivatable(STARTER_PACK_ID, [])).toBe(true);
    expect(missingProviders(STARTER_PACK_ID, [])).toEqual([]);
  });

  it('seats the shared rate card\'s STARTER_MODEL on every role, and it is a catalogued id', () => {
    for (const role of AGENT_ROLES) expect(packModelForRole(STARTER_PACK_ID, role)).toBe(STARTER_MODEL);
    expect(CURRENT_MODELS.gemini).toContain(STARTER_MODEL);
    expect(MODEL_ID_SET.has(STARTER_MODEL)).toBe(true);
  });

  it('is the default for a workspace with nothing connected, and never displaces a real provider', () => {
    expect(defaultPackForProviders([])).toBe(STARTER_PACK_ID);
    const all: Provider[] = ['anthropic', 'openai', 'gemini'];
    for (let mask = 1; mask < 8; mask++) {
      const ready = all.filter((_, i) => mask & (1 << i));
      expect(defaultPackForProviders(ready)).not.toBe(STARTER_PACK_ID);
    }
  });

  it('is the ONLY platform pack — every other seat still costs the user a key', () => {
    for (const id of PACK_ORDER) {
      expect(!!PACKS[id]!.platform, id).toBe(id === STARTER_PACK_ID);
      if (id !== STARTER_PACK_ID) expect(packRequiredProviders(id).length).toBeGreaterThan(0);
    }
  });

  it('sits last in PACK_ORDER — a floor, not an opinion competing with the curated packs', () => {
    expect(PACK_ORDER[PACK_ORDER.length - 1]).toBe(STARTER_PACK_ID);
  });

  it('resolves like any other builtin, so no caller needs to know it is special', () => {
    expect(resolvePackRoles(STARTER_PACK_ID, [])).toBe(PACKS[STARTER_PACK_ID]!.roles);
    expect(resolvePackName(STARTER_PACK_ID, [])).toBe('NeuraMesh brain');
    expect(isCustomPackId(STARTER_PACK_ID)).toBe(false); // a real builtin id, never a sentinel
    expect(seatModel({ role: 'developer', currentModel: 'claude-opus-4-8', projectPack: STARTER_PACK_ID })).toBe(STARTER_MODEL);
  });
});

describe('gpt-5.6-luna exclusion (2026-07-17 — smoke: codex-cli ≤0.140.0 400s it → silent-downgrade risk)', () => {
  it('is neither offered nor accepted until the codex runtime verifiably serves it', () => {
    expect(CURRENT_MODELS.codex).not.toContain('gpt-5.6-luna');
    expect(MODEL_ID_SET.has('gpt-5.6-luna')).toBe(false);
  });
});

describe('legacy compatibility', () => {
  it('accepts retired-but-routable ids so existing agents stay editable', () => {
    expect(MODEL_ID_SET.has('gemini-2.5-pro')).toBe(true);
    expect(MODEL_ID_SET.has('gpt-5')).toBe(true);
  });
  it('rejects genuinely unknown ids', () => {
    expect(MODEL_ID_SET.has('gemini-3.1-pro')).toBe(false); // the id the user originally referenced — never existed
    expect(MODEL_ID_SET.has('gpt-9')).toBe(false);
  });
});

describe('custom brains (user-authored packs)', () => {
  const roles = {
    orchestrator: 'claude-sonnet-4-6', architect: 'claude-opus-4-8',
    developer: 'claude-haiku-4-5', worker: 'claude-haiku-4-5',
    reviewer: 'gemini-3.5-flash', designer: 'claude-sonnet-5',
    sales: 'gemini-3.1-flash-lite', curator: 'gemini-3.1-flash-lite',
  } as const;

  it('custom ids are prefixed and never collide with builtin ids or the sentinel', () => {
    expect(isCustomPackId('custom:6f1e0d3c-2a44-4a1a-9c2b-8f3d5e7a9b01')).toBe(true);
    expect(isCustomPackId(CUSTOM_PACK_ID)).toBe(false); // the bare sentinel is NOT a custom brain
    for (const id of Object.keys(PACKS)) expect(isCustomPackId(id)).toBe(false);
    expect(isCustomPackId(null)).toBe(false);
    expect(isCustomPackId(undefined)).toBe(false);
  });

  it('derives required providers from an arbitrary roles map (custom brains included)', () => {
    expect(requiredProvidersForRoles(roles).sort()).toEqual(['anthropic', 'gemini']);
    expect(missingProvidersForRoles(roles, ['anthropic'])).toEqual(['gemini']);
    expect(rolesActivatable(roles, ['anthropic', 'gemini'])).toBe(true);
    expect(rolesActivatable(roles, ['anthropic'])).toBe(false);
  });

  it('builtin packRequiredProviders stays derived through the shared helper', () => {
    // …for every pack the USER pays for. A platform pack is the documented exception: the
    // credential is ours, so its requirement is none regardless of what its model ids imply.
    for (const id of PACK_ORDER.filter((p) => !PACKS[p]!.platform)) {
      expect(packRequiredProviders(id).sort()).toEqual(requiredProvidersForRoles(PACKS[id]!.roles).sort());
    }
  });
});

describe('picker preview roles', () => {
  it('previews the six working roles — designer (docs/14) and marketer (marketing-channel plan) seated, support roles separate', () => {
    expect(PACK_PREVIEW_ROLES).toEqual(['orchestrator', 'architect', 'developer', 'reviewer', 'designer', 'marketer']);
    expect(PACK_SUPPORT_ROLES).toEqual(['shipper', 'sales', 'curator']);
    // worker never previews — it aliases developer
    expect(PACK_PREVIEW_ROLES).not.toContain('worker');
    expect([...PACK_PREVIEW_ROLES, ...PACK_SUPPORT_ROLES, 'worker'].sort()).toEqual([...AGENT_ROLES].sort());
  });
});

describe('active-pack resolution (builtin · custom · sentinel)', () => {
  const custom = [{
    id: 'custom:6f1e0d3c-2a44-4a1a-9c2b-8f3d5e7a9b01', name: 'Weekend budget',
    roles: { ...PACKS['balanced']!.roles, designer: 'claude-opus-4-8' },
  }];
  it('resolves builtin ids from the catalog without consulting the custom list', () => {
    expect(resolvePackRoles('ultracode', [])).toBe(PACKS['ultracode']!.roles);
    expect(resolvePackName('ultracode', [])).toBe('Ultracode');
  });
  it('resolves custom ids from the provided list', () => {
    expect(resolvePackRoles(custom[0]!.id, custom)?.designer).toBe('claude-opus-4-8');
    expect(resolvePackName(custom[0]!.id, custom)).toBe('Weekend budget');
  });
  it('sentinel → null roles + "Manual"; unknown → null/null', () => {
    expect(resolvePackRoles(CUSTOM_PACK_ID, custom)).toBeNull();
    expect(resolvePackName(CUSTOM_PACK_ID, custom)).toBe('Manual');
    expect(resolvePackRoles(null, custom)).toBeNull();
    expect(resolvePackName(null, custom)).toBe('Manual');
    expect(resolvePackRoles('nope', custom)).toBeNull();
    expect(resolvePackRoles('custom:not-in-list', custom)).toBeNull();
    expect(resolvePackName('custom:not-in-list', custom)).toBeNull();
  });
});

// ── seatModel: per-project brains (docs/10) ─────────────────────────────────
// Workspace packs are materialized into agents.model; a PROJECT pack cannot be
// (one agent row, one model column, many projects) so it resolves per run.
describe('seatModel — the project override, resolved at run time', () => {
  const dev = { role: 'developer' as const, currentModel: 'claude-opus-4-8' };

  it('with no project override, the workspace materialization stands', () => {
    expect(seatModel({ ...dev, projectPack: null })).toBe('claude-opus-4-8');
    expect(seatModel({ ...dev })).toBe('claude-opus-4-8');
    expect(seatModel({ ...dev, projectPack: CUSTOM_PACK_ID })).toBe('claude-opus-4-8'); // the "unmanaged" sentinel
    expect(seatModel({ ...dev, projectPack: 'not-a-pack' })).toBe('claude-opus-4-8');
  });

  it('a project pack re-seats the agent by ROLE', () => {
    const pack = 'openai-core';
    const roles = PACKS[pack]!.roles;
    for (const role of AGENT_ROLES) {
      expect(seatModel({ role, currentModel: 'claude-opus-4-8', projectPack: pack })).toBe(roles[role]);
    }
  });

  it('a human pin outranks the project pack — a pack switch never undoes it', () => {
    expect(seatModel({ ...dev, modelSource: 'manual', projectPack: 'openai-core' })).toBe('claude-opus-4-8');
    // …while a pack-managed seat moves
    expect(seatModel({ ...dev, modelSource: 'pack', projectPack: 'openai-core' })).toBe(PACKS['openai-core']!.roles.developer);
  });

  it('resolves a custom project pack from the workspace list', () => {
    const custom = [{ id: 'custom:abc', name: 'Mine', roles: { ...PACKS['claude-core']!.roles, developer: 'gpt-5.6-sol' } }] as never;
    expect(seatModel({ ...dev, projectPack: 'custom:abc', custom })).toBe('gpt-5.6-sol');
    // an id the workspace doesn't have (deleted pack) falls back rather than crashing
    expect(seatModel({ ...dev, projectPack: 'custom:gone', custom })).toBe('claude-opus-4-8');
  });
});
