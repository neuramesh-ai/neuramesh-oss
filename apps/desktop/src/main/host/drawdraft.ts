// THE BUTTON'S DRAW: one draft's picture, whoever pressed Generate (docs/design/calendar-image-gen-2026-08).
//
// the desktop's calendar modal calls draftImageFor in process. no other surface can: a tab, the
// phone and a thread card post the ‹gen-image:› marker, and the machine that wakes on it answers
// with drawOnAsk. both run drawDraft, so a draft with no brief gets one written from its post on
// every surface (George, 2026-09-27: Generate image failed on the web and the phone). before, the
// marker drew only a draft that already had a brief, so a tab waited three minutes for nothing.
//
// split from host/content.ts on its ratchet's own terms. drawBriefed moved with it, and
// generateDraftImage (the agents' tools) still draws through it. the credential, the brand, the
// pixels and the words arrive through ctx, so a test fakes them without a host.
import { PACKS } from '@neuramesh/shared';
import { providerFor } from '../runtime/adapter';
import { BRIEF_SYSTEM, REWRITE_SYSTEM, briefAsk, parseRewrite, rewriteAsk, type BrandBits } from './draftbrief';
import type { brandTokensFor, generateBrandImage, HostedAgent } from '../agents';
import type { ImageCred, textComplete } from '../imagegen';
import type { HostCtx } from './ctx';

type Ch = { id: string; slug: string; workspace_id: string };
type DraftRow = { platform: string; media: string | null; body: string };
export type DrawOutcome = { ok: boolean; thumb?: string; body?: string; model?: string; error?: string };

/** the reason a card shows when the workspace holds no image key (the one credential story) */
export const NO_IMAGE_KEY = 'This workspace has no image key. Add one under Image generation.';

export function makeDraw(ctx: Pick<HostCtx, 'post'> & {
  agents: Map<string, HostedAgent>;
  db: { getAll: <T>(sql: string, params?: unknown[]) => Promise<T[]> };
  /** the room's image credential: the designer's seat key, else the workspace's (agents.ts designerImageCred) */
  imageCred: (ch: Ch) => Promise<ImageCred | null>;
  brandOf: (channelId: string) => ReturnType<typeof brandTokensFor>;
  paint: typeof generateBrandImage;
  complete: typeof textComplete;
}) {
  const { agents, db, post, imageCred, brandOf, paint, complete } = ctx;
  const postAs = (agent: HostedAgent) => async (cmd: unknown): Promise<boolean> => {
    const r = await post('/v1/commands', { kind: 'agent', id: agent.id, role: agent.role }, cmd).catch(() => null);
    return !!r?.ok;
  };
  const mediaOf = (raw: string | null): { brief?: string; image_error?: string } => {
    try { return (JSON.parse(raw ?? 'null') as { brief?: string; image_error?: string } | null) ?? {}; } catch { return {}; }
  };
  const seatOf = (agent: HostedAgent, cred: ImageCred): string =>
    providerFor(agent.runtime) === cred.provider ? agent.model : (PACKS[cred.provider === 'openai' ? 'openai-core' : 'gemini-core']?.roles.marketer ?? '');

  /** The draw tail every caller shares: credential ladder → brand → pixels → attach + thumb (or
   *  the imageError revise). Outcome-shaped so the calendar's button gets data, not prose.
   *  `stale`: the draft carries an old reason. it goes first, so a retry that fails the same way
   *  reads as a new outcome to a surface that waits for one (the tab's modal). */
  async function drawBriefed(agent: HostedAgent, ch: Ch, itemId: string, platform: string, brief: string, stale = false): Promise<DrawOutcome> {
    const postCmd = postAs(agent);
    const cred = await imageCred(ch);
    if (!cred) {
      await postCmd({ type: 'content.revise', item: itemId, imageError: NO_IMAGE_KEY });
      return { ok: false, error: NO_IMAGE_KEY };
    }
    if (stale) await postCmd({ type: 'content.revise', item: itemId, imageError: '' });
    const g = await paint(cred, seatOf(agent, cred), await brandOf(ch.id), brief, platform, agent.name);
    if (g.error || (!g.thumb && !g.publish)) {
      const why = g.error ?? 'the image came back empty';
      await postCmd({ type: 'content.revise', item: itemId, imageError: why });
      console.log(`agent_gen_image agent=${agent.name} room=#${ch.slug} item=${itemId.slice(0, 8)} failed=${why}`);
      return { ok: false, error: why };
    }
    if (g.publish) await postCmd({ type: 'content.attach_media', item: itemId, dataUrl: g.publish });
    if (g.thumb) await postCmd({ type: 'content.revise', item: itemId, thumb: g.thumb });
    console.log(`agent_gen_image agent=${agent.name} room=#${ch.slug} item=${itemId.slice(0, 8)} ok model=${g.model ?? '?'}`);
    return { ok: true, thumb: g.thumb, model: g.model };
  }

  /**
   * The button's draw (Generate · Regenerate · New angle). A brief-less draft gets its brief WRITTEN
   * first (one text-only completion on the same image credential: one key powers words and pixels,
   * so "no image key" stays the single failure story), and `rewrite` redrafts body + brief from a
   * new angle before the draw. Every mutation rides the command lane as `agent`.
   */
  async function drawDraft(agent: HostedAgent, ch: Ch, itemId: string, d: DraftRow, opts: { angle?: string; rewrite?: boolean } = {}): Promise<DrawOutcome> {
    const media = mediaOf(d.media);
    let brief = media.brief ?? '';
    if (brief && !opts.rewrite) return drawBriefed(agent, ch, itemId, d.platform, brief, !!media.image_error);
    const postCmd = postAs(agent);
    const cred = await imageCred(ch);
    if (!cred) {
      await postCmd({ type: 'content.revise', item: itemId, imageError: NO_IMAGE_KEY });
      return { ok: false, error: NO_IMAGE_KEY };
    }
    const brandFull = await brandOf(ch.id);
    const bits: BrandBits = { palette: brandFull.tokens.palette.map((c) => c.hex), fonts: brandFull.tokens.fonts, product: brandFull.product };
    // a stale reason leaves with the write below: one command, not two
    const clear = media.image_error ? { imageError: '' } : {};
    // a failure before the draw goes on the card too. a tab and a thread card wait for an outcome
    // on the row, and a reason only in the reply left them to wait three minutes (George, 2026-09-27)
    const fail = async (why: string): Promise<DrawOutcome> => {
      await postCmd({ type: 'content.revise', item: itemId, imageError: why });
      return { ok: false, error: why };
    };
    let body: string | undefined;
    if (opts.rewrite) {
      const rw = parseRewrite(await complete(cred, seatOf(agent, cred), REWRITE_SYSTEM, rewriteAsk(d.body, d.platform, bits, opts.angle)).catch(() => ''));
      if (!rw) return fail('The rewrite came back in a form that cannot be used.');
      body = rw.body;
      brief = rw.brief;
      if (!(await postCmd({ type: 'content.revise', item: itemId, body, imageBrief: brief, ...clear }))) return fail('The rewrite did not save.');
      console.log(`draft_rewrite agent=${agent.name} room=#${ch.slug} item=${itemId.slice(0, 8)}${opts.angle ? ' angled' : ''}`);
    } else {
      const raw = await complete(cred, seatOf(agent, cred), BRIEF_SYSTEM, briefAsk(d.body, d.platform, bits)).catch(() => '');
      brief = raw.trim().replace(/^["'`]+|["'`]+$/g, '').split('\n')[0]!.slice(0, 400);
      if (!brief) return fail('The model could not write an image brief from this post.');
      await postCmd({ type: 'content.revise', item: itemId, imageBrief: brief, ...clear });
    }
    return { ...(await drawBriefed(agent, ch, itemId, d.platform, brief)), body };
  }

  /** the calendar modal's direct line (host/directacts.ts): the room's marketer draws, else the orchestrator */
  async function draftImageFor(itemId: string, opts: { angle?: string; rewrite?: boolean } = {}): Promise<{ ok: boolean; thumb?: string; body?: string; error?: string }> {
    const [d] = await db.getAll<DraftRow & { channel_id: string; slug: string; workspace_id: string }>(
      `select ci.platform, ci.media, ci.body, ci.channel_id, c.slug, c.workspace_id
         from content_items ci join channels c on c.id = ci.channel_id
        where ci.id = ? and ci.status = 'draft'`,
      [itemId],
    ).catch(() => []);
    if (!d) return { ok: false, error: 'This draft is not available now.' };
    const ch = { id: d.channel_id, slug: d.slug, workspace_id: d.workspace_id };
    const agent = [...agents.values()].find((a) => a.role === 'marketer' && a.channels.has(ch.id))
      ?? [...agents.values()].find((a) => a.role === 'orchestrator');
    if (!agent) return { ok: false, error: 'No agent runs on this machine yet. Wait for the workspace to start, then try again.' };
    const { ok, thumb, body, error } = await drawDraft(agent, ch, itemId, d, opts);
    return { ok, thumb, body, error };
  }

  /** the ‹gen-image:› marker's answer (host/wake.ts): the same draw as the calendar button, the
   *  outcome in words for the thread. scoped by the room the wake is in, the ACL boundary. */
  async function drawOnAsk(agent: HostedAgent, ch: Ch, itemId: string): Promise<string> {
    const [d] = await db.getAll<DraftRow>(
      `select platform, media, body from content_items where id = ? and channel_id = ? and status = 'draft'`,
      [itemId, ch.id],
    ).catch(() => [] as DraftRow[]);
    if (!d) return 'That draft is not available to draw. It is scheduled, published or deleted.';
    const out = await drawDraft(agent, ch, itemId, d);
    if (out.ok) return `I drew the image${out.model ? ` on ${out.model}` : ''}. It is on the card now. Nothing publishes until you approve it.`;
    return out.error === NO_IMAGE_KEY
      ? 'I cannot draw it. This workspace has no image key. Add an OpenAI or Gemini key under Image generation, then press Try again on the card.'
      : `The draw failed: ${(out.error ?? 'no reason came back').replace(/[.\s]+$/, '')}. The card shows the reason. Press Try again on the card to draw it again.`;
  }

  return { drawBriefed, draftImageFor, drawOnAsk };
}
