import { THEME_LABELS } from '@neuramesh/client-core';
import Constants from 'expo-constants';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { loadSession, signOut } from '../src/auth';
import { unregisterPush } from '../src/push';
import { disconnect } from '../src/system';
import { type ThemeChoice, useTheme, useThemeChoice } from '../src/theme';
import { useWorkspace } from '../src/workspace';
import { F, R } from '../src/type';

const THEME_OPTIONS: Array<{ key: ThemeChoice; label: string }> = [
  { key: 'system', label: 'Match system' },
  { key: 'dark', label: THEME_LABELS.dark },
  { key: 'light', label: THEME_LABELS.light },
  { key: 'soft-dark', label: THEME_LABELS['soft-dark'] },
  { key: 'cream-oak', label: THEME_LABELS['cream-oak'] },
];

const NOTIF: Array<{ key: 'questions' | 'gates' | 'blocked'; label: string }> = [
  { key: 'questions', label: 'Questions from agents' },
  { key: 'gates', label: 'Review + accept gates' },
  { key: 'blocked', label: 'Blocked tasks' },
];

export default function Settings() {
  const t = useTheme();
  const router = useRouter();
  const { choice, setChoice } = useThemeChoice();
  const { active, workspaces, setActive } = useWorkspace();
  const [notif, setNotif] = useState({ questions: true, gates: true, blocked: false });
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    void loadSession().then((s) => setEmail(s?.email ?? null));
  }, []);
  const initials = (email?.trim()?.[0] ?? 'G').toUpperCase();
  const version = `NeuraMesh ${Constants.expoConfig?.version ?? '0.1.0'} · dev`;

  async function onSignOut() {
    await unregisterPush().catch(() => {});
    await disconnect().catch(() => {});
    await signOut();
    router.replace('/sign-in');
  }

  const sect = {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    fontSize: 11,
    ...F.mono(500),
    letterSpacing: F.track,
    textTransform: 'uppercase' as const,
    color: t.dim,
  };
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: t.border, borderBottomWidth: 1 };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: true, title: 'Settings', headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text }} />

      {/* Workspaces (0113). Absent at a single membership — a switcher nobody needs should not
          be visible. Switching is INSTANT here: the phone has no agent host and no machine
          registration to rebind, and both workspaces already stream into the one replica, so
          this is a scope change rather than the desktop's relaunch. */}
      {workspaces.length > 1 && (
        <>
          <Text style={sect}>Workspaces</Text>
          {workspaces.map((w) => (
            <Pressable key={w.id} onPress={() => setActive(w.id)} style={row} accessibilityRole="button"
              accessibilityState={{ selected: w.id === active }}>
              <View style={{ width: 26, height: 26, borderRadius: R.md, backgroundColor: w.id === active ? t.accent : t.panel3, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                <Text style={{ color: w.id === active ? t.accentInk : t.body, fontSize: 12, ...F.mono(600) }}>{(w.name?.[0] ?? '?').toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 13, ...F.body(600) }}>{w.name}</Text>
                {w.role ? <Text style={{ color: t.muted, fontSize: 11.5, marginTop: 1 }}>{w.role}{w.memberCount ? ` · ${w.memberCount} member${w.memberCount === 1 ? '' : 's'}` : ''}</Text> : null}
              </View>
              {w.id === active ? <Text style={{ color: t.accent, fontSize: 15 }}>✓</Text> : null}
            </Pressable>
          ))}
        </>
      )}

      <Text style={sect}>Theme</Text>
      {THEME_OPTIONS.map((o) => (
        <Pressable key={o.key} onPress={() => setChoice(o.key)} style={row}>
          <Text style={{ color: t.text, fontSize: 13, flex: 1 }}>{o.label}</Text>
          {choice === o.key ? <Text style={{ color: t.accent, fontSize: 15 }}>✓</Text> : null}
        </Pressable>
      ))}

      <Text style={sect}>Notifications</Text>
      {NOTIF.map((n) => (
        <View key={n.key} style={row}>
          <Text style={{ color: t.text, fontSize: 13, flex: 1 }}>{n.label}</Text>
          <Switch value={notif[n.key]} onValueChange={(v) => setNotif((prev) => ({ ...prev, [n.key]: v }))} trackColor={{ true: t.accent, false: t.panel3 }} />
        </View>
      ))}

      <Text style={sect}>Account</Text>
      <View style={row}>
        <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: t.accentSoft, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
          <Text style={{ color: t.accent, fontSize: 13, ...F.mono(600) }}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: t.text, fontSize: 13, ...F.body(600) }}>Signed in</Text>
          {email ? <Text style={{ color: t.muted, fontSize: 11.5, marginTop: 1 }}>{email}</Text> : null}
        </View>
      </View>
      <Pressable onPress={onSignOut} style={row}>
        <Text style={{ color: t.blocked, fontSize: 13, ...F.body(600) }}>Sign out</Text>
      </Pressable>
      <Text style={{ color: t.dim, fontSize: 11, ...F.mono(400), paddingHorizontal: 16, paddingTop: 18 }}>{version}</Text>
    </ScrollView>
  );
}
