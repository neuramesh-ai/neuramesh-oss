// The nav's session list — pure. App feeds it historyRows output + channel/project metadata and
// the machine-local scope; it hands back the rows to draw, the rooms to offer, and the projects
// the picker lists. Tested from src/main.
//
// ── THE FLAT ROUND (2026-08-17, George) ──────────────────────────────────────────────────────
// This used to be `navTree`: rows regrouped under one collapsible header PER PROJECT, each with
// its own channel strip and its own `n more ›`. Four projects therefore spent eight rows of
// chrome and three separate cap decisions before the rail had said anything you came for — and
// every row spent its first line on `#room`, repeated straight down the column.
//
// The replacement is not a new mechanism: it is the **ScopeBar** every workspace destination has
// worn since 2026-08-07 (Tasks · Whiteboards · Automations · Files · Skills · Activity) —
// *narrowing is a visible, reversible choice, never an invisible default*. The nav was the last
// surface answering "what am I looking at?" its own way.
//
// Rulings carried across from the tree (each one kept its job, not its shape):
// - **Every project stays visible** (2026-08-07): a quiet project must be visible, clickable and
//   creatable-in. It now lives in the picker's list — with its logo, its ask dot and its live
//   pulse — instead of costing two rows of rail height forever. `projects` below is EVERY project
//   the caller hands over, whether or not it holds a single thread;
// - **Attention is COLOR, never a numeral** — an ask rides the row itself; a project holding one
//   wears a dot in the picker; and when the ask is outside the current scope the chip itself
//   wears one (`askOutside`), so narrowing can never silence an ask;
// - **Asks pin into the cap** — an ask-holding row is always among the visible, ahead of newer
//   quiet rows. One cap over one list now, rather than one per group;
// - **A cap sorts BEFORE it slices** (docs/33 §9 trap 11) — see `stripChannels`;
// - **Channel order is BUSIEST FIRST**, slug breaking ties (`chanOrder`), the same order
//   `nm:channels` ships so every surface that lists rooms agrees;
// - **The strip is the inside of a project**: rooms are only offered once a project is picked.
//   Across projects the slugs repeat (three `#marketing`s in three projects), and a strip whose
//   chips cannot be told apart is not a strip — the picker is the door to them there.

export interface NavTreeRowMeta {
  key: string;
  channelId: string | null;
  /** ISO timestamp — historyRows' `when`; ISO sorts lexicographically, so no Date parsing here */
  when: string;
}

/** One chip in the room strip (2026-08-09). */
export interface NavTreeChannel {
  id: string;
  slug: string;
  /** feeding the list right now — true for every channel when no room filter is set */
  on: boolean;
  /** a thread in THIS room holds an ask, so the chip carries a dot even when the room is filtered out */
  hasAsk: boolean;
  /** the room's whole message count — the strip's order (busiest leftmost, 2026-08-11) */
  msgs: number;
}

/** A row in the project picker — and the source of the scope chip's own face. */
export interface NavFlatProject {
  id: string;
  name: string;
  /** the project's face — its detected logo, else ProjLogo's letter tile */
  logo: string | null;
  /** any thread in this project holds an ask (computed over ALL rows, never the scoped ones) */
  hasAsk: boolean;
  /** any thread in this project has an open run — the picker row's live pulse */
  live: boolean;
  /** how many sessions it holds at all; 0 = a project you have never talked in, still listed */
  count: number;
}

/** What a row has to say about where it lives — the caller draws only what the scope doesn't. */
export interface NavFlatRowMeta {
  projectId: string | null;
  projectName: string | null;
  projectLogo: string | null;
}

/** The rail's machine-local narrowing. Both null = "All projects", the resting state. */
export interface NavScope {
  projectId: string | null;
  /** only meaningful inside a project — the picker clears it whenever the project changes */
  channelId: string | null;
}

export const emptyNavScope = (): NavScope => ({ projectId: null, channelId: null });

/**
 * The rail's one cap. Generous — the list scrolls, and with the groups gone there are no
 * neighbours left for one busy project to bury (which is what forced the tree's 3 / 12 pair).
 * Past this, ⌘Y is the surface.
 */
export const NAV_FLAT_CAP = 12;

/** How many channel chips the strip shows before folding into “+N” (one row, George 2026-08-09). */
export const NAV_STRIP_CAP = 2;

/**
 * The strip's visible slice. BUSIEST-FIRST is the resting state (2026-08-11, George — see
 * `chanOrder`), but two kinds of chip PIN into the cap ahead of it, for the same reason asks pin
 * into the row cap above: a state the strip is expressing must never hide inside the “+N” —
 *  · the room the list is currently FILTERED to (`on` while a filter is active), else the
 *    strip shows two unlit chips and the lit one is invisible — a filter you can't see is a
 *    filter you can't clear;
 *  · a room holding an ask (its dot is the whole point of the dot).
 * Pins re-sort to the resting order so pinning never reorders what the eye scans.
 */
export function stripChannels(channels: NavTreeChannel[], cap: number = NAV_STRIP_CAP): { visible: NavTreeChannel[]; more: number } {
  if (channels.length <= cap) return { visible: channels, more: 0 };
  const filtered = channels.some((c) => !c.on);
  const pinned = channels.filter((c) => (filtered && c.on) || c.hasAsk);
  // the tail is sorted BEFORE it is sliced, not after: sorting only the survivors would let the
  // caller's order decide who survived, and the whole point of `chanOrder` is that the cap keeps
  // the rooms you live in. (It read correct until 2026-08-11 only because every caller happened
  // to hand this function a slug-sorted array.)
  const rest = channels.filter((c) => !pinned.includes(c)).sort(chanOrder);
  const visible = [...pinned, ...rest.slice(0, Math.max(0, cap - pinned.length))]
    .slice(0, Math.max(cap, pinned.length)) // never drop a pin, even if pins alone exceed the cap
    .sort(chanOrder);
  return { visible, more: channels.length - visible.length };
}

/**
 * The one channel order: busiest room first, slug breaking ties (2026-08-11, George). Alphabetical
 * ordered rooms by NAME, which is never why you are looking for one — and with the strip folding
 * past two chips, the room you live in could sit inside a “+N” because its slug starts with a
 * late letter. Ties fall back to slug so rooms nobody has posted in keep a stable, readable order
 * instead of shuffling on every load.
 */
export function chanOrder(a: NavTreeChannel, b: NavTreeChannel): number {
  return b.msgs - a.msgs || a.slug.localeCompare(b.slug);
}

/** One project's folder in the GROUPED rail (rail-ink round, 2026-09-04 — the Codex shape George chose). */
export interface NavGroup<R> {
  id: string;
  name: string;
  logo: string | null;
  /** the rows this folder shows — recency, asks pinned into the folder's cap */
  rows: Array<R & NavFlatRowMeta>;
  /** rows the folder's cap hides — the "Show more" row's reason to exist */
  hidden: number;
  /** every session in the project, shown or not — the folded folder's count */
  count: number;
  hasAsk: boolean;
  live: boolean;
  folded: boolean;
}

export interface NavGroupedResult<R> {
  groups: Array<NavGroup<R>>;
  /** rows whose room belongs to no project — listed after the folders, flat */
  orphans: Array<R & NavFlatRowMeta>;
  /** an ask sits inside a FOLDED folder — its row wears the dot so folding cannot silence it */
  askFolded: boolean;
}

/** how many rows a folder shows before "Show more" — Codex's five; the rail scrolls */
export const NAV_GROUP_CAP = 5;

/**
 * THE GROUPED RAIL (rail-ink round, 2026-09-04, George — "the grouping by project in our mockup"):
 * Chat mode's list is folders, one per project that holds a session, newest folder first, rows
 * inside by recency with asks pinned into a per-folder cap. Empty projects are NOT folders (they
 * are the picker's business, and a folder with nothing in it is a row of chrome); a folded folder
 * keeps its count and its ask dot (the 2026-08-16 nesting rules ② and ④, applied to projects).
 *
 * This is deliberately NOT `navTree` returning: no channel strips, no per-group `n more ›` chrome —
 * one row per folder, and rows that say nothing the folder already says.
 */
export function navGrouped<R extends NavTreeRowMeta>(opts: {
  rows: R[];
  filter?: (r: R) => boolean;
  channels: Array<{ id: string; project_id: string | null; slug?: string; msg_count?: number }>;
  projects: Array<{ id: string; name: string; logo_url?: string | null }>;
  askKeys: Set<string>;
  liveKeys: Set<string>;
  /** project ids the human folded (persisted) */
  folded: Set<string>;
  /** project ids the human asked to show fully this session */
  expanded: Set<string>;
  cap?: number;
}): NavGroupedResult<R> {
  const cap = opts.cap ?? NAV_GROUP_CAP;
  const all = opts.filter ? opts.rows.filter(opts.filter) : opts.rows;
  const projectOf = new Map(opts.channels.map((c) => [c.id, c.project_id]));
  const byId = new Map(opts.projects.map((p) => [p.id, p]));
  const pidOf = (r: R) => (r.channelId ? projectOf.get(r.channelId) ?? null : null);
  const byRecency = (a: R, b: R) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0);
  const decorate = (r: R, pid: string | null) => {
    const p = pid ? byId.get(pid) : null;
    return { ...r, projectId: pid, projectName: p?.name ?? null, projectLogo: p?.logo_url ?? null };
  };
  const buckets = new Map<string, R[]>();
  const orphans: R[] = [];
  for (const r of all) {
    const pid = pidOf(r);
    if (pid && byId.has(pid)) (buckets.get(pid) ?? buckets.set(pid, []).get(pid)!).push(r);
    else orphans.push(r);
  }
  let askFolded = false;
  const groups: Array<NavGroup<R>> = [...buckets.entries()].map(([pid, mine]) => {
    const p = byId.get(pid)!;
    const sorted = mine.slice().sort(byRecency);
    const folded = opts.folded.has(pid);
    const hasAsk = sorted.some((r) => opts.askKeys.has(r.key));
    if (folded && hasAsk) askFolded = true;
    let shown = sorted;
    if (!opts.expanded.has(pid) && sorted.length > cap) {
      // asks pin into the folder's cap, newest first, re-sorted so the pin never reorders the scan
      const asks = sorted.filter((r) => opts.askKeys.has(r.key));
      const quiet = sorted.filter((r) => !opts.askKeys.has(r.key));
      shown = [...asks.slice(0, cap), ...quiet.slice(0, Math.max(0, cap - asks.length))].sort(byRecency);
    }
    return {
      id: pid, name: p.name, logo: p.logo_url ?? null,
      rows: folded ? [] : shown.map((r) => decorate(r, pid)),
      hidden: folded ? 0 : sorted.length - shown.length,
      count: sorted.length,
      hasAsk,
      live: sorted.some((r) => opts.liveKeys.has(r.key)),
      folded,
    };
  });
  // newest folder first — the folder whose latest session is latest — so the rail still reads as
  // recency, one level up; ties by name so quiet projects keep a stable order
  const newest = new Map(groups.map((g) => [g.id, (buckets.get(g.id) ?? []).slice().sort(byRecency)[0]?.when ?? '']));
  groups.sort((a, b) => { const x = newest.get(a.id)!, y = newest.get(b.id)!; return x < y ? 1 : x > y ? -1 : a.name.localeCompare(b.name); });
  return { groups, orphans: orphans.sort(byRecency).map((r) => decorate(r, null)), askFolded };
}

export interface NavFlatResult<R> {
  /** recency-ordered, capped, asks pinned in — each decorated with the project it belongs to */
  rows: Array<R & NavFlatRowMeta>;
  /** rows the cap hid — the “Everything else ⌘Y” row's reason to exist */
  moreCount: number;
  /** every project the caller handed over, for the picker */
  projects: NavFlatProject[];
  /** the picked project, or null on All projects */
  scopeProject: NavFlatProject | null;
  /** the picked project's rooms, busiest first — EMPTY on All projects (see the header note) */
  channels: NavTreeChannel[];
  /** the picked room, for the room chip's label */
  scopeChannel: NavTreeChannel | null;
  /** an ask exists OUTSIDE the current scope — the project chip wears a dot so narrowing can't silence it */
  askOutside: boolean;
  /** rows exist in this project but the room filter hides every one of them */
  filteredOut: boolean;
}

/**
 * CODE MODE's predicate (rail-ink round, 2026-09-04 — the Chat | Code switch under the head).
 * A row is code work when it carries a branch or a pull request — a repo-backed task today, and
 * an engineering session (`engineeringSessionId`) the day that branch lands: the predicate is
 * written for both so the switch relists rather than reshapes. Pure; navtree.test.ts covers it.
 */
export function isCodeRow(r: { branch?: string | null; task?: { branch?: string | null; pr_url?: string | null } | null; engineeringSessionId?: string | null }): boolean {
  return !!(r.branch || r.task?.branch || r.task?.pr_url || r.engineeringSessionId);
}
/** Chat mode's predicate: every conversation — a repo-backed task is still a thread — but never an
 *  engineering session, which has no room and belongs to Code (mixing them in was what produced
 *  rows like `Code · e2e-local · main`, George 2026-09-04) */
export function isChatRow(r: { engineeringSessionId?: string | null }): boolean {
  return !r.engineeringSessionId;
}

export function navFlat<R extends NavTreeRowMeta>(opts: {
  /** every row before any narrowing — `filter` (a MODE, not a scope) is applied first, so the
   *  picker's counts, the cap and `askOutside` all speak about the rows the mode shows */
  filter?: (r: R) => boolean;
  rows: R[];
  channels: Array<{ id: string; project_id: string | null; slug?: string; msg_count?: number }>;
  projects: Array<{ id: string; name: string; logo_url?: string | null }>;
  scope: NavScope;
  askKeys: Set<string>;
  liveKeys: Set<string>;
  cap?: number;
}): NavFlatResult<R> {
  const cap = opts.cap ?? NAV_FLAT_CAP;
  const all = opts.filter ? opts.rows.filter(opts.filter) : opts.rows;
  const projectOf = new Map(opts.channels.map((c) => [c.id, c.project_id]));
  const byId = new Map(opts.projects.map((p) => [p.id, p]));
  const pidOf = (r: R) => (r.channelId ? projectOf.get(r.channelId) ?? null : null);

  // ── the picker's list: EVERY project, whether or not it holds a thread ──
  const projects: NavFlatProject[] = opts.projects.map((p) => {
    const mine = all.filter((r) => pidOf(r) === p.id);
    return {
      id: p.id,
      name: p.name,
      logo: p.logo_url ?? null,
      hasAsk: mine.some((r) => opts.askKeys.has(r.key)),
      live: mine.some((r) => opts.liveKeys.has(r.key)),
      count: mine.length,
    };
  });
  // a scope pointing at a project that no longer exists (archived, deleted, another machine's
  // pick) resolves to All rather than to an empty rail with no visible way out
  const scopeProject = opts.scope.projectId ? projects.find((p) => p.id === opts.scope.projectId) ?? null : null;

  // ── the strip: the picked project's rooms. Across projects the slugs repeat, so there is no
  //    strip to draw — the picker is the door (see the header note). ──
  const roomFilter = scopeProject ? opts.scope.channelId : null;
  const inProject = scopeProject ? all.filter((r) => pidOf(r) === scopeProject.id) : all;
  const askRooms = new Set(
    inProject.filter((r) => opts.askKeys.has(r.key)).map((r) => r.channelId).filter((c): c is string => !!c),
  );
  const channels: NavTreeChannel[] = scopeProject
    ? opts.channels
        .filter((c) => c.project_id === scopeProject.id)
        .map((c) => ({ id: c.id, slug: c.slug ?? '', on: !roomFilter || roomFilter === c.id, hasAsk: askRooms.has(c.id), msgs: c.msg_count ?? 0 }))
        .sort(chanOrder)
    : [];
  // a room filter naming a room outside the picked project is stale in the same way — drop it
  const scopeChannel = roomFilter ? channels.find((c) => c.id === roomFilter) ?? null : null;

  // ── the rows ──
  const scoped = scopeChannel ? inProject.filter((r) => r.channelId === scopeChannel.id) : inProject;
  let rows = scoped;
  if (scoped.length > cap) {
    // asks pin into the cap: visible = the ask rows + the newest quiet rows that still fit,
    // re-sorted to recency so the pin never reorders what the eye scans.
    //
    // The asks are sliced too, and that is the fix for a bug the tree carried: `[...asks, ...quiet]`
    // was never capped, so a project with more ask-holding rows than the cap simply rendered all of
    // them — a cap a pin can blow past is not a cap. Keeping the NEWEST asks is the honest cut, and
    // nothing is silenced by it: `askOutside` below reports any ask this list could not show, and
    // the chip wears a dot for it.
    const asks = scoped.filter((r) => opts.askKeys.has(r.key));
    const quiet = scoped.filter((r) => !opts.askKeys.has(r.key));
    rows = [...asks.slice(0, cap), ...quiet.slice(0, Math.max(0, cap - asks.length))].sort((a, b) => (a.when < b.when ? 1 : a.when > b.when ? -1 : 0));
  }
  const shownKeys = new Set(rows.map((r) => r.key));
  const decorated = rows.map((r) => {
    const pid = pidOf(r);
    const p = pid ? byId.get(pid) : null;
    return { ...r, projectId: pid, projectName: p?.name ?? null, projectLogo: p?.logo_url ?? null };
  });

  return {
    rows: decorated,
    moreCount: scoped.length - rows.length,
    projects,
    scopeProject,
    channels,
    scopeChannel,
    // an ask the scope (or the cap) is hiding — the chip has to say so, or narrowing silences it
    askOutside: all.some((r) => opts.askKeys.has(r.key) && !shownKeys.has(r.key)),
    filteredOut: inProject.length > 0 && scoped.length === 0,
  };
}
