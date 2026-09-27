// The schedule verbs the daemon's tick writes, spread into CommandSchema the commands-machine.ts
// way (commands.ts sits at its size-ratchet cap, and the release routine added a cursor —
// release drafts, 2026-09-17). schedules.test.ts drives all three through the handler, so a
// member dropped from the spread fails a suite, never silently.
import { z } from 'zod';

export const SCHEDULE_RUN_COMMANDS = [
  // the daemon's atomic claim of a due run: counter CAS (ship-stage lesson) so two machines
  // never double-fire. nextRunAt is the claimer's recomputed advance (null = done).
  z.object({
    type: z.literal('schedule.claim_run'),
    schedule: z.string().min(1),
    runCount: z.number().int().min(0),
    nextRunAt: z.string().datetime().nullable(),
  }),
  // the fire's outcome → schedules.last_error (the attention bar's truth); null = the next clean run clears it
  z.object({ type: z.literal('schedule.mark_result'), schedule: z.string().min(1), error: z.string().max(500).nullable() }),
  // the release routine's cursor (docs/design/release-drafts-2026-09 §4.2): the lane that FINISHED a
  // scan writes where the next window starts, plus one ledger line (a quiet day is a row too). Any
  // authenticated teammate, like claim_run and mark_result: the row is the truth, the Routines
  // ledger its reader. Refused on a row that is not a release routine.
  z.object({
    type: z.literal('schedule.set_cursor'),
    schedule: z.string().min(1),
    cursor: z.object({ at: z.string().datetime(), tag: z.string().max(120).nullable() }),
    log: z.object({ at: z.string().datetime(), key: z.string().max(120).nullable(), note: z.string().trim().min(1).max(300) }).nullable().optional(),
  }),
] as const;

// marketing.setup's fifth step (docs/design/release-drafts-2026-09 §4.7): the repository to watch,
// draft the latest release now (a free one-shot), watch daily (a Team routine)
export const MARKETING_RELEASES = z.object({
  repoId: z.string().min(1).nullable().optional(),
  slug: z.string().trim().max(200).nullable().optional(), // owner/name, for the titles
  now: z.boolean(),
  watch: z.boolean(),
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  tz: z.string().max(64).optional(),
});

// the same step written as it lands (setup.step): every field optional, the wizard resumes from it
export const SETUP_RELEASES_VALUE = z.object({
  repoId: z.string().min(1).nullable().optional(),
  slug: z.string().trim().max(200).nullable().optional(),
  now: z.boolean().optional(),
  watch: z.boolean().optional(),
});
