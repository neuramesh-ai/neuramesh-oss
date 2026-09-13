// THE MEMORY SURFACE — recall for one room, plus the lesson editor.
//
// Split out of App(). Memory is the ONE destination that is not workspace-wide by construction:
// /v1/memory is keyed to a single channel, so it gets a room picker rather than a scope bar
// aggregate. That is why it has a room picker and no project filter.
//
// It OWNS its state (state-ownership round, 2026-08-16): the recall fetch, the room picker, and
// the lesson editor's four flags all live here now. The fetch already discarded on leave — App's
// effect gated on `view !== 'memory'` and called setMem(null) — so ownership changed the filing,
// not the behaviour. The view gate is gone because this component only mounts on that view.

import { useEffect, useState } from 'react';
import { nm } from '../bridge/nm';
import type { ScopeProps } from '../shell/useScopeMemory';
import { ScopePill } from '../ui/ScopeBar';
import type { WorkspaceProjectRow } from '../bridge/rows-board';
import type { ChannelRow } from '../bridge/rows-rooms';

/** what /v1/memory returns for one room — the summary block plus its facts */
export type MemoryPayload = {
  block: { content: string; basisCount: number; updatedAt: string } | null;
  facts: Array<{ id: string; content: string; kind?: string; taskNumber?: number | null; validFrom: string; validUntil: string | null; supersededBy?: string | null }>;
} | null;

export function MemorySurface({ chans, current, wsProjects, scope, setScope }: {
  chans: ChannelRow[];
  /** this destination's remembered narrowing (shell/useScopeMemory.ts) */
  scope: ScopeProps['scope'];
  setScope: ScopeProps['setScope'];
  /** the room the shell is standing in — the picker's default */
  current: ChannelRow | null;
  wsProjects: WorkspaceProjectRow[];
}) {
  const [mem, setMem] = useState<{
    block: { content: string; basisCount: number; updatedAt: string } | null;
    facts: Array<{ id: string; content: string; kind?: string; taskNumber?: number | null; validFrom: string; validUntil: string | null; supersededBy?: string | null }>;
  } | null>(null);

  // The room picker is a NARROWING like any other, so it rides the shared registry rather than
  // local state. It shipped as a plain useState in the ownership round and was the only surface
  // in the app that forgot where you were looking — the very split useScopeMemory exists to end.
  const memRoomId = scope.channelId;
  const setMemRoomId = (id: string | null) => setScope({ channelId: id });

  const memRoom = (memRoomId ? chans.find((c) => c.id === memRoomId) : null) ?? current;
  useEffect(() => {
    if (!nm || !memRoom) return;
    setMem(null);
    setLessonEdit(null); setLessonRetire(null); setLessonErr('');
    void nm.memory(memRoom.slug).then(setMem).catch(() => setMem({ block: null, facts: [] }));
  }, [memRoom?.id]);

  // Lesson curation (Memory view): a two-step retire ends a lesson's validity
  // server-side (bitemporal — the row stays, prompts stop seeing it); the inline
  // correct flow records the fixed phrasing and closes out the old one when the
  // reconcile's overlap check missed the rewrite. Who may retire is enforced by
  // the API (403), not here.
  const [lessonEdit, setLessonEdit] = useState<{ id: string; draft: string } | null>(null);
  const [lessonRetire, setLessonRetire] = useState<string | null>(null);
  const [lessonBusy, setLessonBusy] = useState(false);
  const [lessonErr, setLessonErr] = useState('');
  const curationError = (e: unknown, fallback: string) =>
    setLessonErr(((e instanceof Error ? e.message : String(e)).split(': ').pop() ?? '').trim() || fallback);
  // curation acts on the room being READ, not the room the shell is standing in — with a room
  // picker on the surface those are no longer the same channel, and recording a lesson against
  // the wrong one would file a correction where nobody will ever read it
  const refreshMem = async () => {
    if (!nm || !memRoom) return;
    try { setMem(await nm.memory(memRoom.slug)); } catch { /* keep what's shown */ }
  };
  const retireLesson = async (factId: string) => {
    if (!nm) return;
    setLessonBusy(true); setLessonErr('');
    try { await nm.memoryRetireFact(factId); await refreshMem(); }
    catch (e) { curationError(e, 'retire failed'); }
    setLessonBusy(false); setLessonRetire(null);
  };
  const correctLesson = async () => {
    if (!nm || !lessonEdit || !memRoom) return;
    const content = lessonEdit.draft.trim();
    setLessonBusy(true); setLessonErr('');
    try {
      const r = await nm.memoryRecordLesson(memRoom.slug, content);
      // deterministic replace: when the reconcile missed the rewrite (or superseded a
      // different row), close the old phrasing out naming its successor — the server
      // no-ops if the reconcile already got it.
      if (r.decision !== 'noop' && r.factId !== lessonEdit.id) await nm.memoryRetireFact(lessonEdit.id, r.factId);
      await refreshMem();
      setLessonEdit(null);
    } catch (e) { curationError(e, 'correction failed'); }
    setLessonBusy(false);
  };


  return (
      <>
        {/* Memory is the one destination that CANNOT go workspace-wide client-side: the
            server's /v1/memory hard-requires a channel and store.channelMemory is keyed by
            one, so aggregating needs a backend change. It gets the destination chrome and a
            room picker; the picker chooses whose memory you are reading. */}
        <div className="topbar">Memory<span className="desc">a room's living summary, facts and lessons</span></div>
        <div className="scopebar">
          <span className="memroomlbl">Reading</span>
          <ScopePill label="Room" active={memRoom?.id ?? null} onPick={setMemRoomId}
            items={chans.map((c) => ({ id: c.id, label: `#${c.slug}`, sub: wsProjects.find((p) => p.id === c.project_id)?.name }))} />
        </div>
      <div className="libwrap">
        <div className="memcard">
          <div className="memhead">◐ What's happening in #{memRoom?.slug}</div>
          {mem?.block ? (
            <>
              <p className="memblock">{mem.block.content}</p>
              <div className="memmeta">
                refreshed {new Date(mem.block.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·
                basis {mem.block.basisCount} messages · sleep-time worker · in every agent's context
              </div>
            </>
          ) : (
            <div className="empty">No summary block yet — it appears once the orchestrator's sleep-time worker runs.</div>
          )}
        </div>
        {mem && mem.facts.some((f) => f.kind === 'lesson') && (
          <>
            <div className="memhead" style={{ marginTop: 16 }}>Lessons from reviews</div>
            {mem.facts.filter((f) => f.kind === 'lesson').map((f) => (
              <div key={f.id} className={`factrow${f.validUntil ? ' dead' : ''}`} onMouseLeave={() => { if (lessonRetire === f.id) setLessonRetire(null); }}>
                <span className="factdot lesson">{f.validUntil ? '◌' : '●'}</span>
                {lessonEdit?.id === f.id ? (
                  <span className="lessonedit">
                    <textarea
                      autoFocus
                      rows={2}
                      maxLength={500}
                      value={lessonEdit.draft}
                      onChange={(e) => setLessonEdit({ id: f.id, draft: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setLessonEdit(null);
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void correctLesson();
                      }}
                    />
                    <span className="lessoneditacts">
                      <button
                        className="btn primary"
                        disabled={lessonBusy || lessonEdit.draft.trim().length < 12 || lessonEdit.draft.trim() === f.content}
                        onClick={() => void correctLesson()}
                      >
                        Record correction
                      </button>
                      <button className="btn" disabled={lessonBusy} onClick={() => setLessonEdit(null)}>Cancel</button>
                      <span className="lessoneditnote">supersedes this phrasing — history stays</span>
                    </span>
                  </span>
                ) : (
                  <>
                    <span className="factbody">{f.content}</span>
                    <span className="factmeta">
                      {f.taskNumber ? `from #${f.taskNumber} · ` : ''}
                      {f.validUntil
                        ? `${f.supersededBy ? 'superseded' : 'retired'} ${new Date(f.validUntil).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
                        : `since ${new Date(f.validFrom).toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
                    </span>
                    {!f.validUntil && (
                      <span className="factacts">
                        <button
                          className="factact"
                          disabled={lessonBusy}
                          title="record a corrected phrasing — it supersedes this lesson"
                          onClick={() => { setLessonRetire(null); setLessonErr(''); setLessonEdit({ id: f.id, draft: f.content }); }}
                        >
                          correct
                        </button>
                        <button
                          className={`factact${lessonRetire === f.id ? ' danger' : ''}`}
                          disabled={lessonBusy}
                          title="retire this lesson — agents stop being briefed on it; history stays"
                          onClick={() => {
                            setLessonEdit(null);
                            if (lessonRetire === f.id) void retireLesson(f.id);
                            else setLessonRetire(f.id);
                          }}
                        >
                          {lessonRetire === f.id ? 'confirm retire?' : 'retire'}
                        </button>
                      </span>
                    )}
                  </>
                )}
              </div>
            ))}
            {lessonErr && <div className="lessonerr">⚠ {lessonErr}</div>}
          </>
        )}
        <div className="memhead" style={{ marginTop: 16 }}>Durable facts</div>
        {mem && !mem.facts.some((f) => f.kind !== 'lesson') && <div className="empty">No facts distilled yet.</div>}
        {mem?.facts.filter((f) => f.kind !== 'lesson').map((f) => (
          <div key={f.id} className={`factrow${f.validUntil ? ' dead' : ''}`}>
            <span className="factdot">{f.validUntil ? '◌' : '●'}</span>
            <span className="factbody">{f.content}</span>
            <span className="factmeta">
              {f.validUntil
                ? `${new Date(f.validFrom).toLocaleDateString([], { month: 'short', day: 'numeric' })} → superseded ${new Date(f.validUntil).toLocaleDateString([], { month: 'short', day: 'numeric' })}`
                : `since ${new Date(f.validFrom).toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
            </span>
          </div>
        ))}
      </div>
      </>
  );
}
