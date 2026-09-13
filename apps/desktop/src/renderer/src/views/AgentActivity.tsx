// The activity stream — what an agent has been doing, tool call by tool call.
// Extracted from App.tsx (track A4).
import { ActivityItems } from '../thread/AgentGhost';
import { Modal } from '../ui/Modal';
import { fmtTok } from './LogsScreen';
import { groupActivity } from '../activity';
import { nm as nmBridge } from '../bridge/nm';
import { type AgentRow, type LogRow, type RunRow } from '../bridge/rows-crew';
import { useEffect, useMemo, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// Click an agent's "is working…" status (above the composer) to see its recent session telemetry —
// wakes, tool calls, results — for observability/debugging, without leaving the chat. Reuses the
// Agent activity, scoped to ONE run (a single channel reply / task attempt / sweep / review).
// Defaults to the agent's current run; the run picker switches to earlier runs. Live while it works.
export function AgentActivity({ agent, focusRunId, onClose }: { agent: AgentRow; focusRunId?: string | null; onClose: () => void }) {
  const [runs, setRuns] = useState<RunRow[]>([]);
  // `focusRunId` opens straight onto ONE run — how a subagent's row reaches its own steps.
  // A leg is its own run in this picker (runs() groups agent_logs by run_id), so following
  // the newest must NOT be armed here or the pick would be stolen by whatever ran last.
  const [runId, setRunId] = useState<string | null>(focusRunId ?? null);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [open, setOpen] = useState<Set<number>>(new Set()); // expanded tool cards / event rows, by id
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const following = useRef(true); // auto-follow the newest run until the user picks an older one
  const runIdRef = useRef<string | null>(null);
  runIdRef.current = runId;
  const listRef = useRef<HTMLDivElement>(null);
  const bottom = () => requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  const refreshRuns = () => void nm?.agentRuns(agent.id, 40).then((rs) => {
    setRuns(rs);
    if (following.current && rs[0] && rs[0].run_id !== runIdRef.current) setRunId(rs[0].run_id);
  }).catch(() => {});
  useEffect(() => { following.current = !focusRunId; refreshRuns(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [agent.id, focusRunId]);
  // the selected run's steps
  useEffect(() => {
    if (!nm || !runId) { setRows([]); return; }
    let alive = true;
    void nm.agentLogs({ agentId: agent.id, runId, limit: 500 }).then((r) => { if (alive) { setRows(r); bottom(); } }).catch(() => {});
    return () => { alive = false; };
  }, [agent.id, runId]);
  // live: append rows of the selected run; a row from another run means a fresh activity → refresh picker (+ follow)
  useEffect(() => {
    if (!nm) return;
    return nm.watchAgentLogs((row) => {
      if (row.agent_id !== agent.id) return;
      if (row.run_id && row.run_id === runIdRef.current) { setRows((prev) => [...prev.slice(-499), row]); bottom(); }
      else if (row.run_id) refreshRuns();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.id]);
  const pick = (id: string) => { following.current = runs[0]?.run_id === id; setRunId(id); };
  const cur = runs.find((r) => r.run_id === runId);
  const items = useMemo(() => groupActivity(rows), [rows]);
  return (
    <Modal title={`@${agent.name} · activity`} onClose={onClose} huge subtitle={<span className="activitysub"><span className="livebadge"><span className="livedot" /> live</span> one run at a time — wakes · tool calls · results. Local only, not synced; kept 7 days.</span>}>
      <div className="runpicker">
        {!runs.length && <span className="runchip muted">no runs yet</span>}
        {runs.map((r, i) => (
          <button key={r.run_id} className={`runchip${r.run_id === runId ? ' on' : ''} rl-${r.worst_level}`} onClick={() => pick(r.run_id)} title={r.trigger}>
            {i === 0 ? '● now' : new Date(r.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {r.task_number ? <span className="runtask"> #{r.task_number}</span> : r.channel_slug ? <span className="runtask"> #{r.channel_slug}</span> : null}
          </button>
        ))}
      </div>
      {cur && <div className="runhead"><span className="runtrigger">{cur.trigger}</span><span className="runmeta">{cur.rows} step{cur.rows === 1 ? '' : 's'}{cur.tokens ? ` · ${fmtTok(cur.tokens)} tok` : ''}</span></div>}
      <div className="logwrap activitylog" ref={listRef}>
        {!rows.length && <div className="empty">{runId ? 'No steps in this run yet.' : `No activity logged for @${agent.name} yet.`}</div>}
        <ActivityItems items={items} open={open} toggle={toggle} />
      </div>
    </Modal>
  );
}
