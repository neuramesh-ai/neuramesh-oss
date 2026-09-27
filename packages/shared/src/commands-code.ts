// The Code-session commands (0135, the mobile-cloud round) — SHARED, because the phone sends the
// first two as itself and the machine host sends all three (handler/codesession.ts says who may
// write what). The server spreads them into its CommandSchema through commands-machine.ts (its
// commands.ts sits at its size cap); the client's HumanCommandSchema spreads the same tuple.
import { z } from 'zod';
import { CODE_APPROVAL_CATEGORIES, CODE_SESSION_MODES, CODE_SESSION_STATES } from './code-sessions';
import { THREAD_KINDS } from './threads';

export const CODE_SESSION_COMMANDS = [
  // create-or-update the session's synced row. `createdBy` names the member the session belongs
  // to; only the owner of the hosting machine may name someone other than themselves (a cloud
  // runner speaks as its owner and works for every member). Every other field is a patch.
  z.object({
    type: z.literal('code_session.upsert'),
    workspace: z.string().min(1),
    codeSessionId: z.string().uuid(),
    createdBy: z.string().uuid().optional(),
    projectId: z.string().uuid().nullable().optional(),
    repoId: z.string().uuid().nullable().optional(),
    repoName: z.string().max(200).optional(),
    branch: z.string().max(200).optional(),
    title: z.string().max(200).optional(),
    mode: z.enum(CODE_SESSION_MODES).optional(),
    state: z.enum(CODE_SESSION_STATES).optional(),
    machineId: z.string().uuid().nullable().optional(),
    lastLine: z.string().max(400).optional(),
    changesCount: z.number().int().min(0).optional(),
    checkpointsCount: z.number().int().min(0).optional(),
  }),
  // the turn ended, or the client left: the row rests in a terminal-ish state with ended_at stamped
  z.object({
    type: z.literal('code_session.close'),
    workspace: z.string().min(1),
    codeSessionId: z.string().uuid(),
    state: z.enum(['completed', 'error', 'resumable']).optional(),
    lastLine: z.string().max(400).optional(),
  }),
  // an approval is waiting on the session's member — the host says so, the server pushes it
  z.object({
    type: z.literal('code_session.approval_waiting'),
    workspace: z.string().min(1),
    codeSessionId: z.string().uuid(),
    approvalId: z.string().min(1).max(200),
    category: z.enum(CODE_APPROVAL_CATEGORIES),
    toolName: z.string().min(1).max(120),
  }),
  // Coding threads (0144, docs/design/coding-threads-2026-09): a conversation becomes coding (the
  // coding runtime works on the project's repository in it) or goes back to chat. A human, or the
  // room's orchestrator from its triage turn (ruling 1, 2026-09-26); handler/thread.ts refuses a
  // task thread (its unit IS the code path) and a project with no repository (REPO_REQUIRED).
  z.object({
    type: z.literal('thread.set_kind'),
    workspace: z.string().min(1),
    threadId: z.string().uuid(),
    kind: z.enum(THREAD_KINDS),
  }),
] as const;
