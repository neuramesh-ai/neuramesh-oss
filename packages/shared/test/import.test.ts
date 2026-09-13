// The client half of the import (unit U7, docs/export-format.md "Import"): planBatches turns a
// parsed export into ordered batches with fresh ids and no dangling key, rewriteTaskRefs renumbers
// `#123` in prose, parseExport reads the archive's entries back, and the two maps that drive both
// halves agree with each other.
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT, EXPORT_MANIFEST_NAME, EXPORT_REFS, EXPORT_STRIPPED, EXPORT_TABLES, EXPORT_VERSION, IMPORT_COLUMNS, IMPORT_UNWRITTEN, LINK_TABLES,
  exportEntryName, hasWorkspaceId, lateKeys, parseExport, planBatches, repoint, rewriteTaskRefs, writeColumns,
  type ExportManifest, type ExportTable, type ImportBatch, type ParsedExport,
} from '../src/index';

const SRC = '11111111-1111-4111-8111-111111111111';
const TGT = '22222222-2222-4222-8222-222222222222';
const HUMAN = '99999999-9999-4999-8999-999999999999';
const IMPORT = '33333333-3333-4333-8333-333333333333';
const T = '2026-09-12T10:00:00.000Z';

/** a deterministic mint: uuid-shaped, counted */
function counter(): (old: string) => string {
  const seen = new Map<string, string>();
  return (old) => {
    let v = seen.get(old);
    if (!v) seen.set(old, (v = `aaaaaaaa-0000-4000-8000-${String(seen.size + 1).padStart(12, '0')}`));
    return v;
  };
}
const oid = (n: number): string => `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** one row in every table, every key kind: forward (late), same-table, actor, address */
function fixture(): ParsedExport {
  const [project, general, build, repo, link, rex, mover, ac1, ac2, chat, taskThread, task, subtask, m1, m2, m3, art, block, f1, f2] = Array.from({ length: 20 }, (_, i) => oid(i + 1));
  const rows: ParsedExport['rows'] = {
    projects: [{ id: project!, workspace_id: SRC, name: 'Default', slug: 'default', description: '', status: 'active', is_default: true, created_at: T, auto_open_pr: true, run_ci_before_merge: true, website: null, logo_url: null, ship_gate: true, model_pack: null }],
    channels: [
      { id: general!, workspace_id: SRC, slug: 'general', topic: '', settings: {}, created_at: T, project_id: project!, thread_mode: 'on', kind: 'build', marketing: null, created_by_kind: null, created_by: null },
      { id: build!, workspace_id: SRC, slug: 'build', topic: '', settings: {}, created_at: T, project_id: project!, thread_mode: 'on', kind: 'build', marketing: null, created_by_kind: 'agent', created_by: rex! },
    ],
    repos: [{ id: repo!, workspace_id: SRC, provider: 'github', org_name: 'acme', name: 'site', default_branch: 'main', clone_url: 'https://github.com/acme/site', created_at: T, ...({ local_path: '/home/x/site' } as object) }],
    project_repos: [{ id: link!, project_id: project!, repo_id: repo!, is_primary: true }],
    agents: [
      { id: rex!, workspace_id: SRC, name: 'rex', role: 'orchestrator', runtime: 'claude-code', model: 'm', card: {}, status: 'online', created_at: T, kind: 'local', endpoint_url: '', emoji: null, model_source: 'pack', retired_at: null, brief: null, description: null, ...({ machine_id: oid(99) } as object) },
      { id: mover!, workspace_id: SRC, name: 'mover', role: 'developer', runtime: 'claude-code', model: 'm', card: {}, status: 'online', created_at: T, kind: 'local', endpoint_url: '', emoji: null, model_source: 'pack', retired_at: null, brief: null, description: null },
    ],
    agent_channels: [
      { id: ac1!, agent_id: rex!, channel_id: general!, created_at: T, created_by_kind: 'human', created_by: HUMAN },
      { id: ac2!, agent_id: mover!, channel_id: build!, created_at: T, created_by_kind: 'agent', created_by: rex! },
    ],
    threads: [
      { id: chat!, workspace_id: SRC, channel_id: general!, title: 'a chat', description: '', created_by: `human:${HUMAN}`, task_id: null, created_at: T, updated_at: T, root_message_id: m1!, mode: 'chat', brain_override: null, archived_at: null, filed_at: null, filed_reason: null, schedule_id: oid(98), titled_at: null, origin: 'desktop', settled_at: null },
      { id: taskThread!, workspace_id: SRC, channel_id: build!, title: 'the task', description: '', created_by: `agent:${rex}`, task_id: task!, created_at: T, updated_at: T, root_message_id: null, mode: 'tasks', brain_override: null, archived_at: null, filed_at: null, filed_reason: null, schedule_id: null, titled_at: null, origin: null, settled_at: null },
    ],
    tasks: [
      { id: task!, workspace_id: SRC, channel_id: build!, project_id: project!, number: 1001, title: 'ship it', description: 'see #1002', state: 'in_progress', creator_kind: 'human', creator_id: HUMAN, assignee_kind: 'agent', assignee_id: mover!, repo_id: repo!, base_ref: 'main', branch: 'nm/1001-ship-it', submitted_sha: null, requirements: null, requirements_confirmed: true, artifact_count: 1, version: 3, created_at: T, updated_at: T, claimed_at: T, submitted_at: null, accepted_at: null, closed_at: null, offered_agent_id: mover!, definition_of_done: '', pr_url: '', pr_number: null, approved_at: null, blocked_from: null, kind: null, ship_plan: null, parent_task_id: null, plan_approved_at: null, work_plan: null, origin_thread_id: chat! },
      { id: subtask!, workspace_id: SRC, channel_id: build!, project_id: project!, number: 1002, title: 'a step', description: '', state: 'todo', creator_kind: 'agent', creator_id: rex!, assignee_kind: null, assignee_id: null, repo_id: null, base_ref: null, branch: null, submitted_sha: null, requirements: null, requirements_confirmed: false, artifact_count: 0, version: 0, created_at: T, updated_at: T, claimed_at: null, submitted_at: null, accepted_at: null, closed_at: null, offered_agent_id: null, definition_of_done: '', pr_url: '', pr_number: null, approved_at: null, blocked_from: null, kind: null, ship_plan: null, parent_task_id: task!, plan_approved_at: null, work_plan: null, origin_thread_id: null },
    ],
    messages: [
      { id: m1!, workspace_id: SRC, channel_id: general!, task_id: null, author_kind: 'human', author_id: HUMAN, body: 'hello', created_at: T, edited_at: null, pinned: false, reply_to: null, thread_id: chat!, ...({ embedding: [0.1], fts: 'x' } as object) },
      { id: m2!, workspace_id: SRC, channel_id: general!, task_id: null, author_kind: 'agent', author_id: rex!, body: 'hi, see #1001', created_at: T, edited_at: null, pinned: false, reply_to: m1!, thread_id: chat! },
      { id: m3!, workspace_id: SRC, channel_id: build!, task_id: task!, author_kind: 'agent', author_id: mover!, body: 'on it', created_at: T, edited_at: null, pinned: false, reply_to: null, thread_id: taskThread! },
    ],
    artifacts: [{ id: art!, workspace_id: SRC, channel_id: build!, project_id: project!, task_id: task!, kind: 'doc', name: 'notes.md', tags: [], version: 1, content_hash: null, storage_path: null, size_bytes: 5, promoted: true, promoted_by: rex!, created_by_kind: 'agent', created_by: mover!, created_at: T, inline_content: 'notes', message_id: m3!, mime: 'text/markdown', width: null, height: null }],
    memory_blocks: [{ id: block!, workspace_id: SRC, channel_id: general!, project_id: null, kind: 'channel_summary', content: 'a summary', basis_count: 2, updated_at: T }],
    facts: [
      { id: f1!, workspace_id: SRC, channel_id: general!, content: 'old', basis_count: 1, valid_from: T, valid_until: T, superseded_by: f2!, created_at: T, kind: 'fact', task_id: task! },
      { id: f2!, workspace_id: SRC, channel_id: general!, content: 'new', basis_count: 1, valid_from: T, valid_until: null, superseded_by: null, created_at: T, kind: 'fact', task_id: null },
    ],
  };
  const counts = Object.fromEntries(EXPORT_TABLES.map((t) => [t, rows[t].length])) as Record<ExportTable, number>;
  const manifest: ExportManifest = { format: EXPORT_FORMAT, version: EXPORT_VERSION, workspace: { id: SRC, name: 'Local', slug: 'local' }, exportedAt: T, counts };
  return { manifest, rows };
}

const rowBatches = (b: ImportBatch[]): ImportBatch[] => b.filter((x) => !x.first && !x.links);

describe('the two maps agree with each other and with the tables', () => {
  it('every ref column is a column of its table, late keys point at threads and facts, the write list drops them', () => {
    for (const t of EXPORT_TABLES) {
      const cols = new Set<string>(IMPORT_COLUMNS[t]);
      for (const ref of EXPORT_REFS[t]) expect(cols.has(ref.column), `${t}.${ref.column}`).toBe(true);
      for (const c of EXPORT_STRIPPED[t] ?? []) expect(cols.has(c), `${t}.${c} never travels`).toBe(false);
      const write = writeColumns(t);
      for (const late of lateKeys(t)) expect(write).not.toContain(late);
      for (const c of IMPORT_UNWRITTEN[t] ?? []) expect(write).not.toContain(c);
      expect(write).toContain('id');
      expect(write.includes('workspace_id')).toBe(hasWorkspaceId(t));
    }
    expect(LINK_TABLES).toEqual(['threads', 'facts']);
    expect(lateKeys('threads')).toEqual(['task_id', 'root_message_id']);
    expect(lateKeys('facts')).toEqual(['superseded_by']);
  });
});

describe('planBatches', () => {
  const exp = fixture();
  const plan = planBatches(exp, { targetWorkspaceId: TGT, importId: IMPORT, mint: counter() });
  const newIds = new Set(Object.values(plan.ids));

  it('opens with the manifest and the bytes, then every table in EXPORT_TABLES order, then the link passes, and the last batch says so', () => {
    const [first, ...rest] = plan.batches;
    expect(first).toMatchObject({ importId: IMPORT, seq: 0, rows: [], first: { manifest: exp.manifest, totalBytes: plan.totalBytes } });
    expect(plan.totalBytes).toBeGreaterThan(0);
    expect(plan.batches.map((b) => b.seq)).toEqual(plan.batches.map((_, i) => i));
    expect(rowBatches(rest).map((b) => b.table)).toEqual([...EXPORT_TABLES]);
    expect(rest.filter((b) => b.links).map((b) => b.table)).toEqual(['threads', 'facts']);
    expect(plan.batches.filter((b) => b.last)).toHaveLength(1);
    expect(plan.batches[plan.batches.length - 1]!.last).toBe(true);
    for (const b of rest) expect(b.importId).toBe(IMPORT);
  });

  it('mints a new id for every row and points every key at a new id: nothing dangles', () => {
    expect(Object.keys(plan.ids)).toHaveLength(20);
    for (const b of rowBatches(plan.batches)) {
      for (const row of b.rows) {
        expect(newIds.has(row['id'] as string), `${b.table} id`).toBe(true);
        if (hasWorkspaceId(b.table)) expect(row['workspace_id']).toBe(TGT);
        for (const ref of EXPORT_REFS[b.table]) {
          if (ref.late) { expect(ref.column in row, `${b.table}.${ref.column} waits for the link pass`).toBe(false); continue; }
          const v = row[ref.column];
          if (v == null) continue;
          if (ref.address) { expect(String(v).startsWith('human:') || newIds.has(String(v).slice(6))).toBe(true); continue; }
          if (ref.to === 'actor') expect(v === HUMAN || newIds.has(v as string), `${b.table}.${ref.column}`).toBe(true);
          else expect(newIds.has(v as string), `${b.table}.${ref.column} = ${v}`).toBe(true);
        }
      }
    }
    const [thread] = plan.batches.find((b) => b.table === 'threads' && !b.links)!.rows;
    expect(thread!['created_by']).toBe(`human:${HUMAN}`);
    const rexThread = plan.batches.find((b) => b.table === 'threads' && !b.links)!.rows[1]!;
    expect(rexThread['created_by']).toBe(`agent:${plan.ids[oid(6)]}`);
  });

  it('drops the stripped columns and keeps schedule_id for the server to leave null', () => {
    const agent = plan.batches.find((b) => b.table === 'agents')!.rows[0]!;
    expect('machine_id' in agent).toBe(false);
    const repo = plan.batches.find((b) => b.table === 'repos')!.rows[0]!;
    expect('local_path' in repo).toBe(false);
    const msg = plan.batches.find((b) => b.table === 'messages')!.rows[0]!;
    expect('embedding' in msg).toBe(false);
    expect('fts' in msg).toBe(false);
    expect(plan.batches.find((b) => b.table === 'threads' && !b.links)!.rows[0]!['schedule_id']).toBe(oid(98));
  });

  it('the link passes carry id, workspace_id and the re-pointed late keys, for rows that have one', () => {
    const threads = plan.batches.find((b) => b.table === 'threads' && b.links)!;
    expect(threads.rows).toEqual([
      { id: plan.ids[oid(10)], workspace_id: TGT, task_id: null, root_message_id: plan.ids[oid(14)] },
      { id: plan.ids[oid(11)], workspace_id: TGT, task_id: plan.ids[oid(12)], root_message_id: null },
    ]);
    const facts = plan.batches.find((b) => b.table === 'facts' && b.links)!;
    expect(facts.rows).toEqual([{ id: plan.ids[oid(19)], workspace_id: TGT, superseded_by: plan.ids[oid(20)] }]);
  });

  it('is deterministic with an injected mint', () => {
    const again = planBatches(fixture(), { targetWorkspaceId: TGT, importId: IMPORT, mint: counter() });
    expect(again).toEqual(plan);
  });

  it('splits a table across batches under the cap, in order', () => {
    const small = planBatches(exp, { targetWorkspaceId: TGT, importId: IMPORT, mint: counter(), maxBytes: 1200 });
    const msgs = small.batches.filter((b) => b.table === 'messages' && !b.links);
    expect(msgs.length).toBeGreaterThan(1);
    for (const b of small.batches) {
      const bytes = b.rows.reduce((n, r) => n + new TextEncoder().encode(JSON.stringify(r)).length + 1, 0);
      expect(bytes, `seq ${b.seq}`).toBeLessThanOrEqual(1200);
    }
    expect(msgs.flatMap((b) => b.rows.map((r) => r['id']))).toEqual(exp.rows.messages.map((m) => small.ids[m.id]));
    expect(small.tooLarge).toEqual([]);
  });

  it('a row over the cap on its own stays behind, and so does a row that names it', () => {
    const big = fixture();
    big.rows.messages[2]!.body = 'x'.repeat(2000);
    const p = planBatches(big, { targetWorkspaceId: TGT, importId: IMPORT, mint: counter(), maxBytes: 1500 });
    const m3 = p.ids[oid(16)]!;
    const art = p.ids[oid(17)]!;
    expect(p.tooLarge).toEqual([
      { table: 'messages', id: m3, bytes: expect.any(Number) },
      { table: 'artifacts', id: art, bytes: expect.any(Number), because: m3 },
    ]);
    const sent = new Set(rowBatches(p.batches).flatMap((b) => b.rows.map((r) => r['id'])));
    expect(sent.has(m3)).toBe(false);
    expect(sent.has(art)).toBe(false);
    expect(p.totalBytes).toBeLessThan(plan.totalBytes);
  });
});

describe('repoint', () => {
  it('re-points a known id, keeps an unknown one, and keeps the kind of an address', () => {
    const ids = { [oid(1)]: 'new-1' };
    expect(repoint(oid(1), { column: 'x', to: 'projects' }, ids)).toBe('new-1');
    expect(repoint(oid(2), { column: 'x', to: 'projects' }, ids)).toBe(oid(2));
    expect(repoint(null, { column: 'x', to: 'projects' }, ids)).toBe(null);
    expect(repoint(`agent:${oid(1)}`, { column: 'x', to: 'actor', address: true }, ids)).toBe('agent:new-1');
    expect(repoint(`human:${HUMAN}`, { column: 'x', to: 'actor', address: true }, ids)).toBe(`human:${HUMAN}`);
  });
});

describe('rewriteTaskRefs', () => {
  const map = { '12': 40, '7': 1007 };
  it('renumbers a reference the map knows', () => {
    expect(rewriteTaskRefs('see #12 and (#7).', map)).toBe('see #40 and (#1007).');
    expect(rewriteTaskRefs('#12 leads', map)).toBe('#40 leads');
  });
  it('keeps a number the map lacks', () => {
    expect(rewriteTaskRefs('see #123', map)).toBe('see #123');
    expect(rewriteTaskRefs('see #1', map)).toBe('see #1');
  });
  it('keeps a # inside a word and a number that runs into letters', () => {
    expect(rewriteTaskRefs('C#12 is a language', map)).toBe('C#12 is a language');
    expect(rewriteTaskRefs('foo#12', map)).toBe('foo#12');
    expect(rewriteTaskRefs('#12a', map)).toBe('#12a');
    expect(rewriteTaskRefs('##12', map)).toBe('##12');
    expect(rewriteTaskRefs('pull/12#issuecomment-7', map)).toBe('pull/12#issuecomment-7');
  });
});

describe('parseExport', () => {
  const exp = fixture();
  const entries = [
    { name: EXPORT_MANIFEST_NAME, text: JSON.stringify(exp.manifest) },
    ...EXPORT_TABLES.map((t) => ({ name: exportEntryName(t), text: exp.rows[t].map((r) => JSON.stringify(r)).join('\n') + '\n' })),
  ];
  it('reads the entries back into the manifest and the rows', () => {
    expect(parseExport(entries)).toEqual(exp);
  });
  it('refuses a missing manifest, another format, another version, and a count that does not match', () => {
    expect(() => parseExport(entries.slice(1))).toThrow('no manifest.json');
    expect(() => parseExport([{ name: EXPORT_MANIFEST_NAME, text: JSON.stringify({ ...exp.manifest, format: 'zip' }) }, ...entries.slice(1)])).toThrow('not a NeuraMesh export');
    expect(() => parseExport([{ name: EXPORT_MANIFEST_NAME, text: JSON.stringify({ ...exp.manifest, version: 2 }) }, ...entries.slice(1)])).toThrow('version 2');
    const short = entries.map((e) => (e.name === 'facts.jsonl' ? { ...e, text: '' } : e));
    expect(() => parseExport(short)).toThrow('facts.jsonl has 0 rows. The manifest says 2.');
  });
});
