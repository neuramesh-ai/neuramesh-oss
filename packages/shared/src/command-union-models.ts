// The person's model for an agent (agent-models.ts), spread into both command unions the
// command-union-schedule.ts way: the server's union and the phone's mirror sit at their size caps.
// HUMAN_ONLY and SELF-ONLY by construction, as member.set_compute is: the handler writes the ACTOR's
// own row, so the payload cannot name another member, and an agent cannot move its own model.
import { z } from 'zod';
import { THINKING_LEVELS } from './agent-models';
import { MODEL_IDS } from './model-packs';

const KNOWN = new Set<string>(MODEL_IDS);

export const MODEL_COMMANDS = [
  // one agent's model for THIS person, from their next message. null = back to the agent's own model.
  // The level rides only a model that takes one (the handler drops it otherwise).
  z.object({
    type: z.literal('member.set_agent_model'),
    workspace: z.string().min(1),
    agent: z.string().uuid(),
    model: z.string().min(1).refine((m) => KNOWN.has(m), { message: 'unknown model id' }).nullable(),
    thinking: z.enum(THINKING_LEVELS).nullable().optional(),
  }),
] as const;
