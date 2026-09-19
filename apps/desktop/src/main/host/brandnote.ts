// THE BRAND NOTE FOR A CONVERSATION (George, 2026-09-19, the Flowe AI room on the web app: rex ran
// the UGC playbook and asked "what does Flowe AI do? no brand docs or prior brand research are in
// this room's workspace yet" while business-profile.md, brand-guidelines.md, market-research.md
// and social-strategy.md sat on the room's shelf, in the Workbench beside the thread).
//
// A content TASK opens with the brand docs staged (staging.ts stageBrandContext writes them into
// the scratch dir and says so). A CONVERSATION never did: the orchestrator's turn and the
// marketer's chat turn carried the connected accounts and nothing about the shelf, so knowing the
// docs existed depended on the model deciding to call list_library. A capable model does. The
// house model on a cloud machine did not, and asserted the shelf was empty. These are agents: the
// note does not recite the docs and it does not forbid sentences (George, 2026-09-19: "our
// instructions should guide them on tools to use to find brand information, and request one when
// not found"). It names what is on the shelf and the tool that reads it, and when the shelf is
// empty it says which tool asks the human and which one shelves the answer.
//
// One reader for both: `readBrand` is what stageBrandContext read inline before, moved here so the
// task note and the conversation note cannot drift apart on which docs count.
import { BRAND_DOC_NAMES } from '@neuramesh/shared';
import type { AttDbLike } from '../agents';

export interface BrandFacts {
  marketing: boolean;
  product: string | null;
  logo: boolean;
  profile: { website?: string; focus?: string[]; goal?: string };
  /** the newest of each named brand doc on this room's shelf, by name */
  docs: Map<string, string>;
  conns: Array<{ provider: string; handle: string | null }>;
}

const NONE: BrandFacts = { marketing: false, product: null, logo: false, profile: {}, docs: new Map(), conns: [] };

/** the room's kind, product, profile, brand docs and connected accounts, in one read */
export async function readBrand(db: AttDbLike, channelId: string): Promise<BrandFacts> {
  const [ch] = await db.getAll<{ kind: string; marketing: string | null; website: string | null; logo: string | null }>(
    `select c.kind as kind, c.marketing as marketing, p.website as website, p.logo_url as logo
       from channels c left join projects p on p.id = c.project_id where c.id = ?`,
    [channelId],
  ).catch(() => [] as Array<{ kind: string; marketing: string | null; website: string | null; logo: string | null }>);
  if (!ch || ch.kind !== 'marketing') return NONE;
  const rows = await db.getAll<{ name: string; inline_content: string | null }>(
    `select name, inline_content from artifacts where channel_id = ? and kind = 'doc' order by created_at desc`,
    [channelId],
  ).catch(() => [] as Array<{ name: string; inline_content: string | null }>);
  const docs = new Map<string, string>();
  for (const r of rows) if (BRAND_DOC_NAMES.includes(r.name) && r.inline_content && !docs.has(r.name)) docs.set(r.name, r.inline_content);
  // by PROJECT (0106): `channel_id` only records where the OAuth round-trip was started, so a
  // channel-keyed read told the marketer "nothing is connected" in every room but that one.
  const conns = await db.getAll<{ provider: string; handle: string | null }>(
    `select k.provider, k.handle from connectors k
      where k.status = 'connected'
        and k.workspace_id = (select workspace_id from channels where id = ?)
        and (k.project_id is null or k.project_id = (select project_id from channels where id = ?))
      order by (k.project_id is not null) desc`,
    [channelId, channelId],
  ).catch(() => [] as Array<{ provider: string; handle: string | null }>);
  let profile: BrandFacts['profile'] = {};
  try { if (ch.marketing) profile = JSON.parse(ch.marketing) as BrandFacts['profile']; } catch { /* leave empty */ }
  return { marketing: true, product: profile.website || ch.website || null, logo: !!ch.logo, profile, docs, conns };
}

/**
 * The note a marketing room's conversation turn carries: where the brand lives and the tools that
 * reach it. Empty outside a marketing room. In a marketing room it always says something, because
 * an empty shelf is a fact the agent must act on (ask, then shelve), not one it may guess at.
 */
export async function brandNote(db: AttDbLike, channelId: string): Promise<string> {
  const b = await readBrand(db, channelId);
  if (!b.marketing) return '';
  const lines: string[] = [];
  if (b.product) lines.push(`Product: ${b.product}${b.logo ? ' (logo on file)' : ''}.`);
  if (b.profile.goal) lines.push(`Growth goal: ${b.profile.goal}.`);
  if (b.profile.focus?.length) lines.push(`Focus: ${b.profile.focus.join(', ')}.`);
  if (b.docs.size) {
    lines.push(`Brand docs on this room's shelf: ${[...b.docs.keys()].join(', ')}. Read them with read_library_doc (scope room) before you draft, and before you ask the human what the product does or who it is for. list_library shows the rest of the shelf.`);
  } else {
    // project scope only: a project is one product, and another project's brand docs are another product's
    lines.push(`This room has no brand docs yet (the marketing setup writes ${BRAND_DOC_NAMES.join(', ')}). Call list_library with scope project in case they live in another room of this project. If none exist, ask the human for the product facts you need before you draft, or to finish the marketing setup, and shelve what you learn with propose_library_doc.`);
  }
  return `\n\n[MARKETING CONTEXT — this conversation is in a marketing room. Where its brand lives:\n- ${lines.join('\n- ')}]`;
}
