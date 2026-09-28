// THE WORKTREES DESTINATION (docs/design/worktrees-2026-09, George 2026-09-26: "it should instead
// be showing active/open worktrees on the workspace, and user can cleanup any of the worktree
// whenever they want"). One table of this machine's worktrees: the task berths, classed by the
// board the sweeper's way (docs/40), and the coding threads' retained worktrees, with Open and
// Clean up on every row. The agents' footprint keeps the disk gauge behind its own doors.
//
// Every row's state is the daemon's classification, never a stored word, and the bulk button IS
// the sweeper's remove verdict (settled and no-task rows). A person may clean up an ACTIVE row,
// once, out loud: the confirm leads with the warning and its verb reads "Clean up anyway".
import { useEffect, useState, type ReactNode } from 'react';
import type { WorktreeRemoveInput, WorktreesPayloadUI, WorktreeTaskRowUI, WorktreeThreadRowUI } from '../bridge/rows-infra';
import { nm } from '../bridge/nm';
import { timeAgo } from '../lib/time';
import { IconCode, IconMachine } from '../ui/icons';
import { Orb } from '../ui/Orb';
import { fmtBytes } from './FootprintView';

type Filter = 'all' | 'active' | 'submitted' | 'settled' | 'coding';
const TASK_CHIP: Record<WorktreeTaskRowUI['cls'], [Filter, string]> = { leased: ['active', 'active'], warm: ['submitted', 'submitted'], dead: ['settled', 'settled'], orphan: ['settled', 'no task'] };
const THREAD_CHIP: Record<WorktreeThreadRowUI['cls'], string> = { working: 'working', waits: 'waits for you', idle: 'idle', orphan: 'no thread' };
const RING: Record<WorktreeTaskRowUI['cls'], string> = { leased: 'b', warm: 'r', dead: 'd', orphan: 'o' };
const sum = (rows: Array<{ bytes: number }>): number => rows.reduce((n, r) => n + r.bytes, 0);
const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;

/** the confirm's words, per plan §3.3: what goes, what stays, and the warning first when there is one */
type ConfirmWords = { title: string; warn: string[]; body: ReactNode; verb: string; force: boolean };
function confirmFor(row: { kind: 'task'; row: WorktreeTaskRowUI } | { kind: 'thread'; row: WorktreeThreadRowUI }): ConfirmWords {
  const size = fmtBytes(row.row.bytes);
  if (row.kind === 'task') {
    const t = row.row;
    const title = `Remove nm-${t.taskNumber}\u2019s worktree?`;
    const stays = t.branch ? <>The branch <code>{t.branch}</code> stays on origin.</> : 'Nothing on origin changes.';
    if (t.cls === 'leased') return { title, warn: ['An agent works here now. Its run stops with an error.'], body: `${size}. The task keeps its branch on origin. Nothing else is touched.`, verb: 'Clean up anyway', force: true };
    if (t.cls === 'warm') return { title, warn: [], body: <>{size}. {stays} A rework starts from the pushed branch. Nothing else is touched.</>, verb: 'Clean up', force: false };
    if (t.cls === 'orphan') return { title, warn: [], body: `${size}. No task on the board owns it now. Nothing else is touched.`, verb: 'Clean up', force: false };
    return { title, warn: [], body: <>{size}. {stays} Nothing else is touched.</>, verb: 'Clean up', force: false };
  }
  const t = row.row;
  const warn: string[] = [];
  if (t.held) warn.push('The coding runtime works here now. Its session stops with an error.');
  if (t.dirty > 0) warn.push(`${count(t.dirty, 'file')} changed here ${t.dirty === 1 ? 'is' : 'are'} not committed. ${t.dirty === 1 ? 'It goes' : 'They go'} with the worktree.`);
  if (t.cls === 'orphan') return { title: 'Remove this worktree?', warn, body: `${size}. No thread owns it now. Nothing else is touched.`, verb: 'Clean up', force: false };
  return { title: 'Remove this thread\u2019s worktree?', warn, body: <>{size}. The thread stays, and its next open cuts a fresh worktree{t.branch ? <> from <code>{t.branch}</code></> : null}.</>, verb: t.held ? 'Clean up anyway' : 'Clean up', force: t.held };
}


function Confirm({ title, warn, body, verb, busy, onGo, onCancel }: { title: string; warn: string[]; body: ReactNode; verb: string; busy: boolean; onGo: () => void; onCancel: () => void }) {
  return (
    <div className="wtvconfirm" role="dialog" aria-label={title}>
      <b>{title}</b>
      {warn.map((w) => <p key={w} className="warnline">{w}</p>)}
      <p>{body}</p>
      <div className="acts">
        <button className="btn ghost sm" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="btn primary sm" disabled={busy} onClick={onGo}><span>{verb}</span></button>
      </div>
    </div>
  );
}

function Row({ glyph, name, sub, repo, branch, chip, chipCls, bytes, mtimeMs, onOpen, confirmOpen, onConfirm, confirm, busy, onGo, onCancel }: {
  glyph: ReactNode; name: ReactNode; sub: string | null; repo: string | null; branch: string | null; chip: string; chipCls: string; bytes: number; mtimeMs: number;
  onOpen: (() => void) | null; confirmOpen: boolean; onConfirm: () => void; confirm: ConfirmWords; busy: boolean; onGo: () => void; onCancel: () => void;
}) {
  return (
    <div className="wtvrow">
      <span className="gl">{glyph}</span>
      <span className="nm" title={sub ?? undefined}>{name}</span>
      <span className="br" title={[repo, branch].filter(Boolean).join(' · ')}>{[repo, branch].filter(Boolean).join(' · ') || '—'.replace('—', '')}</span>
      <span><span className={`wtvchip c-${chipCls}`}>{chip}</span></span>
      <span className="sz">{fmtBytes(bytes)}</span>
      <span className="when">{mtimeMs ? timeAgo(new Date(mtimeMs).toISOString()) : ''}</span>
      <span className="acts">
        {onOpen && <button className="btn ghost sm" onClick={onOpen}>Open</button>}
        <span className="wtvconfirmwrap">
          <button className="btn sm" disabled={busy} aria-haspopup="dialog" aria-expanded={confirmOpen} onClick={onConfirm}>Clean up</button>
          {confirmOpen && <Confirm {...confirm} busy={busy} onGo={onGo} onCancel={onCancel} />}
        </span>
      </span>
    </div>
  );
}

export function WorktreesView({ onOpenTask, onOpenThread }: { onOpenTask: (taskId: string) => void; onOpenThread: (threadId: string, channelId: string | null) => void }) {
  const [p, setP] = useState<WorktreesPayloadUI | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  // exactly one confirm open at a time: a row's key, or 'settled' for the bulk button
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const ask = (): void => {
      void nm?.worktreesGet().then((r) => {
        if (dead) return;
        setP(r.payload);
        if (r.payload.fleetPending) retry = setTimeout(ask, 4000); // the other tools' sizes warm in the background
      }).catch((e) => { if (!dead) setErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 120) : 'could not read this machine'); });
    };
    ask();
    return () => { dead = true; if (retry) clearTimeout(retry); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (err) return <div className="fpempty">{err}</div>;
  if (!p) {
    return (
      <div className="fploading">
        <Orb state="searching" size={64} label="Measuring this machine" />
        <div className="fploadinglbl">Measuring this machine</div>
      </div>
    );
  }
  const remove = (input: WorktreeRemoveInput): void => {
    if (!nm) return;
    setBusy(true); setNote('');
    void nm.worktreeRemove(input).then((r) => {
      setBusy(false); setOpen(null); setP(r.payload);
      if (r.ok) setNote(r.freedBytes ? `Freed ${fmtBytes(r.freedBytes)}` : 'Nothing to clean up');
      else setNote(r.code === 'WORKTREE_BUSY' ? 'Something works there now. The table is fresh, try again.' : 'That worktree is already gone.');
    }).catch(() => { setBusy(false); setOpen(null); setNote('Clean-up failed'); });
  };
  const tally = { active: p.tasks.filter((t) => t.cls === 'leased').length, submitted: p.tasks.filter((t) => t.cls === 'warm').length, settled: p.tasks.filter((t) => t.cls === 'dead' || t.cls === 'orphan').length, coding: p.threads.length };
  const all = p.tasks.length + p.threads.length;
  const tasks = filter === 'coding' ? [] : p.tasks.filter((t) => filter === 'all' || TASK_CHIP[t.cls][0] === filter);
  const threads = filter === 'all' || filter === 'coding' ? p.threads : [];
  const fleetB = sum(p.fleet);
  const tok = (f: Filter, label: string, n: number) => (
    <button key={f} className={`wtvtok${filter === f ? ' on' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label} {n}</button>
  );
  return (
    <div className="wtview">
      <div className="wtvhead">
        <div className="wtvid">
          <h1>Worktrees</h1>
          <div className="wtvsub"><IconMachine s={11} /><span>{p.machine}</span><span>·</span><span>{count(all, 'worktree')}</span><span>·</span><span>{fmtBytes(sum(p.tasks) + sum(p.threads))}</span></div>
          <div className="wtvtoks">
            {tok('all', 'all', all)}{tok('active', 'active', tally.active)}{tok('submitted', 'submitted', tally.submitted)}{tok('settled', 'settled', tally.settled)}{tok('coding', 'coding', tally.coding)}
          </div>
        </div>
        <div className="wtvright">
          {note && <span className="wtvnote" role="status">{note}</span>}
          <span className="wtvconfirmwrap">
            <button className="btn" disabled={busy || p.settled.count === 0} title={p.settled.count === 0 ? 'Nothing settled to clean up' : undefined}
              aria-haspopup="dialog" aria-expanded={open === 'settled'} onClick={() => setOpen((o) => (o === 'settled' ? null : 'settled'))}>
              Clean up settled{p.settled.count ? ` · ${fmtBytes(p.settled.bytes)}` : ''}
            </button>
            {open === 'settled' && (
              // the sweeper's own verdict: settled and no-task rows, exactly what runs
              <Confirm title={`Remove ${count(p.settled.count, 'settled worktree')}?`} warn={[]}
                body={`${fmtBytes(p.settled.bytes)}. The branches on origin stay. Active and submitted work is never touched.`}
                verb="Clean up" busy={busy} onGo={() => remove({ kind: 'settled' })} onCancel={() => setOpen(null)} />
            )}
          </span>
        </div>
      </div>
      {all === 0 && <div className="wtvempty">No worktrees on this machine. A task or a coding thread makes one when it starts.</div>}
      {(filter === 'all' || filter !== 'coding') && tasks.length > 0 && (
        <>
          <div className="wtvsec">Task worktrees <small>· {tasks.length} · {fmtBytes(sum(tasks))}</small></div>
          {tasks.map((t) => {
            const key = `nm-${t.taskNumber}`;
            const c = confirmFor({ kind: 'task', row: t });
            return (
              <Row key={key} glyph={<span className={`wtvring ${RING[t.cls]}`} aria-hidden />}
                name={<><em>{key}</em>{t.title ?? 'No task on the board'}</>} sub={t.title} repo={t.repoName} branch={t.branch}
                chip={TASK_CHIP[t.cls][1]} chipCls={TASK_CHIP[t.cls][0] === 'settled' && t.cls === 'orphan' ? 'orphan' : TASK_CHIP[t.cls][0]}
                bytes={t.bytes} mtimeMs={t.mtimeMs}
                onOpen={t.taskId ? () => onOpenTask(t.taskId!) : null}
                confirmOpen={open === key} onConfirm={() => setOpen((o) => (o === key ? null : key))} confirm={c} busy={busy}
                onGo={() => remove({ kind: 'task', taskNumber: t.taskNumber, force: c.force })} onCancel={() => setOpen(null)} />
            );
          })}
        </>
      )}
      {threads.length > 0 && (
        <>
          <div className="wtvsec">Coding threads <small>· {threads.length} · {fmtBytes(sum(threads))}</small></div>
          {threads.map((t) => {
            const c = confirmFor({ kind: 'thread', row: t });
            return (
              <Row key={t.name} glyph={<IconCode s={13} />}
                name={t.title ?? (t.cls === 'orphan' ? 'No thread owns this worktree' : 'Coding thread')} sub={t.title} repo={t.repoName} branch={t.branch}
                chip={THREAD_CHIP[t.cls]} chipCls={t.cls} bytes={t.bytes} mtimeMs={t.mtimeMs}
                onOpen={t.threadId ? () => onOpenThread(t.threadId!, t.channelId) : null}
                confirmOpen={open === t.name} onConfirm={() => setOpen((o) => (o === t.name ? null : t.name))} confirm={c} busy={busy}
                onGo={() => remove({ kind: 'thread', name: t.name, force: c.force })} onCancel={() => setOpen(null)} />
            );
          })}
        </>
      )}
      {(p.fleet.length > 0 || p.fleetPending) && filter === 'all' && (
        <>
          <div className="wtvsec">Other tools on this Mac <small>· {p.fleetPending && !p.fleet.length ? 'measuring' : fmtBytes(fleetB)}</small></div>
          <div className="wtvfleet">
            {p.fleet.map((f) => <div key={f.path} className="r"><span>{f.path}</span><b>{count(f.count, 'worktree')} · {fmtBytes(f.bytes)}</b></div>)}
            <div className="foot">NeuraMesh never touches these. Clean up from the owning tool.</div>
          </div>
        </>
      )}
    </div>
  );
}
