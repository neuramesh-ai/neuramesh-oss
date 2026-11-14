import { z } from 'zod';
import {CURRENT_MODELS} from './model-packs';
import {STARTER_MODEL} from './rates';

const financeModels=new Set<string>([STARTER_MODEL,...Object.values(CURRENT_MODELS).flat()]);
export const FinanceModelSelectionSchema=z.object({model:z.string().min(1).max(128),thinking:z.enum(['low','medium','high']).nullable().default(null)});
export const FinanceRequestModelSchema=FinanceModelSelectionSchema.shape.model.refine(value=>financeModels.has(value),'Choose a current NeuraMesh model.');
export type FinanceModelSelection=z.infer<typeof FinanceModelSelectionSchema>;

// The partner boundary contains display data only. No Plaid IDs, bank credentials or workspace scope.
export const FinanceAccountSchema = z.object({
  id: z.string().max(128), name: z.string().max(256), mask: z.string().max(8).nullable(),
  type: z.string().max(64), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  current: z.number().finite().nullable(), available: z.number().finite().nullable(),
  syncedAt: z.string().datetime().nullable(), needsReconnect: z.boolean(),
});
export const FinanceStatusSchema = z.object({
  state: z.enum(['pending', 'confirmation', 'connected', 'expired', 'revoked']),
  identity: z.object({ id: z.string().max(128), email: z.string().max(320).nullable() }).nullable(),
  accountCount: z.number().int().min(0).max(1000), expiresAt: z.string().datetime(),
  capabilities: z.array(z.enum(['transactions:read', 'budgets:read', 'budgets:write'])).default([]),
  consentRevision:z.number().int().nonnegative().optional(),
});
export type FinanceStatus = z.infer<typeof FinanceStatusSchema>;
export type FinanceAccount = z.infer<typeof FinanceAccountSchema>;
export type FinanceConnection = { state: 'disconnected' | 'unconfigured' } | FinanceStatus;
const money = z.number().finite();
const currency = z.string().regex(/^[A-Z]{3}$/);
export const FinanceQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), currency: currency.optional(), search: z.string().max(150).optional(), cursor: z.string().max(512).optional(), limit: z.number().int().min(1).max(100).optional() });
export type FinanceQuery = z.infer<typeof FinanceQuerySchema>;
export const FinanceTransactionSchema = z.object({ id: z.string().max(128), accountId: z.string().max(128), accountName: z.string().max(256), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().max(512), merchantName: z.string().max(512).nullable(), category: z.string().max(256), amount: money, currency: currency.nullable(), pending: z.boolean() });
export const FinanceBudgetSchema = z.object({ id: z.string().max(128), categoryName: z.string().max(256), budgetType: z.enum(['category', 'group']), currency: currency.nullable(), monthlyLimit: money, spent: money.nullable(), remaining: money.nullable(), version: z.string().max(128) });
export const FinanceSnapshotSchema = z.object({
  scope: z.object({ month: z.string(), currency: currency.nullable(), availableCurrencies: z.array(currency), accountCount: z.number().int().nonnegative() }),
  freshness: z.object({ balancesAt: z.string().datetime().nullable(), transactionsAt: z.string().datetime().nullable() }),
  summary: z.object({ spent: money, incoming: money, transactionCount: z.number().int().nonnegative(), pendingCount: z.number().int().nonnegative() }),
  transactions: z.object({ items: z.array(FinanceTransactionSchema).max(100), nextCursor: z.string().nullable(), total: z.number().int().nonnegative() }),
  spending: z.object({ categories: z.array(z.object({ name: z.string().max(256), amount: money, count: z.number().int().nonnegative() })), daily: z.array(z.object({ date: z.string(), amount: money })) }),
  budgets: z.array(FinanceBudgetSchema), categoryOptions:z.array(z.object({name:z.string().max(256),group:z.string().max(256)})).default([]), categories: z.array(z.string().max(256)), warnings: z.array(z.string().max(1000)),
});
export type FinanceSnapshot = z.infer<typeof FinanceSnapshotSchema>;
export type FinanceTransaction = z.infer<typeof FinanceTransactionSchema>;
export type FinanceBudget = z.infer<typeof FinanceBudgetSchema>;
export const FinanceBudgetDraftSchema = z.object({ requestId: z.string().uuid(), operation: z.enum(['upsert', 'delete']), categoryName: z.string().trim().min(1).max(256), budgetType: z.enum(['category', 'group']), currency, monthlyLimit: money.positive().max(1_000_000_000).optional(), budgetId: z.string().max(128).optional() });
export type FinanceBudgetDraft = z.infer<typeof FinanceBudgetDraftSchema>;
export const FinanceBudgetProposalSchema = z.object({ id: z.string().uuid(), operation: z.enum(['upsert', 'delete']), categoryName: z.string().max(256), budgetType: z.enum(['category', 'group']), currency, beforeLimit: money.nullable(), afterLimit: money.nullable(), version: z.string().nullable(), expiresAt: z.string().datetime(), state: z.enum(['prepared', 'committed', 'dismissed']), budgetId: z.string().nullable().optional() });
export type FinanceBudgetProposal = z.infer<typeof FinanceBudgetProposalSchema>;
export const FinanceChatMessageSchema = z.object({ id: z.string().uuid(), role: z.enum(['user', 'assistant']), text: z.string().max(24000), at: z.string().datetime(), state: z.enum(['complete', 'pending', 'failed']), selection:FinanceModelSelectionSchema.optional(), author: z.object({id:z.string().uuid(),name:z.string().max(320)}).optional(), source: z.object({ month: z.string(), currency: currency.nullable(), accountCount: z.number(), transactionsAt: z.string().nullable() }).optional(), budgetDraft: FinanceBudgetDraftSchema.omit({ requestId: true }).optional() });
export type FinanceChatMessage = z.infer<typeof FinanceChatMessageSchema>;
export const FinanceChatSchema = z.object({ id: z.string().uuid(), title: z.string().max(100), revision: z.number().int().nonnegative(), messages: z.array(FinanceChatMessageSchema).max(200), updatedAt: z.string().datetime() });
export type FinanceChat = z.infer<typeof FinanceChatSchema>;
export type FinanceChatSummary = Pick<FinanceChat, 'id' | 'title' | 'updatedAt'>;
export interface FinanceBridge {
  financeStatus(): Promise<FinanceConnection>;
  financeStart(intent: 'create' | 'connect'): Promise<{ url: string }>;
  financeConfirm(identity: string): Promise<FinanceConnection>;
  financeDisconnect(): Promise<{ ok: true }>;
  financeAccounts(): Promise<{ accounts: FinanceAccount[] }>;
  financeOpen(url: string): Promise<void>;
  financeMigration(): Promise<{ available: boolean }>;
  financeAdopt(): Promise<{ ok: true }>;
  financeManage(): Promise<{ url: string }>;
  financeOverview(query: FinanceQuery): Promise<FinanceSnapshot>;
  financeRefresh(): Promise<{ ok: true; transactionsAt: string | null; warnings: string[] }>;
  financeBudgetPrepare(draft: FinanceBudgetDraft): Promise<FinanceBudgetProposal>;
  financeBudgetCommit(proposalId: string): Promise<FinanceBudgetProposal>;
  financeBudgetDismiss(proposalId: string): Promise<FinanceBudgetProposal>;
  financeChats(): Promise<{ chats: FinanceChatSummary[]; model: string | null }>;
  financeChatGet(id: string): Promise<FinanceChat>;
  financeChatSend(input: { chatId: string; requestId: string; text: string; month: string; currency?: string; model?:string; thinking?:'low'|'medium'|'high'|null }): Promise<FinanceChat>;
}
