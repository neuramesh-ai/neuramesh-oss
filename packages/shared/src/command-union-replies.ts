// The reply queue's verbs (docs/design/models-and-replies-2026-10/plan.md §2), spread into both command
// unions the command-union-schedule.ts way: the server's union and the phone's mirror sit at their size
// caps. All three are a person's own: the handler refuses an agent, and a row belongs to its member.
import { z } from 'zod';

const GAP = z.union([z.literal(5), z.literal(8), z.literal(12), z.literal(20)]);

export const REPLY_COMMANDS = [
  // queue rows of a reply card: the server reads the rows off the card, computes each time and link,
  // and never trusts a draft or a link from the client
  z.object({
    type: z.literal('reply.queue'),
    message: z.string().uuid(),
    letters: z.array(z.string().trim().min(1).max(2)).min(1).max(8),
    gapMin: GAP,
    startAt: z.string().datetime(),
  }),
  // what the person did with one row: opened X, posted it, skipped it, or queued it again
  z.object({ type: z.literal('reply.mark'), reminder: z.string().uuid(), state: z.enum(['opened', 'posted', 'skipped', 'queued']) }),
  // Clear queue: drop the owed rows of one card (the done rows stay as the record)
  z.object({ type: z.literal('reply.clear'), message: z.string().uuid() }),
] as const;

/** a routine's queue gap, on schedule.create and schedule.update (the routine writer's Replies part) */
export const REPLY_GAP_FIELD = GAP;
