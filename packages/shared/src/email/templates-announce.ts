// The announce-ready email: the public door's one message to a stranger's address. The visitor
// pasted a repository at neuramesh.app/announce and left an email. The cron read the release,
// drafted one post per network, drew the release card, and this is the link back
// (docs/design/release-drafts-2026-09/plan.md §4.8 "The email"; the board AnnounceWait.dc.html
// is the visual and copy contract). Transactional: they asked for it, and this is the one
// surface that carries the link.
//
// Every sentence is ASD-STE100 (CLAUDE.md #11): active voice, simple tenses, one idea each,
// no em dashes, no semicolons. Split out of templates.ts like templates-account.ts.
import { button, esc, h1, layout, p, rule, small } from './layout';
import { trimEndChars } from '../linear';
import { done, type RenderedEmail, type TemplateMeta } from './templates';

export const announceReadyMeta: TemplateMeta = {
  kind: 'transactional',
  shape: 'The beat. The drafts are ready, here is the door, stop',
  claims: [
    ['One draft per network, X, LinkedIn and Instagram, from one Starter turn', 'docs/design/release-drafts-2026-09/plan.md:§4.8 The job'],
    ['The release card is drawn on the site’s palette', 'docs/design/release-drafts-2026-09/plan.md:§4.6, §4.8 The job'],
    ['The button opens the ready page, /announce/:id', 'proposed: apps/web/src/announce.tsx (docs/design/release-drafts-2026-09/plan.md:§6 Site)'],
    ['Sign in imports the drafts: the project, its marketing room, the session, the cards', 'docs/design/release-drafts-2026-09/plan.md:§4.8 Ready, §5.2 POST /v1/announce/:id/claim'],
    ['A marketing room can watch the repository daily', 'apps/desktop/src/main/host/releasewatch.ts:1-6; packages/shared/src/playbooks-registry.ts:221 release'],
    ['The request was made at neuramesh.app/announce with this address', 'docs/design/release-drafts-2026-09/plan.md:§4.8 The form (proposed: apps/web /announce, plan.md:§6 Site)'],
    ['An unopened link does nothing: the import waits for a bearer sign in', 'docs/design/release-drafts-2026-09/plan.md:§5.2 POST /v1/announce/:id/claim (bearer)'],
    ['At most one email per request: one draft set per (repo, tag) per email', 'proposed: 0139_announcements.sql unique (repo, tag, email), docs/design/release-drafts-2026-09/plan.md:§6 Migrations'],
    ['A verdict of none: the brief found nothing to announce and says why', 'packages/shared/src/releasebrief.ts:6 ReleaseVerdict; docs/design/release-drafts-2026-09/plan.md:§4.4'],
    ['Sent through the Resend lane: the outbox and the suppression rules', 'packages/control-api/src/mail.ts:1; docs/design/release-drafts-2026-09/plan.md:§4.8 The email'],
  ],
};

const NETWORK_LABEL: Record<string, string> = { x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok' };
const COUNT_WORD = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** `X, LinkedIn and Instagram`: commas, then one `and`. */
const listOf = (items: string[]): string =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/** One to nine as a word at the start of the sentence. Ten and past that stay digits. */
const countWord = (n: number): string => {
  const w = COUNT_WORD[n];
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : String(n);
};

/** `https://neuramesh.app/` reads as `neuramesh.app` beside a possessive. */
const hostOf = (site: string): string => trimEndChars(site.replace(/^https?:\/\//i, ''), '/');

export function renderAnnounceReady(v: {
  /** owner/repo. The subject carries the part after the slash. */
  repo: string;
  tag: string;
  /** the headline feature from the brief. It is the preheader */
  title: string;
  /** display names (X, LinkedIn) or connector keys (x, linkedin). One draft each */
  networks: string[];
  /** the website the brand was read from, or null when no palette was read */
  site: string | null;
  /** the ready page, /announce/:id */
  link: string;
  verdict: 'feature' | 'improvement' | 'fix' | 'none';
}): RenderedEmail {
  const short = v.repo.split('/').pop() || v.repo;
  const subject = `Your release drafts are ready: ${short} ${v.tag}`;
  const preheader = v.title;
  const none = v.verdict === 'none';
  const n = v.networks.length;
  const names = listOf(v.networks.map((k) => esc(NETWORK_LABEL[k.toLowerCase()] ?? k)));
  const palette = v.site ? `, with a release card drawn on ${esc(hostOf(v.site))}’s palette` : '';
  return done(subject, preheader, layout({
    preheader: esc(preheader),
    footerWhy: `Someone entered this address at neuramesh.app/announce for ${esc(v.repo)}. Each request gets at most one email.`,
    body: [
      none
        ? h1(`Nothing in ${esc(v.tag)} is worth an announcement`)
        : h1(`${countWord(n)} draft${n === 1 ? '' : 's'} for ${esc(v.tag)} ${n === 1 ? 'is' : 'are'} ready`),
      none
        ? p('The brief says why.')
        : p(`${esc(v.title)} is announced for ${names}${palette}.`),

      button('Open the drafts', esc(v.link)),
      p(none
        ? 'Sign in to save the brief, and let your marketing room watch the next release.'
        : 'Sign in to save them, schedule them, and let your marketing room watch the next release.'),

      rule(),
      small('You asked for this at neuramesh.app/announce. If you did not, ignore this email and nothing happens.'),
    ].join(''),
  }));
}
