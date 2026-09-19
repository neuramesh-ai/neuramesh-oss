// Bundled skill packs into a channel (a leaf of pgstore.ts, on its ratchet's terms): insert the
// packs a room's kind carries, and REFRESH the ones whose bundled content has moved since the
// room was seeded. Idempotent at every level. Runs in the caller's transaction.
//
// "Moved" = the stored version differs from bundledPackVersion(entry), which is content-derived
// (seed/packversion.ts: the pin alone misses every preamble-only edit, and a skill added to a
// pack later). There is no older/newer to order here: the pin is a git sha, and for an
// origin='bundled' pack the seed compiled into the running control-api IS the truth, so any
// difference means the room holds something this deploy no longer ships. A pack a human IMPORTED
// under the same name is never touched: the name is unique per channel, so that row owns it.
import type postgres from 'postgres';
import { bundledPackVersion } from '../seed/packversion';
import type { SeedPack } from '../seed/skill-seed';

const NOBODY = '00000000-0000-0000-0000-000000000000';

export async function seedBundledPacksSql(sql: postgres.Sql, workspaceId: string, channelId: string, seed: readonly SeedPack[]): Promise<{ added: number; refreshed: number }> {
  let added = 0;
  let refreshed = 0;
  for (const entry of seed) {
    const { pack, skills } = entry;
    const version = bundledPackVersion(entry);
    const [exists] = await sql`select id, origin, version from skill_packs
      where workspace_id = ${workspaceId}::uuid and channel_id = ${channelId} and name = ${pack.name} for update`;
    if (exists) {
      if (exists['origin'] !== 'bundled' || exists['version'] === version) continue;
      await refreshBundledPack(sql, workspaceId, channelId, exists['id'] as string, entry, version);
      refreshed++;
      continue;
    }
    const [row] = await sql`insert into skill_packs (workspace_id, channel_id, name, description, source_url, source_ref, version, origin, status)
      values (${workspaceId}::uuid, ${channelId}, ${pack.name}, ${pack.description}, ${pack.source_url}, ${pack.source_ref}, ${version}, 'bundled', 'ready') returning id`;
    const packId = row!['id'] as string;
    for (const s of skills) await insertSkill(sql, workspaceId, channelId, packId, s);
    added++;
  }
  return { added, refreshed };
}

const insertSkill = (sql: postgres.Sql, workspaceId: string, channelId: string, packId: string, s: SeedPack['skills'][number]) =>
  sql`insert into skills (workspace_id, channel_id, name, description, scope, body, status, author_kind, author_id, pack_id, enabled)
    values (${workspaceId}::uuid, ${channelId}, ${s.name}, ${s.description}, 'channel', ${s.body}, 'active', 'agent'::actor_kind, ${NOBODY}::uuid, ${packId}::uuid, true)`;

// Bring one already-seeded bundled pack up to the deploy's content, in place.
//
// What a refresh must not eat, and how each is protected WITHOUT a new column:
//   · `enabled`: per-room, on the pack row and on every skill row (the discovery seam reads both).
//     Never in a SET list here; a disabled pack refreshes and stays off.
//   · curated edits: a skill someone rewrote is theirs, not the bundle's. `skills.version` is the
//     marker: the seed inserts at 1 and NEVER bumps it, and skill.update (humans and the
//     orchestrator, the only in-place edit path) always does. So version > 1 is proof the row left
//     the bundle's hands, and those rows are skipped whole. This is the model-pack rule in other
//     clothes: pack-apply skips model_source='manual'.
//   · someone else's skill filed under this pack: skill.create takes a packId, so a row here need
//     not be ours at all. The seed authors as the nil uuid; anything else is a person's.
//   · deliberate retirement: a skill someone deprecated stays deprecated. Resurrecting it as part
//     of a background boot backfill would silently undo a curation decision.
async function refreshBundledPack(sql: postgres.Sql, workspaceId: string, channelId: string, packId: string, entry: SeedPack, version: string): Promise<void> {
  const { pack, skills } = entry;
  await sql`update skill_packs set description = ${pack.description}, source_url = ${pack.source_url},
    source_ref = ${pack.source_ref}, version = ${version}, updated_at = now() where id = ${packId}`;
  for (const s of skills) {
    // the pack's own row for this name, active one first: several deprecated namesakes may coexist
    // (the active-name unique index is partial), and it is the live one that a refresh is about
    const [row] = await sql`select id, status, version, author_id from skills
      where workspace_id = ${workspaceId}::uuid and channel_id = ${channelId}::uuid and pack_id = ${packId}::uuid and name = ${s.name}
      order by (status = 'active') desc, updated_at desc limit 1 for update`;
    if (!row) { await insertSkill(sql, workspaceId, channelId, packId, s); continue; } // a skill the bundle GAINED
    // retired, curated, or never ours (nil author = written by the seed): all three stay put
    if (row['status'] !== 'active' || Number(row['version']) > 1 || row['author_id'] !== NOBODY) continue;
    await sql`update skills set description = ${s.description}, body = ${s.body}, updated_at = now() where id = ${row['id']}`;
  }
  // skills the bundle DROPPED: retire the ones still exactly as seeded, so agents stop discovering
  // a skill this deploy no longer carries. Same ownership test as above, so a person's own skill
  // filed under this pack is not swept away by an upstream deletion.
  const names = skills.map((s) => s.name);
  if (names.length) {
    await sql`update skills set status = 'deprecated', updated_at = now()
      where pack_id = ${packId}::uuid and status = 'active' and version = 1
        and author_id = ${NOBODY}::uuid and name <> all(${names}::text[])`;
  }
}
