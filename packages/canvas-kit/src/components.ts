import { z } from 'zod';

// The schema parts and the components that every canvas catalog shares. A catalog spreads the
// components into its own `components`, so the model sees one definition of each in every desk.
export const text = (max: number) => z.string().max(max);
export const amount = z.number().finite();
export const size = z.enum(['sm', 'md', 'lg', 'full']).nullable().optional().describe('Card width on a 12 column grid: sm 4, md 6, lg 8, full 12. Default md.');
export type Size = z.infer<typeof size>;
export const format = z.enum(['currency', 'number', 'percent']);
export const ask = z.object({ label: text(60), prompt: text(300) });

const tone = z.enum(['neutral', 'warn', 'good']).nullable().optional();
const metric = { label: text(60), value: amount, format, currency: text(3).nullable().optional(), note: text(80).nullable().optional(), tone };

export const kpiTile = {
  props: z.object({ ...metric, size }),
  description: 'One metric with a short note.',
};

export const kpiList = {
  props: z.object({ items: z.array(z.object(metric)).min(1).max(5), size }),
  description: 'Two to five metrics in one card, one per row.',
};

export const insightCard = {
  props: z.object({ tone: z.enum(['info', 'good', 'warn']), label: text(40), body: text(400), actions: z.array(ask).max(3).nullable().optional(), size }),
  description: 'One finding and what to do next. Actions ask a follow-up question.',
};

export const followUps = {
  props: z.object({ items: z.array(ask).min(1).max(3) }),
  description: 'Up to three next questions. Put it last.',
};
