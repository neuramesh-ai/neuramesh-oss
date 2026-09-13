import type { HumanCommandInput } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Dimensions, ScrollView, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from '../../../src/auth';
import { OfflineBanner } from '../../../src/connection';
import { useTheme } from '../../../src/theme';
import { F, R } from '../../../src/type';
import { inputStyle, Btn } from '../../../src/kit';

interface Artifact {
  id: string;
  kind: string;
  name: string;
  inline_content: string;
  created_at: string;
}

function roundOf(name: string): number {
  const g = /design-mockup-v(\d+)-/.exec(name)?.[1];
  return g ? Number(g) : 0;
}

// The design gate — approve_design is HUMAN-only, and the phone satisfies it. The
// mockups are self-contained HTML (artifact.inline_content) rendered in a sandboxed
// WebView with external navigation blocked (parity with the desktop's iframe).
export default function DesignReview() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: artifacts } = useQuery<Artifact>(
    "select id, kind, name, inline_content, created_at from artifacts where task_id = ? and kind = 'design' order by created_at",
    [id],
  );
  const [busy, setBusy] = useState(false);
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  // Measured height of the pager area. A flex WebView nested in a horizontal paging
  // ScrollView lands a 0-height frame on iOS and never paints — so we give each page
  // a concrete height instead of relying on the flex chain through the scroller.
  const [pagerH, setPagerH] = useState(0);

  const designs = artifacts ?? [];
  const latestRound = designs.reduce((mx, a) => Math.max(mx, roundOf(a.name)), 0);
  const round = designs.filter((a) => roundOf(a.name) === latestRound && a.inline_content);
  const width = Dimensions.get('window').width;

  async function run(cmd: HumanCommandInput) {
    setBusy(true);
    setError(null);
    try {
      await api.command(cmd);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'action failed');
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: true, title: 'Design review', headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text }} />
      <OfflineBanner />
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 }}>
        <Text style={{ color: t.dim, fontSize: 12 }}>
          Round {latestRound} · {round.length} mockup{round.length === 1 ? '' : 's'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 4, marginLeft: 'auto' }}>
          {round.map((a, i) => (
            <View key={a.id} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === page ? t.accent : t.border2 }} />
          ))}
        </View>
      </View>

      <View style={{ flex: 1 }} onLayout={(e) => setPagerH(e.nativeEvent.layout.height)}>
        {round.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: t.muted }}>No design round yet</Text>
          </View>
        ) : pagerH > 0 ? (
          <ScrollPager width={width} onPage={setPage}>
            {round.map((a) => (
              <View key={a.id} style={{ width, height: pagerH, padding: 12 }}>
                <View style={{ flex: 1, borderRadius: R.lg, overflow: 'hidden', borderWidth: 1, borderColor: t.border2, backgroundColor: '#ffffff' }}>
                  <WebView
                    originWhitelist={['*']}
                    source={{ html: a.inline_content }}
                    onShouldStartLoadWithRequest={(req) => !/^https?:/i.test(req.url)}
                    style={{ flex: 1 }}
                  />
                </View>
                <Text style={{ color: t.dim, fontSize: 10, marginTop: 6, ...F.mono(400) }} numberOfLines={1}>
                  {a.name}
                </Text>
              </View>
            ))}
          </ScrollPager>
        ) : null}
      </View>

      {error ? <Text style={{ color: t.blocked, fontSize: 12, paddingHorizontal: 12 }}>{error}</Text> : null}
      {revising ? (
        <View style={{ padding: 12, borderTopColor: t.border, borderTopWidth: 1 }}>
          <TextInput
            value={feedback}
            onChangeText={setFeedback}
            placeholder="What should change?"
            placeholderTextColor={t.dim}
            multiline
            style={{ ...inputStyle(t), minHeight: 56 }}
          />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <Btn label="Cancel" onPress={() => setRevising(false)} style={{ flex: 1 }} />
            <Btn kind="primary" label="Send changes" disabled={busy || !feedback.trim()} onPress={() => run({ type: 'task.revise_design', taskId: id, feedback: feedback.trim() })} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopColor: t.border, borderTopWidth: 1 }}>
          <Btn kind="primary" label="Approve design" disabled={busy} onPress={() => run({ type: 'task.approve_design', taskId: id })} style={{ flex: 1 }} />
          <Btn label="Request changes" disabled={busy} onPress={() => setRevising(true)} style={{ flex: 1 }} />
        </View>
      )}
    </View>
  );
}

// A paged horizontal scroller that reports the current page.
function ScrollPager({ width, onPage, children }: { width: number; onPage: (p: number) => void; children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={(e) => onPage(Math.round(e.nativeEvent.contentOffset.x / width))}
      style={{ flex: 1 }}
    >
      {children}
    </ScrollView>
  );
}
