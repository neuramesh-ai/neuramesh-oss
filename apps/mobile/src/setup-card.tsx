// THE SETUP CARD (S6, D18): what is left to set up, pinned where the room brief lives on Home and
// folding to a pill. The items are the shared `onboardingItems` minus the mobile one (you are
// holding it); every signal is a row the replica has or a read the API answers, and a lane that
// cannot be read stays UNKNOWN — an ask, never a tick. It retires itself once every item is done.
import { MACHINES_WITH_KIND_FOR_WORKSPACE, MEMBERS_FOR_WORKSPACE } from '@neuramesh/client-core';
import { onboardingComplete, onboardingItems, onboardingKnowable, type OnboardingCredential, type OnboardingItem } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { api, currentUserId } from './auth';
import { WEB_URL } from './config';
import { Icon } from './icon';
import { Btn, Card, inputStyle } from './kit';
import { errMsg } from './onboard';
import { useTheme } from './theme';
import { F, R } from './type';
import { useWorkspace } from './workspace';

const VERB: Record<OnboardingItem['action'], string> = { none: '', 'connect-brain': 'Connect', invite: 'Invite', 'get-desktop': 'Get', 'get-mobile': '' };

export function SetupCard({ ws }: { ws: string | null }) {
  const t = useTheme();
  const router = useRouter();
  const { workspaces } = useWorkspace();
  const { data: machines, isLoading: machinesLoading } = useQuery<{ id: string; name: string; kind: string | null; owner_user_id: string | null }>(MACHINES_WITH_KIND_FOR_WORKSPACE, [ws ?? '']);
  const { data: members, isLoading: membersLoading } = useQuery<{ user_id: string }>(MEMBERS_FOR_WORKSPACE, [ws ?? '']);
  const [credentials, setCredentials] = useState<OnboardingCredential[] | null>(null);
  const [fold, setFold] = useState<boolean | null>(null);
  const [inviting, setInviting] = useState(false);
  useEffect(() => {
    if (!ws) return;
    let alive = true;
    setCredentials(null);
    void api.credentials(ws).then((r) => { if (alive) setCredentials(r.credentials); }).catch(() => { /* unknown stays unknown */ });
    return () => { alive = false; };
  }, [ws]);
  const items = useMemo(() => onboardingItems({
    machines: machinesLoading ? null : (machines ?? []),
    members: membersLoading ? null : (members ?? []),
    credentials,
    devices: null,
  }).filter((i) => i.id !== 'mobile'), [machines, machinesLoading, members, membersLoading, credentials]);
  if (!ws || !onboardingKnowable(items) || onboardingComplete(items)) return null;
  const done = items.filter((i) => i.done === true).length;
  // FOLDED UNLESS YOU HAVE NEVER STARTED (George, 2026-09-07: "collapsed by default except first
  // login users"). The signal is the items you can ACT on: `machine` is true the moment a workspace
  // exists, so counting it would fold the card for everybody on their very first screen. Nobody
  // stores a "seen it" flag — a person who has done none of the asks has not started, and that is
  // the one time this list is the point of the screen. It is derived rather than a useState seed
  // because the items arrive async: every `done` is null on the first render, so a seed would latch
  // "not started" for the whole session and hold the card open for everyone.
  const folded = fold ?? items.some((i) => i.action !== 'none' && i.done === true);
  const name = workspaces.find((w) => w.id === ws)?.name ?? 'your workspace';
  // the subscription is signed in on YOUR machine, through its terminal (S8): the member machine when
  // you have one, else the workspace's runner; Compute is the door when neither has synced yet
  const me = currentUserId();
  const own = (machines ?? []).find((m) => m.kind === 'member' && m.owner_user_id === me) ?? (machines ?? []).find((m) => m.kind === 'runner') ?? null;
  const act = (item: OnboardingItem) => {
    if (item.action === 'connect-brain') { if (own) router.push({ pathname: '/terminal', params: { machine: own.id, name: own.name } }); else router.push('/compute'); }
    else if (item.action === 'invite') setInviting(true);
    else if (item.action === 'get-desktop') void WebBrowser.openBrowserAsync(`${WEB_URL}/downloads`).catch(() => {});
  };
  const head = (
    <Pressable onPress={() => setFold(!folded)} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={{ ...F.body(600), fontSize: 13.5, color: t.text, flex: 1 }} numberOfLines={1}>Set up {name}</Text>
      <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim }}>{done} / {items.length}</Text>
      <View style={{ transform: [{ rotate: folded ? '0deg' : '90deg' }] }}><Icon name="chevron" size={13} color={t.dim} /></View>
    </Pressable>
  );
  if (folded) return <Card style={{ marginTop: 6, paddingVertical: 9 }}>{head}</Card>;
  return (
    <Card style={{ marginTop: 6 }}>
      {head}
      <View style={{ marginTop: 6 }}>
        {items.map((item) => (
          <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: t.border }}>
            <View style={{ width: 16, height: 16, borderRadius: R.pill, borderWidth: 1, borderColor: item.done ? t.green : t.border2, backgroundColor: item.done ? `${t.green}29` : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {item.done ? <Icon name="check" size={11} color={t.green} /> : null}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ ...F.body(item.done ? 400 : 500), fontSize: 12.5, color: item.done ? t.muted : t.text }} numberOfLines={1}>{item.label}</Text>
              {!item.done ? <Text style={{ ...F.body(400), fontSize: 11, lineHeight: 15, color: t.dim, marginTop: 1 }} numberOfLines={2}>{item.detail}</Text> : null}
            </View>
            {!item.done && VERB[item.action] ? <Btn sm label={VERB[item.action]} onPress={() => act(item)} /> : null}
          </View>
        ))}
      </View>
      <InviteSheet ws={ws} open={inviting} onClose={() => setInviting(false)} />
    </Card>
  );
}

/** the invitation as a sheet: one address, the command, the server's answer verbatim (a free
 *  workspace's seat cap included — D17: the plan said out loud, never hidden behind a disabled button) */
function InviteSheet({ ws, open, onClose }: { ws: string; open: boolean; onClose: () => void }) {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function send() {
    const addr = email.trim().toLowerCase();
    if (!addr || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await api.command({ type: 'workspace.invite', workspace: ws, email: addr });
      setNote({ ok: true, text: `NeuraMesh sent an invitation to ${addr}.` });
      setEmail('');
    } catch (e) {
      setNote({ ok: false, text: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ backgroundColor: t.overlay, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, borderTopWidth: 1, borderColor: t.border, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 34 }}>
          <View style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: t.border2, marginBottom: 12 }} />
          <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim }}>Invite your team</Text>
          <Text style={{ ...F.display(), fontSize: 20, letterSpacing: F.tight(20), color: t.text, marginTop: 4 }}>Who works here with you?</Text>
          <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 18, color: t.muted, marginTop: 4 }}>On the Team plan each member gets a cloud machine.</Text>
          <TextInput value={email} onChangeText={setEmail} placeholder="teammate@company.com" placeholderTextColor={t.dim} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoFocus
            style={{ ...inputStyle(t), marginTop: 12 }} />
          {note ? <Text style={{ ...F.body(400), fontSize: 12, lineHeight: 17, color: note.ok ? t.green : t.warn, marginTop: 8 }}>{note.text}</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <Btn label="Done" onPress={onClose} />
            <Btn kind="primary" label={busy ? 'Please wait…' : 'Send invite'} onPress={() => void send()} disabled={busy || !email.trim()} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
