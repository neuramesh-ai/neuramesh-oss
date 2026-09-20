// The films store (0140, the video rung): a leaf of both stores on their ratchets' own terms, the
// announce store's shape. ONE interface, two implementations, the Store carries it as a single
// property (`store.films`). A row is the server's job record for one film on the platform's key:
// written at submit with the credits already debited (and how the charge split across the pools),
// worked by the minute cron to done or failed. Never synced: the draft the film lands on is the
// synced object.
import type postgres from 'postgres';

export type FilmStatus = 'queued' | 'running' | 'done' | 'failed';
/** what filmed a draft, as the card reads it: the tier and model, the length, the credits, when */
export interface VideoMeta { tier: string; model: string; seconds: number; credits: number; at: string; frame?: string | null; frameUsed?: boolean; shots?: { asked: number; applied: number; why?: string } }
export interface FilmRow {
  id: string;
  workspaceId: string;
  itemId: string;
  tier: string;
  model: string;
  endpoint: string;
  requestId: string | null;
  seconds: number;
  micros: number;
  grantMicros: number;
  purchasedMicros: number;
  status: FilmStatus;
  error: string | null;
  createdBy: string | null;
  /** the shelf image the draft named, and whether the lane took it (brand-grounding plan §6) */
  frame: string | null;
  frameUsed: boolean;
  createdAt: string;
  finishedAt: string | null;
}
export interface FilmCreate { workspaceId: string; itemId: string; tier: string; model: string; endpoint: string; requestId: string | null; seconds: number; micros: number; grantMicros: number; purchasedMicros: number; createdBy: string | null; frame?: string | null; frameUsed?: boolean }
export type FilmPatch = Partial<Pick<FilmRow, 'status' | 'error' | 'requestId' | 'finishedAt'>>;

export interface FilmStore {
  create(input: FilmCreate): Promise<{ id: string }>;
  get(id: string): Promise<FilmRow | null>;
  /** the open rows, oldest first: what the cron works on each tick */
  open(limit: number): Promise<FilmRow[]>;
  update(id: string, patch: FilmPatch): Promise<void>;
  /** a workspace's films, newest first: the credits history */
  forWorkspace(workspaceId: string, limit: number): Promise<FilmRow[]>;
  /** the open film on a draft, if any: one film at a time per draft */
  openForItem(itemId: string): Promise<FilmRow | null>;
}

// ── memory ─────────────────────────────────────────────────────────────────────────────────────
export class MemFilmStore implements FilmStore {
  rows: FilmRow[] = [];
  async create(input: FilmCreate): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    this.rows.push({ id, ...input, frame: input.frame ?? null, frameUsed: input.frameUsed ?? false, status: 'queued', error: null, createdAt: new Date().toISOString(), finishedAt: null });
    return { id };
  }
  async get(id: string): Promise<FilmRow | null> { return this.rows.find((r) => r.id === id) ?? null; }
  async open(limit: number): Promise<FilmRow[]> { return this.rows.filter((r) => r.status === 'queued' || r.status === 'running').slice(0, limit); }
  async update(id: string, patch: FilmPatch): Promise<void> {
    const r = this.rows.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  }
  async forWorkspace(workspaceId: string, limit: number): Promise<FilmRow[]> { return this.rows.filter((r) => r.workspaceId === workspaceId).reverse().slice(0, limit); }
  async openForItem(itemId: string): Promise<FilmRow | null> { return this.rows.find((r) => r.itemId === itemId && (r.status === 'queued' || r.status === 'running')) ?? null; }
}

// ── postgres ───────────────────────────────────────────────────────────────────────────────────
const COLS = 'id, workspace_id, item_id, tier, model, endpoint, request_id, seconds, micros, grant_micros, purchased_micros, status, error, created_by, frame, frame_used, created_at, finished_at';
type Row = Record<string, unknown>;
const rowOf = (r: Row): FilmRow => ({
  id: r['id'] as string, workspaceId: r['workspace_id'] as string, itemId: r['item_id'] as string, tier: r['tier'] as string, model: r['model'] as string, endpoint: r['endpoint'] as string,
  requestId: (r['request_id'] as string | null) ?? null, seconds: Number(r['seconds']), micros: Number(r['micros']), grantMicros: Number(r['grant_micros']), purchasedMicros: Number(r['purchased_micros']),
  status: r['status'] as FilmStatus, error: (r['error'] as string | null) ?? null, createdBy: (r['created_by'] as string | null) ?? null, frame: (r['frame'] as string | null) ?? null, frameUsed: !!r['frame_used'],
  createdAt: new Date(r['created_at'] as string).toISOString(), finishedAt: r['finished_at'] ? new Date(r['finished_at'] as string).toISOString() : null,
});

export class PgFilmStore implements FilmStore {
  constructor(private readonly sql: postgres.Sql) {}
  async create(input: FilmCreate): Promise<{ id: string }> {
    const [row] = await this.sql`insert into films (workspace_id, item_id, tier, model, endpoint, request_id, seconds, micros, grant_micros, purchased_micros, created_by, frame, frame_used)
      values (${input.workspaceId}::uuid, ${input.itemId}::uuid, ${input.tier}, ${input.model}, ${input.endpoint}, ${input.requestId}, ${input.seconds}, ${input.micros}, ${input.grantMicros}, ${input.purchasedMicros}, ${input.createdBy}::uuid, ${input.frame ?? null}, ${input.frameUsed ?? false})
      returning id`;
    return { id: row!['id'] as string };
  }
  async get(id: string): Promise<FilmRow | null> {
    const [row] = await this.sql.unsafe(`select ${COLS} from films where id = $1::uuid`, [id]);
    return row ? rowOf(row as Row) : null;
  }
  async open(limit: number): Promise<FilmRow[]> {
    const rows = await this.sql.unsafe(`select ${COLS} from films where status in ('queued', 'running') order by created_at limit $1`, [limit]);
    return rows.map((r) => rowOf(r as Row));
  }
  async update(id: string, patch: FilmPatch): Promise<void> {
    const sql = this.sql;
    const sets: Array<ReturnType<typeof sql>> = [sql`updated_at = now()`];
    if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
    if (patch.error !== undefined) sets.push(sql`error = ${patch.error}`);
    if (patch.requestId !== undefined) sets.push(sql`request_id = ${patch.requestId}`);
    if (patch.finishedAt !== undefined) sets.push(sql`finished_at = ${patch.finishedAt}`);
    const joined = sets.reduce((acc, s, i) => (i === 0 ? s : sql`${acc}, ${s}`));
    await sql`update films set ${joined} where id = ${id}::uuid`;
  }
  async forWorkspace(workspaceId: string, limit: number): Promise<FilmRow[]> {
    const rows = await this.sql.unsafe(`select ${COLS} from films where workspace_id = $1::uuid order by created_at desc limit $2`, [workspaceId, limit]);
    return rows.map((r) => rowOf(r as Row));
  }
  async openForItem(itemId: string): Promise<FilmRow | null> {
    const [row] = await this.sql.unsafe(`select ${COLS} from films where item_id = $1::uuid and status in ('queued', 'running') order by created_at desc limit 1`, [itemId]);
    return row ? rowOf(row as Row) : null;
  }
}
