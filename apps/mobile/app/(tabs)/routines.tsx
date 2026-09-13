// ROUTINES · CALENDAR (the mobile-cloud round D9–D10): Automations' two surfaces nest under one head
// as a segment — the nav-nesting ruling at phone scale (docs/33 §8: a destination never grows a tab
// strip; its children nest). Routines is the inventory of what is armed; Calendar is the time view of
// everything scheduled — automation firings projected through the SHARED scheduleFirings (never
// re-derived) and scheduled posts, two lanes told apart by their glyph. New routine is the FAB.
//
// THE CALENDAR SHOWS THE WORK, NOT ONLY THE CLOCK (the fix round, 2026-09-06; George: "calendar on
// mobile seems to be showing routines instead of items"). Two faults, both real. A post was plotted
// only once it HELD a time, so every draft was dropped, and drafts are most of what a person has —
// they get their own band above the week now. And nothing in the agenda was a target, so a week of
// routine firings was all that ever showed and none of it could be acted on. Every entry opens:
// a firing opens its routine, a post opens the post sheet.
//
// THE SCOPE IS THE PROJECT, NOT THE ROOM (George, 2026-09-06: "fix the duplicate room chips to
// filter by project instead of rooms"). A room slug is unique inside a project and repeats across
// them, so a workspace-wide destination drew `#build` three times with nothing to tell them apart.
// Projects are the work axis and their names are unique, which is what a scope chip needs. The
// chips ride BOTH surfaces now: the filter used to apply to the calendar while only Routines could
// see or change it, which is the invisible-default the scope-bar ruling exists to prevent.
import { AGENTS_FOR_WORKSPACE, CHANNELS_WITH_PROJECT_FOR_WORKSPACE, CONTENT_ITEMS_FOR_CALENDAR, PROJECTS_FOR_WORKSPACE, SCHEDULES_FOR_WORKSPACE } from '@neuramesh/client-core';
import { scheduleFirings } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api } from '../../src/auth';
import { AgendaRow, NO_TIME } from '../../src/agenda-row';
import { Head } from '../../src/head';
import { Icon } from '../../src/icon';
import { Kicker } from '../../src/kit';
import { platformName, postHeadline, postSlot, type PostItem } from '../../src/post-item';
import { PostSheet } from '../../src/post-sheet';
import { promptOf, RoutineCard, type ScheduleRow } from '../../src/routine-card';
import { RoutineSheet, type RoutineDraft } from '../../src/routine-form';
import { useTheme } from '../../src/theme';
import { GhostPill, PILL_H } from '../../src/thread-parts';
import { F, R } from '../../src/type';
import { useActiveWorkspace } from '../../src/ui';

type Agenda = { key: string; at: Date; kind: 'run' | 'post'; title: string; sub: string; dim: boolean; done?: boolean; id: string };

const DAY_MS = 86_400_000;
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const postTitle = (p: PostItem) => `${platformName(p.platform)} · “${postHeadline(p.body)}”`;

export default function Routines() {
  const t = useTheme();
  const ws = useActiveWorkspace();
  const [seg, setSeg] = useState<'routines' | 'calendar'>('routines');
  const [project, setProject] = useState<string | null>(null);
  const router = useRouter();
  const [weekOff, setWeekOff] = useState(0);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [sheet, setSheet] = useState<RoutineDraft | null>(null);
  const [post, setPost] = useState<string | null>(null);
  // the drafts band starts CLOSED: the calendar is a time view, and a draft has no time yet
  const [drafts, setDrafts] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const { data: scheds } = useQuery<ScheduleRow>(SCHEDULES_FOR_WORKSPACE, [ws ?? '']);
  const { data: posts } = useQuery<PostItem>(CONTENT_ITEMS_FOR_CALENDAR, [ws ?? '']);
  const { data: channels } = useQuery<{ id: string; slug: string; project_id: string | null }>(CHANNELS_WITH_PROJECT_FOR_WORKSPACE, [ws ?? '']);
  const { data: projects } = useQuery<{ id: string; name: string }>(PROJECTS_FOR_WORKSPACE, [ws ?? '']);
  const { data: agents } = useQuery<{ id: string; name: string }>(AGENTS_FOR_WORKSPACE, [ws ?? '']);
  const slugOf = (id: string) => (channels ?? []).find((c) => c.id === id)?.slug ?? 'room';
  const projectOf = (channelId: string) => (channels ?? []).find((c) => c.id === channelId)?.project_id ?? null;
  const projectName = (id: string | null) => (id ? (projects ?? []).find((p) => p.id === id)?.name ?? null : null);
  const inScope = (channelId: string) => !project || projectOf(channelId) === project;
  // the room stays in a row's own line, and the PROJECT joins it only while nothing is picked —
  // which is exactly when three rooms called #build are otherwise indistinguishable
  const where = (channelId: string) => (project ? `#${slugOf(channelId)}` : `${projectName(projectOf(channelId)) ?? 'project'} · #${slugOf(channelId)}`);
  const agentName = (id: string | null) => (id ? (agents ?? []).find((a) => a.id === id)?.name ?? null : null);
  const live = useMemo(() => (scheds ?? []).filter((s) => (s.status === 'active' || s.status === 'paused') && inScope(s.channel_id)), [scheds, project, channels]); // eslint-disable-line react-hooks/exhaustive-deps
  const armed = live.filter((s) => s.status !== 'paused');
  const paused = live.filter((s) => s.status === 'paused');

  // every agenda entry is a target: a firing opens its routine, a post opens the post sheet
  function open(a: Agenda) {
    if (a.kind === 'post') { setPost(a.id); return; }
    const s = live.find((x) => x.id === a.id);
    if (s) setSheet(editDraft(s));
  }

  async function run(id: string, cmd: Parameters<typeof api.command>[0]) {
    setBusy(id);
    try { await api.command(cmd); } catch { /* the synced row is the truth; it re-renders */ } finally { setBusy(null); }
  }
  const editDraft = (s: ScheduleRow): RoutineDraft => ({
    id: s.id, title: s.title, prompt: promptOf(s), channel_id: s.channel_id, cadence: (s.cadence as RoutineDraft['cadence']) ?? 'daily', at_time: s.at_time || '09:00', weekday: s.weekday ?? 1,
    runDate: (s.next_run_at ? new Date(s.next_run_at) : new Date(Date.now() + 3600e3)).toISOString().slice(0, 10),
  });
  // a routine still belongs to a ROOM, so the scope picks the room rather than replacing it: the
  // first room of the project in scope, else the first room the workspace has
  const newDraft = (): RoutineDraft => ({ title: '', prompt: '', channel_id: (channels ?? []).find((c) => inScope(c.id))?.id ?? channels?.[0]?.id ?? '', cadence: 'daily', at_time: '09:00', weekday: 1, runDate: new Date(Date.now() + DAY_MS).toISOString().slice(0, 10) });

  // ── the calendar's week: Monday-start, the shared projection over the visible window ──
  const monday = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOff * 7); return d; }, [weekOff]);
  const days = useMemo(() => [...Array(7)].map((_, i) => new Date(monday.getTime() + i * DAY_MS)), [monday]);
  // every post in scope, once — the agenda plots the ones that hold a time, the band above the
  // week holds the ones that do not. A draft with no slot used to be dropped by both.
  const mine = useMemo(() => (posts ?? []).filter((p) => inScope(p.channel_id)), [posts, project, channels]); // eslint-disable-line react-hooks/exhaustive-deps
  const waiting = useMemo(() => mine.filter((p) => p.status === 'draft' && !postSlot(p)), [mine]);
  const agenda = useMemo<Agenda[]>(() => {
    const to = new Date(monday.getTime() + 7 * DAY_MS);
    const runs = scheduleFirings(live, monday, to).map<Agenda>((f) => ({
      key: f.key, at: f.at, kind: 'run', id: f.schedule.id, title: f.schedule.title, dim: f.schedule.status === 'paused',
      sub: `${where(f.schedule.channel_id)}${agentName(f.schedule.agent_id) ? ` · ${agentName(f.schedule.agent_id)}` : ''} · ${f.schedule.status === 'paused' ? 'paused' : f.at.getTime() < Date.now() ? 'fired' : 'next firing'}`,
    }));
    const items = mine.map<Agenda | null>((p) => {
      const at = postSlot(p);
      return at ? { key: `post:${p.id}`, at, kind: 'post', id: p.id, title: postTitle(p), dim: false, done: p.status === 'published', sub: `${p.status} · ${where(p.channel_id)}` } : null;
    }).filter((a): a is Agenda => !!a && a.at >= monday && a.at < to);
    return [...runs, ...items].sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [live, mine, monday, project, channels, agents]); // eslint-disable-line react-hooks/exhaustive-deps
  const byDay = useMemo(() => { const m = new Map<string, Agenda[]>(); for (const a of agenda) m.set(dayKey(a.at), [...(m.get(dayKey(a.at)) ?? []), a]); return m; }, [agenda]);
  // the sheet reads the LIVE row, so scheduling a post updates the sheet under your thumb rather
  // than showing the snapshot it opened with
  const openPost = useMemo(() => (post ? (posts ?? []).find((p) => p.id === post) ?? null : null), [post, posts]);
  // THE SHEET'S NEIGHBOURS (George, 2026-09-06: "i will like to be able to just swipe left or right
  // to move to. the next draft"). The order is the band's own order, so a swipe walks the list you
  // can see. It wraps, because the alternative is a swipe that silently does nothing at the ends.
  const walk = useMemo(() => waiting.map((p) => p.id), [waiting]);
  const at = post ? walk.indexOf(post) : -1;
  const stepPost = (delta: -1 | 1) => {
    if (at < 0 || walk.length < 2) return;
    setPost(walk[(at + delta + walk.length) % walk.length] ?? null);
  };
  const today = dayKey(new Date());
  const shownDays = pickedDay ? days.filter((d) => dayKey(d) === pickedDay) : days;

  const segs = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 6, gap: 8 }}>
      <View style={{ flexDirection: 'row', backgroundColor: t.panel3, borderRadius: R.pill, padding: 2, gap: 2 }}>
        {(['routines', 'calendar'] as const).map((k) => (
          <Pressable key={k} onPress={() => setSeg(k)} style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: R.pill, backgroundColor: seg === k ? t.card : 'transparent' }}>
            <Text style={{ ...F.body(600), fontSize: 12, color: seg === k ? t.text : t.muted }}>{k === 'routines' ? 'Routines' : 'Calendar'}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      {seg === 'calendar' ? <Text style={{ ...F.display(), fontSize: 16, letterSpacing: F.tight(16), color: t.text }}>{(days[3] ?? monday).toLocaleDateString([], { month: 'long', year: 'numeric' })}</Text> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Head />
      {segs}
      {/* the scope row is a control strip, so it keeps its own air: the cards used to start right
          under the chips and read as one crowded block (George, 2026-09-06) */}
      {/* the strip is measured, not guessed: a horizontal ScrollView takes its height from the
          content it can measure, and it read the pills short and shaved their bottom border off
          (George, 2026-09-06: "the project pills at the top seems cutoff towards their bottom").
          PILL_H + the air above and below is the whole answer. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center', gap: 8 }} style={{ flexGrow: 0, height: PILL_H + 12, marginBottom: 12 }}>
        <GhostPill label="All projects" on={project === null} onPress={() => setProject(null)} />
        {(projects ?? []).map((p) => <GhostPill key={p.id} label={p.name} on={project === p.id} onPress={() => setProject(p.id)} />)}
      </ScrollView>
      {seg === 'routines' ? (
        <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
          {live.length === 0 && scheds !== undefined ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <Text style={{ ...F.display(), fontSize: 18, letterSpacing: F.tight(18), color: t.text }}>Nothing runs on a schedule yet.</Text>
              <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, marginTop: 4 }}>Add a daily brief, a weekly retro, or a dependency sweep.</Text>
            </View>
          ) : null}
          {[...armed, ...paused].map((s) => (
            <RoutineCard key={s.id} s={s} agentName={agentName(s.agent_id)} where={where(s.channel_id)} busy={busy === s.id}
              onToggle={() => void run(s.id, { type: 'schedule.set_status', schedule: s.id, status: s.status === 'paused' ? 'active' : 'paused' })}
              onEdit={() => setSheet(editDraft(s))}
              onRemove={() => void run(s.id, { type: 'schedule.delete', schedule: s.id })} />
          ))}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 2 }}>
            <Pressable onPress={() => { setWeekOff((w) => w - 1); setPickedDay(null); }} hitSlop={8} style={{ padding: 6 }}><Icon name="arrowL" size={14} color={t.muted} /></Pressable>
            {days.map((d) => {
              const k = dayKey(d);
              const on = pickedDay === k || (!pickedDay && k === today);
              return (
                <Pressable key={k} onPress={() => setPickedDay((p) => (p === k ? null : k))} style={{ flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: R.md, backgroundColor: on ? t.card : 'transparent', borderWidth: on ? 1 : 0, borderColor: t.cardBorder }}>
                  <Text style={{ ...F.mono(500), fontSize: 9, letterSpacing: F.track, color: t.dim }}>{d.toLocaleDateString([], { weekday: 'short' }).toUpperCase()}</Text>
                  <Text style={{ ...F.body(600), fontSize: 12.5, color: on ? t.text : t.body }}>{d.getDate()}</Text>
                  <View style={{ width: 4, height: 4, borderRadius: 2, marginTop: 1, backgroundColor: byDay.has(k) ? t.prog : 'transparent' }} />
                </Pressable>
              );
            })}
            <Pressable onPress={() => { setWeekOff((w) => w + 1); setPickedDay(null); }} hitSlop={8} style={{ padding: 6 }}><Icon name="arrowR" size={14} color={t.muted} /></Pressable>
          </View>
          {shownDays.map((d) => {
            const k = dayKey(d);
            const list = byDay.get(k) ?? [];
            if (!list.length && !pickedDay) return null;
            return (
              <View key={k}>
                <Kicker>{`${d.toLocaleDateString([], { weekday: 'short', day: 'numeric' })}${k === today ? ' · today' : ''}`}</Kicker>
                {list.length === 0 ? <Text style={{ ...F.body(400), fontSize: 12.5, color: t.dim, paddingHorizontal: 16 }}>Nothing is scheduled.</Text> : null}
                {list.map((a) => (
                  <AgendaRow key={a.key} time={a.at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                    kind={a.kind} title={a.title} sub={a.sub} dim={a.dim} done={a.done} onPress={() => open(a)} />
                ))}
              </View>
            );
          })}
          {agenda.length === 0 && waiting.length === 0 ? <Text style={{ ...F.body(400), fontSize: 12.5, color: t.dim, paddingHorizontal: 16, paddingTop: 14 }}>Nothing is scheduled this week.</Text> : null}
          {/* DRAFTS SIT UNDER THE WEEK, FOLDED (George, 2026-09-06: "drafts are taking up all the
              space before we see what's actually scheduled for the day"). 95 of them buried the
              day. The band keeps its place in the surface and its count, and opens on a tap. */}
          {waiting.length ? (
            <View style={{ paddingTop: 6 }}>
              <Pressable onPress={() => setDrafts((v) => !v)} accessibilityLabel={`Draft items, ${waiting.length}`}>
                <Kicker right={<Text style={{ ...F.body(600), fontSize: 12, color: t.link }}>{drafts ? 'Hide' : 'Show'}</Text>}>
                  {`Draft items · ${waiting.length}`}
                </Kicker>
              </Pressable>
              {drafts ? waiting.map((p) => (
                <AgendaRow key={`wait:${p.id}`} time={NO_TIME} kind="post" title={postTitle(p)}
                  sub={`draft · ${where(p.channel_id)}`} onPress={() => setPost(p.id)} />
              )) : null}
            </View>
          ) : null}
        </ScrollView>
      )}
      <Pressable onPress={() => setSheet(newDraft())} accessibilityLabel="New routine" style={{ position: 'absolute', right: 16, bottom: 20, width: 52, height: 52, borderRadius: R.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } }}>
        <Icon name="routineClock" size={22} color={t.brandInk} />
      </Pressable>
      {sheet && ws ? <RoutineSheet workspace={ws} initial={sheet} onClose={() => setSheet(null)} onSaved={() => undefined} /> : null}
      {openPost && ws ? (
        <PostSheet workspace={ws} item={openPost} roomSlug={slugOf(openPost.channel_id)}
          onStep={at >= 0 && walk.length > 1 ? stepPost : undefined}
          place={at >= 0 && walk.length > 1 ? { at: at + 1, of: walk.length } : undefined}
          onClose={() => setPost(null)} onOpenThread={(id) => router.push(`/thread/${id}`)} />
      ) : null}
    </View>
  );
}
