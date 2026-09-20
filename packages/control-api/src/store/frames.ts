// The frame (docs/design/brand-grounding-2026-09 §6): a video post names an image on its room's
// shelf, and the film shows that screen. This is the one lookup both doors share: the command
// handler checks the name when a draft is written or revised, the film door reads the bytes when
// it submits. An image on the shelf lives as a data URI in `artifacts.inline_content` (the chat
// attachment lane, 0048), so the same row serves the card, the agent's list and the film.
//
// A leaf beside the stores, on the ratchet's own terms (pgstore.ts and the contract are at their
// caps): the SQL lives here and reaches the store's handle the way credits.ts does (`sqlOf`); the
// memory store answers through its one-line `libraryImage`. Newest by name wins, as the shelf's
// own listing supersedes.
import { sqlOf } from '../credits';
import type { Store } from './contract';

export interface FrameImage { name: string; mime: string; dataUrl: string }

/** the newest image with that name (case-insensitive) on the room's shelf, else on a shelf of the
 *  room's PROJECT (a product is one project's, and its screenshots sit where they were uploaded:
 *  George 2026-09-20, "search the project files for actual product images"), else null */
export async function libraryImage(store: Store, channelId: string, name: string): Promise<FrameImage | null> {
  const sql = sqlOf(store);
  if (sql) {
    const [row] = await sql<Array<{ name: string; mime: string | null; inline_content: string }>>`
      select name, mime, inline_content from artifacts
       where lower(name) = lower(${name}) and inline_content like 'data:image/%'
         and (channel_id = ${channelId}::uuid
              or channel_id in (select id from channels where project_id = (select project_id from channels where id = ${channelId}::uuid)))
       order by (channel_id = ${channelId}::uuid) desc, created_at desc limit 1`;
    return row ? frameOf(row.name, row.mime, row.inline_content) : null;
  }
  const mem = store as { libraryImage?: (channelId: string, name: string) => Promise<{ name: string; mime: string | null; content: string } | null> };
  const hit = mem.libraryImage ? await mem.libraryImage(channelId, name) : null;
  return hit ? frameOf(hit.name, hit.mime, hit.content) : null;
}

const frameOf = (name: string, mime: string | null, dataUrl: string): FrameImage => ({ name, mime: mime ?? (/^data:(image\/[a-z0-9.+-]+)/i.exec(dataUrl)?.[1] ?? 'image/png'), dataUrl });
