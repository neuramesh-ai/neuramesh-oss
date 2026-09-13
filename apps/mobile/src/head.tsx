// THE HEAD — the frame at phone scale (the mobile-cloud round, D2): mark · workspace ▾ · the
// cloud-machine pill in its state colour · the credit ring · you. The one row every tab shows,
// so a machine you cannot see is never a machine you forget is asleep. The pill and the ring are
// doors to Compute; the avatar to Settings. The magnifier lands on the Threads tab, which owns
// the one search field in the product (History was folded into it, 2026-09-08) —
// a control that leads nowhere is a defect, not a placeholder.
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { currentEmail, currentUserId } from './auth';
import { PorchMark } from './brand';
import { useCompute } from './compute';
import { Icon } from './icon';
import { Kicker, Ring, Tile } from './kit';
import { useTheme } from './theme';
import { F, R } from './type';
import { useWorkspace } from './workspace';

/** the pill's colour, from the ONE derivation (machineState): online green · waking warm · asleep dim · a refusal warm */
export function pillColor(status: string | null, t: { green: string; warn: string; dim: string; muted: string }): string {
  if (status === 'online') return t.green;
  if (status === 'waking' || status === 'capped' || status === 'no_credits' || status === 'unreachable') return t.warn;
  if (status === 'asleep') return t.dim;
  return t.muted;
}

export function Head() {
  const t = useTheme();
  const router = useRouter();
  const { active, workspaces, setActive } = useWorkspace();
  const compute = useCompute(active);
  const [switching, setSwitching] = useState(false);
  const me = currentUserId();
  const pill = compute.pillFor(me);
  const credits = compute.credits?.credits;
  const name = workspaces.find((w) => w.id === active)?.name ?? 'neuramesh';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
      <PorchMark size={22} />
      <Pressable onPress={() => workspaces.length > 1 && setSwitching(true)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Text style={{ ...F.body(600), fontSize: 15, color: t.text, letterSpacing: -0.15 }} numberOfLines={1}>{name}</Text>
        {workspaces.length > 1 ? <Icon name="chevron" size={14} color={t.muted} /> : null}
      </Pressable>
      <View style={{ marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {/* the pill draws the CLOUD MACHINE (chassis + cloud badge) — one mark that says it by itself; absent when the fleet has not answered */}
        {pill ? (
          <Pressable onPress={() => router.push('/compute')} hitSlop={6} accessibilityLabel={`Cloud machine · ${pill.status}`} style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: R.pill }}>
            <Icon name="cloudMachine" size={18} color={pillColor(pill.status, t)} />
          </Pressable>
        ) : null}
        {/* a meter that cannot read draws NOTHING (CreditRing.tsx) */}
        {credits ? (
          <Pressable onPress={() => router.push('/compute')} hitSlop={6} accessibilityLabel={`${credits.remaining} credits left`}>
            <Ring frac={credits.granted > 0 ? credits.remaining / credits.granted : 0} />
          </Pressable>
        ) : null}
        <Link href="/(tabs)/threads" asChild>
          <Pressable hitSlop={6} accessibilityLabel="Search every thread" style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: R.pill }}>
            <Icon name="search" size={17} color={t.muted} />
          </Pressable>
        </Link>
        <Link href="/settings" asChild>
          <Pressable hitSlop={6}><Tile label={currentEmail()?.trim() || (me ? 'you' : '?')} size={26} /></Pressable>
        </Link>
      </View>
      <Modal visible={switching} transparent animationType="fade" onRequestClose={() => setSwitching(false)}>
        <Pressable onPress={() => setSwitching(false)} style={{ flex: 1, backgroundColor: '#0000004d' }}>
          <View style={{ marginTop: 92, marginHorizontal: 16, backgroundColor: t.card, borderRadius: R.lg, borderWidth: 1, borderColor: t.cardBorder, overflow: 'hidden' }}>
            <Kicker>Workspaces</Kicker>
            {workspaces.map((w) => (
              <Pressable key={w.id} onPress={() => { setActive(w.id); setSwitching(false); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderTopColor: t.border, borderTopWidth: 1 }}>
                <Tile label={w.name || '?'} size={24} round={false} />
                <Text style={{ ...F.body(500), color: t.text, fontSize: 14, flex: 1 }}>{w.name}</Text>
                {w.id === active ? <Icon name="check" size={15} color={t.accent} /> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
