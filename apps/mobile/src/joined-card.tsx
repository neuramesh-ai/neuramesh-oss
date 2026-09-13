// THE JOIN MOMENT (S6, D19): the card Home shows once after you accept an invitation. On Team the
// join minted your own cloud machine, and the card names it, its state, and its sharing default —
// the switch is the roster's compute grant (member.set_compute), the same one Compute draws. On a
// free workspace there is no machine to name, so the card says what is yours instead. Done
// dismisses it for good; Open Compute is the door to the rest.
import { MACHINES_WITH_KIND_FOR_WORKSPACE, MEMBERS_FOR_WORKSPACE } from '@neuramesh/client-core';
import { useQuery } from '@powersync/react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { api, currentUserId } from './auth';
import { useCompute } from './compute';
import { Btn, Card, Kicker } from './kit';
import { clearJoined, readJoined } from './onboard';
import { useTheme } from './theme';
import { F } from './type';
import { MachineTile } from './wizard-parts';
import { useWorkspace } from './workspace';

interface MachineRow { id: string; name: string; kind: string | null; owner_user_id: string | null; last_seen_at: string | null }
interface MemberRow { user_id: string; compute: string | null }

const sharesOf = (m: MemberRow | undefined): string[] => {
  try { return ((JSON.parse(m?.compute ?? '{}') as { shares?: string[] }).shares ?? []); } catch { return []; }
};

export function JoinedCard({ ws }: { ws: string | null }) {
  const t = useTheme();
  const router = useRouter();
  const me = currentUserId();
  const { workspaces } = useWorkspace();
  const compute = useCompute(ws);
  const [joined, setJoined] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { data: machines } = useQuery<MachineRow>(MACHINES_WITH_KIND_FOR_WORKSPACE, [ws ?? '']);
  const { data: members } = useQuery<MemberRow>(MEMBERS_FOR_WORKSPACE, [ws ?? '']);
  useEffect(() => { void readJoined().then(setJoined); }, [ws]);
  if (!ws || joined !== ws) return null;
  const name = workspaces.find((w) => w.id === ws)?.name ?? 'the workspace';
  const mine = (machines ?? []).find((m) => m.kind === 'member' && m.owner_user_id === me) ?? null;
  const st = mine ? compute.stateOf(mine.id) : null;
  const tone: 'on' | 'waking' | 'sleep' = st?.status === 'online' ? 'on' : st?.status === 'asleep' ? 'sleep' : 'waking';
  const sharing = sharesOf((members ?? []).find((m) => m.user_id === me)).includes('*');
  async function setSharing(on: boolean) {
    setSaving(true);
    try { await api.command({ type: 'member.set_compute', workspace: ws!, shares: on ? ['*'] : [] }); } catch { /* the roster row is the truth; it re-renders */ }
    finally { setSaving(false); }
  }
  const done = () => { void clearJoined(); setJoined(null); };
  return (
    <Card style={{ marginTop: 6 }}>
      <Kicker style={{ paddingHorizontal: 0, paddingTop: 0, paddingBottom: 2 }}>you joined {name}</Kicker>
      <Text style={{ ...F.display(), fontSize: 19, letterSpacing: F.tight(19), color: t.text }}>{mine ? `${name} gave you a machine` : 'You are in'}</Text>
      {mine ? (
        <>
          <MachineTile name={`${mine.name} · your cloud machine`} tone={tone} style={{ marginHorizontal: 0, marginTop: 8, padding: 10, backgroundColor: t.panel2, borderColor: t.border }}
            small={st ? st.reason : 'starts · your logins stay here'} />
          <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 18, color: t.muted, marginTop: 8 }}>
            The workspace can use your machine by default. Teammates&apos; tasks and routines then run on your subscription.
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 8 }}>
            <Text style={{ ...F.body(600), fontSize: 13, color: t.text, flex: 1 }}>Share my compute with the workspace</Text>
            <Switch value={sharing} onValueChange={(v) => void setSharing(v)} disabled={saving} trackColor={{ true: t.brand, false: t.panel3 }} />
          </View>
        </>
      ) : (
        <Text style={{ ...F.body(400), fontSize: 12.5, lineHeight: 18, color: t.muted, marginTop: 6 }}>
          You can read the rooms and the board, and ask the crew. The work runs on the workspace machines.
        </Text>
      )}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <Btn sm label="Open Compute" onPress={() => router.push('/compute')} />
        <Btn sm kind="primary" label="Done" onPress={done} />
      </View>
    </Card>
  );
}
