// PROJECT MEMORY ON THE MACHINE (decision D15, round 8). The memory of a project is one summary block
// (memory_blocks kind 'project_summary', synced to the replica) and its facts (server only, recalled
// through /v1/recall). This file holds the rules the sleep-time refresh (host/block.ts) and the context
// readers share, pure so a test can hold them.
//
// Who refreshes a project:
//   · a seat on a vendor brain (a Claude, Codex or Gemini login): this machine, through the seat's own
//     login. The user's login pays.
//   · a seat on the starter brain: nm-api (control-api project-memory-refresh.ts), which calls the starter
//     model with the platform key and meters it. This machine skips it, so a project is never billed twice.
// Both obey one rate limit: at most one refresh per NM_MEMORY_REFRESH_MINUTES (default 60) per project.
import { STARTER_MODEL } from '@neuramesh/shared';

/** the shortest time between two refreshes of one project, in ms. 0: the refresh is off */
export function memoryRefreshMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(env['NM_MEMORY_REFRESH_MINUTES'] ?? '', 10);
  const minutes = Number.isFinite(n) ? n : 60;
  return minutes <= 0 ? 0 : Math.max(5, minutes) * 60_000;
}

/** the machine refreshes for vendor seats only. A starter seat is nm-api's (see the header) */
export function machineRefreshes(agent: { role: string; model: string }): boolean {
  return agent.role === 'orchestrator' && agent.model !== STARTER_MODEL;
}

/**
 * Is a project's block due? There are messages past the block's basis, and the block is older than the
 * window. A project with no block yet is due at its first message.
 */
export function projectRefreshDue(input: { messages: number; basis: number; updatedAt: string | null; now: number; windowMs: number }): boolean {
  if (!input.windowMs || input.messages === 0 || input.messages <= input.basis) return false;
  if (!input.updatedAt) return true;
  const at = Date.parse(input.updatedAt);
  return !Number.isFinite(at) || input.now - at >= input.windowMs;
}

/** the replica read for the block every context gets: the project block of the channel's project, else
 *  the legacy channel summary (until the first project refresh writes one) */
export const PROJECT_BLOCK_SQL = `select content from (
    select b.content, 0 as rank from memory_blocks b join channels c on c.project_id = b.project_id
     where c.id = ? and b.kind = 'project_summary' and trim(b.content) <> ''
    union all
    select b.content, 1 as rank from memory_blocks b
     where b.channel_id = ? and b.kind = 'channel_summary' and trim(b.content) <> ''
  ) order by rank limit 1`;


/** the lines a refresh prompt reads: every thread of the project, newest first, as the replica holds them */
export const PROJECT_ACTIVITY_SQL = `select m.author_kind, m.body, coalesce(nullif(t.title, ''), '#' || c.slug) as place
    from messages m join channels c on c.id = m.channel_id left join threads t on t.id = m.thread_id
   where c.project_id = ? and trim(m.body) <> '' order by m.created_at desc limit 40`;
