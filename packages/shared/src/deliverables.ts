// Deliverables (docs/30) — which attached artifacts are worth rendering in the thread, and how
// they group into one delivery.
//
// A submit attaches everything: the real files a worker produced AND `result.md`, which is the
// agent's summary text — byte-for-byte the message posted just above it. Rendering that as a file
// card makes the thread say everything twice (live: #1032 shipped three artifacts, two of them
// `result.md` echoes of messages already on screen).
//
// Pure so the rules are unit-testable without a renderer.

export interface DeliverableArtifact {
  id: string;
  name: string;
  kind: string;
  /** inline content, when the artifact carries it (docs/diffs do; big files may not) */
  content?: string | null;
  createdAt: string;
}

/** normalize for comparison: whitespace and trailing punctuation are not a difference */
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * Is this artifact just an echo of something already in the transcript? Two ways:
 *  - its content matches a message body (the `result.md` case), or
 *  - it is a bare `result.md` whose content is the summary the agent also posted.
 * A near-match counts: the submit note appends an evidence line the message may not carry, so an
 * artifact whose content STARTS the message (or vice versa) is still the same words twice.
 */
export function isEchoArtifact(art: DeliverableArtifact, messageBodies: readonly string[]): boolean {
  const c = norm(art.content ?? '');
  if (!c) return false;
  return messageBodies.some((b) => {
    const m = norm(b);
    if (!m) return false;
    if (m === c) return true;
    // one contains the other, and the shorter is most of the longer — the same text plus a note
    const [short, long] = c.length <= m.length ? [c, m] : [m, c];
    return short.length >= 40 && long.startsWith(short.slice(0, Math.min(short.length, 400)));
  });
}

/**
 * Design mockups are the ONLY artifacts excluded, and only because something else really
 * does render them inline: the design handoff card. Carding them too would be the same
 * artifact twice on one screen.
 *
 * Implementation and ship plans used to be excluded on that same reasoning, and for both
 * it was false (founder report, 2026-07-28). Nothing renders a plan document in the
 * thread — the linkified name only opens a full-screen overlay — so the artifact you are
 * being asked to approve was the one thing you could not read in place, while a research
 * report beside it got a scrollable card.
 *
 * The ship case is the subtler one, and it is why `kind: 'ship'` is no longer here: the
 * release-plan gate card looks like that second surface but isn't. It renders the
 * CHECKLIST off `tasks.ship_plan` (round, risk, summary, tickable items) — not the
 * `ship-plan-vN.md` report the shipper actually wrote — and only in ship_review/releasing,
 * so the document was invisible before and after those states too.
 *
 * Both now card like any other deliverable; a plan card's title opens the block-comment
 * overlay, where the commenting and approving still happen.
 *
 * The marketer's `posts.json` is not a fourth case either, and the reasoning changed once —
 * worth recording, because the first answer was right about the symptom and wrong about the
 * rule. It is a wire format (content.ts parses it into content_items that render as
 * SocialPostCards), so "something else renders it" seems to apply. The original argument was
 * that the draft strip and the file strip sat on OPPOSITE sides of `if (!isContent)`, so they
 * could never collide — true then, and it stopped being true when those two transcript
 * builders merged (2026-08-08).
 *
 * The rule that survives is the one that branch was really encoding: the wire file cards as a
 * FALLBACK, when nothing else is rendering those posts, and never beside the cards themselves.
 * That is a check on the thread's own contents, not on a task's kind, so it lives at the call
 * site (`isPostsFile` + "are there draft cards?") rather than here. Excluding it outright would
 * still be wrong — a thread with the file and no content_items is the live #1048 shape, and
 * emptier is not better.
 *
 * Either way it renders AS POSTS, never as raw JSON (FileBody's `posts` branch, the same way
 * csv renders as a table), so it reads correctly on every surface — the Library, the mobile
 * viewer, an old task's history.
 */
const WORKFLOW_KINDS = new Set(['design']);
export function isWorkflowArtifact(art: Pick<DeliverableArtifact, 'name' | 'kind'>): boolean {
  return WORKFLOW_KINDS.has(art.kind);
}

/**
 * Is this the marketer's drafted-posts wire file? Named here (not in the renderer) so the
 * desktop thread, the Library and the mobile viewer can never disagree about what it is.
 */
export function isPostsFile(name: string): boolean {
  const base = (name.split('/').pop() ?? name).toLowerCase();
  return base === 'posts.json' || base === 'revised.json';
}

/**
 * The artifacts worth a card: what the work PRODUCED. Drops echoes of messages already on screen
 * and workflow artifacts that have their own surface. Order is preserved (callers sort by time).
 */
export function renderableDeliverables(
  arts: readonly DeliverableArtifact[],
  messageBodies: readonly string[],
): DeliverableArtifact[] {
  return arts.filter((a) => !isWorkflowArtifact(a) && !isEchoArtifact(a, messageBodies));
}

/** artifacts attached by one submit land within seconds of each other — one delivery */
export const DELIVERY_WINDOW_MS = 90_000;

/**
 * Group artifacts into deliveries by time cluster, so a rework's files render as their OWN strip
 * further down the transcript instead of piling onto the first attempt's. Input need not be sorted.
 */
export function groupDeliveries(
  arts: readonly DeliverableArtifact[],
  windowMs = DELIVERY_WINDOW_MS,
): DeliverableArtifact[][] {
  const sorted = [...arts].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const out: DeliverableArtifact[][] = [];
  for (const a of sorted) {
    const last = out[out.length - 1];
    const prev = last?.[last.length - 1];
    if (last && prev && Date.parse(a.createdAt) - Date.parse(prev.createdAt) <= windowMs) last.push(a);
    else out.push([a]);
  }
  return out;
}

/**
 * A later delivery of the SAME filename supersedes the earlier one (a rework re-attaching
 * `result.md`). Returns the ids that are no longer current — the renderer dims them rather than
 * hiding them, because history stays readable.
 */
export function supersededIds(arts: readonly DeliverableArtifact[]): Set<string> {
  const newest = new Map<string, DeliverableArtifact>();
  for (const a of arts) {
    const cur = newest.get(a.name);
    if (!cur || Date.parse(a.createdAt) > Date.parse(cur.createdAt)) newest.set(a.name, a);
  }
  const keep = new Set([...newest.values()].map((a) => a.id));
  return new Set(arts.filter((a) => !keep.has(a.id)).map((a) => a.id));
}

/** the weight shown in a card header: words for prose, lines for code/diff, else bytes */
export function fileWeight(name: string, kind: string, content: string | null | undefined): string {
  const c = content ?? '';
  if (!c) return '';
  const bytes = new TextEncoder().encode(c).length;
  const kb = bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
  if (kind === 'diff' || /\.(diff|patch)$/i.test(name)) {
    const add = (c.match(/^\+(?!\+\+)/gm) ?? []).length;
    const del = (c.match(/^-(?!--)/gm) ?? []).length;
    return `+${add} −${del}`;
  }
  if (/\.(md|markdown|txt)$/i.test(name) || kind === 'doc') {
    const words = c.trim().split(/\s+/).filter(Boolean).length;
    return `${words.toLocaleString('en-US')} w · ${kb}`;
  }
  if (/\.(csv|tsv)$/i.test(name)) {
    const rows = c.trim().split('\n').length - 1;
    return `${Math.max(0, rows)} rows`;
  }
  return kb;
}

/** short uppercase type tag for the card header — the extension, or the artifact kind */
export function fileTag(name: string, kind: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1];
  if (ext) return ext.toLowerCase().slice(0, 5);
  return (kind || 'file').slice(0, 5);
}
