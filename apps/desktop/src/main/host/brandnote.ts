import { projectContext, projectLibrary, type ProjectAnchor } from './project-context';
// THE BRAND NOTE FOR A CONVERSATION (George, 2026-09-19, the Flowe AI room on the web app: rex ran
// the UGC playbook and asked "what does Flowe AI do? no brand docs or prior brand research are in
// this project's workspace yet" while business-profile.md, brand-guidelines.md, market-research.md
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
import { isAppShot } from './frames';

export interface BrandFacts {
  marketing: boolean;
  product: string | null;
  logo: boolean;
  profile: { website?: string; focus?: string[]; goal?: string };
  /** the newest of each named brand doc on this project's shelf, by name */
  docs: Map<string, string>;
  /** the real app screenshots on the shelf, by name: what a video post can show (plan §6, host/frames.ts isAppShot) */
  images: string[];
  conns: Array<{ provider: string; handle: string | null }>;
}

const NONE: BrandFacts = { marketing: false, product: null, logo: false, profile: {}, docs: new Map(), images: [], conns: [] };

/** Project facts are shared by all threads, regardless of historical channel kind. */
export async function readBrand(db: AttDbLike, channelId: string, at: ProjectAnchor = {}): Promise<BrandFacts> {
  const project = await projectContext(db, channelId, at);
  if (!project) return NONE;
  const rows = (await Promise.all([
    projectLibrary(db, channelId, 100, 'project', at),
    ...BRAND_DOC_NAMES.map(name => projectLibrary(db, channelId, 1, 'project', at, name)),
  ])).flat();
  const docs = new Map<string, string>();
  const images: string[] = [];
  for (const row of rows) {
    if (row.kind === 'doc' && BRAND_DOC_NAMES.includes(row.name) && !docs.has(row.name)) {
      const body = row.inline_content ?? await row.readContent?.();
      if (body?.trim()) docs.set(row.name, body);
    } else if ((row.inline_content?.startsWith('data:image/') || row.mime?.startsWith('image/')) && isAppShot(row) && !images.includes(row.name)) images.push(row.name);
  }
  const conns = await db.getAll<{ provider: string; handle: string | null }>(
    `select provider, handle from connectors where status = 'connected' and workspace_id = ?
     and (project_id is null or project_id = ?) order by (project_id is not null) desc`,
    [project.workspace_id, project.id]);
  let profile: BrandFacts['profile'] = {};
  try { if (project.brand_profile) profile = JSON.parse(project.brand_profile) as BrandFacts['profile']; } catch { /* old invalid profile */ }
  return { marketing: !!project.brand_profile || docs.size > 0 || conns.length > 0, product: profile.website || project.website || null, logo: !!project.logo_url, profile, docs, images, conns };
}

/**
 * Every conversation can discover the active project's brand files and the tools that read them.
 * Empty when the project has no brand setup; the general library remains available.
 */
export async function brandNote(db: AttDbLike, channelId: string, at: ProjectAnchor = {}): Promise<string> {
  const b = await readBrand(db, channelId, at);
  if (!b.marketing) return '';
  const lines: string[] = [];
  if (b.product) lines.push(`Product: ${b.product}${b.logo ? ' (logo on file)' : ''}.`);
  if (b.profile.goal) lines.push(`Growth goal: ${b.profile.goal}.`);
  if (b.profile.focus?.length) lines.push(`Focus: ${b.profile.focus.join(', ')}.`);
  if (b.docs.size) {
    lines.push(`Brand docs on this project's shelf: ${[...b.docs.keys()].join(', ')}. Read them with read_library_doc (scope project) before you draft, and before you ask the human what the product does or who it is for. list_library shows the rest of the shelf.`);
  } else {
    // project scope only: a project is one product, and another project's brand docs are another product's
    lines.push(`This project has no brand docs yet (the marketing setup writes ${BRAND_DOC_NAMES.join(', ')}). Check list_library for other project documents. If none contain the needed facts, ask the human for the product facts you need before you draft, or to finish the marketing setup, and shelve what you learn with propose_library_doc.`);
  }
  // the frame (plan §6): a video post names a shelf image, and the film shows that screen instead of an invented one
  if (b.images.length) lines.push(`App screenshots on the shelf: ${b.images.join(', ')}. A beat that puts the app's screen on camera names one of them (SHOW, or the post's frame), so the film shows the real screen. A beat with no screen needs none.`);
  else lines.push('No app screenshot is on this project\'s shelf. A film shows only a real one: take one from the project\'s repository with shelve_repo_screenshot, or ask the human to upload one to this project\'s Files. A beat with no screen needs none.');
  return `\n\n[MARKETING CONTEXT — this conversation is in a project with marketing setup. Where its brand lives:\n- ${lines.join('\n- ')}]`;
}
