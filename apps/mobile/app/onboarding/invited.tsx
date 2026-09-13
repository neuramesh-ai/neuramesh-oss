// INVITED (S6, D19): the first run with an invitation waiting. The join comes before any wizard —
// an invited newcomer has zero memberships, the exact signal that would otherwise open a wizard
// for a workspace they never meant to create. Joining is the accept command; on Team the join
// also mints the member's own cloud machine, and Home's join card names it and its sharing default.
import type { PendingInvite } from '@neuramesh/client-core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, currentUserId } from '../../src/auth';
import { PorchMark } from '../../src/brand';
import { Btn, Card } from '../../src/kit';
import { acceptInvite, errMsg } from '../../src/onboard';
import { useTheme } from '../../src/theme';
import { F, R } from '../../src/type';
import { useWorkspace } from '../../src/workspace';

export default function Invited() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setActive } = useWorkspace();
  const [invites, setInvites] = useState<PendingInvite[] | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const me = currentUserId();

  useEffect(() => {
    let alive = true;
    void api.myInvites().then((r) => { if (alive) setInvites(r.invites); }).catch(() => { if (alive) setInvites([]); });
    void import('../../src/auth').then((m) => m.loadSession()).then((s) => { if (alive) setEmail(s?.email ?? null); });
    return () => { alive = false; };
  }, []);

  async function join(inv: PendingInvite) {
    if (busy) return;
    setBusy(inv.inviteId);
    setErr('');
    try {
      const { workspaceId } = await acceptInvite(inv.inviteId);
      setActive(workspaceId);
      router.replace('/(tabs)');
    } catch (e) {
      setErr(errMsg(e));
      setBusy(null);
    }
  }

  const first = invites?.[0] ?? null;
  const host = first ? (first.inviterName?.trim() || first.inviterEmail?.split('@')[0] || 'Your team') : null;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingTop: insets.top + 18, paddingBottom: insets.bottom + 24 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 4 }}>
        <PorchMark size={18} />
        <Text style={{ ...F.body(600), fontSize: 17, color: t.text, letterSpacing: -0.3 }}>neuramesh</Text>
      </View>
      {invites === null ? <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} /> : !first ? (
        <View style={{ paddingHorizontal: 24, paddingTop: 30, alignItems: 'center' }}>
          <Text style={{ ...F.display(), fontSize: 22, letterSpacing: F.tight(22), color: t.text, textAlign: 'center' }}>That invitation has closed.</Text>
          <Btn kind="primary" label="Set up my own workspace" onPress={() => router.replace('/onboarding/wizard')} style={{ marginTop: 18, alignSelf: 'stretch' }} />
        </View>
      ) : (
        <>
          <Text style={{ ...F.display(), fontSize: 22, letterSpacing: F.tight(22), color: t.text, textAlign: 'center', paddingTop: 14, paddingHorizontal: 24 }}>{host} is expecting you</Text>
          <Text style={{ ...F.body(400), fontSize: 13.5, lineHeight: 20, color: t.muted, textAlign: 'center', paddingTop: 8, paddingHorizontal: 28 }}>
            This workspace has a team and a board already.
          </Text>
          {invites!.map((inv) => (
            <Card key={inv.inviteId} style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ width: 38, height: 38, borderRadius: R.md, backgroundColor: t.brand, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...F.mono(600), fontSize: 15, color: t.brandInk }}>{inv.workspaceName.slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ ...F.body(600), fontSize: 13.5, color: t.text }} numberOfLines={1}>{inv.workspaceName}</Text>
                <Text style={{ ...F.body(400), fontSize: 11.5, color: t.dim, marginTop: 2 }} numberOfLines={1}>{email ?? me ?? 'you'} · joining as {inv.role}</Text>
              </View>
              {invites!.length > 1 ? <Btn sm kind="primary" label={busy === inv.inviteId ? 'Please wait…' : 'Join'} onPress={() => void join(inv)} disabled={!!busy} /> : null}
            </Card>
          ))}
          <Text style={{ ...F.mono(500), fontSize: 10.5, lineHeight: 15, color: t.dim, textAlign: 'center', paddingHorizontal: 28, paddingTop: 4 }}>
            On the Team plan you get your own cloud machine. Your logins stay on it.
          </Text>
          {invites!.length === 1 ? (
            <Btn kind="primary" label={busy ? 'Please wait…' : `Join ${first.workspaceName}`} onPress={() => void join(first)} disabled={!!busy}
              icon={busy ? <ActivityIndicator color={t.brandInk} /> : undefined} style={{ marginTop: 16, marginHorizontal: 16 }} />
          ) : null}
          {err ? <Text style={{ ...F.body(400), fontSize: 12.5, color: t.warn, textAlign: 'center', paddingTop: 10, paddingHorizontal: 24 }}>{err}</Text> : null}
          <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim, textAlign: 'center', paddingVertical: 8 }}>or</Text>
          <Btn label="Set up my own workspace" onPress={() => router.replace('/onboarding/wizard')} style={{ marginHorizontal: 16 }} />
        </>
      )}
    </ScrollView>
  );
}
