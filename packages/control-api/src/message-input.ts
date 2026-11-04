import {z} from 'zod';
import {PERMISSION_MODES} from '@neuramesh/shared';

export const MessageInputSchema = z.object({
  // Client-supplied id keeps optimistic local rows identical to server rows
  // (PowerSync echo-back would otherwise duplicate-then-swap them).
  id: z.string().uuid().optional(),
  workspace: z.string().min(1),
  channel: z.string().min(1).optional(),
  project: z.string().uuid().optional(),
  // may be empty when the message carries only attachments (no caption)
  body: z.string(),
  taskId: z.string().min(1).optional(),
  // the conversation thread this message belongs to (conversation-first shell). A
  // fresh client-generated id births the thread transactionally with the message.
  threadId: z.string().uuid().optional(),
  // docs/34: the composer's Tasks toggle, applied ONLY when this send births the thread.
  // A later message carrying it is ignored — the mode is the thread's, and changing it is
  // thread.set_mode (human-only), never a side effect of typing.
  threadMode: z.enum(['tasks', 'chat']).optional(),
  // docs/10 §15: the composer's brain draft, applied ONLY when this send births the thread —
  // the same birth-time contract as threadMode above, and for the same reason. Moving it
  // afterwards is thread.set_brain (human-only), never a side effect of typing.
  brainOverride: z.record(z.string(), z.string()).nullable().optional(),
  // docs/31: when this send BIRTHS a thread, the room message it hangs off. The root is
  // referenced, never moved — it keeps its place in the feed and grows a replies footer.
  rootMessageId: z.string().uuid().optional(),
  // 0119: the automation whose slot fired this send, applied ONLY when it births the thread —
  // the same birth-time contract as threadMode/brainOverride. It is what lets the Automations
  // card list a routine's runs without pattern-matching the marker in its opening line.
  scheduleId: z.string().uuid().optional(),
  permissionMode: z.enum(PERMISSION_MODES).optional(),
  schedulePermission: z.string().uuid().optional(),
  // 0134, rule D9: WHERE the session runs and WHICH client bore it, applied ONLY when this send
  // births the thread — the same birth-time contract as the three above. Moving the machine
  // afterwards is thread.set_machine (human-only); the origin never moves.
  // 0144, coding threads: the kind this send births the thread with — `coding` when the composer's
  // repo chip was set, so the coding runtime works on that repository in it. Birth-only, like the
  // rest; moving it afterwards is thread.set_kind (a human, or the room's orchestrator at triage).
  threadMachineId: z.string().uuid().nullable().optional(), threadOrigin: z.enum(['desktop', 'web', 'routine']).optional(), threadKind: z.enum(['chat', 'coding']).optional(),
  // the message this reply ANSWERS (agent wake replies) — the server enforces one
  // reply per (agent, trigger) so concurrent daemons can't double-reply (0060).
  replyTo: z.string().uuid().optional(),
  // the routine writer: set by propose_routine and offer_routine_session only, never by an agent's words. An
  // agent's routine card without it is dropped (routineCardGuard), so the tools' checks cannot be skipped
  // …and the repo-connect round's needCard: set by the tools that post a GitHub card, so it mints its Needs-you row (need-cards.ts)
  routineCard: z.literal(true).optional(), needCard: z.literal(true).optional(),
}).refine(v => !!v.channel || !!v.project, { message: 'A project is required.' });
