// a marketing room's marketers (plume for browser workspaces, 2026-10-04): a room that BECOMES a
// marketing room links every active marketer of the workspace, in the transaction that plants its
// setup task (project.create's starter room, a channel.set_kind flip). it is the one exception to the
// isolation rule beside the orchestrator's (pgstore addOrchestratorsToChannels), because a marketing
// room with no marketer of its own runs no draft schedules and gets no playbook pre-offer. it fires on
// the change only, never as a sweep: a removal deletes the link row, so a sweep cannot tell "never
// joined" from "a person took it out". leaf helper of PostgresStore, kept out of pgstore.ts on its
// ratchet's own terms.
import type postgres from 'postgres';

/** links each active marketer of the workspace to the room, idempotently. returns the NEW rows. */
export async function addMarketersToChannelSql(sql: postgres.Sql, workspace: string, channelId: string): Promise<number> {
  const inserted = await sql`
    insert into agent_channels (agent_id, channel_id)
    select a.id, c.id from agents a
    join channels c on c.workspace_id = a.workspace_id and c.id = ${channelId}::uuid
    where a.workspace_id = ${workspace}::uuid and a.role = 'marketer' and a.retired_at is null
    on conflict do nothing
    returning agent_id`;
  return inserted.length;
}
