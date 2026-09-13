// ONE SCHEDULED ITEM, ON ITS OWN SCREEN (George, 2026-09-07: a push 30 minutes before a post lands,
// "incase i want to review it before it goes out").
//
// A notification needs somewhere to land, and Home's band needs somewhere to send you. Both wanted
// the post sheet, which until now could only be opened from inside the Calendar. So this is that
// sheet with a route in front of it — the same component, the same commands, the same edit and
// reschedule. Nothing about a post is reimplemented here.
//
// Closing goes BACK where you came from, and falls to Home when there is no back: a push opens the
// app cold, and a Close that led nowhere would strand you on an empty stack.
import { CONTENT_ITEMS_FOR_CALENDAR } from '@neuramesh/client-core';
import { useQuery } from '@powersync/react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { Btn } from '../../src/kit';
import { type PostItem } from '../../src/post-item';
import { PostSheet } from '../../src/post-sheet';
import { useTheme } from '../../src/theme';
import { F } from '../../src/type';
import { useActiveWorkspace } from '../../src/ui';

export default function PostScreen() {
  const t = useTheme();
  const router = useRouter();
  const ws = useActiveWorkspace();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: posts } = useQuery<PostItem>(CONTENT_ITEMS_FOR_CALENDAR, [ws ?? '']);
  const { data: rooms } = useQuery<{ id: string; slug: string }>('select id, slug from channels where workspace_id = ?', [ws ?? '']);
  const item = (posts ?? []).find((p) => p.id === id) ?? null;
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  // TRANSPARENT UNDER THE SHEET (George, 2026-09-07). A sheet is a sheet: whatever you came from
  // belongs behind it. An opaque screen under a modal is a blank page wearing a scrim, which is what
  // a push notification used to land on. The two fallbacks below are whole screens, so they keep a
  // ground of their own.
  const showing = posts !== undefined && item && ws;
  return (
    <View style={{ flex: 1, backgroundColor: showing ? 'transparent' : t.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* posts is undefined while the query runs and [] once it has answered — telling those apart
          is the difference between a spinner and an honest "this is gone" */}
      {posts === undefined ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.accent} /></View>
      ) : item && ws ? (
        <PostSheet workspace={ws} item={item} roomSlug={(rooms ?? []).find((c) => c.id === item.channel_id)?.slug ?? ''}
          onClose={leave} onOpenThread={(tid) => router.replace(`/thread/${tid}`)} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
          <Text style={{ ...F.body(600), fontSize: 14.5, color: t.text }}>This post is gone.</Text>
          <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, marginTop: 6, textAlign: 'center' }}>
            Somebody published it or removed it. The calendar shows what is left.
          </Text>
          {/* A WAY OUT. This branch is a whole screen with no sheet under it, so it carried no
              control at all and stranded the reader — the route is a transparent modal, which does
              not swipe away (found on the simulator, 2026-09-08). */}
          <View style={{ marginTop: 16 }}><Btn label="Close" onPress={leave} /></View>
        </View>
      )}
    </View>
  );
}
