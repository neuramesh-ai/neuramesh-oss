// THE PLATFORM'S OWN SKILLS MOVE WITH THE API (George, 2026-11-24). The neuramesh-work pack teaches the tools that
// this API and its machines ship: publish-page names publish_file and the rules of the publish routes. Its rows
// refreshed only when a machine sent skillpack.seed_defaults at its boot (a Mac for its build rooms, a cloud runner for
// its marketing rooms), so a deploy that changed the pack reached no room until a machine restarted. A publish ask on
// the day publish-page shipped got "The workspace has no enabled publish-page skill" from rex.
//
// So each API boot refreshes every room that holds the pack at another version, through the command's own refresh
// (store/skillpack-seed.ts): a disabled pack stays off, and a curated, retired or person-authored skill stays as it
// is. Agents find skills across the whole workspace (desktop host/workspace-skills.ts), so one room with the pack
// serves an agent in every room. A room with no copy gets none: a person may remove a pack, and a boot never undoes
// that. Each room commits on its own, and two API instances that boot at once meet on the pack row's lock.
import type postgres from 'postgres';
import { bundledPackVersion } from './seed/packversion';
import type { SeedPack } from './seed/skill-seed';
import { TASK_SKILL_SEED } from './seed/task-skill-seed';
import { seedBundledPacksSql } from './store/skillpack-seed';

/** `workspace` limits the pass to one workspace (a test shares its database with other suites) */
export async function refreshPlatformPacks(sql: postgres.Sql, opts: { seed?: readonly SeedPack[]; workspace?: string } = {}): Promise<{ stale: number; refreshed: number; failed: number }> {
  const { seed = TASK_SKILL_SEED, workspace } = opts;
  let stale = 0;
  let refreshed = 0;
  let failed = 0;
  for (const entry of seed) {
    const version = bundledPackVersion(entry);
    const rooms = await sql<Array<{ workspace_id: string; channel_id: string }>>`select workspace_id, channel_id from skill_packs
      where origin = 'bundled' and name = ${entry.pack.name} and version <> ${version}
        ${workspace ? sql`and workspace_id = ${workspace}::uuid` : sql``} order by workspace_id, channel_id`;
    stale += rooms.length;
    for (const r of rooms) {
      try {
        const out = await sql.begin(async (tx) => {
          await tx`set local lock_timeout = '3s'`;
          return seedBundledPacksSql(tx as unknown as postgres.Sql, r.workspace_id, r.channel_id, [entry]);
        });
        refreshed += out.refreshed;
      } catch (e) {
        failed++;
        console.error(`platform_packs: ${entry.pack.name} in room ${r.channel_id} stays at its version until the next boot:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return { stale, refreshed, failed };
}
