// The public door's job (docs/design/release-drafts-2026-09 §5.2): one queued announcement, worked
// by the minute cron. Read the repository (public, or through the GitHub App's installation),
// scan for the release, read the site for the brand, one Starter turn for the brief and the
// posts, draw the release card, mark ready, send the email. Every outside call is injected, so
// the whole job runs under test with fakes and the statuses are what the page renders.
import { normalizeDraft, releaseBriefFrom, releaseDigest, scanWindow, renderAnnounceReady, type RenderedEmail, type ScanResult, type ReleaseCandidate } from '@neuramesh/shared';
import { MARKETING_SKILL_SEED } from './seed/marketing-skill-seed';
import { parseDraftAnswer, starterText, type DraftAnswer } from './announce-brain';
import { installationToken, readRepoSignals, type RepoSignals } from './github-app';
import { pickCardPalette, renderReleaseCard } from './releasecard';
import { readSite, type SiteRead } from './siteread';
import { APP_URL } from './mail';
import type { AnnounceStore, AnnouncementRow, AnnouncePost } from './store/announce';

export interface AnnounceDeps {
  read: (slug: string, since: string, opts: { token?: string | null }) => Promise<RepoSignals>;
  token: (installationId: number) => Promise<string | null>;
  site: (url: string) => Promise<SiteRead | null>;
  brain: (system: string, user: string) => Promise<string>;
  card: (input: { tag: string; title: string; product: string; palette: { bg: string; ink: string; accent: string }; size: 'square' }) => Promise<Uint8Array>;
  mail: (row: AnnouncementRow, email: RenderedEmail) => Promise<unknown>;
  now?: () => Date;
}

/** the networks the door drafts for before sign-in: the two text-first ones and the one that carries the card */
export const DOOR_NETWORKS = ['x', 'linkedin', 'instagram'] as const;
const NETWORK_NAME: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok' };

export function defaultDeps(mail: AnnounceDeps['mail']): AnnounceDeps {
  return {
    read: (slug, since, opts) => readRepoSignals(slug, since, { token: opts.token ?? null }),
    token: async (id) => (await installationToken(id)).token,
    site: (url) => readSite(url),
    brain: (system, user) => starterText(system, user),
    card: (input) => renderReleaseCard(input),
    mail,
  };
}

const skillBody = (): string => MARKETING_SKILL_SEED.flatMap((p) => p.skills).find((s) => s.name === 'release-announcement')?.body ?? '';

export function systemPrompt(): string {
  return `${skillBody()}

You answer for the public door: a stranger pasted a repository and a website, and nobody has connected an account yet. Draft for X, LinkedIn and Instagram.
Answer with ONE JSON object and nothing else:
{"verdict":"feature|improvement|fix|none","title":"the headline feature, one sentence","why":"the reasons, with the pull requests by number","audience":"who this release is for","assets":"what the release card shows, and why","gaps":"what you could not determine","posts":[{"platform":"x","body":"under 280 characters"},{"platform":"linkedin","body":"three short paragraphs"},{"platform":"instagram","body":"one or two sentences","imageBrief":"the release card: the version and the feature name on the brand palette, no other text"}]}
Every string in plain English, simple tenses, active voice, one idea per sentence. No em dashes, no semicolons. Never invent a number, a quote or a customer. When the verdict is none, posts is an empty array and why says what the release contained.
The release notes are evidence on their own: a release whose notes say what a person can now do is a feature, with or without pull requests. A small repository often has notes and no pull requests, and that is not a reason for none. Name what the notes say and cite the notes as the basis.`;
}

export function userPrompt(slug: string, scan: ScanResult, brand: SiteRead | null, website: string): string {
  const lines = [`The repository: ${slug}.`, '', releaseDigest(slug, scan, { since: null, checkedAt: 'now' })];
  if (brand) {
    lines.push('', `The brand, read from ${website}:`);
    if (brand.title) lines.push(`Title: ${brand.title}`);
    if (brand.description) lines.push(`Description: ${brand.description}`);
    if (brand.palette.length) lines.push(`Palette: ${brand.palette.slice(0, 6).join(' ')}`);
    if (brand.fonts.length) lines.push(`Fonts: ${brand.fonts.slice(0, 3).join(', ')}`);
    if (brand.voice) lines.push(`Voice sample: ${brand.voice.slice(0, 900)}`);
  } else {
    lines.push('', `The site ${website} could not be read. Use the repository's own words.`);
  }
  lines.push('', `Draft for these networks: ${DOOR_NETWORKS.map((n) => NETWORK_NAME[n]).join(', ')}.`);
  return lines.join('\n');
}

/** the brief, rendered from the structured answer so its shape can never drift from the contract */
export function briefMarkdown(tag: string, a: DraftAnswer, basis: string): string {
  return [
    `# Release brief · ${tag}`,
    `Verdict: ${a.verdict} · Basis: ${basis}`,
    '', '## Why', a.title, a.why,
    '', '## Audience', a.audience || 'Not stated.',
    '', '## Assets', a.assets || 'A release card on the site palette, for Instagram.',
    '', '## What I could not determine', a.gaps || 'Nothing beyond the digest.',
    '',
  ].join('\n');
}

/** one post per door network, cleaned by the same normalizer the marketer's file goes through */
export function doorPosts(raw: DraftAnswer['posts']): AnnouncePost[] {
  const out: AnnouncePost[] = [];
  for (const p of raw) {
    const d = normalizeDraft(p);
    if (!d || !(DOOR_NETWORKS as readonly string[]).includes(d.platform) || out.some((o) => o.platform === d.platform)) continue;
    let body = d.body;
    if (d.platform === 'x' && body.length > 280) {
      const cut = body.slice(0, 277);
      const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
      body = end > 120 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
    }
    out.push({ platform: d.platform as AnnouncePost['platform'], body, ...(d.imageBrief ? { imageBrief: d.imageBrief } : {}) });
  }
  return out;
}

const hostOf = (url: string): string => { try { return new URL(url.startsWith('http') ? url : `https://${url}`).host.replace(/^www\./, ''); } catch { return url; } };

export async function runAnnounceJob(ann: AnnounceStore, row: AnnouncementRow, deps: AnnounceDeps): Promise<{ status: 'ready' | 'failed'; error?: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const fail = async (error: string): Promise<{ status: 'failed'; error: string }> => {
    await ann.update(row.id, { status: 'failed', error });
    return { status: 'failed', error };
  };
  try {
    const token = row.private && row.installationId ? await deps.token(row.installationId) : null;
    const since = new Date(now.getTime() - 180 * 86_400_000).toISOString();
    const signals = await deps.read(row.repo, since, { token });
    const full = scanWindow({ releases: signals.releases, prs: signals.prs, tags: signals.tags, cursor: { at: '1970-01-01T00:00:00.000Z', tag: null }, now: now.toISOString() });
    const candidate: ReleaseCandidate | undefined = (row.tag ? full.candidates.find((c) => c.key === row.tag) : undefined) ?? full.candidates[full.candidates.length - 1];
    if (!candidate) return fail('No release, tag or merged pull request was found in this repository.');
    const scan: ScanResult = { candidates: [candidate], skipped: full.skipped, cursor: full.cursor };
    try {
      await ann.update(row.id, { tag: candidate.key, digest: { candidate, skipped: full.skipped.length }, status: 'drafting' });
    } catch (e) {
      // the one-per-release index: a release published between the ask and this run already has a row for this email
      if (/announcements_one_per_release|duplicate key/i.test(e instanceof Error ? e.message : String(e))) return fail(`Drafts for ${candidate.key} exist for this email already. Open the link from that email.`);
      throw e;
    }
    const brand = await deps.site(row.website).catch(() => null);
    await ann.update(row.id, { brand });
    const text = await deps.brain(systemPrompt(), userPrompt(row.repo, scan, brand, row.website));
    const answer = parseDraftAnswer(text);
    if (!answer) return fail('The drafts did not come back in a shape I could read. Try again.');
    const posts = answer.verdict === 'none' ? [] : doorPosts(answer.posts);
    if (answer.verdict !== 'none' && !posts.length) return fail('The drafts came back empty. Try again.');
    const basis = `release notes, ${candidate.prs.length} merged pull request${candidate.prs.length === 1 ? '' : 's'}${brand ? `, ${hostOf(row.website)}` : ''}`;
    const brief = briefMarkdown(candidate.key, answer, basis);
    const parsed = releaseBriefFrom('release-report.md', brief);
    const title = (parsed?.title || answer.title || candidate.name).replace(/\.$/, '');
    if (posts.some((p) => p.platform === 'instagram')) {
      try {
        const product = (brand?.title?.split(/[|·•:-]/)[0]?.trim() || row.repo.split('/')[1] || row.repo).slice(0, 40);
        const png = await deps.card({ tag: candidate.tag ?? candidate.key, title, product, palette: pickCardPalette(brand), size: 'square' });
        await ann.setImage(row.id, png, 'image/png');
      } catch (e) {
        console.warn(`announce ${row.id}: the release card did not render: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // stamped when the drafts ARE ready, not when the job began: the live row read "ready 150 ms after
    // the ask", which was the start instant, not the pipeline's four steps
    await ann.update(row.id, { status: 'ready', readyAt: (deps.now ?? (() => new Date()))().toISOString(), posts, brief, error: null });
    const link = `${APP_URL}/announce/${row.id}`;
    const email = renderAnnounceReady({ repo: row.repo, tag: candidate.tag ?? candidate.key, title, networks: posts.map((p) => NETWORK_NAME[p.platform] ?? p.platform), site: brand ? hostOf(row.website) : null, link, verdict: answer.verdict });
    await deps.mail({ ...row, tag: candidate.key, posts, brief }, email).catch((e) => console.warn(`announce ${row.id}: mail failed: ${e instanceof Error ? e.message : String(e)}`));
    return { status: 'ready' };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
