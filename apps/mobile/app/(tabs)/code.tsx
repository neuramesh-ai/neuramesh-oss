// THE CODE TAB — the rail's Code mode (the mobile-cloud round D12): code work only, one row per
// synced code_sessions row (0135) in the one row anatomy, the branch as each row's one fact, a
// repo narrowing in chips. The state is the row's glyph: the orb for a streaming turn, the ask pulse
// for an approval waiting on you, a quiet row for a resting Plan, `done` for a settled one. New
// session is the FAB. No relay configured = the honest sentence, never an empty list.
import { CODE_SESSIONS_FOR_WORKSPACE } from '@neuramesh/client-core';
import { sessionGroups, type HistoryRow, type HistoryTask } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Head } from '../../src/head';
import { Icon } from '../../src/icon';
import { Kicker } from '../../src/kit';
import { relayConfigured } from '../../src/relay';
import { SessionRow } from '../../src/session-row';
import { useTheme } from '../../src/theme';
import { GhostPill } from '../../src/thread-parts';
import { F, R } from '../../src/type';
import { timeAgo, useActiveWorkspace } from '../../src/ui';

export interface CodeRow { id: string; project_id: string | null; repo_id: string | null; repo_name: string | null; branch: string | null; title: string | null; mode: string; state: string; machine_id: string | null; created_by: string | null; last_line: string | null; changes_count: number | null; checkpoints_count: number | null; created_at: string; updated_at: string; ended_at: string | null }

/** the row's chip + liveness from the synced state (the mockup's act · approval · plan · done) */
export function codeRowFace(r: CodeRow, t: { prog: string; warn: string; plan: string; done: string; blocked: string; muted: string }): { label: string; color?: string; live: boolean; ask: boolean } {
  if (r.state === 'streaming') return { label: r.mode, color: r.mode === 'act' ? t.prog : t.plan, live: true, ask: false };
  if (r.state === 'awaiting_approval') return { label: 'approval', color: t.warn, live: false, ask: true };
  if (r.state === 'completed') return { label: 'done', color: t.done, live: false, ask: false };
  if (r.state === 'error') return { label: 'error', color: t.blocked, live: false, ask: false };
  return { label: r.mode, color: r.mode === 'act' ? t.prog : undefined, live: false, ask: false };
}

export default function Code() {
  const t = useTheme();
  const router = useRouter();
  const ws = useActiveWorkspace();
  const { data: rows } = useQuery<CodeRow>(CODE_SESSIONS_FOR_WORKSPACE, [ws ?? '']);
  const [repo, setRepo] = useState<string | null>(null);
  const repos = useMemo(() => [...new Set((rows ?? []).map((r) => r.repo_name).filter((x): x is string => !!x))], [rows]);
  const shown = useMemo(() => (rows ?? []).filter((r) => !repo || r.repo_name === repo), [rows, repo]);
  // sessionGroups only reads `when`; the rows ride through as themselves
  const groups = useMemo(() => sessionGroups(shown.map((r) => ({ key: r.id, when: r.updated_at, row: r })) as unknown as Array<HistoryRow<HistoryTask>>, Date.now()) as unknown as Array<{ label: string; rows: Array<{ row: CodeRow }> }>, [shown]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Head />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 6, gap: 6 }} style={{ flexGrow: 0 }}>
        <GhostPill label="All repos" on={repo === null} onPress={() => setRepo(null)} />
        {repos.map((r) => <GhostPill key={r} label={r} on={repo === r} onPress={() => setRepo(r)} />)}
      </ScrollView>
      <ScrollView contentContainerStyle={{ paddingBottom: 96 }}>
        {!relayConfigured() ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
            <Text style={{ ...F.display(), fontSize: 18, letterSpacing: F.tight(18), color: t.text }}>No Code lane on this build.</Text>
            <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, marginTop: 4 }}>Code runs on your cloud machine through nm-relay. This build has no relay. Sessions from other clients still show below.</Text>
          </View>
        ) : null}
        {/* one empty state at a time: with no relay the sentence above already explains the list */}
        {rows !== undefined && shown.length === 0 && relayConfigured() ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <Text style={{ ...F.display(), fontSize: 18, letterSpacing: F.tight(18), color: t.text }}>No Code sessions yet.</Text>
            <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, marginTop: 4 }}>A new session opens on your cloud machine, in its own branch.</Text>
          </View>
        ) : null}
        {groups.map((g) => (
          <View key={g.label}>
            <Kicker>{g.label}</Kicker>
            {g.rows.map(({ row: r }) => {
              const face = codeRowFace(r, t);
              return (
                <SessionRow key={r.id} kind="code" title={r.title || `${r.repo_name ?? 'repo'} · new session`} snip={r.branch ? `⎇ ${r.branch}` : `${r.repo_name ?? 'repo'} · read-only`} snipMono={!!r.branch}
                  when={timeAgo(r.updated_at)} live={face.live} ask={face.ask} chip={{ label: face.label, color: face.color }} onPress={() => router.push(`/code/${r.id}`)} />
              );
            })}
          </View>
        ))}
      </ScrollView>
      <Pressable onPress={() => router.push('/code/new')} accessibilityLabel="New Code session" style={{ position: 'absolute', right: 16, bottom: 20, width: 52, height: 52, borderRadius: R.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } }}>
        <Icon name="code" size={22} color={t.brandInk} />
      </Pressable>
    </View>
  );
}
