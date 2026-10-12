// the marketing room's lines (2026-10-06): what the brand bootstrap (apps/desktop host/marketing.ts)
// posts and streams in the setup session, the doc-drop card's wire shape, and the film's first line
// (host/videogen.ts). one pure module, so the daemon and the preview story say the same words and
// nobody keeps a copy. a person reads them, so they follow the house rules: no em dash, no semicolon,
// the simple present. the stream lines never pass the server's dash scrub, and the scrub skips the
// nmsched and nmplays fences, so these words are the only guard those lines have.
import { filmMinutes } from './filmprompt';
import type { PlaybookRec } from './playbooks';

/** what a doc-drop card says about the doc: on the shelf already, or waiting for the person's approval */
export type DocDropVerb = 'saved to' | 'proposed for';

/** the doc-drop card's wire shape (hq and desktop docdrop.ts parse it). the dash is the separator every
 *  published desktop parses, and the server's dash scrub turns it into a comma, which the parsers read
 *  too. a parsed card shows the label and the file, never this line */
export function docDropBody(label: string, file: string, doc: string, verb: DocDropVerb = 'saved to'): string {
  return `📄 **${label}** — ${verb} the library as \`${file}\`.\n\n${doc}`;
}

/** the daemon's log line while a brand doc is in flight, and the rail's reading of it (BrandSections).
 *  a retry logs `writes <file> again`, which reads as the same doc */
export const docWriteLog = (file: string): string => `writes ${file}`;
export function docInFlight(summary: string | null | undefined): string | null {
  return /^writes (\S+\.md)(?:\s|$)/.exec(summary ?? '')?.[1] ?? null;
}

const DOCS = 'four brand docs here: the business profile, the brand guidelines, the market research and the social strategy';
const SHELF = "the room's **Library** tab";

/** the opening line. `research`: the runtime reads the site and searches the web (claude-code). the
 *  others write each doc in one completion from the answers, and the machine reads only the site's
 *  colors and fonts, best effort (marketing-research.ts siteDesignTokens) */
export function bootstrapOpening(o: { site: string | null; research: boolean; repo: boolean }): string {
  if (o.research) {
    const reads = o.site
      ? `First I read ${o.site}${o.repo ? ', its key pages and the project code' : ' and its key pages'}. I also search the web for the product's market.`
      : `${o.repo ? 'First I read the project code. I also search' : 'First I search'} the web for the product and its market.`;
    return `${reads} Then I write ${DOCS}. Each doc goes to ${SHELF} when it is done. Each doc takes a few minutes.`;
  }
  const colors = o.site ? ` I also try to read the colors and fonts from ${o.site}.` : '';
  return `I write ${DOCS}. I write them from your answers.${colors} Each doc goes to ${SHELF} when it is done.`;
}

/** a reply in the setup session writes the docs that did not land (host/wakerouting.ts) */
export function bootstrapResume(files: readonly string[]): string {
  return files.length === 1 ? `I write \`${files[0]}\` now.` : `I write the last ${files.length} docs now.`;
}

/** the stream's status lines, italic in the live bubble */
export const bootstrapStart = (subject: string): string => `*I start the brand docs for ${subject}…*`;
export function bootstrapDocStatus(file: string, n: number, total: number, research: boolean): string {
  return `*${research ? 'I research and write' : 'I write'} \`${file}\` (${n}/${total})…*`;
}

export const bootstrapDocFailed = (label: string): string => `⚠️ I could not write **${label}** this time. Reply here, and I write it again.`;
export const BOOTSTRAP_ERROR = '⚠️ An error stopped the brand docs. Reply here, and I continue.';

/** a reply that completes the set closes short: the first close already posted the cards */
export function bootstrapNudgeDone(files: readonly string[]): string {
  const names = files.map((f) => `\`${f}\``);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  return `${list} ${files.length === 1 ? 'is' : 'are'} in ${SHELF}. The brand docs are complete.`;
}

/** a pass writes only the docs that are missing, so the count is this pass's, never the room's */
export const bootstrapPartial = (done: number, total: number): string => `This time I wrote ${done} of ${total} docs. Reply here, and I write the rest.`;

/** the close: the cadence card (nmsched) and the first playbooks (nmplays), each under its own line */
export function bootstrapClosing(schedBlock: string, playsBlock: string): string {
  return `The brand docs are done. They are in ${SHELF}, and later drafts use them. Here is a first cadence. Arm the rows that you want. Nothing posts until you approve it.\n\n${schedBlock}\n\n` +
    `The next step is a baseline. Run the audit once to get a score. Run it again later to see what changed.\n\n${playsBlock}`;
}

/** the cadence card's rows when the strategy doc gives none that parse. a row's prompt shows on the card */
export const BOOTSTRAP_SCHED_FALLBACK: ReadonlyArray<{ title: string; cadence: 'weekdays' | 'weekly'; weekday?: number; atTime: string; prompt: string }> = [
  { title: 'Weekday post drafts', cadence: 'weekdays', atTime: '09:00', prompt: 'Draft one X post from the narrative pillars in social-strategy.md, in the brand voice.' },
  { title: 'Weekly thread', cadence: 'weekly', weekday: 2, atTime: '10:00', prompt: 'Draft a thread on the strongest narrative pillar of the week. Use the brand docs.' },
  { title: 'Weekly competitor scan', cadence: 'weekly', weekday: 1, atTime: '08:00', prompt: 'Run the competitor scan again with the competitor-scan skill. Write the changes since market-research.md as a room note.' },
];

/** the first playbooks the close recommends: a baseline first, and never run on its own */
export const BOOTSTRAP_PLAYS: readonly PlaybookRec[] = [
  { id: 'audit', why: 'one score out of 100 across six dimensions' },
  { id: 'geo', why: 'who AI search cites for your questions today' },
];

/** the film's first line in the thread (host/videogen.ts): the length the door films, the tier's house
 *  name and never the model behind it (2026-10-06), and the tier's limit when it held a longer pick */
export function filmStartLine(f: { seconds: number; tier: string; asked: number; credits: number }): string {
  const held = f.seconds < f.asked ? ` (${f.tier} films up to ${f.seconds} s)` : '';
  return `The ${f.seconds} s film starts on ${f.tier}${held}. It takes about ${filmMinutes(f.seconds)} minutes and costs ${f.credits} credits. The film lands on the card.`;
}
