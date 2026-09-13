// HOME (docs/35 §4; the mobile-cloud round D3–D4): the head, what is left to set up, what lands
// today, and the needs-you queue as ROWS. New chat is the FAB.
//
// THE QUEUE LOST ITS BUTTONS (George, 2026-09-08). Accept-and-merge, approve, request-changes as
// buttons on a list were noise: if a thread needs you it is in the Needs you status, the row says
// why, and the answer is given in the thread in words — the orchestrator applies it (a merge on
// your word, an approval on the plan card). The row's one act is Settle, which moves the thread
// to Settled and nothing else (src/needs-you.tsx, src/settle.ts). The rows are the Threads tab's
// rows, filtered to the one status: one derivation, one row recipe.
import { Link, useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { GoingOutToday } from '../../src/going-out';
import { Head } from '../../src/head';
import { Icon } from '../../src/icon';
import { JoinedCard } from '../../src/joined-card';
import { NeedsYou } from '../../src/needs-you';
import { type SessionRowData, useSessions } from '../../src/sessions';
import { useSettle } from '../../src/settle';
import { SetupCard } from '../../src/setup-card';
import { useTheme } from '../../src/theme';
import { F, R } from '../../src/type';
import { useActiveWorkspace } from '../../src/ui';
import { UndoPill } from '../../src/undo-pill';

export default function Home() {
  const t = useTheme();
  const router = useRouter();
  const ws = useActiveWorkspace();
  const { local, undo, settle, unsettle } = useSettle(ws);
  // the first page of sessions holds every thread that could need you: they are the recent ones
  const sessions = useSessions(ws, { pageSize: 50, status: 'needs_you', settledLocally: local });
  const open = (r: SessionRowData) => (r.task ? router.push(`/task/${r.task.id}`) : r.threadId ? router.push(`/thread/${r.threadId}`) : undefined);
  const rows = sessions.rows;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Head />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 96 }} keyboardShouldPersistTaps="handled">
        {/* the join moment, then what is left to set up (S6) — pinned above the queue, folding to a pill */}
        <JoinedCard ws={ws} />
        <SetupCard ws={ws} />
        {/* WHAT LANDS TODAY, above the queue: it has a clock on it. Absent when nothing is scheduled. */}
        <GoingOutToday workspace={ws} />
        {rows.length ? <NeedsYou rows={rows} onSettle={(r) => { if (r.threadId) void settle(r.threadId, r.title); }} onOpen={open} /> : null}
        {/* NOTHING WAITING IS A RESULT, not an empty screen — and it says where the threads went */}
        {sessions.ready && !rows.length ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 22 }}>
            <Text style={{ ...F.body(600), fontSize: 14, color: t.text }}>Nothing needs you.</Text>
            <Pressable onPress={() => router.push('/(tabs)/threads')} hitSlop={6}>
              <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 18, color: t.muted, marginTop: 4 }}>
                Your threads are in the Threads tab.
              </Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
      {undo ? <UndoPill title={undo.title} onUndo={() => void unsettle()} /> : null}
      <Link href="/new" asChild>
        <Pressable accessibilityLabel="New chat" style={{ position: 'absolute', right: 16, bottom: 20, width: 52, height: 52, borderRadius: R.pill, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } }}>
          <Icon name="compose" size={22} color={t.brandInk} />
        </Pressable>
      </Link>
    </View>
  );
}
