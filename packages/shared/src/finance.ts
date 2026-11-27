import { z } from 'zod';
import {CURRENT_MODELS} from './model-packs';
import {STARTER_MODEL} from './rates';
import {THINKING_LEVELS,type ThinkingLevel} from './agent-models';

const financeModels=new Set<string>([STARTER_MODEL,...Object.values(CURRENT_MODELS).flat()]);
export const FinanceModelSelectionSchema=z.object({model:z.string().min(1).max(128),thinking:z.enum(THINKING_LEVELS).nullable().default(null)});
export const FinanceRequestModelSchema=FinanceModelSelectionSchema.shape.model.refine(value=>financeModels.has(value),'Choose a current NeuraMesh model.');
export type FinanceModelSelection=z.infer<typeof FinanceModelSelectionSchema>;

// The partner boundary contains display data only. No Plaid IDs, bank credentials or workspace scope.
export const FinanceAccountSchema = z.object({
  id: z.string().max(128), name: z.string().max(256), mask: z.string().max(8).nullable(),
  type: z.string().max(64), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  current: z.number().finite().nullable(), available: z.number().finite().nullable(),
  syncedAt: z.string().datetime().nullable(), needsReconnect: z.boolean(),
});
export const FINANCE_CAPABILITIES = ['transactions:read', 'transactions:categorize', 'budgets:read', 'budgets:write'] as const;
export type FinanceCapability = typeof FINANCE_CAPABILITIES[number];
export const FinanceStatusSchema = z.object({
  state: z.enum(['pending', 'confirmation', 'connected', 'expired', 'revoked']),
  identity: z.object({ id: z.string().max(128), email: z.string().max(320).nullable() }).nullable(),
  accountCount: z.number().int().min(0).max(1000), expiresAt: z.string().datetime(),
  // A capability that this version does not know is dropped, never a failed parse: Kinshi adds one before NeuraMesh learns it.
  capabilities: z.array(z.string()).default([]).transform(list => list.filter((c): c is FinanceCapability => (FINANCE_CAPABILITIES as readonly string[]).includes(c))),
  consentRevision:z.number().int().nonnegative().optional(),
});
export type FinanceStatus = z.infer<typeof FinanceStatusSchema>;
export type FinanceAccount = z.infer<typeof FinanceAccountSchema>;
export type FinanceConnection = { state: 'disconnected' | 'unconfigured' } | FinanceStatus;
const money = z.number().finite();
const currency = z.string().regex(/^[A-Z]{3}$/);
export const FinanceQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), currency: currency.optional(), search: z.string().max(150).optional(), accountId: z.string().max(128).optional(), category: z.string().max(256).optional(), direction: z.enum(['in', 'out', 'transfer']).optional(), cursor: z.string().max(512).optional(), limit: z.number().int().min(1).max(100).optional() });
export type FinanceQuery = z.infer<typeof FinanceQuerySchema>;
export const FinanceTransactionSchema = z.object({ id: z.string().max(128), accountId: z.string().max(128), accountName: z.string().max(256), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().max(512), merchantName: z.string().max(512).nullable(), category: z.string().max(256), amount: money, currency: currency.nullable(), pending: z.boolean(), transfer: z.boolean().optional() });
export const FinanceBudgetSchema = z.object({ id: z.string().max(128), categoryName: z.string().max(256), budgetType: z.enum(['category', 'group']), currency: currency.nullable(), monthlyLimit: money, spent: money.nullable(), remaining: money.nullable(), version: z.string().max(128) });
export const FinanceSnapshotSchema = z.object({
  scope: z.object({ month: z.string(), currency: currency.nullable(), availableCurrencies: z.array(currency), accountCount: z.number().int().nonnegative() }),
  freshness: z.object({ balancesAt: z.string().datetime().nullable(), transactionsAt: z.string().datetime().nullable() }),
  summary: z.object({ spent: money, incoming: money, transactionCount: z.number().int().nonnegative(), pendingCount: z.number().int().nonnegative() }),
  transactions: z.object({ items: z.array(FinanceTransactionSchema).max(100), nextCursor: z.string().nullable(), total: z.number().int().nonnegative() }),
  spending: z.object({ categories: z.array(z.object({ name: z.string().max(256), amount: money, count: z.number().int().nonnegative() })), daily: z.array(z.object({ date: z.string(), amount: money })) }),
  // each account's posted money in and money out this month, transfers included (Kinshi #92). Older Kinshi sends none.
  accountActivity: z.array(z.object({ accountId: z.string().max(128), in: money, out: money, count: z.number().int().nonnegative() })).max(1000).optional(),
  budgets: z.array(FinanceBudgetSchema), categoryOptions:z.array(z.object({name:z.string().max(256),group:z.string().max(256)})).default([]), categories: z.array(z.string().max(256)), warnings: z.array(z.string().max(1000)),
});
export type FinanceSnapshot = z.infer<typeof FinanceSnapshotSchema>;
export type FinanceTransaction = z.infer<typeof FinanceTransactionSchema>;
export type FinanceBudget = z.infer<typeof FinanceBudgetSchema>;
// Recommendations (finance-overview round, 2026-11-18): patterns that NeuraMesh detectors find in the month, each
// with the rows behind it. The words come from a template. The key is the detector, its subject and the month.
export const FinanceRecommendationSchema = z.object({
  key: z.string().max(400), kind: z.enum(['over_budget', 'budget_pace', 'large_charge', 'subscriptions', 'repeat_charges', 'category_growth']),
  priority: z.enum(['high', 'medium', 'low']), title: z.string().max(300), body: z.string().max(600),
  evidence: z.array(FinanceTransactionSchema).max(5),
  link: z.object({ kind: z.enum(['budgets', 'set_budget', 'transactions']), category: z.string().max(256).nullable() }),
});
export const FinanceRecommendationsSchema = z.object({
  month: z.string(), checkedAt: z.string().datetime(), items: z.array(FinanceRecommendationSchema).max(10),
  // what a person addressed or dismissed this month, newest first: who and when
  history: z.array(z.object({ id: z.string().max(128), title: z.string().max(300), action: z.enum(['addressed', 'dismissed']), actorId: z.string().max(128), at: z.string().datetime() })).max(50),
});
export const FinanceRecommendationActionSchema = z.union([
  z.object({ action: z.enum(['addressed', 'dismissed']), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), key: z.string().min(1).max(400), title: z.string().min(1).max(300) }),
  z.object({ action: z.literal('restore'), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), id: z.string().min(1).max(128) }),
]);
export type FinanceRecommendation = z.infer<typeof FinanceRecommendationSchema>;
export type FinanceRecommendations = z.infer<typeof FinanceRecommendationsSchema>;
export type FinanceRecommendationAction = z.infer<typeof FinanceRecommendationActionSchema>;
export const FinanceBudgetDraftSchema = z.object({ requestId: z.string().uuid(), operation: z.enum(['upsert', 'delete']), categoryName: z.string().trim().min(1).max(256), budgetType: z.enum(['category', 'group']), currency, monthlyLimit: money.positive().max(1_000_000_000).optional(), budgetId: z.string().max(128).optional() });
export type FinanceBudgetDraft = z.infer<typeof FinanceBudgetDraftSchema>;
export const FinanceBudgetProposalSchema = z.object({ id: z.string().uuid(), operation: z.enum(['upsert', 'delete']), categoryName: z.string().max(256), budgetType: z.enum(['category', 'group']), currency, beforeLimit: money.nullable(), afterLimit: money.nullable(), version: z.string().nullable(), expiresAt: z.string().datetime(), state: z.enum(['prepared', 'committed', 'dismissed']), budgetId: z.string().nullable().optional() });
export type FinanceBudgetProposal = z.infer<typeof FinanceBudgetProposalSchema>;
// A category change (finance-recategorize round, 2026-11-19): Kinshi's proposal pattern, as for budgets. `merchant`
// also saves a Kinshi merchant rule. Only a person who owns the workspace prepares, commits or dismisses one.
export const FinanceCategorizeDraftSchema = z.object({ requestId: z.string().uuid(), transactionId: z.string().min(1).max(128), categoryName: z.string().trim().min(1).max(256), scope: z.enum(['one', 'merchant']) });
export type FinanceCategorizeDraft = z.infer<typeof FinanceCategorizeDraftSchema>;
export const FinanceCategorizeProposalSchema = z.object({ id: z.string().uuid(), state: z.enum(['prepared', 'committed', 'dismissed']), transactionId: z.string().max(128), merchantName: z.string().max(512), scope: z.enum(['one', 'merchant']), categoryName: z.string().max(256), fromCategories: z.array(z.string().max(256)).max(20), count: z.number().int().nonnegative(), rule: z.boolean(), expiresAt: z.string().datetime(), updated: z.number().int().nonnegative().optional() });
export type FinanceCategorizeProposal = z.infer<typeof FinanceCategorizeProposalSchema>;
/** What a person decided on an agent's category change card. The card is named by its content (`categoryCardKey`). */
export const FinanceCardDecisionSchema = z.object({ card: z.string().max(420), outcome: z.enum(['approved', 'dismissed']), actor: z.object({ id: z.string().uuid(), name: z.string().max(320) }), at: z.string().datetime(), updated: z.number().int().nonnegative().optional() });
export type FinanceCardDecision = z.infer<typeof FinanceCardDecisionSchema>;
export const FinanceCategoryCardSchema = z.object({ transactionId: z.string().min(1).max(128), categoryName: z.string().trim().min(1).max(256), scope: z.enum(['one', 'merchant']) });
export type FinanceCategoryDecisionInput = { chatId: string; messageId: string; card: z.infer<typeof FinanceCategoryCardSchema>; outcome: 'approved' | 'dismissed'; updated?: number };
// The first analysis Kinshi computes without a model (partner action `analysis`).
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const FinanceAnalysisSchema = z.object({
  state: z.enum(['ready', 'syncing', 'no_data']),
  window: z.object({ from: day, to: day }), currency: currency.nullable(), accountCount: z.number().int().nonnegative(),
  freshness: z.object({ transactionsAt: z.string().datetime().nullable() }),
  totals: z.object({ out: money, in: money, transactionCount: z.number().int().nonnegative(), previousOut: money.nullable() }),
  weekly: z.array(z.object({ start: day, out: money, in: money })).max(12),
  monthly: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), out: money, in: money })).max(13),
  categories: z.array(z.object({ name: z.string().max(256), amount: money, count: z.number().int().nonnegative() })).max(20),
  recurring: z.object({ monthlyTotal: money, items: z.array(z.object({ merchant: z.string().max(256), amount: money, monthlyAmount: money,
    frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'unknown']), since: day.nullable(), lastDate: day.nullable(), confidence: z.number().min(0).max(1) })).max(20) }),
  warnings: z.array(z.string().max(1000)).max(20),
});
export type FinanceAnalysis = z.infer<typeof FinanceAnalysisSchema>;
// A canvas is a json-render spec. packages/finance-ui validates it against the Finance catalog before a save.
export const FinanceCanvasSchema = z.object({ title: z.string().max(120), spec: z.record(z.unknown()) }).refine(canvas => JSON.stringify(canvas.spec).length <= 60_000, 'The canvas is too large.');
export type FinanceCanvas = z.infer<typeof FinanceCanvasSchema>;
export const FinanceStepSchema = z.object({ label: z.string().max(120), state: z.enum(['now', 'done', 'todo']) });
export type FinanceStep = z.infer<typeof FinanceStepSchema>;
export const FinanceChatMessageSchema = z.object({ id: z.string().uuid(), role: z.enum(['user', 'assistant']), text: z.string().max(24000), at: z.string().datetime(), state: z.enum(['complete', 'pending', 'failed']), selection:FinanceModelSelectionSchema.optional(), author: z.object({id:z.string().uuid(),name:z.string().max(320)}).optional(), agent: z.object({id:z.string().uuid(),name:z.string().max(64),emoji:z.string().max(16).nullable()}).optional(), source: z.object({ month: z.string(), currency: currency.nullable(), accountCount: z.number(), transactionsAt: z.string().nullable() }).optional(), budgetDraft: FinanceBudgetDraftSchema.omit({ requestId: true }).optional(), canvas: FinanceCanvasSchema.optional(), steps: z.array(FinanceStepSchema).max(8).optional(), decisions: z.array(FinanceCardDecisionSchema).max(20).optional() });
export type FinanceChatMessage = z.infer<typeof FinanceChatMessageSchema>;
export const FinanceChatSchema = z.object({ id: z.string().uuid(), kind: z.enum(['chat', 'analysis']).optional(), title: z.string().max(100), revision: z.number().int().nonnegative(), messages: z.array(FinanceChatMessageSchema).max(200), updatedAt: z.string().datetime() });
export type FinanceChat = z.infer<typeof FinanceChatSchema>;
export type FinanceChatSummary = Pick<FinanceChat, 'id' | 'title' | 'updatedAt'>;
/** One server-sent event of `chat-stream` and `analysis-stream`. */
export type FinanceStreamEvent =
  | { type: 'chat'; chat: FinanceChat }
  | { type: 'step'; id: string; label: string; state: 'now' | 'done' }
  | { type: 'text'; delta: string }
  | { type: 'patch'; patch: { op: string; path: string; value?: unknown; from?: string } }
  | { type: 'queued' }
  | { type: 'done'; chat: FinanceChat }
  | { type: 'error'; error: string; code?: string; chat?: FinanceChat };
export type FinanceChatSendInput = { chatId: string; requestId: string; text: string; month: string; currency?: string; model?:string; thinking?:ThinkingLevel|null; agent?: string };
export interface FinanceBridge {
  financeStatus(): Promise<FinanceConnection>;
  financeStart(intent: 'create' | 'connect' | 'upload'): Promise<{ url: string }>;
  financeConfirm(identity: string): Promise<FinanceConnection>;
  financeDisconnect(): Promise<{ ok: true }>;
  financeAccounts(): Promise<{ accounts: FinanceAccount[] }>;
  financeOpen(url: string): Promise<void>;
  financeMigration(): Promise<{ available: boolean }>;
  financeAdopt(): Promise<{ ok: true }>;
  financeManage(options?: { upload?: boolean }): Promise<{ url: string }>;
  financeOverview(query: FinanceQuery): Promise<FinanceSnapshot>;
  financeRefresh(): Promise<{ ok: true; transactionsAt: string | null; warnings: string[] }>;
  financeBudgetPrepare(draft: FinanceBudgetDraft): Promise<FinanceBudgetProposal>;
  financeBudgetCommit(proposalId: string): Promise<FinanceBudgetProposal>;
  financeBudgetDismiss(proposalId: string): Promise<FinanceBudgetProposal>;
  financeChats(): Promise<{ chats: FinanceChatSummary[]; model: string | null }>;
  financeChatGet(id: string): Promise<FinanceChat>;
  financeChatSend(input: FinanceChatSendInput): Promise<FinanceChat>;
  /** Streamed replies. Optional: a desktop without them falls back to financeChatSend. */
  financeChatStream?(input: FinanceChatSendInput, onEvent: (event: FinanceStreamEvent) => void, signal?: AbortSignal): Promise<void>;
  financeRecommendations?(query: { month: string; currency?: string }): Promise<FinanceRecommendations>;
  financeRecommendationAction?(input: FinanceRecommendationAction & { currency?: string }): Promise<FinanceRecommendations>;
  /** Category changes. Optional: the desktop app does not take them, so hq shows no edit control without them. */
  financeCategorizePrepare?(draft: FinanceCategorizeDraft): Promise<FinanceCategorizeProposal>;
  financeCategorizeCommit?(proposalId: string): Promise<FinanceCategorizeProposal>;
  financeCategorizeDismiss?(proposalId: string): Promise<FinanceCategorizeProposal>;
  financeCategoryDecision?(input: FinanceCategoryDecisionInput): Promise<FinanceChat>;
  financeAnalysisStream?(input: { chatId: string; requestId: string; currency?: string }, onEvent: (event: FinanceStreamEvent) => void, signal?: AbortSignal): Promise<void>;
}
