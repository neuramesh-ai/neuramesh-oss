// The frame (docs/design/brand-grounding-2026-09 §6): a video post names an image on its room's
// shelf, and the film shows that screen. This is the one lookup both doors share: the command
// handler checks the name when a draft is written or revised, the film door reads the bytes when
// it submits. Images use either a legacy inline data URI or verified object bytes.
//
// A leaf beside the stores, on the ratchet's own terms (pgstore.ts and the contract are at their
// caps): the SQL lives here and reaches the store's handle the way credits.ts does (`sqlOf`); the
// memory store answers through its one-line `libraryImage`. Newest by name wins, as the shelf's
// own listing supersedes.
import { sqlOf } from '../credits';
import type { Store } from './contract';
import type { BrainObjectRef } from '../brain-objects';
import { artifactContent } from './artifact-content';

export interface FrameImage { name: string; mime: string; dataUrl: string }

/** the newest image with that name (case-insensitive) on the room's shelf, else on a shelf of the
 *  room's PROJECT (a product is one project's, and its screenshots sit where they were uploaded:
 *  George 2026-09-20, "search the project files for actual product images"), else null.
 *
 *  REAL APP SCREENSHOTS ONLY (George, 2026-10-06): a film shows an image that a person created, or
 *  one the platform took from the project's repository (`source` repo:, set by POST /v1/repo/shelve
 *  alone). An agent's web capture or drawn picture never counts. `any` finds the image whatever made
 *  it, so a refusal can say why a name does not count. */
export async function libraryImage(store: Store, channelId: string, name: string, opts: { any?: boolean } = {}): Promise<FrameImage | null> {
  const sql = sqlOf(store);
  const any = !!opts.any;
  if (sql) {
    const [row] = await sql<Array<{ name: string; mime: string | null; inline_content: string | null; object_ref: BrainObjectRef | null }>>`
      select a.name, a.mime, a.inline_content, b.object_ref from artifacts a
       left join brain_artifacts b on b.artifact_id = a.id left join threads t on t.id = b.thread_id
       where lower(a.name) = lower(${name}) and (a.inline_content like 'data:image/%' or (a.mime like 'image/%' and b.object_ref is not null))
         and (t.id is null or t.kind <> 'coding')
         and (${any}::boolean or a.created_by_kind = 'human' or a.source like 'repo:%')
         and (a.channel_id = ${channelId}::uuid
              or a.channel_id in (select id from channels where project_id = (select project_id from channels where id = ${channelId}::uuid)))
       order by (a.channel_id = ${channelId}::uuid) desc, a.created_at desc limit 1`;
    const content = row ? await artifactContent(row.inline_content, row.object_ref) : null;
    return row && content ? frameOf(row.name, row.mime, content) : null;
  }
  const mem = store as { libraryImage?: (channelId: string, name: string, any?: boolean) => Promise<{ name: string; mime: string | null; content: string } | null> };
  const hit = mem.libraryImage ? await mem.libraryImage(channelId, name, any) : null;
  return hit ? frameOf(hit.name, hit.mime, hit.content) : null;
}

/** marks an artifact as the platform's copy of a repository file: POST /v1/repo/shelve alone calls this */
export async function setArtifactSource(store: Store, artifactId: string, source: string): Promise<void> {
  const sql = sqlOf(store);
  if (sql) { await sql`update artifacts set source = ${source} where id = ${artifactId}::uuid`; return; }
  await (store as { setArtifactSource?: (id: string, source: string) => Promise<void> }).setArtifactSource?.(artifactId, source);
}

const frameOf = (name: string, mime: string | null, dataUrl: string): FrameImage => ({ name, mime: mime ?? (/^data:(image\/[a-z0-9.+-]+)/i.exec(dataUrl)?.[1] ?? 'image/png'), dataUrl });
