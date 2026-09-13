import { CHANNEL_PICKER_FOR_WORKSPACE } from '@neuramesh/client-core';
import { useQuery } from '@powersync/react-native';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { api } from '../src/auth';
import { useTheme } from '../src/theme';
import { useActiveWorkspace } from '../src/ui';
import { F, R } from '../src/type';
import { inputStyle, labelText, Btn } from '../src/kit';

// Park a backlog idea from anywhere (the Home FAB). task.create backlog:true — it
// waits in the backlog column until a human/orchestrator promotes it; no agent can
// pick it up. The one creation path open to a phone.
export default function Capture() {
  const t = useTheme();
  const router = useRouter();
  const ws = useActiveWorkspace();
  // scoped (0113): unscoped, this offered rooms from EVERY workspace you belong to while the
  // create below posts to `ws` — so picking one of them filed the idea into a workspace whose
  // channel it named, or failed outright
  const { data: channels } = useQuery<{ id: string; slug: string }>(CHANNEL_PICKER_FOR_WORKSPACE, [ws ?? '']);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = slug ?? channels?.[0]?.slug ?? null;

  async function submit() {
    if (!title.trim() || !ws || !chosen) return;
    setBusy(true);
    setError(null);
    try {
      await api.command({ type: 'task.create', workspace: ws, channel: chosen, title: title.trim(), backlog: true });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add this to the backlog.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: 16 }}>
      <Stack.Screen options={{ headerShown: true, title: 'Park an idea', headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text }} />
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Alert me when an agent uses too many tokens"
        placeholderTextColor={t.dim}
        multiline
        style={{ ...inputStyle(t), minHeight: 70 }}
      />
      <Text style={{ ...labelText(t, 11), marginTop: 14, marginBottom: 6 }}>Channel</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {(channels ?? []).map((c) => (
          <Pressable
            key={c.id}
            onPress={() => setSlug(c.slug)}
            style={{ paddingHorizontal: 11, paddingVertical: 5, borderRadius: R.pill, borderWidth: 1, borderColor: chosen === c.slug ? t.accent : t.border2, backgroundColor: chosen === c.slug ? `${t.accent}1e` : t.panel2 }}
          >
            <Text style={{ ...F.mono(500), color: chosen === c.slug ? t.text : t.muted, fontSize: 12, letterSpacing: F.tight(12) }}>#{c.slug}</Text>
          </Pressable>
        ))}
      </View>
      <Btn kind="primary" label={busy ? 'Please wait…' : 'Add to backlog'} disabled={busy || !title.trim()} onPress={submit} style={{ marginTop: 18 }} />
      {error ? <Text style={{ color: t.blocked, fontSize: 12, marginTop: 10 }}>{error}</Text> : null}
      <Text style={{ color: t.dim, fontSize: 11, marginTop: 12, textAlign: 'center' }}>It waits in the backlog until you promote it. No agent can start it.</Text>
    </ScrollView>
  );
}
