// The agent ghost (docs/26) — what an agent is doing, narrated while it does it.
// Extracted from App.tsx (track A3).
import { AgentAvatar } from '../components/AgentAvatar';
import { LOG_KIND_ICON, fmtTok } from '../views/LogsScreen';
import { Orb } from '../ui/Orb';
import { groupActivity, toolHeadline, toolOutcome } from '../activity';
import { nm as nmBridge } from '../bridge/nm';
import { orbStateFor } from '../views/SessionList';
import { toolVerb, type ToolCat } from '@neuramesh/shared';
import { type AgentRow, type LogRow } from '../bridge/rows-crew';
import { useEffect, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// ── the ghost message (docs/26 dead-air fix, mockup V2): the reply's row, alive before
// the reply exists. The sheen pill (the task threads' .liveact idiom) narrates the wake's
// REAL activity — the same LogRow stream the activity panel reads, humanized — and quiet
// mono toks tally the receipts (2 files · 1 command). The stream bubble takes the slot
// the moment text flows; the synced message replaces that. One ghost per thread, ever.
export const GHOST_CATS = { file: ['file', 'files'], cmd: ['command', 'commands'], search: ['search', 'searches'], check: ['check', 'checks'] } as const;

export type GhostCat = ToolCat; // GHOST_CATS keys are the shared union — a new cat must land in both

// the verb map + humanizer live in @neuramesh/shared (docs/29): the daemon writes the SAME
// words into the run's synced `step`, so the machine-local pill and the cross-machine card
// can never tell two different stories about one tool call.
export const ghostVerb = (row: LogRow): { verb: string; cat?: GhostCat } | null => toolVerb(row);

// Word-burst typewriter (design round §D): the display trails the streamed target and catches
// up ~4 words a frame — fast enough to never lag a finished reply by more than ~a second, slow
// enough to read as writing. `done` (or reduced motion) snaps to the full text: a finished
// message never animates, and scroll-back/reload render instantly because they mount done.
export const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useTypewriter(target: string, done: boolean): string {
  const [shownLen, setShownLen] = useState(() => (done || REDUCED_MOTION ? target.length : 0));
  const lenRef = useRef(shownLen);
  useEffect(() => {
    if (done || REDUCED_MOTION) { lenRef.current = target.length; setShownLen(target.length); return; }
    if (lenRef.current >= target.length) return;
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const rest = target.slice(lenRef.current);
      if (!rest) return;
      // advance to the end of the 4th word boundary in the unrevealed tail
      let idx = 0;
      for (let w = 0; w < 4; w++) {
        const sp = rest.indexOf(' ', idx + 1);
        if (sp === -1) { idx = rest.length; break; }
        idx = sp;
      }
      lenRef.current = Math.min(target.length, lenRef.current + Math.max(1, idx));
      setShownLen(lenRef.current);
      if (lenRef.current < target.length) timer = setTimeout(tick, 48);
    };
    let timer = setTimeout(tick, 48);
    return () => { alive = false; clearTimeout(timer); };
  }, [target, done]);
  return target.slice(0, Math.min(shownLen, target.length));
}

export function AgentGhost({ agent, beat, onActivity }: { agent: AgentRow; beat?: { title: string; done: number; total: number } | null; onActivity?: (a: AgentRow) => void }) {
  const [verb, setVerb] = useState('thinking…');
  const [cat, setCat] = useState<ToolCat | null>(null);
  const [tally, setTally] = useState<Partial<Record<GhostCat, number>>>({});
  const [sec, setSec] = useState(1);
  // The ghost keeps the RAW rows too, so it can show the same activity stream a run card shows.
  // Until now it distilled everything into one verb and a tally: a wake with 59 steps read as
  // "composing… 135s · 3 checks · 20 commands · 1 file" while the panel had the whole story.
  const [rows, setRows] = useState<LogRow[]>([]);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const toggle = (id: number) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const startRef = useRef(Date.now());
  // a tool burst can swap verbs every ~100ms — unreadable, and each swap restarts the
  // fade so the text lives half-transparent. Hold every verb ≥450ms; a newer one waits
  // its turn and only the LATEST pending shows (humans want the current state, not a log)
  const swapRef = useRef({ at: 0, pending: '', timer: null as ReturnType<typeof setTimeout> | null });
  // Seeded from the agent's latest run rather than from mount: a human opening the thread while rex
  // is already 100 steps in should see those steps, not an empty block that fills from now on.
  useEffect(() => {
    let alive = true;
    void nm?.agentLogs({ agentId: agent.id, limit: 200 }).then((r) => {
      if (!alive || !r.length) return;
      const cur = r[r.length - 1]?.run_id ?? null;
      if (!cur) return;
      const seed = r.filter((x) => x.run_id === cur);
      setRows((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...seed.filter((x) => !seen.has(x.id)), ...prev].sort((a, b) => a.id - b.id).slice(-120);
      });
    }).catch(() => {});
    return () => { alive = false; };
  }, [agent.id]);
  useEffect(() => {
    startRef.current = Date.now();
    const iv = setInterval(() => setSec(Math.max(1, Math.round((Date.now() - startRef.current) / 1000))), 1000);
    const applyVerb = (v: string) => { setVerb(v); swapRef.current.at = Date.now(); };
    const un = nm?.watchAgentLogs((row) => {
      if (row.agent_id !== agent.id) return;
      setRows((prev) => (prev.some((p) => p.id === row.id) ? prev : [...prev, row].slice(-120)));
      if (Date.parse(row.ts) < startRef.current - 2000) return; // this wake only (small clock slack)
      const g = ghostVerb(row);
      if (!g) return;
      setCat(g.cat ?? null);
      if (g.cat) setTally((t) => ({ ...t, [g.cat!]: (t[g.cat!] ?? 0) + 1 }));
      const s = swapRef.current;
      const since = Date.now() - s.at;
      if (since >= 450) applyVerb(g.verb);
      else {
        s.pending = g.verb;
        s.timer ??= setTimeout(() => { s.timer = null; applyVerb(s.pending); }, 450 - since);
      }
    });
    return () => { clearInterval(iv); un?.(); if (swapRef.current.timer) clearTimeout(swapRef.current.timer); };
  }, [agent.id]);
  const toks = (Object.entries(tally) as Array<[GhostCat, number]>).map(([k, n]) => `${n} ${GHOST_CATS[k][n === 1 ? 0 : 1]}`);
  const ghostItems = groupActivity(rows).filter((it) => it.t !== 'event');
  // an active BEAT outranks the tool narration: the worker's declared step is the truer
  // "what am I doing" (verbs keep feeding the tally underneath); step count replaces the
  // elapsed seconds while it shows
  const shown = beat ? beat.title : verb;
  // The agent's own narration — its latest text block — is the PLAN the human reads while the
  // work happens (design round §B; Codex's best idea). It types in and stays. NO_REPLY-class
  // sentinels never narrate.
  // no phase — a phased 'turn' row is the daemon's own diagnostics (phase:'inject' carries the
  // context-spend line), and the live run showed exactly that leaking in as the "plan"
  const plan = ([...rows].reverse().find((r) => r.kind === 'turn' && !r.phase && r.summary && !/^NO_REPLY/.test(r.summary))?.summary ?? '')
    .replace(/\*\*|__|`/g, ''); // narration renders as plain prose — raw ** markers read as noise
  const typedPlan = useTypewriter(plan, false);
  // the step log is CLOSED by default now — a wake with 59 steps was a wall before the reply
  // existed; the sheen line says what is happening, the chevron opens the story on request
  const [logOpen, setLogOpen] = useState(false);
  return (
    <div className="msg ghostmsg">
      <AgentAvatar name={agent.name} size={26} interactive />
      <div className="body">
        <div className="head">
          <b>{agent.name}</b>
          {agent.role ? <span className="rolechip msgrole" data-role={agent.role}>{agent.role}</span> : null}
          <span className="time">now</span>
        </div>
        <div className="ghostelapsed">Working for {sec}s</div>
        {typedPlan && <div className="ghostplan">{typedPlan}{typedPlan.length < plan.length && <span className="tcaret" aria-hidden />}</div>}
        <div className="ghostrow">
          <button type="button" className="liveact ghoststep" aria-expanded={logOpen}
            title={logOpen ? 'collapse the step log' : `what ${agent.name} has done — expand`}
            onClick={() => setLogOpen((v) => !v)}>
            <Orb state={orbStateFor(shown, cat, agent.role)} label={`${agent.name} is ${shown}`} />
            {/* key on the text so the sheen + enter animation replay when the step advances */}
            <span className="liveact-txt" key={shown}>{shown}</span>
            <span className="ghostchev" aria-hidden>▶</span>
            <span className="liveact-step">{beat ? `${beat.done}/${beat.total}` : `${sec}s`}</span>
          </button>
          <button type="button" className="ghostact" title={`open @${agent.name}'s full activity`} onClick={() => onActivity?.(agent)}>activity ›</button>
        </div>
        {logOpen && (
          <>
            {toks.length > 0 && (
              <div className="gtally">{toks.map((t) => <span key={t} className="gtok">{t}</span>)}</div>
            )}
            {ghostItems.length > 0 && (
              <div className="legact logwrap activitylog threadact">
                <ActivityItems items={ghostItems.slice(-LEG_ACT_ROWS)} open={open} toggle={toggle} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Runs (docs/29): the ghost's synced twin ────────────────────────────────────────────────
// The ghost narrates a wake beautifully, on ONE machine, for exactly as long as the turn. The
// run card is the same story as a durable row: it survives the reply, renders on every machine,
// grows a leg per fanned-out strand, and settles into something you can scroll back to.
//
// It renders IN the message stream (like a beats history block), which is what makes it
// zone-legal by construction (docs/25): it's thread content, not another docked surface.

/** How many of a leg's tool calls the in-place unfold shows before it defers to the full panel. */
export const LEG_ACT_ROWS = 5;

/**
 * A subagent's own tool calls, unfolded under the row that owns them.
 *
 * Reads the leg's run id straight from the local activity log — the same rows the activity
 * modal shows, capped to the last few and stripped to verb + argument + outcome. It exists so
 * "what is this subagent actually doing" is answerable WITHOUT leaving the thread; the button
 * at the end escalates to the full panel, filtered to this leg.
 */
/**
 * The activity rows, rendered ONE way.
 *
 * The thread used to draw its own stripped-down version — lowercase verb, truncated arg, no
 * narration, no expandable call — while the activity panel showed the real thing: bold verb, full
 * argument, the agent's prose between steps, a chevron onto the CALL payload. Same data, two
 * renderers, and the thread's was the poor relation. There is now one, so "what the panel shows"
 * and "what the thread shows" cannot drift again.
 */
export function ActivityItems({ items, open, toggle }: {
  items: ReturnType<typeof groupActivity<LogRow>>;
  open: Set<number>;
  toggle: (id: number) => void;
}) {
  return (
    <>
      {items.map((it) => {
        if (it.t === 'narration') return <div key={it.row.id} className="actnarr">{it.row.summary}</div>;
        if (it.t === 'tool') {
          const { call, result } = it;
          // COLLAPSED by default, running or not (founder report). An in-flight call used to
          // auto-open, which meant a live turn dumped whole prompt payloads into the thread — a
          // spawn's brief ran to twenty lines and buried the conversation it was posted in. The
          // headline already says what it is and that it is running; the payload is a click away.
          const isOpen = open.has(call.id);
          const head = toolHeadline(call.summary);
          const oc = toolOutcome(result);
          return (
            <div key={call.id} className={`acttool${isOpen ? ' open' : ''}${result?.level === 'error' ? ' err' : ''}`}>
              {/* toggleable while it RUNS too — watching a call in flight is exactly when you
                  most want to look inside it; it just no longer opens itself to do that */}
              <div className="acttoolhead" role="button" tabIndex={0}
                onClick={() => toggle(call.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(call.id); } }}>
                <span className="actchev" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                <span className="acthead">{head.verb ? <><span className="actverb">{head.verb}</span> <span className="actarg">{head.arg}</span></> : head.arg}</span>
                {oc ? <span className={`actoutcome ${oc.cls}`} aria-hidden="true">{oc.glyph}</span>
                  : <span className="actrunning">running<span className="tdots"><i /><i /><i /></span></span>}
              </div>
              {isOpen && <div className="actsub"><ActSub row={call} />{result && <ActSub row={result} />}</div>}
            </div>
          );
        }
        const r = it.row;
        const isOpen = open.has(r.id);
        return (
          <div key={r.id} className={`logrow actevent l-${r.level}${isOpen ? ' open' : ''}`} onClick={() => toggle(r.id)}>
            <span className="logtime">{new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            <span className={`logkind k-${r.kind}`}>{LOG_KIND_ICON[r.kind] ?? '·'} {r.phase ?? r.kind}</span>
            {r.task_number ? <span className="logtask">#{r.task_number}</span> : null}
            <span className="logsummary">{r.summary}</span>
            {r.tokens ? <span className="logtok">{fmtTok(r.tokens)} tok</span> : null}
            {r.detail && isOpen && <pre className="logdetail">{r.detail}</pre>}
          </div>
        );
      })}
    </>
  );
}

/**
 * This machine's name, stamped once from bootstrap.
 *
 * A module-level value rather than a prop threaded through four layers, because it is read only
 * for COPY and it never changes within a session. It exists because of shared compute (0114):
 * `agent_logs` is machine-local and NOT synced, so a run served by a teammate's laptop has no
 * tool rows here — and the honest sentence for that is not the same as the one for "this agent
 * genuinely called no tools".
 */

// One raw telemetry line nested under an expanded tool card — the underlying 'call' or
// 'result' with its full (redacted, truncated) detail. This is "the logs, underneath".
export function ActSub({ row }: { row: LogRow }) {
  return (
    <div className="actsubrow">
      <span className={`actsubkind k-${row.kind}`}>{row.phase ?? row.kind}</span>
      <span className="actsubsummary">{row.summary}</span>
      {row.detail && <pre className="actsubdetail">{row.detail}</pre>}
    </div>
  );
}
