// Everything the task panel LOADS — the thread's messages and attachments, the artifacts and
// beats, the room's skills and packs, the events behind the rounds drawer, the live runs — and
// `act`, the one path every board command takes out of this panel.
//
// It owns the state it fills, so the panel reads values rather than threading a dozen setters
// through. What stayed behind is the state the COMPOSER owns (armed mode, reply target): those
// effects react to the task moving, not to anything loading. Split out of thread/TaskThread.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { groupByMessage } from '../parts';
import { mergeTranscript } from './merge';
import { useRuns } from '../hooks';
import { isWatchableRun, runTrees } from '../../runs/runs';
import { nm as nmBridge } from '../../bridge/nm';
import type { ArtifactUI, BeatUI, TaskRow } from '../../bridge/rows-board';
import type { AttachmentRow } from '../../bridge/rows-board';
import type { MessageRow } from '../../bridge/rows-rooms';
import type { SkillPackRow, SkillRow } from '../../bridge/rows-content';

const nm = nmBridge;

export function useTaskData(d: {
  task: TaskRow;
  channelId: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setActErr: (v: string) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  threadStream: { agent: string; text: string } | null;
  convoThreadId?: string | null;
  setComposerMode: (v: null) => void;
}) {
  const { task, channelId, busy, setBusy, setActErr, listRef, threadStream, convoThreadId, setComposerMode } = d;
const [rows, setRows] = useState<MessageRow[]>([]);
const [threadAtts, setThreadAtts] = useState<AttachmentRow[]>([]);
const threadAttByMsg = useMemo(() => groupByMessage(threadAtts), [threadAtts]);
const [arts, setArts] = useState<ArtifactUI[]>([]);
const [beats, setBeats] = useState<BeatUI[]>([]);
const [openArt, setOpenArt] = useState<string | null>(null);
const [skills, setSkills] = useState<SkillRow[]>([]);
const [packs, setPacks] = useState<SkillPackRow[]>([]);
const [detail, setDetail] = useState<{ events: Array<{ id: string; type: string; source: string; ts?: string; created_at?: string; occurred_at?: string; payload?: Record<string, unknown> }> } | null>(null);

const act = async (type: string, fb?: string, opts?: { silentThread?: boolean }) => {
  if (!nm || busy) return;
  setBusy(true);
  setActErr('');
  try {
    // silentThread: the caller already posted the feedback into the thread (the armed
    // composer does, so attachments ride along) — don't double-post it here.
    if (fb && type === 'task.request_changes' && !opts?.silentThread) await nm.sendThread(task.id, channelId, `Changes requested: ${fb}`);
    await nm.taskAction(type, task.id, fb);
    setComposerMode(null);
  } catch (e) {
    setActErr(e instanceof Error ? e.message.replace(/^Error invoking remote method.*?: Error: /, '').slice(0, 110) : 'action failed');
  } finally {
    setBusy(false);
  }
};

useEffect(() => {
  if (!nm) return;
  setRows([]);
  let first = true;
  // a task born from a conversation shows the WHOLE exchange — the pre-task chat rides
  // in via the thread union (watchConvo); a plain task thread reads by task as before.
  // AN ANCHORED UNIT'S OWN ROWS RIDE BESIDE THE CONVERSATION'S (2026-09-20, thread/task/merge.ts
  // says why): the unit's task-scoped rows are watched too and merged by time
  const anchored = !!convoThreadId && convoThreadId === task.origin_thread_id;
  const sub = (cb: (r: MessageRow[]) => void): (() => void) => {
    if (!convoThreadId) return nm!.watchThread(task.id, cb);
    if (!anchored) return nm!.watchConvo(convoThreadId, cb);
    let convo: MessageRow[] = []; let own: MessageRow[] = [];
    const unConvo = nm!.watchConvo(convoThreadId, (r) => { convo = r; cb(mergeTranscript(convo, own)); });
    const unOwn = nm!.watchThread(task.id, (r) => { own = r; cb(mergeTranscript(convo, own)); });
    return () => { unConvo(); unOwn(); };
  };
  return sub((r) => {
    const el = listRef.current;
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 200;
    setRows(r);
    const initial = first;
    first = false;
    // instant (not smooth): the smooth animation unpins a reader who was at the bottom, so a
    // reply arriving right after another message stops following — see the channel feed note.
    if (initial || nearBottom)
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
  });
}, [task.id, convoThreadId, task.origin_thread_id]);

useEffect(() => {
  if (!nm) return;
  setArts([]);
  setOpenArt(null);
  return nm.watchArtifacts(task.id, setArts);
}, [task.id]);
// The artifacts drawer used to auto-open on a review-ready task, because the deliverable was
// otherwise invisible. Since docs/30 the files render INLINE where they landed, so popping the
// drawer on arrival now covers the thread with a second copy of what is already on screen. It
// stays a deliberate click — for scrolling back to a file after the conversation has moved on.
// a filename in prose is a link only when THIS task actually attached it (docs/30) — the same
// "resolve or leave it alone" rule the #1234 task ref follows
const artByName = useCallback((name: string) => arts.some((a) => a.name === name), [arts]);
// Runs (docs/29) scoped to THIS task — its own work, never the room's other threads
const taskRunRows = useRuns(channelId);
const runTrees_ = useMemo(() => runTrees(taskRunRows, { taskId: task.id }).filter(isWatchableRun), [taskRunRows, task.id]);
useEffect(() => {
  if (!nm) { setBeats([]); return; }
  setBeats([]);
  return nm.watchBeats(task.id, setBeats);
}, [task.id]);
useEffect(() => {
  if (!nm) { setThreadAtts([]); return; }
  setThreadAtts([]);
  return nm.watchThreadAttachments(task.id, setThreadAtts);
}, [task.id]);
// follow a streaming reply to the bottom while the reader is near it — parity with the channel
// feed's chatStream follow, which the thread was missing (a growing bubble never scrolled). Instant
// + a fresh near-bottom read, so a reader parked in history is never yanked down by the stream.
useEffect(() => {
  const el = listRef.current;
  if (!el || !threadStream) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 200)
    requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight }));
}, [threadStream?.text]);
// the room's skill library backs the `/` picker here exactly as in the channel composer
useEffect(() => {
  if (!nm) return;
  setSkills([]);
  return nm.watchSkills(channelId, (rows) => setSkills(rows as SkillRow[]));
}, [channelId]);
useEffect(() => {
  if (!nm) return;
  setPacks([]);
  return nm.watchSkillPacks(channelId, (rows) => setPacks(rows as SkillPackRow[]));
}, [channelId]);

// task detail (events) powers the rounds drawer's review-loop audit
useEffect(() => {
  setDetail(null);
  void nm?.taskDetail(task.id).then((d) => setDetail(d as never)).catch(() => setDetail(null));
}, [task.id, task.state, task.updated_at]);
  return { rows, threadAtts, threadAttByMsg, arts, beats, openArt, setOpenArt, skills, packs, detail, act, artByName, taskRunRows, runTrees_ };
}
