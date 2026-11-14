// Read and reset machine usage. Runtime mutation rules stay in fleet-lifecycle.
import type postgres from 'postgres';

export async function machineUsageToday(sql: postgres.Sql, workspaceId: string): Promise<{ day: string; minutes: number }> {
  const [row] = await sql<{ day: string; minutes: number }[]>`
    select to_char((now() at time zone 'utc')::date, 'YYYY-MM-DD') as day,
           coalesce((select u.minutes from machine_usage u
              where u.workspace_id = ${workspaceId}::uuid and u.day = (now() at time zone 'utc')::date), 0) as minutes`;
  return { day: row!.day, minutes: Number(row!.minutes) };
}

export async function resetDailyUsage(sql: postgres.Sql, target: { workspace?: string; all?: boolean }): Promise<string[]> {
  const rows = target.all
    ? await sql<{ workspace_id: string }[]>`
        update machine_usage set minutes = 0
         where day = (now() at time zone 'utc')::date and minutes > 0
        returning workspace_id`
    : await sql<{ workspace_id: string }[]>`
        update machine_usage set minutes = 0
         where day = (now() at time zone 'utc')::date and minutes > 0
           and workspace_id = ${target.workspace!}::uuid
        returning workspace_id`;
  return rows.map((r) => r.workspace_id);
}
