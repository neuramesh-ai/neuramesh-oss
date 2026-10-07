// the marketing OS fix round's desktop states (`?fixes=`, 2026-10-06), the twin of apps/hq/preview/mock-fixes.ts.
// `?fixes=1` is the brand bootstrap's session as the server stores it: the words come from the daemon's
// own module (shared brandlines.ts), and each doc-drop line passes the server's dash scrub, as an agent
// message does by default since #308: the shape the cards failed to parse. `?fixes=writing` is the same
// session while the second doc is in flight: the first card, a shelf with only that doc (fixesShelf), and
// the daemon's log line through window.__nmDocWrites (harness-hooks.ts), which the brand rail's row reads.
// staged on a flag, so every other capture reads the static world as it was. kept apart from
// mock-fixtures.ts (at its size cap) and spliced in there, so this file imports nothing from it.
import {
  BOOTSTRAP_PLAYS, BOOTSTRAP_SCHED_FALLBACK, bootstrapClosing, bootstrapOpening, docDropBody, playbookRecsBlock, scrubEmdash,
} from '@neuramesh/shared';

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const CH = 'c-marketing';
export const FIXES_BRAND_THREAD_ID = 'th-fixes-brand';

const DOCS: Array<[label: string, file: string, doc: string]> = [
  ['Business profile', 'business-profile.md', '# Acme. Business Profile\n\n## What It Is\nAcme writes release notes for small software teams. It reads the merged pull requests and writes the notes that users read.\n\n## Core Value Prop\n"Every release, in the words your users use."\n\n## Pricing\n| Tier | Price | Key Limits |\n|---|---|---|\n| Free | $0 | one repository |\n| Pro | $19 a month | ten repositories |'],
  ['Brand guidelines', 'brand-guidelines.md', '# Acme. Brand Guidelines\n\n## Color Palette\n| Role | Hex |\n|---|---|\n| Background | #101010 |\n| Text | #e8e2d4 |\n| Accent | #d97757 |\n\n**Mood:** calm and exact — a tool that does its job and nothing more.\n\n## Brand Voice\n- Short sentences\n- One claim in each line'],
  ['Market research', 'market-research.md', '# Acme. Market Research\n\n## Competitive Landscape (2026)\n| Competitor | Category | Key Weakness vs Acme |\n|---|---|---|\n| Changelogger | hosted changelog | the team writes each note by hand |'],
  ['Social strategy', 'social-strategy.md', '# Acme. Social Media Strategy\n\n## Platform Priority\nX first, then LinkedIn.\n\n## Posting Cadence (Starter)\n- X: three posts each week'],
];

const SCHED = '```nmsched\n' + JSON.stringify({ channel: CH, recs: BOOTSTRAP_SCHED_FALLBACK }) + '\n```';
const said = (id: string, at: number, body: string) => ({ id, author_kind: 'agent', author_id: 'a-plume', created_at: ago(at), body: scrubEmdash(body) });

const brandMsgs = [
  { id: 'fx1', author_kind: 'human', author_id: 'u-george', created_at: ago(30 * MIN), body: '**Marketing HQ setup**\nWebsite: acme.dev\nGoal: first 1000 signups\nFocus: social, content' },
  said('fx2', 29 * MIN, bootstrapOpening({ site: 'acme.dev', research: false, repo: false })),
  ...DOCS.map(([label, file, doc], i) => said(`fx${3 + i}`, (27 - 3 * i) * MIN, docDropBody(label, file, doc))),
  said('fx7', 14 * MIN, bootstrapClosing(SCHED, playbookRecsBlock(CH, [...BOOTSTRAP_PLAYS]))),
];

/** the one splice mock-fixtures.ts makes: mutation, never reassignment (see mock-release.ts) */
export function stageFixes(w: { mockThreads: Record<string, any[]>; convoMsgs: Record<string, any[]> }, on: string | null): void {
  if (on !== '1' && on !== 'writing') return;
  // while the second doc is in flight, the session holds the setup, the opening and the first card
  const msgs = on === 'writing' ? brandMsgs.slice(0, 3) : brandMsgs;
  const last = msgs[msgs.length - 1]!;
  (w.mockThreads[CH] ??= []).push({ id: FIXES_BRAND_THREAD_ID, title: 'Brand foundation', description: '', created_by: 'human:u-george', task_id: null,
    created_at: ago(30 * MIN), updated_at: last.created_at, msg_count: msgs.length, last_body: last.body, last_author_kind: 'agent', last_at: last.created_at });
  w.convoMsgs[FIXES_BRAND_THREAD_ID] = msgs;
}

/** the room's shelf (mock-marketing.ts) while the second doc is in flight: of the four docs, it holds only
 *  the one the session saved, at its card's time. the brand rail drops its row when the doc in flight is
 *  on the shelf. the room's bridge lane passes no flag, so this reads the query itself */
export function fixesShelf<T extends { name: string }>(rows: T[]): T[] {
  if (typeof location === 'undefined' || new URLSearchParams(location.search).get('fixes') !== 'writing') return rows;
  const [, file, doc] = DOCS[0]!;
  const saved = { id: 'fx-art-1', kind: 'doc', name: file, mime: 'text/markdown', inline_content: doc, size_bytes: doc.length, promoted: 1, message_id: null, task_id: null, created_at: brandMsgs[2]!.created_at };
  return [saved as unknown as T, ...rows.filter((a) => !DOCS.some(([, f]) => f === a.name))];
}
