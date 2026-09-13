// A ROOM OPENS TO ITS SESSION LIST (docs/35 — a channel is a folder of sessions): the room's
// conversations and bare tasks in the one row anatomy, day-grouped, and a composer that BIRTHS a
// session in this room (docs/35 §4.2: every send births a session — a loose room message is
// something nothing can create any more). The activity strip keeps saying who is working here.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@powersync/react-native';
import { currentUserId } from '../../src/auth';
import { OfflineBanner } from '../../src/connection';
import { Kicker } from '../../src/kit';
import { sendSession } from '../../src/send';
import { SessionRow } from '../../src/session-row';
import { SessionFoot } from '../../src/session-foot';
import { cleanLine, rowKind, rowSnip, useSessions } from '../../src/sessions';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme';
import { ActivityStrip } from '../../src/thread-activity';
import { ComposerCard, SessionHead } from '../../src/thread-parts';
import { F } from '../../src/type';
import { timeAgo, useActiveWorkspace } from '../../src/ui';

export default function ChannelSessions() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ws = useActiveWorkspace();
  const { data: channelRows } = useQuery<{ slug: string; topic: string | null; workspace_id: string }>('select slug, topic, workspace_id from channels where id = ? limit 1', [id]);
  const channel = channelRows?.[0];
  const sessions = useSessions(channel?.workspace_id ?? ws, { channelId: id });
  const [draft, setDraft] = useState('');

  async function send() {
    const body = draft.trim();
    const uid = currentUserId();
    if (!body || !uid || !channel) return;
    setDraft('');
    const threadId = await sendSession({ workspace: channel.workspace_id, channelId: id, body, authorId: uid, machineId: null });
    router.push(`/thread/${threadId}`);
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <OfflineBanner />
      <View style={{ paddingTop: 4 }}>
        <SessionHead crumb="home" title={channel ? `#${channel.slug}` : ''} onBack={() => router.back()} />
        {channel?.topic ? <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, paddingHorizontal: 16, marginTop: -4, marginBottom: 4 }}>{channel.topic}</Text> : null}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
          {sessions.groups.length === 0 ? (
            <Text style={{ ...F.body(400), color: t.dim, fontSize: 13, paddingHorizontal: 16, paddingTop: 14 }}>{sessions.ready ? 'No sessions in this room yet. Start one below.' : ''}</Text>
          ) : sessions.groups.map((g) => (
            <View key={g.label}>
              <Kicker>{g.label}</Kicker>
              {g.rows.map((r) => {
                const snip = rowSnip(r);
                return (
                  <SessionRow key={r.key} kind={rowKind(r)} state={r.state} title={cleanLine(r.title)} snip={snip.text} snipMono={snip.mono} when={timeAgo(r.when)} live={!!r.live} ask={r.ask}
                    onPress={() => (r.task ? router.push(`/task/${r.task.id}`) : r.threadId ? router.push(`/thread/${r.threadId}`) : undefined)} />
                );
              })}
            </View>
          ))}
          {sessions.ready && sessions.rows.length ? <SessionFoot shown={sessions.rows.length} hasMore={sessions.hasMore} onMore={sessions.loadMore} /> : null}
        </ScrollView>
        <ActivityStrip channelId={id} />
        <ComposerCard value={draft} onChange={setDraft} placeholder={channel ? `Message #${channel.slug}…` : 'Message…'} onSend={send} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
