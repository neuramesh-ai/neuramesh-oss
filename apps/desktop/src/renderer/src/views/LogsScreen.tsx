// The activity log screen — extracted from App.tsx (track A: leaf views).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOnWeb } from '../compute/NeedsMachine';
import type { AgentRow, LogRow } from '../bridge/rows-crew';
import { nm } from '../bridge/nm';
import { AgentAvatar } from '../components/AgentAvatar';
export const LOG_KIND_ICON: Record<string, string> = {
  wake: '◔', exec: '⚙', tool: '›', turn: '✎', result: '✓', lifecycle: '◈',
};
import { Select } from '../ui/Select';

// Agent Logs — local-only telemetry for agents on THIS machine. The host
// captures the SDK stream (tool calls, turns, results) + execution lifecycle;
// none of it is synced (it can hold file/bash content). Live tail + filters.
// ~blended Opus rate ($/token) for a rough est — labelled as an estimate, never
// presented as billed truth (rows carry total tokens, not the input/output split)
export const TOKEN_EST_RATE = 30 / 1_000_000;

export const fmtTok = (n: number) => n.toLocaleString();

export const estCost = (tok: number) => {
  const c = tok * TOKEN_EST_RATE;
  return c < 0.01 ? `<$0.01` : `$${c.toFixed(2)}`;
};

export function LogsScreen({ agents, task, onTask }: { agents: AgentRow[]; task: number | null; onTask: (n: number | null) => void }) {
  // machine-local reads: agentLogs + watchAgentLogs both come off the machine's own
  // activity.db, so on web this list is ALWAYS empty and the copy below must not blame
  // the agents for it.
  const onWeb = useOnWeb();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [agentId, setAgentId] = useState('');
  const [level, setLevel] = useState('all');
  const [search, setSearch] = useState('');
  const [live, setLive] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef(live);
  liveRef.current = live;
  const fRef = useRef({ agentId, level, search, task });
  fRef.current = { agentId, level, search, task };
  const totalTokens = useMemo(() => rows.reduce((s, r) => s + (r.tokens ?? 0), 0), [rows]);

  useEffect(() => {
    if (!nm) return;
    let alive = true;
    void nm.agentLogs({ agentId: agentId || undefined, taskNumber: task ?? undefined, level, search: search || undefined, limit: 400 })
      .then((r) => { if (alive) { setRows(r); requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight })); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [agentId, level, search, task]);

  useEffect(() => {
    if (!nm) return;
    return nm.watchAgentLogs((row) => {
      const f = fRef.current;
      if (f.agentId && row.agent_id !== f.agentId) return;
      if (f.task != null && row.task_number !== f.task) return;
      if (f.level === 'error' && row.level !== 'error') return;
      if (f.level === 'warn' && row.level === 'info') return;
      if (f.search && !`${row.summary} ${row.detail ?? ''}`.toLowerCase().includes(f.search.toLowerCase())) return;
      setRows((prev) => [...prev.slice(-499), row]);
      if (liveRef.current) requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }));
    });
  }, []);

  const doExport = async () => {
    if (!nm || exporting) return;
    setExporting(true);
    setExportMsg('');
    try {
      const res = await nm.exportLogs({ agentId: agentId || undefined, taskNumber: task ?? undefined, level, search: search || undefined });
      setExportMsg(res.saved ? `exported ${res.count} rows` : '');
    } catch { setExportMsg('export failed'); }
    setExporting(false);
  };

  return (
    <>
      <div className="topbar">
        Agent activity
        <span className="desc">local telemetry · agents on this machine · not synced</span>
        <div className="actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {totalTokens > 0 && (
            <span className="logtotals" title="total tokens in view · rough cost estimate (blended Opus rate)">
              Σ {fmtTok(totalTokens)} tok · ≈ {estCost(totalTokens)} <span className="dim">est</span>
            </span>
          )}
          {exportMsg && <span className="dim" style={{ fontSize: 11 }}>{exportMsg}</span>}
          <button className="btn" disabled={exporting || !rows.length} title="export the current view to a JSON file" onClick={doExport}>
            {exporting ? 'exporting…' : '⭳ Export'}
          </button>
          <button className={`btn${live ? ' primary' : ''}`} title="auto-scroll to newest" onClick={() => setLive((v) => !v)}>
            {live ? '● live' : '○ paused'}
          </button>
        </div>
      </div>
      <div className="logbar">
        <Select value={agentId} width={144} title="filter by agent" options={[{ value: '', label: 'all agents' }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} onChange={setAgentId} />
        <Select value={level} width={128} title="filter by level" options={[{ value: 'all', label: 'all levels' }, { value: 'warn', label: 'warnings+' }, { value: 'error', label: 'errors only' }]} onChange={setLevel} />
        <input className="logsearch" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search summaries / detail…" />
        {task != null && (
          <button className="taskfilter" title="clear task filter" onClick={() => onTask(null)}>task #{task} ✕</button>
        )}
      </div>
      <div className="logwrap" ref={listRef}>
        {!rows.length && (
          <div className="empty">
            {onWeb
              // "No activity yet" would be a lie in the browser: the log lives on the machine's
              // own disk and cannot be read from here, so an empty list says nothing about whether
              // the agents have been working.
              ? 'Activity is recorded on your machine, and the browser cannot read it yet. Open this workspace in the desktop app to see it.'
              : task != null ? `No activity logged for #${task} yet.` : 'No activity yet — agent wakes, tool calls, and execution land here as they happen.'}
          </div>
        )}
        {rows.map((r) => (
          <div key={r.id} className={`logrow l-${r.level}${openId === r.id ? ' open' : ''}`} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
            <span className="logtime">{new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <AgentAvatar name={r.agent_name} size={16} radius={4} />
            <span className="logagent">{r.agent_name}</span>
            <span className={`logkind k-${r.kind}`}>{LOG_KIND_ICON[r.kind] ?? '·'} {r.phase ?? r.kind}</span>
            {r.task_number ? <span className="logtask">#{r.task_number}</span> : null}
            <span className="logsummary">{r.summary}</span>
            {r.tokens ? <span className="logtok" title="tokens (input+output)">{fmtTok(r.tokens)} tok</span> : null}
            {r.detail && openId === r.id && <pre className="logdetail">{r.detail}</pre>}
          </div>
        ))}
      </div>
    </>
  );
}
