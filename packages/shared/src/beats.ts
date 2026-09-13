import { z } from 'zod';
import { TASK_STATES } from './states';

// Beats (docs/17) — the ordered, high-level steps an agent declares for the phase it picked
// up, checked off live. Descriptive, never gating. `status` is enforced as an enum (mirrors the
// SQL beat_status). `role` is the declaring agent's role, which drives the tracker's color.
export const BEAT_STATUSES = ['pending', 'active', 'done', 'blocked'] as const;
export type BeatStatus = (typeof BEAT_STATUSES)[number];

export const BeatSchema = z.object({
  id: z.string(),
  workspace: z.string(),
  taskId: z.string(),
  runId: z.string(),
  phase: z.enum(TASK_STATES),
  role: z.string(),
  seq: z.number().int().nonnegative(),
  title: z.string(),
  status: z.enum(BEAT_STATUSES),
  startedAt: z.string().nullable(),
  doneAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Beat = z.infer<typeof BeatSchema>;

// Which agent role owns a task's beats in each phase — the write gate (an agent may declare/
// advance beats only for a task in a phase its role owns). Descriptive phases only.
export const BEAT_PHASE_ROLES: Partial<Record<(typeof TASK_STATES)[number], readonly string[]>> = {
  designing: ['designer'],
  planning: ['architect'],
  in_progress: ['developer', 'worker', 'marketer'],
  in_review: ['reviewer'],
  shipping: ['shipper'],
  releasing: ['shipper'],
};
