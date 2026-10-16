import { PACKS } from '@neuramesh/shared';
import { designerImageCred, generateBrandImage, type HostedAgent, type AttDbLike } from '../agents';
import { brandTokensFor } from './brandtokens';
import { providerFor } from '../runtime/adapter';

/** One image-generation path for chat and coding deliverables. */
export async function shareImage({ apiUrl, ownerActorId, db, designer }: {
  apiUrl: string; ownerActorId: string; db: AttDbLike;
  designer?: Pick<HostedAgent, 'id' | 'name' | 'runtime' | 'model'>;
}, agent: Pick<HostedAgent, 'name' | 'runtime' | 'model'>, ch: { id: string; slug: string; workspace_id: string }, brief: string): Promise<{ thumb?: string; bytes?: Buffer; error?: string }> {
  const { cred } = await designerImageCred(apiUrl, ch.workspace_id, designer, ownerActorId);
  if (!cred) return { error: 'no image key connected — add an OpenAI or Gemini key under Image generation' };
  const brand = await brandTokensFor(db, ch.id);
  const reviewSeat = providerFor(agent.runtime) === cred.provider ? agent.model : (PACKS[cred.provider === 'openai' ? 'openai-core' : 'gemini-core']?.roles.marketer ?? '');
  const g = await generateBrandImage(cred, reviewSeat, brand, brief, 'x', agent.name);
  if (g.error || !g.thumb) return { error: g.error ?? 'the image came back empty' };
  console.log(`agent_share_image agent=${agent.name} room=#${ch.slug} ok model=${g.model ?? '?'}`);
  return { thumb: g.thumb, bytes: g.bytes }; // the bytes too, for a caller that keeps a copy
}
