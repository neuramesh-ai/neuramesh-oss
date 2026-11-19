import type postgres from 'postgres';
import type { Actor } from '@neuramesh/shared';
import { embed } from '../embedder';
import { DomainError } from '../errors';

type Row = Record<string, any>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the project of a channel, in its workspace. null when the channel is not found */
async function channelProject(sql: postgres.Sql, workspace: string, chId: string): Promise<string | null> {
  const [c] = await sql`select project_id from channels where id = ${chId}::uuid and workspace_id = ${workspace}::uuid`;
  return (c?.['project_id'] as string | undefined) ?? null;
}

/**
 * The memory view (decision D15: memory belongs to the project). A channel names its project, so a
 * caller that still passes a channel id reads the memory of the whole project.
 *   · block: the project block (kind 'project_summary'). The newest legacy channel summary stands in
 *     until the first project refresh writes one.
 *   · blocks: the legacy channel summaries of the project, newest first (the human view lists them).
 *   · facts: the project's facts, valid first, then the newest superseded ones.
 */
export async function memoryViewSql(sql: postgres.Sql, workspace: string, chId: string | null, project: string | null, actor?: Actor, marketing?:boolean) {
    const scope = project ?? (chId ? await channelProject(sql, workspace, chId) : null);
    const canReadMarketing = marketing!==false && (!actor || (await sql`select nm_destination_access(${workspace}::uuid,${actor.kind},${actor.id}::uuid,'marketing') as allowed`)[0]?.allowed === true);
    const [own] = scope && canReadMarketing ? await sql`select content, basis_count, updated_at from memory_blocks
      where workspace_id = ${workspace}::uuid and project_id = ${scope}::uuid and kind = 'project_summary' and btrim(content) <> ''` : [];
    const blocks = await sql`select b.content, b.basis_count, b.updated_at, b.kind from memory_blocks b
      join channels c on c.id = b.channel_id
      where b.workspace_id = ${workspace}::uuid and b.kind = 'channel_summary' and (${canReadMarketing} or not nm_marketing_row(c.workspace_id,'channels',to_jsonb(c))) and ((${scope}::uuid is not null and c.project_id = ${scope}::uuid)
        or (${scope}::uuid is null and b.channel_id = ${chId}::uuid))
      order by b.updated_at desc`;
    const blk = own ?? blocks[0];
    const facts = await sql`with scoped as (
      select f.id, f.content, f.kind, t.number as task_number, f.valid_from, f.valid_until, f.superseded_by
      from facts f join channels c on c.id = f.channel_id left join tasks t on t.id = f.task_id
      where f.workspace_id = ${workspace}::uuid
        and (${canReadMarketing} or not nm_marketing_row(c.workspace_id,'channels',to_jsonb(c)))
        and ((${scope}::uuid is not null and coalesce(f.project_id, c.project_id) = ${scope}::uuid)
          or (${scope}::uuid is null and f.channel_id = ${chId}::uuid))
    ) (select * from scoped where valid_until is null order by valid_from desc limit 30)
      union all (select * from scoped where valid_until is not null order by valid_until desc limit 8)`;
    const view = (b: Row) => ({ content: b['content'] as string, basisCount: Number(b['basis_count']), updatedAt: new Date(b['updated_at']).toISOString() });
    return {
      projectId: scope,
      /** the project block alone (null before the first project refresh): what a client shows first */
      projectBlock: own ? view(own) : null,
      blocks: blocks.map(view),
      block: blk ? view(blk) : null,
      facts: facts.map((f) => ({
        id: f['id'] as string,
        content: f['content'] as string,
        kind: f['kind'] as string,
        taskNumber: f['task_number'] == null ? null : Number(f['task_number']),
        validFrom: new Date(f['valid_from']).toISOString(),
        validUntil: f['valid_until'] ? new Date(f['valid_until']).toISOString() : null,
        // distinguishes a superseded lesson (has a successor) from a retired one
        supersededBy: (f['superseded_by'] as string | null) ?? null,
      })),
    };
}

/** where a recall may look: the caller's actor and, when it knows it, its thread, project or channel */
export interface RecallScope {
  /** no actor: a person, or the store's own caller (a test) */
  actor?: Actor;
  marketing?:boolean;
  thread?: string | null;
  project?: string | null;
}

/**
 * THE PROJECTS A RECALL MAY READ (D15). The first that applies wins:
 *   1. a thread: its project (threads.project_id, else its channel's project),
 *   2. a project: that project, when it is in the workspace,
 *   3. a channel id: its project,
 *   4. a channel slug (the legacy wire): the projects that hold a channel of that slug,
 *   5. nothing: a person reads the whole workspace (null). An agent reads the projects it works in
 *      (project_agents, and the projects of its agent_channels rooms). An old machine sends no scope,
 *      so this is what keeps its recall inside the agent's own projects.
 * The answer is never wider than the workspace. An empty list reads workspace-level memory only (rows
 * with no project). Every channel has a project (0035), so no write makes such a row today.
 */
export async function recallProjectsSql(sql: postgres.Sql, workspace: string, channel: string | null, scope: RecallScope): Promise<string[] | null> {
  if (scope.thread) {
    if (!UUID_RE.test(scope.thread)) throw new DomainError('NOT_FOUND', 'Thread not found in this workspace.');
    const [t] = await sql`select coalesce(t.project_id, c.project_id) as project_id from threads t join channels c on c.id = t.channel_id
      where t.id = ${scope.thread}::uuid and t.workspace_id = ${workspace}::uuid`;
    if (!t) throw new DomainError('NOT_FOUND', 'Thread not found in this workspace.');
    return [t['project_id'] as string];
  }
  if (scope.project) {
    if (!UUID_RE.test(scope.project) || !(await sql`select 1 from projects where id = ${scope.project}::uuid and workspace_id = ${workspace}::uuid`).length) {
      throw new DomainError('NOT_FOUND', 'Project not found in this workspace.');
    }
    return [scope.project];
  }
  if (channel && UUID_RE.test(channel)) {
    const p = await channelProject(sql, workspace, channel);
    if (!p) throw new DomainError('NOT_FOUND', `channel ${channel} not found`);
    return [p];
  }
  const agent = scope.actor?.kind === 'agent' ? scope.actor.id : null;
  const mine = agent && UUID_RE.test(agent)
    ? (await sql`select pa.project_id from project_agents pa where pa.agent_id = ${agent}::uuid and pa.workspace_id = ${workspace}::uuid
        union select c.project_id from agent_channels ac join channels c on c.id = ac.channel_id
         where ac.agent_id = ${agent}::uuid and c.workspace_id = ${workspace}::uuid`).map((r) => r['project_id'] as string)
    : null;
  if (channel) {
    const bySlug = (await sql`select distinct project_id from channels where workspace_id = ${workspace}::uuid and slug = ${channel}`).map((r) => r['project_id'] as string);
    return agent ? bySlug.filter((p) => mine?.includes(p)) : bySlug;
  }
  if (scope.actor?.kind === 'agent') return mine ?? [];
  return null;
}

/**
 * Hybrid recall: FTS + vector legs in parallel, fused with reciprocal-rank (1/(60+rank)). Without the
 * embedder the vector leg is empty and FTS wins. `projects` filters every leg (null: the whole workspace),
 * so one project never reads another project's messages or facts.
 */
export async function recallSql(
  sql: postgres.Sql,
  workspace: string,
  channel: string | null,
  query: string,
  k: number,
  projects: string[] | null,
  actor?: Actor,
  marketing?:boolean,
): Promise<Array<{ id: string; kind: 'fact' | 'message'; body: string; channel: string; createdAt: string; score: number }>> {
  // a legacy slug narrows to that slug inside the projects. A channel id was already turned into its project
  const slug = channel && !UUID_RE.test(channel) ? channel : null;
  const access = actor ? sql`and (not nm_marketing_row(c.workspace_id,'channels',to_jsonb(c)) or (${marketing!==false} and nm_destination_access(${workspace}::uuid,${actor.kind},${actor.id}::uuid,'marketing')))` : sql``;
  const msgScope = sql`${access} ${slug ? sql`and c.slug = ${slug}` : sql``} ${projects ? sql`and c.project_id = any(${projects}::uuid[])` : sql``}`;
  const factScope = sql`${access} ${slug ? sql`and c.slug = ${slug}` : sql``} ${projects ? sql`and coalesce(f.project_id, c.project_id) = any(${projects}::uuid[])` : sql``}`;
  const qvecs = await embed([query]);
  const [fts, vec, factFts, factVec] = await Promise.all([
    sql`select m.id, m.body, c.slug as channel, m.created_at
      from messages m join channels c on c.id = m.channel_id
      where m.workspace_id = ${workspace}::uuid
        and m.fts @@ websearch_to_tsquery('english', ${query}) ${msgScope}
      order by ts_rank(m.fts, websearch_to_tsquery('english', ${query})) desc limit 20`,
    qvecs?.[0]
      ? sql`select m.id, m.body, c.slug as channel, m.created_at
          from messages m join channels c on c.id = m.channel_id
          where m.workspace_id = ${workspace}::uuid and m.embedding is not null ${msgScope}
          order by m.embedding <=> ${JSON.stringify(qvecs[0])}::vector limit 20`
      : Promise.resolve([] as Row[]),
    sql`select f.id, f.content as body, c.slug as channel, f.created_at
      from facts f join channels c on c.id = f.channel_id
      where f.workspace_id = ${workspace}::uuid and f.valid_until is null
        and f.fts @@ websearch_to_tsquery('english', ${query}) ${factScope}
      order by ts_rank(f.fts, websearch_to_tsquery('english', ${query})) desc limit 10`,
    qvecs?.[0]
      ? sql`select f.id, f.content as body, c.slug as channel, f.created_at
          from facts f join channels c on c.id = f.channel_id
          where f.workspace_id = ${workspace}::uuid and f.valid_until is null and f.embedding is not null ${factScope}
          order by f.embedding <=> ${JSON.stringify(qvecs[0])}::vector limit 10`
      : Promise.resolve([] as Row[]),
  ]);
  // FTS is AND: websearch_to_tsquery wants every word of the query in the row. The vector legs
  // cover a paraphrase, but with the embedder off (NM_EMBED unset: the Cloud Run deploy) nothing
  // did, so one extra word lost the record. Asked "which test fruit?", rex searched "designated
  // test fruit" and read "no record" while the lesson "Always use the R6 test fruit … in
  // examples" sat in the room (the feature suite, 2026-11-02). Then an ANY-word leg joins the
  // fusion: ts_rank puts the rows holding more of the words first, and a row the AND leg also
  // found scores in both legs, so it still outranks a row that matched one word.
  const anyWords = !qvecs?.[0] && fts.length + factFts.length < k;
  const anyQuery = sql`to_tsquery('english', replace(websearch_to_tsquery('english', ${query})::text, ' & ', ' | '))`;
  const [ftsAny, factFtsAny] = anyWords
    ? await Promise.all([
      sql`select m.id, m.body, c.slug as channel, m.created_at
        from messages m join channels c on c.id = m.channel_id
        where m.workspace_id = ${workspace}::uuid and m.fts @@ ${anyQuery} ${msgScope}
        order by ts_rank(m.fts, ${anyQuery}) desc limit 20`,
      sql`select f.id, f.content as body, c.slug as channel, f.created_at
        from facts f join channels c on c.id = f.channel_id
        where f.workspace_id = ${workspace}::uuid and f.valid_until is null and f.fts @@ ${anyQuery} ${factScope}
        order by ts_rank(f.fts, ${anyQuery}) desc limit 10`,
    ])
    : [[] as Row[], [] as Row[]];
  const factIds = new Set([...factFts, ...factVec, ...factFtsAny].map((r) => r['id']));
  const scores = new Map<string, { row: Row; score: number }>();
  for (const rows of [fts, vec, factFts, factVec, ftsAny, factFtsAny]) {
    rows.forEach((row, rank) => {
      const prev = scores.get(row['id']);
      scores.set(row['id'], { row, score: (prev?.score ?? 0) + 1 / (60 + rank) });
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ row, score }) => ({
      id: row['id'],
      kind: factIds.has(row['id']) ? ('fact' as const) : ('message' as const),
      body: row['body'],
      channel: row['channel'],
      createdAt: new Date(row['created_at']).toISOString(),
      score: Number(score.toFixed(5)),
    }));
}

/** the project a memory write lands in: the project of its channel. Facts and blocks are keyed by it */
export async function writeProjectSql(sql: postgres.Sql, chId: string): Promise<string> {
  const [c] = await sql`select project_id, workspace_id from channels where id = ${chId}::uuid`;
  if (!c?.['project_id']) throw new DomainError('NOT_FOUND', `channel ${chId} has no project`);
  return c['project_id'] as string;
}
