// Agent activity log — LOCAL-ONLY telemetry for agents hosted on this machine.
// The Claude SDK message stream (tool calls, turns, results) plus execution
// lifecycle land here so a human can see what an agent is actually doing.
//
// Privacy (locked, docs/decisions 2026-06-13): tool I/O contains file contents,
// bash output, possibly secrets — so this lives in its OWN sqlite file on the
// machine, NEVER the PowerSync replica, NEVER synced to the cloud. Per the
// local-compute/cloud-truth doctrine, and why it's "local agents only".
//
// Scoping (locked 2026-06-23): every discrete agent activity is a "run" — a channel
// reply, a task work-attempt, a sweep, a review — tagged with a run_id. The UI scopes
// to the agent's CURRENT run ("what is it doing right now") with older runs as history,
// instead of an undifferentiated all-time feed.
import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';

export interface LogRow {
  id: number;
  ts: string;
  run_id: string | null;
  agent_id: string;
  agent_name: string;
  task_id: string | null;
  task_number: number | null;
  channel_slug: string | null;
  kind: string; // wake | exec | tool | turn | result | lifecycle
  phase: string | null;
  summary: string;
  detail: string | null;
  level: string; // info | warn | error
  tokens: number | null; // input+output tokens for this turn, when the model reports them
  tool_use_id: string | null; // links a tool 'call' row to its 'result' row — precise even when the agent fires parallel calls
}

export interface LogInput {
  kind: string;
  phase?: string;
  summary: string;
  detail?: unknown;
  level?: 'info' | 'warn' | 'error';
  tokens?: number;
  toolUseId?: string; // the SDK tool-use id: set on a tool 'call' (block.id) and its 'result' (block.tool_use_id)
}

export type LogFn = (rec: LogInput) => void;

export interface LogContext {
  agentId: string;
  agentName: string;
  runId?: string | null; // the activity this log belongs to (one per wake/task-attempt/sweep/review)
  taskId?: string | null;
  taskNumber?: number | null;
  channelSlug?: string | null;
}

// One row per run — the activity-history list (newest first) behind the popup's session picker.
export interface RunRow {
  run_id: string;
  agent_id: string;
  started_at: string;
  last_at: string;
  rows: number;
  tokens: number;
  worst_level: string; // info | warn | error
  task_number: number | null;
  channel_slug: string | null;
  trigger: string; // the run's first log summary — what it woke on / started
}

// Retention (locked 2026-06-23): time-based, local-only. Keep a week of runs, pruned on
// boot + hourly; a hard row cap is the safety valve for very busy machines.
const RETENTION_DAYS = 7;
const HARD_CAP = 50_000;
// belt-and-braces even though storage is local: never persist obvious secrets
const SECRET = /\b(sk-ant-[a-z0-9-]{6,}|sk-[a-z0-9]{20,}|gh[ps]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,})/gi;
const redact = (s: string): string => s.replace(SECRET, '[redacted]');

export class AgentLog {
  private db: Database.Database;
  readonly events = new EventEmitter();
  private sinceCompact = 0;

  // `file` lets the caller name the database: after the brain migration it is `activity.db` under
  // ~/.neuramesh/state, and before it the legacy `agent-logs.db` in userData. Defaulted so every
  // other caller (and every test) is unchanged.
  constructor(dir: string, file = 'agent-logs.db') {
    this.db = new Database(join(dir, file));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      create table if not exists agent_logs (
        id integer primary key autoincrement,
        ts text not null, run_id text, agent_id text not null, agent_name text not null,
        task_id text, task_number integer, channel_slug text,
        kind text not null, phase text, summary text not null, detail text,
        level text not null default 'info', tokens integer, tool_use_id text
      );
    `);
    // columns added after the first ship — backfill on pre-existing local DBs BEFORE any index
    // references them (a `create table if not exists` is a no-op on an old DB, so run_id wouldn't
    // exist yet when the agent_logs_run index is created).
    for (const col of ['tokens integer', 'run_id text', 'tool_use_id text']) {
      try { this.db.exec(`alter table agent_logs add column ${col}`); } catch { /* already present */ }
    }
    this.db.exec(`
      create index if not exists agent_logs_agent on agent_logs (agent_id, id desc);
      create index if not exists agent_logs_task on agent_logs (task_id, id desc);
      create index if not exists agent_logs_run on agent_logs (agent_id, run_id, id);
      create index if not exists agent_logs_ts on agent_logs (ts);
    `);
    this.events.setMaxListeners(0);
    this.prune();
  }

  // a context-bound sink: pass the result around as a plain LogFn
  for(ctx: LogContext): LogFn {
    return (rec: LogInput) =>
      this.write({
        ts: new Date().toISOString(),
        run_id: ctx.runId ?? null,
        agent_id: ctx.agentId,
        agent_name: ctx.agentName,
        task_id: ctx.taskId ?? null,
        task_number: ctx.taskNumber ?? null,
        channel_slug: ctx.channelSlug ?? null,
        kind: rec.kind,
        phase: rec.phase ?? null,
        summary: redact(rec.summary).slice(0, 2000),
        detail: rec.detail != null ? redact(JSON.stringify(rec.detail)).slice(0, 8000) : null,
        level: rec.level ?? 'info',
        tokens: rec.tokens ?? null,
        tool_use_id: rec.toolUseId ?? null,
      });
  }

  write(row: Omit<LogRow, 'id'>): LogRow {
    const info = this.db
      .prepare(
        `insert into agent_logs (ts, run_id, agent_id, agent_name, task_id, task_number, channel_slug, kind, phase, summary, detail, level, tokens, tool_use_id)
         values (@ts,@run_id,@agent_id,@agent_name,@task_id,@task_number,@channel_slug,@kind,@phase,@summary,@detail,@level,@tokens,@tool_use_id)`,
      )
      .run(row);
    const full: LogRow = { ...row, id: Number(info.lastInsertRowid) };
    this.events.emit('row', full);
    if (++this.sinceCompact >= 500) { this.prune(); this.sinceCompact = 0; }
    return full;
  }

  // Time-based + hard-cap prune. Cheap and idempotent — safe on boot, on an hourly timer,
  // and every 500 writes. Deletes anything older than the retention window, then enforces the cap.
  prune(): void {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
    this.db.prepare(`delete from agent_logs where ts < ?`).run(cutoff);
    this.db.prepare(`delete from agent_logs where id <= (select max(id) - ? from agent_logs)`).run(HARD_CAP);
  }

  query(f: { agentId?: string; runId?: string; taskNumber?: number; level?: string; search?: string; limit?: number }): LogRow[] {
    const where: string[] = [];
    const args: Record<string, unknown> = {};
    if (f.agentId) { where.push('agent_id = @agentId'); args['agentId'] = f.agentId; }
    if (f.runId) { where.push('run_id = @runId'); args['runId'] = f.runId; }
    if (f.taskNumber) { where.push('task_number = @taskNumber'); args['taskNumber'] = f.taskNumber; }
    if (f.level === 'error') where.push(`level = 'error'`);
    else if (f.level === 'warn') where.push(`level in ('warn','error')`);
    if (f.search) { where.push('(summary like @q or detail like @q)'); args['q'] = `%${f.search}%`; }
    args['limit'] = Math.min(f.limit ?? 300, 1000);
    const rows = this.db
      .prepare(`select * from agent_logs ${where.length ? 'where ' + where.join(' and ') : ''} order by id desc limit @limit`)
      .all(args) as LogRow[];
    return rows.reverse(); // oldest-first for a readable feed
  }

  // The agent's most recent run id (what it's doing now / did last) — the popup's default scope.
  latestRunId(agentId: string): string | null {
    const r = this.db
      .prepare(`select run_id from agent_logs where agent_id = ? and run_id is not null order by id desc limit 1`)
      .get(agentId) as { run_id: string } | undefined;
    return r?.run_id ?? null;
  }

  // Run history for an agent (newest first) — each run summarized for the popup's session list.
  runs(agentId: string, limit = 50): RunRow[] {
    return this.db
      .prepare(
        `select run_id, agent_id, min(ts) as started_at, max(ts) as last_at, count(*) as rows,
           sum(coalesce(tokens,0)) as tokens,
           case max(case when level='error' then 2 when level='warn' then 1 else 0 end)
             when 2 then 'error' when 1 then 'warn' else 'info' end as worst_level,
           max(task_number) as task_number, max(channel_slug) as channel_slug,
           (select summary from agent_logs x where x.run_id = a.run_id order by x.id asc limit 1) as trigger
         from agent_logs a
         where agent_id = @agentId and run_id is not null
         group by run_id
         order by max(id) desc
         limit @limit`,
      )
      .all({ agentId, limit: Math.min(limit, 200) }) as RunRow[];
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}

export function initAgentLog(dir: string, file?: string): AgentLog {
  return new AgentLog(dir, file);
}
