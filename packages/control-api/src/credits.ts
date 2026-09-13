// The metered proxy and the credit ROUTES (docs/design/cloud-first-2026-08). The starter model
// is called from HERE, never from a machine — the platform key stays in this process, so every
// call is metered and the balance guard is a server invariant, not a client promise. The data
// functions the routes stand on live in credit-ledger.ts.
import type { Env, Hono } from 'hono';
import type postgres from 'postgres';
import { z } from 'zod';
import {
  CLOUD_SEAT_MONTHLY_CREDITS,
  RATE_VERSION,
  STARTER_MODEL,
  STARTER_THINKING_LEVEL,
  microsToCredits,
  priceModelCall,
  type Actor,
} from '@neuramesh/shared';
// credits.ts stays the module's front door: it re-exports the ledger's surface so callers that
// imported these before the 2026-08-31 split keep working, and imports for its own use the few
// the routes call directly.
export {
  chargeMachineActivity, creditBalance, grantCredits, spendCredits, usageToday,
  workspacesDueRefill, type CreditBalance, type UsageToday,
} from './credit-ledger';
import { creditBalance, grantCredits, spendCredits, usageToday, type CreditBalance, type UsageToday } from './credit-ledger';
import { planDiskGb } from './fleet';
import { localMode } from './localmode';
import type { Store } from './store';

export function sqlOf(store: Store): postgres.Sql | null {
  return (store as { sql?: postgres.Sql }).sql ?? null;
}

/** the webhook's two named paths (this one and plan-flip.ts) share one outcome vocabulary:
 *  the caller turns anything but 'ok' into a non-2xx so Stripe redelivers. */
export type WebhookOutcome = 'ok' | 'unavailable' | 'failed';

/**
 * APPLY A PAID CREDIT PACK. Split out of the Stripe webhook so the money path is a named thing
 * with its own outcomes rather than three branches inside a 700-line route file.
 *
 * The caller MUST turn anything but 'ok' into a non-2xx. By the time this runs the customer has
 * already paid, and Stripe only redelivers on a failing status — so a swallowed error here is a
 * charge with no credits, no retry, and no alert. That is exactly what shipped the first time.
 *
 * 'unavailable' means the store has no sql pool: a misconfiguration, not a no-op. It gets a
 * retryable status too, because the next delivery may reach a healthy replica.
 */
export async function applyCreditPack(
  store: Store,
  pack: { workspace: string; credits: number; sessionId: string },
): Promise<WebhookOutcome> {
  const sql = sqlOf(store);
  if (!sql) {
    console.error(`credit_pack_grant_unavailable workspace=${pack.workspace} session=${pack.sessionId}: store has no sql pool`);
    return 'unavailable';
  }
  try {
    // idempotent by session id — Stripe redelivers, and a replay must not double-grant
    await grantCredits(sql, pack.workspace, pack.credits, 'purchase', pack.sessionId);
    return 'ok';
  } catch (e) {
    console.error(`credit_pack_grant_failed workspace=${pack.workspace} session=${pack.sessionId}: ${e instanceof Error ? e.message : e}`);
    return 'failed';
  }
}

/** what the routes actually need. narrow on purpose: the handlers depend on three operations,
 *  not on postgres — which is what makes their guards testable without a database. */
export interface Ledger {
  balance(workspaceId: string): Promise<CreditBalance>;
  spend(workspaceId: string, micros: number, usage: { inTokens: number; outTokens: number }): Promise<{ remainingMicros: number } | null>;
  usage(workspaceId: string): Promise<UsageToday>;
}

export function ledgerFor(store: Store): Ledger | null {
  const sql = sqlOf(store);
  if (!sql) return null;
  return {
    balance: (w) => creditBalance(sql, w),
    spend: (w, micros, usage) => spendCredits(sql, w, micros, usage),
    usage: (w) => usageToday(sql, w),
  };
}

// ── the routes ────────────────────────────────────────────────────────────────────────────

const GenerateSchema = z.object({
  workspace: z.string().uuid(),
  /** the turn, already assembled by the caller — this proxy is a transport, not a prompt author */
  contents: z.unknown(),
  system: z.string().optional(),
  tools: z.unknown().optional(),
});

interface GeminiUsage { promptTokenCount?: number; candidatesTokenCount?: number }

/** the free plan's daily wake-minute allowance. INJECTED rather than imported: the cap is a
 *  fleet policy (fleet-lifecycle owns its env var and the force-stop that enforces it) and that
 *  module already imports this one, so reaching back for it would make the two routes a cycle.
 *  /v1/usage only REPORTS the number — the guard stays where the stop happens. */
export function creditRoutes<E extends Env & { Variables: { actor: Actor } }>(app: Hono<E>, store: Store, ledger: Ledger | null = ledgerFor(store)): void {
  // the starter brain. the platform key never leaves this process, the balance is checked
  // before the call and debited after it, and the response carries what is left so a client
  // never has to ask separately.
  app.post('/v1/starter/generate', async (c) => {
    // the one door the local stack keeps shut: the starter key lives on the cloud and never
    // reaches a machine (CLAUDE.md #5). Said plainly, with the way forward.
    if (localMode()) return c.json({ error: 'The local stack has no starter brain. Add your own model key.', code: 'UNAVAILABLE' }, 503);
    if (!ledger) return c.json({ error: 'credits not served by this store' }, 501);
    const body = GenerateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'invalid body', issues: body.error.issues }, 400);
    const { workspace } = body.data;
    if (!(await actorInWorkspace(store, c.get('actor'), workspace))) {
      return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    }
    // the balance guard runs FIRST, before our own configuration check: "you are out of
    // credits" is a true and stable answer about the caller's state whether or not the key is
    // set, and putting it first makes the guard provably the first thing that happens.
    const before = await ledger.balance(workspace);
    if (before.remainingMicros <= 0) {
      return c.json({ error: 'out of credits', code: 'NO_CREDITS', remainingCredits: 0 }, 402);
    }
    const key = process.env['STARTER_GOOGLE_API_KEY'];
    if (!key) return c.json({ error: 'starter brain not configured', code: 'UNAVAILABLE' }, 503);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${STARTER_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: body.data.contents,
          ...(body.data.system ? { systemInstruction: { parts: [{ text: body.data.system }] } } : {}),
          ...(body.data.tools ? { tools: body.data.tools } : {}),
          generationConfig: { thinkingConfig: { thinkingLevel: STARTER_THINKING_LEVEL } },
        }),
      },
    );
    const payload = (await res.json().catch(() => ({}))) as { usageMetadata?: GeminiUsage };
    if (!res.ok) return c.json({ error: 'starter brain call failed', code: 'UPSTREAM', status: res.status }, 502);

    // meter what the vendor SAYS it used, never an estimate — a ledger built on our own guess
    // drifts away from the invoice it is supposed to explain.
    const inTok = payload.usageMetadata?.promptTokenCount ?? 0;
    const outTok = payload.usageMetadata?.candidatesTokenCount ?? 0;
    const micros = priceModelCall(STARTER_MODEL, inTok, outTok);
    const spent = await ledger.spend(workspace, micros, { inTokens: inTok, outTokens: outTok });
    // the call already happened, so a refused debit means the balance emptied underneath it —
    // serve the answer, and let the NEXT call be the one that stops.
    const remaining = spent ? spent.remainingMicros : 0;
    c.header('x-nm-credits-remaining', String(microsToCredits(remaining)));
    return c.json({ ...payload, credits: { remaining: microsToCredits(remaining), spentMicros: micros } });
  });

  // the dashboard's history: daily meter rows + the grant ledger, one call. Read-only,
  // member-gated, straight off machine_usage/credit_grants (both deliberately unsynced).
  app.get('/v1/credits/history', async (c) => {
    const sql = sqlOf(store);
    if (!sql) return c.json({ error: 'credits not served by this store' }, 501);
    const workspace = c.req.query('workspace');
    if (!workspace) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    if (!(await actorInWorkspace(store, c.get('actor'), workspace))) {
      return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    }
    const [days, grants] = await Promise.all([
      sql<Array<Record<string, unknown>>>`
        select to_char(day, 'YYYY-MM-DD') as day, minutes, active_seconds, model_calls,
               model_in_tokens, model_out_tokens, model_micros, machine_micros
          from machine_usage
         where workspace_id = ${workspace}::uuid and day > (now() at time zone 'utc')::date - 31
         order by day`,
      sql<Array<Record<string, unknown>>>`
        select micros, kind, note, to_char(created_at, 'YYYY-MM-DD') as on_day
          from credit_grants
         where workspace_id = ${workspace}::uuid
         order by created_at desc limit 20`,
    ]);
    return c.json({
      days: days.map((d) => ({
        day: String(d['day']),
        activeSeconds: Number(d['active_seconds'] ?? 0),
        modelCalls: Number(d['model_calls'] ?? 0),
        modelInTokens: Number(d['model_in_tokens'] ?? 0),
        modelOutTokens: Number(d['model_out_tokens'] ?? 0),
        brainCredits: microsToCredits(Number(d['model_micros'] ?? 0)),
        machineCredits: microsToCredits(Number(d['machine_micros'] ?? 0)),
      })),
      grants: grants.map((g) => ({
        credits: microsToCredits(Number(g['micros'] ?? 0)),
        kind: String(g['kind']),
        note: (g['note'] as string | null) ?? null,
        day: String(g['on_day']),
      })),
    });
  });

  // what a workspace has and has used — the rail's ring reads this, not PowerSync
  // (machine_usage is deliberately unsynced operator data).
  app.get('/v1/usage', async (c) => {
    if (!ledger) return c.json({ error: 'credits not served by this store' }, 501);
    const workspace = c.req.query('workspace');
    if (!workspace) return c.json({ error: 'workspace required', code: 'INVALID_INPUT' }, 400);
    if (!(await actorInWorkspace(store, c.get('actor'), workspace))) {
      return c.json({ error: 'not your workspace', code: 'NOT_PERMITTED' }, 403);
    }
    const [bal, used, plan] = await Promise.all([ledger.balance(workspace), ledger.usage(workspace), store.workspacePlan(workspace)]);
    // the machine line carries its own DENOMINATOR. without it a client can only print "23 min
    // today", which is a number nobody can act on — and the only honest alternative, inventing a
    // limit client-side, would print a cap the server does not enforce. `null` means UNCAPPED
    // (the cloud plan, which machineSweep's cap-stop skips by `w.plan <> 'cloud'`), never a large
    // number standing in for infinity: a client must be able to tell "no limit" from "a big one".
    return c.json({
      credits: {
        remaining: microsToCredits(bal.remainingMicros),
        granted: microsToCredits(bal.grantedMicros),
        // the split the dashboard shows: what resets at the refill vs what the user bought
        grantRemaining: microsToCredits(bal.grantRemainingMicros),
        purchasedRemaining: microsToCredits(bal.purchasedRemainingMicros),
        // the ONE gate signal (credits era): true parks the machine and 402s the starter.
        outOfCredits: bal.remainingMicros <= 0,
        periodStart: bal.periodStart,
        // 0 on Free: nothing refills there since the source release. A number, not null, because
        // the shipped phone formats this field unguarded (compute.tsx) and the refill worklist
        // (plan = 'cloud') is the promise that matters
        monthlyGrant: plan === 'cloud' ? CLOUD_SEAT_MONTHLY_CREDITS : 0,
      },
      // capMinutes is ALWAYS null now — the daily minute cap died with the credits round;
      // minutes stay as telemetry and activeSeconds is the number that bills.
      machine: { minutesToday: used.minutes, activeSecondsToday: used.activeSeconds, capMinutes: null, plan },
      // ALLOCATION, not usage: nothing meters bytes on the PVC yet. Sending the size the plan
      // provisions lets a surface say "10 GB included" — true, and actionable — instead of "not
      // yet metered", which told nobody anything. It must never be printed as "x of 10 GB used".
      storage: { gb: planDiskGb(plan), metered: false },
      brain: { callsToday: used.modelCalls, model: STARTER_MODEL },
      rateVersion: RATE_VERSION,
    });
  });
}

/** membership for the two credit reads — same posture as the credential lane: a workspace uuid
 *  is not a secret, so the CALLER decides what they may see. */
export async function actorInWorkspace(store: Store, actor: Actor, workspace: string): Promise<boolean> {
  if (actor.kind === 'human') return (await store.humanMemberIds(workspace)).includes(actor.id);
  if (actor.kind === 'agent') return (await store.agentWorkspace(actor.id)) === workspace;
  return false;
}

