// THREADS — every session in the workspace, grouped, narrowed and searched (George, 2026-09-08:
// "threads grouped by projects, filterable by project and search field at the top, continuously
// revealing scroll so it doesn't slow down the app").
//
// It ABSORBS Home's session list rather than sitting beside it (George picked option B in the
// design round). Home keeps what is waiting on you and what lands today; the list of everything
// lives here, one thumb away, and there is exactly one place to go looking for a thread.
//
// STATUS IS A FILTER (the thread-status round, same day): needs you · in progress · settled, the
// first narrowing above the project chips, a count on each. The row's trailing chip wears the
// same word; the dial keeps the phase. A needs-you row settles here exactly as it does on Home.
//
// A PLAIN SCROLL VIEW, like Home. A recycling list earns its complexity on an unbounded list; this
// one is paged, and FlashList drew rows on top of one another on the TestFlight build (the mobile
// fix round, 2026-09-06). Paging removed the reason to recycle.
import { CHANNELS_WITH_PROJECT_FOR_WORKSPACE, PROJECTS_FOR_WORKSPACE } from '@neuramesh/client-core';
import type { ThreadStatus } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Head } from '../../src/head';
import { Icon } from '../../src/icon';
import { Kicker } from '../../src/kit';
import { SessionRow } from '../../src/session-row';
import { cleanLine, rowKind, rowSnip, type SessionRowData, useSessions } from '../../src/sessions';
import { useSettle } from '../../src/settle';
import { SettleRow, settleSheet } from '../../src/settle-row';
import { statusChip } from '../../src/status-chip';
import { StatusSegment } from '../../src/status-segment';
import { useTheme } from '../../src/theme';
import { GhostPill } from '../../src/thread-parts';
import { groupByProject, type RowGroup } from '../../src/thread-groups';
import { F, R } from '../../src/type';
import { timeAgo, useActiveWorkspace } from '../../src/ui';
import { UndoPill } from '../../src/undo-pill';

type Mode = 'project' | 'time';

export default function Threads() {
  const t = useTheme();
  const router = useRouter();
  const ws = useActiveWorkspace();
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('project');
  const [status, setStatus] = useState<ThreadStatus | null>(null);
  const { local, undo, settle, unsettle } = useSettle(ws);
  const { data: projects } = useQuery<{ id: string; name: string }>(PROJECTS_FOR_WORKSPACE, [ws ?? '']);
  const { data: channels } = useQuery<{ id: string; project_id: string | null }>(CHANNELS_WITH_PROJECT_FOR_WORKSPACE, [ws ?? '']);

  // the chip narrows to a project's ROOMS — a session belongs to a room, and a room to a project
  const channelIds = useMemo(
    () => (projectId ? new Set((channels ?? []).filter((c) => c.project_id === projectId).map((c) => c.id)) : null),
    [channels, projectId],
  );
  // 50 to a page: a search is read in one pass and 50 rows is about six screens of it
  const sessions = useSessions(ws, { query, channelIds, pageSize: 50, status, settledLocally: local });

  const projectById = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects]);
  const projectOfChannel = useMemo(() => {
    const byChannel = new Map((channels ?? []).map((c) => [c.id, c.project_id]));
    return (channelId: string | null) => {
      const pid = channelId ? byChannel.get(channelId) : null;
      const project = pid ? projectById.get(pid) : undefined;
      return project ? { id: project.id, name: project.name } : null;
    };
  }, [channels, projectById]);

  const groups = useMemo(
    () => (mode === 'project'
      ? groupByProject(sessions.rows, projectOfChannel)
      : sessions.groups.map((g) => ({ key: g.label, label: g.label, rows: g.rows }))),
    [mode, sessions.rows, sessions.groups, projectOfChannel],
  );
  const n = sessions.rows.length;
  const total = sessions.counts.needs_you + sessions.counts.in_progress + sessions.counts.settled;
  const open = (r: SessionRowData) => (r.task ? router.push(`/task/${r.task.id}`) : r.threadId ? router.push(`/thread/${r.threadId}`) : undefined);
  const onSettle = (r: SessionRowData) => { if (r.threadId) void settle(r.threadId, r.title); };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Head />
      <Filters query={query} setQuery={setQuery} mode={mode} setMode={setMode} status={status} setStatus={setStatus} counts={sessions.counts} total={total}
        projects={projects ?? []} projectId={projectId} setProjectId={setProjectId} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 28 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        scrollEventThrottle={64}
        onScroll={(e) => {
          // THE NEXT PAGE ARRIVES BEFORE YOU DO: one screen from the end is early enough
          const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
          if (sessions.hasMore && contentOffset.y + layoutMeasurement.height >= contentSize.height - layoutMeasurement.height) sessions.loadMore();
        }}
      >
        {groups.map((g) => <Group key={g.key} group={g} mode={mode} onOpen={open} onSettle={onSettle} />)}
        {sessions.ready && n === 0 ? (
          <Text style={{ ...F.body(400), color: t.dim, fontSize: 13, paddingHorizontal: 16, paddingTop: 18 }}>
            {query ? `Nothing matches “${query}”.` : status ? 'No threads with this status.' : 'No threads yet. Start one from Home.'}
          </Text>
        ) : null}
        {/* the foot COUNTS, it does not ask: the scroll is what loads more */}
        {sessions.ready && n > 0 ? (
          <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim, textAlign: 'center', paddingTop: 14 }}>
            {sessions.hasMore ? `${n} threads · more load as you scroll` : status ? `${n} ${n === 1 ? 'thread' : 'threads'} · ${total - n} more under All` : `${n} ${n === 1 ? 'thread' : 'threads'}`}
          </Text>
        ) : null}
      </ScrollView>
      {undo ? <UndoPill title={undo.title} onUndo={() => void unsettle()} bottom={16} /> : null}
    </View>
  );
}

/** one group: its kicker, then its rows — a needs-you row settles on a swipe, exactly as on Home */
function Group({ group, mode, onOpen, onSettle }: { group: RowGroup<SessionRowData>; mode: Mode; onOpen: (r: SessionRowData) => void; onSettle: (r: SessionRowData) => void }) {
  const t = useTheme();
  return (
    <View>
      <Kicker>{`${group.label} · ${group.rows.length}`}</Kicker>
      {group.rows.map((r) => {
        const snip = rowSnip(r);
        const title = cleanLine(r.title);
        const can = r.status === 'needs_you' && !!r.threadId;
        return (
          <SettleRow key={r.key} enabled={can} onSettle={() => onSettle(r)}>
            <SessionRow kind={rowKind(r)} state={r.state} title={title} snip={r.why ?? snip.text} snipMono={!r.why && snip.mono}
              when={mode === 'project' ? `#${r.channelSlug}` : `#${r.channelSlug} · ${timeAgo(r.when)}`} live={!!r.live} ask={r.ask}
              chip={statusChip(t, r.status)} flush={can} onPress={() => onOpen(r)}
              onLongPress={can ? () => settleSheet(title, () => onSettle(r), () => onOpen(r)) : undefined} />
          </SettleRow>
        );
      })}
    </View>
  );
}

/** the narrowing controls: the one search field, the status segment, the grouping switch, the project chips */
function Filters({ query, setQuery, mode, setMode, status, setStatus, counts, total, projects, projectId, setProjectId }: {
  query: string; setQuery: (s: string) => void;
  mode: Mode; setMode: (m: Mode) => void;
  status: ThreadStatus | null; setStatus: (s: ThreadStatus | null) => void;
  counts: Record<ThreadStatus, number>; total: number;
  projects: Array<{ id: string; name: string }>;
  projectId: string | null; setProjectId: (id: string | null) => void;
}) {
  const t = useTheme();
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 9 }}>
        <Icon name="search" size={16} color={t.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search every thread" placeholderTextColor={t.dim}
          autoCorrect={false} autoCapitalize="none" returnKeyType="search"
          style={{ ...F.body(400), flex: 1, fontSize: 14, color: t.text, paddingVertical: 0 }} />
        {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Icon name="close" size={14} color={t.dim} /></Pressable> : null}
      </View>
      <StatusSegment value={status} counts={counts} total={total} onPick={setStatus} />
      {/* the grouping switch sits with the narrowing controls, not in the list */}
      <View style={{ paddingTop: 8, paddingBottom: 2 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          <Segment mode={mode} onPick={setMode} />
          <GhostPill label="All projects" on={projectId === null} onPress={() => setProjectId(null)} />
          {projects.map((p) => <GhostPill key={p.id} label={p.name} on={projectId === p.id} onPress={() => setProjectId(p.id)} />)}
        </ScrollView>
      </View>
    </>
  );
}

/** By project · By time — the one control that changes what the headers mean */
function Segment({ mode, onPick }: { mode: Mode; onPick: (m: Mode) => void }) {
  const t = useTheme();
  const opt = (m: Mode, label: string) => (
    <Pressable key={m} onPress={() => onPick(m)} accessibilityLabel={label}
      style={{ borderRadius: R.pill, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: mode === m ? t.panel3 : 'transparent' }}>
      <Text style={{ ...F.body(500), fontSize: 12, color: mode === m ? t.text : t.muted }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.panel2, borderWidth: 1, borderColor: t.border2, borderRadius: R.pill, padding: 2, alignSelf: 'center' }}>
      {opt('project', 'By project')}
      {opt('time', 'By time')}
    </View>
  );
}
