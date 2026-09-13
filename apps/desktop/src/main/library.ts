// What the channel Library (marketing-channel plan §4.9) is allowed to shelve — kept out of
// sync.ts so the rules can be pinned without a replica.
//
// The bug this exists for: a picture the crew DREW never was an artifacts row. The publish-size
// bytes live server-side in content_media (0090 — blobs must never replicate to every client) and
// what syncs is the 640px `thumb` riding content_items.media. So a room full of generated art
// showed "0 items" under Media, which is precisely the shelf you would go looking for it in.
//
// The cure is a VIEW, not a second write: content_items stays the one truth for a drawn picture,
// and these rows are projected on read. Nothing here is ever written back.

/** One row of the Library. Mostly an artifacts row — but the shape belongs to the surface. */
export interface LibraryRow {
  id: string;
  kind: string;
  name: string;
  mime: string | null;
  inline_content: string | null;
  size_bytes: number | null;
  promoted: number | null;
  message_id: string | null;
  task_id: string | null;
  /** pg text[] as the replica's JSON text (e.g. `["brand"]`); absent on derived rows */
  tags?: string | null;
  created_at: string;
}

/** A content_items row as the replica hands it over (media is jsonb-as-text). */
export interface DraftedPost {
  id: string;
  body: string;
  media: string | null;
  task_id: string | null;
  created_at: string;
}

/**
 * A drawn post image has no filename — and six drafts from one brief produce six tiles that would
 * otherwise all read "post image". The post it was drawn FOR is what makes one recognizable, so
 * its opening words become the name.
 */
export function postImageName(body: string | null | undefined): string {
  const line = (body ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return 'post image';
  return line.length > 46 ? `${line.slice(0, 46).trimEnd()}…` : line;
}

/**
 * The drafts that carry a picture, as Library rows.
 *
 * `kind: 'image'` is a LIBRARY label, not an `artifact_kind` — it exists so the Media folder
 * catches the row and the meta line reads honestly. A draft carrying only an external `mediaUrl`
 * stays out: it is someone else's picture, it has no thumb to show, and the renderer's CSP forbids
 * remote img-src anyway.
 */
export function drawnPostRows(posts: DraftedPost[]): LibraryRow[] {
  return posts.flatMap((p): LibraryRow[] => {
    let thumb = '';
    try {
      thumb = (JSON.parse(p.media ?? 'null') as { thumb?: string } | null)?.thumb ?? '';
    } catch {
      return []; // media isn't json — there is no picture to shelve
    }
    if (typeof thumb !== 'string' || !thumb.startsWith('data:image/')) return [];
    return [{
      id: p.id,
      kind: 'image',
      name: postImageName(p.body),
      mime: /^data:(image\/[a-z0-9.+-]+)/i.exec(thumb)?.[1]?.toLowerCase() ?? 'image/jpeg',
      inline_content: thumb,
      size_bytes: thumb.length,
      promoted: 0,
      message_id: null,
      task_id: p.task_id,
      created_at: p.created_at,
    }];
  });
}

/** The room's shelf: its artifacts and its drawn pictures, newest first. */
export function channelLibrary(artifacts: LibraryRow[], posts: DraftedPost[]): LibraryRow[] {
  return [...artifacts, ...drawnPostRows(posts)].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ── What an AGENT reads off the shelf ────────────────────────────────────────────────────────
// The orchestrator could route work about a product it had no way to read anything about: its
// registry never reached `artifacts` at all. These are the pure halves of that fix, here rather
// than inline in the daemon so they can be tested without a replica.

/**
 * Newest row per NAME, order preserved.
 *
 * A library re-posts a doc under the same name each time it is rewritten (a live room carried
 * six `result.md` rows), so handing an agent every version would spend its context on stale
 * copies of one document — and worse, let it answer from a superseded one. Callers pass rows
 * already sorted newest-first, which is the order the surface reads them in anyway.
 */
export function latestByName<T extends { name: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)));
}

/**
 * A library name as a file name inside the staging dir.
 *
 * The name is DATA — it came off a row an agent wrote — so it is sanitized rather than trusted:
 * separators and dot-runs go, which is what keeps `../../.ssh/config` a file called `-.ssh-config`
 * in the staging dir instead of a write outside it.
 */
export function briefFileName(name: string): string {
  // the cap leaves room for the extension we may add, so a long name cannot exceed it
  const safe = name.replace(/[^\w.\-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[.\-]+/, '').slice(0, 77);
  if (!safe) return 'doc.md';
  return /\.[a-z0-9]{1,8}$/i.test(safe) ? safe : `${safe}.md`;
}
