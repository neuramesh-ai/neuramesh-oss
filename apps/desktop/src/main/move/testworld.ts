// The driver tests' world: a small export archive written by the REAL writer (control-api's tar.ts,
// imported by path, no dependency), and a scripted import server that behaves as import-batch.ts
// does (skips held ids, merges `rex` by name, renumbers tasks from a counter, gates the opening
// batch). Not a test file itself: the suites import it.
import { gzipSync } from 'node:zlib';
import { EXPORT_FORMAT, EXPORT_MANIFEST_NAME, EXPORT_TABLES, EXPORT_VERSION, exportEntryName, hasWorkspaceId, type ExportTable, type ImportBatch, type ImportBatchResult, type ImportStorage } from '@neuramesh/shared';
import { tarStream, type TarEntry } from '../../../../../packages/control-api/src/tar';

export const SRC_WS = 'aaaaaaaa-0000-4000-8000-000000000001';
export const TGT_WS = 'bbbbbbbb-0000-4000-8000-000000000002';
export const LOCAL_HUMAN = 'cccccccc-0000-4000-8000-000000000003';
export const CLOUD_USER = 'dddddddd-0000-4000-8000-000000000004';
export const TGT_REX = 'eeeeeeee-0000-4000-8000-000000000005';
const id = (n: number): string => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const IDS = { project: id(1), channel: id(2), rex: id(3), iris: id(4), reg: id(5), thread: id(6), task12: id(7), task13: id(8), msg: id(9), reply: id(10), art: id(11), fact: id(12) };
const AT = '2026-09-10T10:00:00.000Z';

/** rows in every table, with every kind of key the driver rewrites */
export const ROWS: { [T in ExportTable]: Array<Record<string, unknown>> } = {
  projects: [{ id: IDS.project, workspace_id: SRC_WS, name: 'Default', slug: 'default', is_default: true, created_at: AT }],
  channels: [{ id: IDS.channel, workspace_id: SRC_WS, slug: 'general', topic: 'the room', project_id: IDS.project, created_by_kind: 'human', created_by: LOCAL_HUMAN, created_at: AT }],
  repos: [],
  project_repos: [],
  agents: [
    { id: IDS.rex, workspace_id: SRC_WS, name: 'rex', role: 'orchestrator', status: 'online', created_at: AT },
    { id: IDS.iris, workspace_id: SRC_WS, name: 'iris', role: 'designer', status: 'online', created_at: AT },
  ],
  agent_channels: [{ id: IDS.reg, agent_id: IDS.rex, channel_id: IDS.channel, created_by_kind: 'agent', created_by: IDS.rex, created_at: AT }],
  threads: [{ id: IDS.thread, workspace_id: SRC_WS, channel_id: IDS.channel, title: 'about #12', created_by: `human:${LOCAL_HUMAN}`, task_id: IDS.task12, root_message_id: IDS.msg, mode: 'tasks', created_at: AT, updated_at: AT }],
  tasks: [
    { id: IDS.task12, workspace_id: SRC_WS, channel_id: IDS.channel, project_id: IDS.project, number: 12, title: 'the first task', description: null, state: 'todo', creator_kind: 'human', creator_id: LOCAL_HUMAN, assignee_kind: 'agent', assignee_id: IDS.rex, definition_of_done: 'done when #13 is', created_at: AT, updated_at: AT },
    { id: IDS.task13, workspace_id: SRC_WS, channel_id: IDS.channel, project_id: IDS.project, number: 13, title: 'follows #12', description: 'a step', state: 'todo', creator_kind: 'agent', creator_id: IDS.rex, assignee_kind: 'human', assignee_id: LOCAL_HUMAN, parent_task_id: IDS.task12, created_at: AT, updated_at: AT },
  ],
  messages: [
    { id: IDS.msg, workspace_id: SRC_WS, channel_id: IDS.channel, task_id: IDS.task12, thread_id: IDS.thread, author_kind: 'human', author_id: LOCAL_HUMAN, body: 'see #12 and #13, not #99', created_at: AT },
    { id: IDS.reply, workspace_id: SRC_WS, channel_id: IDS.channel, task_id: null, thread_id: IDS.thread, reply_to: IDS.msg, author_kind: 'agent', author_id: IDS.rex, body: 'on it', created_at: AT },
  ],
  artifacts: [{ id: IDS.art, workspace_id: SRC_WS, channel_id: IDS.channel, task_id: IDS.task12, message_id: IDS.msg, kind: 'doc', name: 'notes.md', created_by_kind: 'human', created_by: LOCAL_HUMAN, promoted_by: null, inline_content: '# notes', created_at: AT }],
  memory_blocks: [],
  facts: [{ id: IDS.fact, workspace_id: SRC_WS, channel_id: IDS.channel, content: 'a lesson', kind: 'lesson', superseded_by: null, created_at: AT, valid_from: AT }],
};

export function exportEntries(rows: typeof ROWS = ROWS): TarEntry[] {
  const counts = Object.fromEntries(EXPORT_TABLES.map((t) => [t, rows[t].length])) as Record<ExportTable, number>;
  const manifest = { format: EXPORT_FORMAT, version: EXPORT_VERSION, workspace: { id: SRC_WS, name: 'Acme Robotics', slug: 'acme' }, exportedAt: AT, counts };
  const out: TarEntry[] = [{ name: EXPORT_MANIFEST_NAME, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) }];
  for (const t of EXPORT_TABLES) out.push({ name: exportEntryName(t), data: Buffer.from(rows[t].length ? `${rows[t].map((r) => JSON.stringify(r)).join('\n')}\n` : '') });
  return out;
}

export async function archiveOf(entries: TarEntry[] = exportEntries()): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of tarStream(entries)) chunks.push(c);
  return gzipSync(Buffer.concat(chunks));
}

const GIB = 1024 ** 3;
export interface FakeServer {
  fetchImpl: typeof fetch;
  /** every batch body received, in order */
  posts: ImportBatch[];
  /** ids the target holds after the batches so far */
  held: Set<string>;
  storage: ImportStorage;
  /** a scripted refusal for the batch, or null to answer as the real server would */
  refuse: (b: ImportBatch) => { status: number; body: unknown } | null;
}

/** an import server that behaves as import-batch.ts does, in memory */
export function fakeServer(archive: Buffer, over: Partial<Pick<FakeServer, 'refuse' | 'storage'>> = {}): FakeServer {
  const numbers = new Map<string, number>();
  const linked = new Set<string>();
  let next = 1001;
  const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const s: FakeServer = {
    posts: [], held: new Set(), refuse: over.refuse ?? (() => null),
    storage: over.storage ?? { allocationBytes: 50 * GIB, usedBytes: 12345, totalBytes: 0 },
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const u = String(url);
      if (u.endsWith('/export')) return new Response(new Uint8Array(archive), { status: 200 });
      if (!u.includes('/import/batches')) return json(404, { error: 'not found', code: 'NOT_FOUND' });
      const b = JSON.parse(String(init?.body)) as ImportBatch;
      s.posts.push(b);
      const scripted = s.refuse(b);
      if (scripted) return json(scripted.status, scripted.body);
      if (b.first) return json(200, { ok: true, seq: b.seq, written: 0, skipped: 0, storage: { ...s.storage, totalBytes: b.first.totalBytes } } satisfies ImportBatchResult);
      if (hasWorkspaceId(b.table)) for (const r of b.rows) if (r['workspace_id'] !== TGT_WS) return json(400, { error: 'wrong workspace', code: 'IMPORT_WORKSPACE', rowId: r['id'] });
      const out: ImportBatchResult = { ok: true, seq: b.seq, written: 0, skipped: 0 };
      for (const r of b.rows) {
        const rid = r['id'] as string;
        if (b.links) { if (linked.has(rid)) out.skipped++; else { linked.add(rid); out.written++; } continue; }
        if (b.table === 'agents' && r['name'] === 'rex') { (out.idMap ??= {})[rid] = TGT_REX; out.skipped++; continue; }
        if (s.held.has(rid)) out.skipped++;
        else { s.held.add(rid); out.written++; if (b.table === 'tasks') numbers.set(rid, next++); }
        if (b.table === 'tasks') (out.numberMap ??= {})[String(r['number'])] = numbers.get(rid)!;
      }
      return json(200, out);
    }) as typeof fetch,
  };
  return s;
}
