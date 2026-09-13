// the parts of the credit lane that must not be wrong: the price, the guard, and who may look.
// the SQL paths (grant/spend transactions) are exercised by the pg suite; these are the pure
// and route-level contracts that hold whether or not a database is present.
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDITS_PER_USD, CREDIT_MICROS, CREDIT_PACKS, MAX_PACK_CREDITS, MIN_PACK_CREDITS, STARTER_MODEL, creditsForUsd, creditsToMicros, microsToCredits, priceModelCall, usdForCredits } from '@neuramesh/shared';
import { creditRoutes, type Ledger } from './credits.js';
import type { Store } from './store';

describe('the rate card', () => {
  it('prices a call from the vendor-reported token counts', () => {
    // 1M in + 1M out at $0.30/$2.50 = $2.80 = 2,800,000 µUSD
    expect(priceModelCall(STARTER_MODEL, 1_000_000, 1_000_000)).toBe(2_800_000);
    // a realistic orchestrator turn: ~11.7k static prompt + a short answer
    expect(priceModelCall(STARTER_MODEL, 11_700, 400)).toBe(4_510);
  });

  it('an unknown model prices at zero rather than guessing', () => {
    // a wrong number in a ledger is worse than a visible gap — it is a bill nobody can explain
    expect(priceModelCall('some-model-we-never-added', 1_000_000, 1_000_000)).toBe(0);
  });

  it('credits round-trip, and remaining credits FLOOR', () => {
    expect(creditsToMicros(500)).toBe(500 * CREDIT_MICROS);
    expect(microsToCredits(creditsToMicros(500))).toBe(500);
    // never show a credit the balance cannot actually pay for
    expect(microsToCredits(CREDIT_MICROS - 1)).toBe(0);
    expect(microsToCredits(CREDIT_MICROS * 3 + 9_999)).toBe(3);
  });
});

describe('the credit routes', () => {
  const WS = '3c9f8a04-8d2e-4d7b-9a51-0f6f0e1c2ab3';
  let prev: string | undefined;
  beforeAll(() => { prev = process.env['STARTER_GOOGLE_API_KEY']; delete process.env['STARTER_GOOGLE_API_KEY']; });
  afterAll(() => { if (prev === undefined) delete process.env['STARTER_GOOGLE_API_KEY']; else process.env['STARTER_GOOGLE_API_KEY'] = prev; });

  const mk = (over: { store?: Partial<Store>; ledger?: Partial<Ledger>; capMin?: () => number } = {}, actor: unknown = { kind: 'human', id: 'u-me' }): Hono => {
    const app = new Hono();
    app.use('/v1/*', async (c, next) => { c.set('actor' as never, actor as never); await next(); });
    const ledger: Ledger = {
      balance: async () => ({ grantedMicros: 5_000_000, spentMicros: 1_000_000, purchasedMicros: 0, purchasedSpentMicros: 0, remainingMicros: 4_000_000, grantRemainingMicros: 4_000_000, purchasedRemainingMicros: 0, periodStart: '2026-08-01' }),
      usage: async () => ({ day: '2026-08-28', minutes: 23, activeSeconds: 480, modelCalls: 7, modelMicros: 1_000_000, machineMicros: 8_000 }),
      spend: async () => ({ remainingMicros: 0 }),
      ...over.ledger,
    };
    const store = { humanMemberIds: async () => ['u-me'], agentWorkspace: async () => WS, workspacePlan: async () => 'free', ...over.store } as unknown as Store;
    creditRoutes(app as never, store, ledger);
    return app;
  };

  it('reports the balance in credits, with the machine and brain lines beside it', async () => {
    const res = await mk().request(`/v1/usage?workspace=${WS}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { credits: { remaining: number }; machine: { minutesToday: number }; brain: { model: string } };
    expect(body.credits.remaining).toBe(400); // 4,000,000 µUSD = 400 credits
    expect(body.machine.minutesToday).toBe(23);
    expect(body.brain.model).toBe(STARTER_MODEL);
  });

  it('the machine line reports active seconds and NO cap — the daily minute cap died with credits', async () => {
    const res = await mk().request(`/v1/usage?workspace=${WS}`);
    const body = (await res.json()) as { machine: { minutesToday: number; activeSecondsToday: number; capMinutes: number | null; plan: string } };
    // capMinutes is always null now; the credit balance is the budget. minutes/activeSeconds are telemetry.
    expect(body.machine).toEqual({ minutesToday: 23, activeSecondsToday: 480, capMinutes: null, plan: 'free' });
  });

  it('credits carry the grant/purchased split and the out-of-credits gate', async () => {
    const res = await mk().request(`/v1/usage?workspace=${WS}`);
    const body = (await res.json()) as { credits: { remaining: number; grantRemaining: number; purchasedRemaining: number; outOfCredits: boolean } };
    expect(body.credits.grantRemaining).toBe(400); // 4,000,000 µUSD
    expect(body.credits.purchasedRemaining).toBe(0);
    expect(body.credits.outOfCredits).toBe(false);
  });

  it('refuses a workspace the caller is not in — the uuid is not the authorization', async () => {
    const res = await mk({ store: { humanMemberIds: async () => ['someone-else'] } }).request(`/v1/usage?workspace=${WS}`);
    expect(res.status).toBe(403);
  });

  it('an empty balance is 402 and the model is NEVER called', async () => {
    // the check happens before the vendor request, so an out-of-credits workspace cannot spend
    // our money. no api key is set here either — reaching the call would surface as 503.
    const res = await mk({
      ledger: { balance: async () => ({ grantedMicros: 100, spentMicros: 100, purchasedMicros: 0, purchasedSpentMicros: 0, remainingMicros: 0, grantRemainingMicros: 0, purchasedRemainingMicros: 0, periodStart: '2026-08-01' }) },
    }).request('/v1/starter/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: WS, contents: [] }),
    });
    expect(res.status).toBe(402);
    expect((await res.json() as { code: string }).code).toBe('NO_CREDITS');
  });

  it('an unconfigured starter key fails loudly rather than silently', async () => {
    const res = await mk().request('/v1/starter/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: WS, contents: [] }),
    });
    expect(res.status).toBe(503);
  });

  it('generate refuses a workspace the caller is not in, before touching the key', async () => {
    const res = await mk({ store: { humanMemberIds: async () => ['someone-else'] } }).request('/v1/starter/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: WS, contents: [] }),
    });
    expect(res.status).toBe(403);
  });
});

// ── custom top-up pricing (2026-08-31) ──────────────────────────────────────────────────────
//
// The menu stopped being the price list: any amount inside the bounds is buyable. That is only
// safe because the SERVER still computes the price — so what has to be true is that one flat
// rule prices every size, and that the two directions are exact inverses (the UI lets a person
// type into either field, and a rounding drift there would quote a number nobody gets charged).
describe('custom top-up pricing — one flat rule, both directions', () => {
  it('prices every published pack exactly, so the menu is just pre-filled amounts', () => {
    for (const pk of CREDIT_PACKS) expect(usdForCredits(pk.credits)).toBe(pk.usd);
  });

  it('converts both ways without drift', () => {
    for (const usd of [5, 12.5, 60, 99.99, 10_000]) {
      expect(usdForCredits(creditsForUsd(usd))).toBeCloseTo(usd, 10);
    }
    for (const credits of [500, 1_251, 6_000, 7_300, MAX_PACK_CREDITS]) {
      expect(creditsForUsd(usdForCredits(credits))).toBe(credits);
    }
  });

  it('keeps the credit worth exactly one cent, the unit every explanation leans on', () => {
    expect(CREDITS_PER_USD).toBe(100);
    expect(usdForCredits(1)).toBeCloseTo(0.01, 10);
    expect(creditsToMicros(CREDITS_PER_USD)).toBe(1_000_000); // $1 in µUSD
  });

  it('rounds a sub-cent dollar figure to a whole credit rather than a fraction', () => {
    // the UI settles the field to match; the server would price 1251 credits at $12.51
    expect(creditsForUsd(12.505)).toBe(1_251);
    expect(Number.isInteger(creditsForUsd(0.999))).toBe(true);
  });

  it('bounds the purchasable range, and the smallest pack sits on the floor', () => {
    expect(MIN_PACK_CREDITS).toBe(Math.min(...CREDIT_PACKS.map((p) => p.credits)));
    expect(MAX_PACK_CREDITS).toBeGreaterThan(MIN_PACK_CREDITS);
    expect(usdForCredits(MIN_PACK_CREDITS)).toBe(5);
    expect(usdForCredits(MAX_PACK_CREDITS)).toBe(10_000);
  });
});
