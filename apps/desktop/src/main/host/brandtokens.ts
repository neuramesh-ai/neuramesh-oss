import { parseBrandGuidelines, EMPTY_BRAND, type BrandTokens } from '@neuramesh/shared';
import { readArtifactText, type ArtifactContentRow } from './artifact-content';
import type { AttDbLike } from '../agents';

// The same brand doc stageBrandContext hands the marketer as prose, read back as STRUCTURE so
// the image generator can bind the real palette (marketing-workflow §4.6). The bootstrap already
// writes a `| Role | Hex |` table into brand-guidelines.md — this is where that pays off. A room
// with no brand doc yet still generates, just without the colour constraint.
export async function brandTokensFor(db: AttDbLike, channelId: string): Promise<{ tokens: BrandTokens; product?: string }> {
  const [ch] = await db.getAll<{ marketing: string | null; website: string | null }>(
    `select c.marketing as marketing, p.website as website
       from channels c left join projects p on p.id = c.project_id where c.id = ?`,
    [channelId],
  ).catch(() => [] as Array<{ marketing: string | null; website: string | null }>);
  const [doc] = await db.getAll<ArtifactContentRow>(
    `select id, workspace_id, name, storage_path, content_hash, inline_content from artifacts where channel_id = ? and kind = 'doc' and name = 'brand-guidelines.md' order by created_at desc limit 1`,
    [channelId],
  ).catch(() => [] as Array<{ inline_content: string | null }>);
  let product = ch?.website ?? undefined;
  try { if (ch?.marketing) product = (JSON.parse(ch.marketing) as { website?: string }).website || product; } catch { /* keep the project's */ }
  const body = await readArtifactText(db, doc);
  return { tokens: body ? parseBrandGuidelines(body) : EMPTY_BRAND, product };
}
