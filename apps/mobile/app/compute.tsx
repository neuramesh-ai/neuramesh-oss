// COMPUTE — this member's machine, the credits, the runner, the teammates' machines, the sharing
// switch (the mobile-cloud round, D11; the member-machines round §6 at phone scale). Reached from
// the head's pill and ring. Every state word comes from machineState() through the compute store;
// every grant from the roster's compute prefs (0119); nothing here derives a second opinion.
//
// Individual collapses to one card: the runner IS your machine. Team draws your member machine,
// the runner (keys + the starter brain), and the teammates' machines with owner · state · grant.
// "Wake now" is offered only where it can succeed (asleep or unreachable, and yours or lent).
// No purchase link anywhere (App Store 3.1.1 — credits and Team are bought on the web).
import { MACHINES_WITH_KIND_FOR_WORKSPACE, MEMBERS_FOR_WORKSPACE } from '@neuramesh/client-core';
import { machineAvailableTo, machineOnline, nextRefillOn } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { api, currentUserId } from '../src/auth';
import { fmtDur, refreshCompute, useCompute } from '../src/compute';
import { ensureCodeMachine } from '../src/relay';
import { Icon } from '../src/icon';
import { Btn, Card, Facts, Kicker, Kind, Reason, Ring, Tile } from '../src/kit';
import { useTheme } from '../src/theme';
import { F } from '../src/type';
import { timeAgo, useActiveWorkspace } from '../src/ui';

interface MachineRow { id: string; name: string; platform: string; last_seen_at: string | null; kind: string | null; owner_user_id: string | null; runtimes: string | null }
interface MemberRow { user_id: string; role: string; display_name: string | null; compute: string | null }
interface AgentRow { id: string; name: string; role: string; status: string; machine_id: string | null; emoji: string | null }

const sharesOf = (m: MemberRow | undefined): string[] => {
  try { return ((JSON.parse(m?.compute ?? '{}') as { shares?: string[] }).shares ?? []); } catch { return []; }
};
const runtimesOf = (m: MachineRow): string[] => { try { return JSON.parse(m.runtimes ?? '[]') as string[]; } catch { return []; } };
const toneOf = (status: string | null | undefined): 'on' | 'waking' | 'sleep' | 'off' | 'warn' =>
  status === 'online' ? 'on' : status === 'waking' ? 'waking' : status === 'asleep' ? 'sleep' : status === 'capped' || status === 'no_credits' || status === 'unreachable' ? 'warn' : 'off';

export default function Compute() {
  const t = useTheme();
  const router = useRouter();
  const ws = useActiveWorkspace();
  const me = currentUserId();
  const compute = useCompute(ws);
  const { data: machines } = useQuery<MachineRow>(MACHINES_WITH_KIND_FOR_WORKSPACE, [ws ?? '']);
  const { data: members } = useQuery<MemberRow>(MEMBERS_FOR_WORKSPACE, [ws ?? '']);
  const { data: agents } = useQuery<AgentRow>('select id, name, role, status, machine_id, emoji from agents where workspace_id = ? and retired_at is null order by name', [ws ?? '']);
  const [waking, setWaking] = useState<string | null>(null);
  // what the boot is doing, so a 146-second cold start is not a button that flickers and gives up
  const [wakeNote, setWakeNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // which card the last wake belongs to, so its verdict cannot land on a different machine
  const wakeTarget = useRef<string | null>(null);
  // A person who leaves the screen cancels their WAIT, never the machine (the ensure contract).
  // It is ARMED ON MOUNT, not only cleared on unmount: React mounts an effect, tears it down and
  // mounts it again in development, so a cleanup-only ref latches true while the screen is still on
  // screen — the wait then cancelled on its first poll and the button never came back.
  const gone = useRef(false);
  useEffect(() => { gone.current = false; return () => { gone.current = true; }; }, []);
  const now = Date.now();
  const rows = machines ?? [];
  const team = compute.usage?.plan === 'cloud';
  const mine = rows.find((m) => m.kind === 'member' && m.owner_user_id === me) ?? null;
  const runner = rows.find((m) => m.kind === 'runner') ?? null;
  const yours = mine ?? runner; // Individual: the runner IS your machine
  // your own desktops are yours, not a teammate's — the roster's "shared with you" line would be
  // nonsense on a machine you own (George's dev DB has nine of them)
  const others = rows.filter((m) => m.id !== yours?.id && m.id !== runner?.id && m.kind !== 'runner' && m.owner_user_id !== me);
  // a row born before 0126 has no kind — it is a laptop, the only kind there was
  const desktops = rows.filter((m) => m.id !== yours?.id && m.kind !== 'member' && m.kind !== 'runner' && m.owner_user_id === me);
  const self = (members ?? []).find((m) => m.user_id === me);
  const sharing = sharesOf(self).includes('*');
  const nameOf = (userId: string | null): string => (members ?? []).find((m) => m.user_id === userId)?.display_name?.trim() || (userId === me ? 'you' : 'a teammate');
  const lentToMe = (m: MachineRow): boolean => machineAvailableTo({ machineId: m.id, ownerUserId: m.owner_user_id ?? '', runtimes: [], lastSeenAt: m.last_seen_at, sharesWith: sharesOf((members ?? []).find((x) => x.user_id === m.owner_user_id)) }, me);
  const serving = (m: MachineRow) => (agents ?? []).filter((a) => a.machine_id === m.id);
  const credits = compute.credits;

  // WAKE NOW WAITS FOR THE MACHINE (George, 2026-09-06: "i noticed the machine shows amber and shows
  // its not awake… should the auto reconnect restart the machine if its sleeping, and stream in
  // status as the machine becomes ready").
  //
  // It used to POST the wake, refresh once and let go. A cloud cold start measures ~146 seconds, so
  // that refresh always landed on a machine that had not booted yet: the button flicked to "Please
  // wait…" for a moment and the card stayed amber, which reads exactly like a wake that did nothing.
  // The terminal already waits properly through the shared ensure, phases and all. This is the same
  // call, so one machine can never have two boot stories.
  async function wake(machineId: string) {
    wakeTarget.current = machineId;
    setWaking(machineId);
    setWakeNote('It starts now. Please wait…');
    try {
      const out = await ensureCodeMachine(ws!, machineId, (p) => setWakeNote(p === 'starting' ? 'It starts now. Please wait…' : 'It answers now.'), () => gone.current);
      setWakeNote(out.ok ? null : out.detail || null);
    } catch {
      setWakeNote('The machine did not start. Try again.');
    } finally {
      await refreshCompute();
      if (!gone.current) setWaking(null);
    }
  }
  async function setSharing(on: boolean) {
    setSaving(true);
    try { await api.command({ type: 'member.set_compute', workspace: ws!, shares: on ? ['*'] : [] }); } catch { /* the roster row is the truth; it re-renders */ }
    finally { setSaving(false); }
  }

  /** a cloud machine's card: name · kind · the reason line · the facts · who it serves · its one action */
  const machineCard = (m: MachineRow, label: string, kind: string, canWake: boolean) => {
    const st = compute.stateOf(m.id, m.last_seen_at);
    const status = st?.status ?? (machineOnline({ machineId: m.id, ownerUserId: '', runtimes: [], lastSeenAt: m.last_seen_at }, now) ? 'online' : null);
    const reason = st?.reason ?? (status === 'online' ? 'Awake and ready for your agents.' : 'The fleet has not answered yet.');
    const i = st?.intent;
    const up = i?.startedAt && status === 'online' ? `up ${fmtDur(now - Date.parse(i.startedAt))}` : null;
    const idle = i?.idleStopMin ? `sleeps after ${Math.round(i.idleStopMin / 60)}h idle` : i?.idleStopMin === null ? 'never auto-sleeps' : null;
    const facts = [up, m.last_seen_at ? `seen ${timeAgo(m.last_seen_at)}` : null, i?.lastActiveAt ? `worked ${timeAgo(i.lastActiveAt)}` : null, idle].filter(Boolean).join(' · ');
    const busy = serving(m);
    const logins = runtimesOf(m);
    return (
      <Card key={m.id}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Icon name={m.kind === 'local' ? 'machine' : 'cloudMachine'} size={18} color={t.body} />
          <Text style={{ ...F.body(600), fontSize: 13.5, color: t.text, flex: 1 }} numberOfLines={1}>{label}</Text>
          <Kind>{kind}</Kind>
        </View>
        {/* while WE are the ones waiting, the mark follows the words: ensureCodeMachine polls the
            fleet on its own 4s clock, so the store's 60s snapshot would leave a moon beside "It
            starts now" for most of the boot. */}
        <Reason tone={waking === m.id ? 'waking' : toneOf(status)}>{waking === m.id && wakeNote ? wakeNote : reason}</Reason>
        {facts ? <Facts>{facts}</Facts> : null}
        {/* a wake that failed keeps its words until the next attempt — the card must not go quiet */}
        {waking !== m.id && wakeNote && wakeTarget.current === m.id ? <Facts style={{ color: t.warn }}>{wakeNote}</Facts> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          {busy.length ? <View style={{ flexDirection: 'row' }}>{busy.slice(0, 4).map((a, n) => <View key={a.id} style={{ marginLeft: n ? -4 : 0 }}><Tile label={a.name} size={20} round={false} /></View>)}</View> : null}
          <Text style={{ ...F.body(400), fontSize: 12, color: t.muted, flex: 1 }} numberOfLines={1}>
            {busy.length ? `${busy.length} agent${busy.length === 1 ? '' : 's'} here` : 'no agents seated here'}{logins.length ? ` · ${logins.join(' · ')} signed in` : ''}
          </Text>
        </View>
        {/* the terminal (S8) is a door on YOUR machine only — a shell is the owner's, never a teammate's */}
        {(canWake && (status === 'asleep' || status === 'unreachable')) || m.id === yours?.id ? (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {canWake && (status === 'asleep' || status === 'unreachable') ? <Btn label={waking === m.id ? 'Please wait…' : 'Wake now'} sm disabled={waking === m.id} onPress={() => void wake(m.id)} /> : null}
            {m.id === yours?.id ? <Btn label="Terminal" sm icon={<Icon name="term" size={12} color={t.text} />} onPress={() => router.push({ pathname: '/terminal', params: { machine: m.id, name: m.name } })} /> : null}
          </View>
        ) : null}
      </Card>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Stack.Screen options={{ headerShown: true, title: 'Compute', headerStyle: { backgroundColor: t.bg }, headerTintColor: t.text, headerTitleStyle: { ...F.body(600) } }} />
      <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 40 }}>
        <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingBottom: 8 }}>
          <Kind>{team ? `Team · ${(members ?? []).length} members` : 'Individual · one person'}</Kind>
          <Kind>{`${(agents ?? []).length} agents`}</Kind>
        </View>

        {yours
          ? machineCard(yours, yours.name, mine ? 'your cloud machine' : team ? 'cloud' : 'your machine', true)
          : <Card><Text style={{ ...F.display(), fontSize: 17, letterSpacing: F.tight(17), color: t.text }}>No cloud machine yet.</Text><Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, marginTop: 4 }}>Your first message starts one.</Text></Card>}

        {credits ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ring frac={credits.credits.granted > 0 ? credits.credits.remaining / credits.credits.granted : 0} size={40} />
              <Text style={{ ...F.display(), fontSize: 26, letterSpacing: F.tight(26), color: t.text }}>{Math.max(0, credits.credits.remaining).toLocaleString()} <Text style={{ ...F.body(500), fontSize: 12.5, color: t.muted }}>credits left</Text></Text>
            </View>
            {[
              ['Brain', `${Math.max(0, credits.credits.granted - credits.credits.remaining).toLocaleString()} used`],
              ['Machine', credits.machine.activeSecondsToday >= 3600 ? `${(credits.machine.activeSecondsToday / 3600).toFixed(1)}h worked today` : `${Math.round(credits.machine.activeSecondsToday / 60)} min worked today`],
              ['Storage', `${credits.storage.gb} GB included`],
            ].map(([k, v]) => (
              <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, marginTop: 2 }}>
                <Text style={{ ...F.body(400), fontSize: 12.5, color: t.body }}>{k}</Text>
                <Text style={{ ...F.mono(500), fontSize: 11.5, color: t.muted }}>{v}</Text>
              </View>
            ))}
            {(() => { const on = nextRefillOn(credits.credits.periodStart, new Date()); return <Facts>{on && credits.credits.monthlyGrant > 0 ? `Refills to ${credits.credits.monthlyGrant.toLocaleString()} on ${on.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })} · ` : ''}connect your own brain to stop the credit use</Facts>; })()}
          </Card>
        ) : null}

        {mine && runner ? machineCard(runner, 'Cloud', 'cloud', true) : null}

        {team && me ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ ...F.body(600), fontSize: 13, color: t.text }}>Share my compute with the workspace</Text>
                <Text style={{ ...F.body(400), fontSize: 11.5, color: t.dim, marginTop: 2 }}>Teammates’ requests, tasks and routines may run on your machine, on your subscription.</Text>
              </View>
              <Switch value={sharing} disabled={saving} onValueChange={(v) => void setSharing(v)} trackColor={{ true: t.brand, false: t.panel3 }} thumbColor={t.brandInk} />
            </View>
          </Card>
        ) : null}

        {desktops.length ? (
          <>
            <Kicker>Your desktops</Kicker>
            {desktops.map((m) => {
              const on = machineOnline({ machineId: m.id, ownerUserId: '', runtimes: [], lastSeenAt: m.last_seen_at }, now);
              return (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 9 }}>
                  <Icon name="machine" size={15} color={t.body} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ ...F.body(500), fontSize: 13, color: t.text }} numberOfLines={1}>{m.name}</Text>
                    <Text style={{ ...F.body(400), fontSize: 11, color: t.dim }}>{m.platform || 'desktop'}{m.last_seen_at ? ` · seen ${timeAgo(m.last_seen_at)}` : ''}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: on ? t.green : t.muted }}>{on ? '●' : '○'}</Text>
                </View>
              );
            })}
          </>
        ) : null}

        {others.length ? (
          <>
            <Kicker>Teammates’ machines</Kicker>
            {others.map((m) => {
              const st = compute.stateOf(m.id, m.last_seen_at);
              const status = st?.status ?? (machineOnline({ machineId: m.id, ownerUserId: '', runtimes: [], lastSeenAt: m.last_seen_at }, now) ? 'online' : 'offline');
              const lent = lentToMe(m);
              const cloud = m.kind === 'member';
              return (
                <View key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 9 }}>
                  <Icon name={cloud ? 'cloud' : 'machine'} size={15} color={t.body} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ ...F.body(500), fontSize: 13, color: t.text }} numberOfLines={1}>{m.name}</Text>
                    <Text style={{ ...F.body(400), fontSize: 11, color: t.dim }}>{nameOf(m.owner_user_id)} · {lent ? 'shared with you' : 'not shared'}</Text>
                  </View>
                  <Text style={{ fontSize: 11, color: toneOf(status) === 'on' ? t.green : toneOf(status) === 'waking' ? t.warn : t.muted }}>{toneOf(status) === 'sleep' ? '☾' : toneOf(status) === 'off' ? '○' : '●'}</Text>
                  {cloud && lent && (status === 'asleep' || status === 'unreachable') ? <Btn label={waking === m.id ? 'Please wait…' : 'Wake now'} sm disabled={waking === m.id} onPress={() => void wake(m.id)} /> : null}
                </View>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
