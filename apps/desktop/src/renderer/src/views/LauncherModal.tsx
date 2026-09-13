// The launcher (⌘K) — start work from anywhere. Extracted from App.tsx (track A2).
import { AgentAvatar } from '../components/AgentAvatar';
import { AttachButton, AttachTray, useAttachments } from '../composer/attach';
import { ChipMenu } from '../ui/ChipMenu';
import { IconSend } from '../ui/icons';
import { Modal } from '../ui/Modal';
import { anchorPoint } from '../ui/anchor';
import { flashToast } from '../lib/toast';
import { nm as nmBridge } from '../bridge/nm';
import { shortTitle } from '../lib/time';
import { type ChannelRow } from '../bridge/rows-rooms';
import { type RoomSurface } from '../room-tabs';
import { type WorkspaceProjectRow } from '../bridge/rows-board';
import { useEffect, useRef, useState } from 'react';

// Imported bindings lose control-flow narrowing inside closures, so re-bind (same as App.tsx).
const nm = nmBridge;

// ── the universal launcher (Cabinet-grade): + New task ▾ from anywhere ──────────
// One modal, two modes. TASK: pick any channel, describe the work, attach files —
// submit posts it to the room exactly like the Home composer (rex triages, the
// thread grows off it) and jumps you there; + Backlog parks it on the channel's
// backlog with no thread. ROUTINE: the same prompt on a cadence — schedules were
// marketing-only UI, but schedule.create is channel-generic, so routines now arm
// for any room (non-marketing slots fire the prompt into the room as your message).
export function LauncherModal({ mode, channels, projects, initialChannelId, orchName, plan, onUpgrade, onClose, onOpenRoom }: {
  mode: 'task' | 'routine';
  channels: ChannelRow[];
  /** The WORK AXIS, and it has to come first. Channel slugs repeat across projects (`#marketing`
   *  exists in three of them), so a flat channel list showed three identical rows with no way to
   *  tell them apart — and defaulted to `channels[0]`, which is why routines kept landing in the
   *  default project. Pick the project, then its rooms. */
  projects: WorkspaceProjectRow[];
  initialChannelId: string | null;
  orchName: string;
  plan: string;
  onUpgrade: (reason: string) => void;
  onClose: () => void;
  /** `surface` lands the room on a specific tab — arming a routine goes straight to Routines */
  onOpenRoom: (c: ChannelRow, surface?: RoomSurface) => void;
}) {
  const [chanId, setChanId] = useState(initialChannelId ?? channels[0]?.id ?? '');
  // The project follows the room you came from, so opening this where you were standing is a
  // no-op rather than a reset. Falls back to the room's own project, then the default.
  const [projectId, setProjectId] = useState<string>(() => {
    const from = channels.find((c) => c.id === (initialChannelId ?? channels[0]?.id))?.project_id;
    return from ?? projects.find((p) => p.is_default)?.id ?? projects[0]?.id ?? '';
  });
  const activeProjects = projects.filter((p) => p.status !== 'archived');
  const roomsInProject = channels.filter((c) => c.project_id === projectId);
  // Picking a project moves the room with it: leaving `chanId` pointing at another project's
  // channel is exactly how a routine ends up filed somewhere nobody chose.
  const pickProject = (id: string) => {
    setProjectId(id);
    const first = channels.find((c) => c.project_id === id);
    if (first) setChanId(first.id);
  };
  const [text, setText] = useState('');
  const [cadence, setCadence] = useState<'once' | 'daily' | 'weekdays' | 'weekly'>('daily');
  const [atTime, setAtTime] = useState('09:00');
  const [weekday, setWeekday] = useState(1);
  const [runAt, setRunAt] = useState(() => {
    const d = new Date(Date.now() + 60 * 60_000);
    d.setMinutes(0, 0, 0);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`;
  });
  const [busy, setBusy] = useState(false);
  const atts = useAttachments(plan, onUpgrade);
  const chan = channels.find((c) => c.id === chanId) ?? null;
  // A task header should read as a title, not as the first 80 characters of a paragraph.
  // `slice(0, 80)` cut mid-word ("…an ai wellness app, people should be") AND the remainder
  // was thrown away entirely, because park passed no description. Now: trim on a WORD
  // boundary for the header, and the full ask rides along as the description, which is the
  // thread's intake record. An agent-created task gets its title from the model instead —
  // capped in the tool schema so a model echoing the ask fails loudly rather than truncating.
  const title = shortTitle(text);

  const launchTask = async () => {
    const body = text.trim();
    if ((!body && !atts.specs().length) || atts.busy || !nm || !chan) return;
    setBusy(true);
    try {
      await nm.send(chan.id, body, { id: atts.msgId(), attachments: atts.specs() });
      flashToast(`Sent to #${chan.slug} — the room takes it from here.`);
      onOpenRoom(chan);
      onClose();
    } catch (e) { flashToast(e instanceof Error ? e.message : 'send failed'); } finally { setBusy(false); }
  };
  const parkBacklog = async () => {
    if (!title || !nm || !chan) return;
    setBusy(true);
    try {
      await nm.createTask(chan.id, title, { backlog: true, ...(text.trim() && text.trim() !== title ? { description: text.trim() } : {}) });
      flashToast(`Parked on #${chan.slug}'s backlog — promote it when it's time.`);
      onClose();
    } catch (e) { flashToast(e instanceof Error ? e.message : 'backlog failed'); } finally { setBusy(false); }
  };
  const armRoutine = async () => {
    const prompt = text.trim();
    if (!prompt || !nm || !chan) return;
    setBusy(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await nm.scheduleCreate({
        channelId: chan.id, title: title || 'routine', prompt, cadence, routine: true,
        ...(cadence === 'once' ? { runAt: new Date(runAt).toISOString() } : { atTime, tz }),
        ...(cadence === 'weekly' ? { weekday } : {}),
      });
      flashToast(`Routine armed for #${chan.slug} — first run ${new Date(res.nextRunAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.`);
      onClose();
    } catch (e) { flashToast(e instanceof Error ? e.message : 'could not arm the routine'); } finally { setBusy(false); }
  };

  const submit = () => void (mode === 'task' ? launchTask() : armRoutine());
  const canSend = mode === 'task' ? !busy && !atts.busy && (!!text.trim() || atts.count > 0) : !busy && !!text.trim();
  const CADENCES = [{ v: 'once', l: 'Once' }, { v: 'daily', l: 'Daily' }, { v: 'weekdays', l: 'Weekdays' }, { v: 'weekly', l: 'Weekly' }] as const;
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // "Give me ideas": the orchestrator reads the ROOM (board, backlog, roster) in a
  // live one-shot and answers with pills it can actually act on there. The generic
  // samples survive only as the fallback when the read comes back empty (no creds,
  // echo daemon off, timeout) — the button always yields pills.
  const SAMPLES = mode === 'task'
    ? ["Summarize this room's week — what moved, what needs me",
       'Audit the board — flag anything stuck, unowned, or ready to promote',
       'Draft a one-page plan for our next milestone']
    : ['Post a morning summary — what moved overnight and what needs a human',
       'End of week: a short recap of what shipped and what stalled',
       'Check the backlog for stale items and suggest three to promote'];
  const [ideas, setIdeas] = useState<string[] | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const ideasSeq = useRef(0);
  const askIdeas = async () => {
    if (ideasBusy) return;
    const seq = ++ideasSeq.current;
    setIdeasBusy(true);
    try {
      const got = nm?.launcherIdeas ? await nm.launcherIdeas(chanId, mode) : null;
      if (seq !== ideasSeq.current) return; // the room changed mid-read — stale answer
      setIdeas(got?.length ? got : SAMPLES);
    } catch { if (seq === ideasSeq.current) setIdeas(SAMPLES); }
    finally { if (seq === ideasSeq.current) setIdeasBusy(false); }
  };
  useEffect(() => { ideasSeq.current++; setIdeas(null); setIdeasBusy(false); }, [chanId]); // ideas are per-room
  return (
    <Modal
      wide
      // New task / New routine are the caret menu's other two rows — a MENU, so it grows out of
      // the row you picked instead of dimming the room (2026-08-17, George)
      anchored
      origin={anchorPoint('.navnewcaret')}
      title={mode === 'task' ? 'What should the channel take on?' : 'What should run on a schedule?'}
      onClose={onClose}
    >
      {/* Give me ideas → the orchestrator's live read of the room → click-to-start pills */}
      <div className="sugrow launchsug" aria-label="Ideas">
        {ideas ? (
          ideas.map((idea, i) => (
            <button key={idea} className="sug ideain" style={{ animationDelay: `${i * 60}ms` }} data-tip="Fills the composer — edit before sending" onClick={() => setText(idea)}>
              {idea}
            </button>
          ))
        ) : ideasBusy ? (
          <span className="ideathinking" role="status">
            <AgentAvatar name={orchName} size={15} radius={4} />
            <span className="ideadots" aria-hidden><i /><i /><i /></span>
            <span className="ideatxt">{orchName} is reading the channel…</span>
          </span>
        ) : (
          <button className="sug ideabtn" data-tip={`${orchName} reads this channel's board, backlog, and roster — then suggests ${mode === 'task' ? 'work' : 'routines'} it can actually run`} onClick={() => void askIdeas()}>
            <AgentAvatar name={orchName} size={15} radius={4} /> Give me ideas
          </button>
        )}
      </div>
      {/* the channel composer, inherited: same box, same row — pickers live as chips
          in the row exactly like the main composer's, the round send is THE submit */}
      <div className="cbox launchcbox">
        <div className="chint">
          <AgentAvatar name={orchName} size={15} radius={4} />
          <span>
            {mode === 'task'
              ? <><b className="chintat">@{orchName}</b> triages it — user-facing work is designed first; Backlog parks it with no thread.</>
              : <><b className="chintat">@{orchName}</b> addresses each run — the prompt fires into the channel at its slot.</>}
          </span>
        </div>
        <AttachTray items={atts.items} onRemove={atts.remove} />
        <textarea
          className="launchta"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (canSend) submit(); } }}
          placeholder={mode === 'task'
            ? `Describe the work — the team takes it from there. ↵ send`
            : `The prompt this routine runs — e.g. "Summarize yesterday's board movement and flag anything stuck."`}
        />
        <div className="row">
          {/* Project first, then its rooms (2026-08-07). The channel menu used to list EVERY
              channel in the workspace by slug alone — and slugs repeat across projects, so it
              showed three identical `#marketing` rows and defaulted to whichever happened to be
              first, which is why routines kept landing in the default project. */}
          <ChipMenu icon="◆" label={activeProjects.find((p) => p.id === projectId)?.name ?? '…'} title="The project this belongs to"
            options={activeProjects.map((p) => ({ value: p.id, label: p.name }))}
            value={projectId} onPick={pickProject} />
          <ChipMenu icon="#" label={chan?.slug ?? '…'} title="The channel this lands in"
            options={roomsInProject.map((c) => ({ value: c.id, label: `#${c.slug}` }))}
            value={chanId} onPick={setChanId} />
          {mode === 'routine' && (
            <>
              <ChipMenu icon="⟳" label={CADENCES.find((c) => c.v === cadence)?.l ?? 'Daily'} title="Cadence"
                options={CADENCES.map((c) => ({ value: c.v, label: c.l }))}
                value={cadence} onPick={(v) => setCadence(v as typeof cadence)} />
              {cadence === 'weekly' && (
                <ChipMenu icon="◫" label={DAYS[weekday] ?? 'Monday'} title="Weekday"
                  options={DAYS.map((d, i) => ({ value: String(i), label: d }))}
                  value={String(weekday)} onPick={(v) => setWeekday(parseInt(v, 10))} />
              )}
              {cadence === 'once'
                ? <label className="cchip timechip" title="Runs exactly once, at this moment">◷<input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} /></label>
                : <label className="cchip timechip" title="The slot, in your timezone">◷<input type="time" value={atTime} onChange={(e) => setAtTime(e.target.value)} /></label>}
            </>
          )}
          <span className="cdiv" aria-hidden />
          <AttachButton onFiles={atts.addFiles} count={atts.count} max={atts.limits.maxPerMessage} />
          {mode === 'task' && (
            <button className="cchip" disabled={busy || !title} title="park it on the backlog — no agent works it until someone promotes it" onClick={() => void parkBacklog()}>
              ＋ Backlog
            </button>
          )}
          <span className="rowsp" />
          <button className="btn primary send" disabled={!canSend} onClick={submit} data-tip={mode === 'task' ? 'Send · ↵' : 'Arm routine · ↵'} aria-label={mode === 'task' ? 'Send' : 'Arm routine'}>
            {busy || atts.busy ? '…' : <IconSend s={20} />}
          </button>
        </div>
      </div>
    </Modal>
  );
}
