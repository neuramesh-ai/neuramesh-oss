// THE MACHINE CHIP (rule D9 on the phone, the mobile-cloud round D7): "Run this session on" — Auto
// first with what it resolves to, then icon · name (a teammate's adds their name), the state as an
// ICON at the row's right, the row Auto resolves to tagged, one foot line. The forecast is the
// SHARED forecastMachine with origin 'web': a phone session prefers the cloud and "This Mac" never
// appears, because the phone is not a machine. What the chip can never do is name a machine the
// member may not use — choosableMachines already refuses those.
import { choosableMachines, forecastMachine, machineKindLabel, machineOnline, type ChoiceMachine, type ComputePrefs } from '@neuramesh/shared';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { type ComputeView } from './compute';
import { Icon, type IconName } from './icon';
import { useTheme } from './theme';
import { F, R } from './type';

export interface ChipMachine extends ChoiceMachine { ownerName: string | null }

const STATE_MARK: Record<string, string> = { online: '●', waking: '●', asleep: '☾', stopped: '○', unreachable: '○', capped: '●', no_credits: '●' };

export function useMachineForecast(input: { machines: readonly ChipMachine[]; selfUserId: string | null; prefs: ComputePrefs | null | undefined; chosen: string | null }) {
  const now = Date.now();
  const rows = choosableMachines(input.machines, input.selfUserId, now) as ChipMachine[];
  const forecast = forecastMachine({ origin: 'web', chosen: input.chosen, prefs: input.prefs, machines: input.machines, selfUserId: input.selfUserId, selfMachineId: null, now });
  const resolved = rows.find((m) => m.id === forecast.machineId) ?? null;
  return { rows, forecast, resolved };
}

export function MachineChip({ machines, selfUserId, prefs, chosen, onChoose, compute, iconOnly }: {
  machines: readonly ChipMachine[]; selfUserId: string | null; prefs: ComputePrefs | null | undefined;
  chosen: string | null; onChoose: (id: string | null) => void; compute: ComputeView; iconOnly?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const { rows, forecast, resolved } = useMachineForecast({ machines, selfUserId, prefs, chosen });
  const iconOf = (m: ChipMachine): IconName => (m.kind === 'local' ? 'machine' : 'cloud');
  const label = chosen ? (resolved?.name ?? 'machine') : resolved ? resolved.name : 'Auto';
  // a cloud machine's word comes from the fleet (machineState); a laptop has no intent row, so its
  // heartbeat decides — online within 90 s, else offline
  const stateOf = (m: ChipMachine): string | null => compute.stateOf(m.id)?.status ?? (machineOnline({ machineId: m.id, ownerUserId: '', runtimes: [], lastSeenAt: m.lastSeenAt }, Date.now()) ? 'online' : 'stopped');
  const { height } = useWindowDimensions();
  const markColor = (s: string | null) => (s === 'online' ? t.done : s === 'waking' || s === 'capped' || s === 'no_credits' ? t.warn : s === 'asleep' ? t.muted : t.dim);
  const kindOf = (m: ChipMachine) => machineKindLabel(m, selfUserId, null, m.id);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityLabel={`Run this session on ${label}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 150, paddingHorizontal: iconOnly ? 7 : 10, minHeight: 28, borderRadius: R.pill, borderWidth: 1, borderColor: open ? t.text : t.border, backgroundColor: open ? t.panel2 : 'transparent' }}>
        <Icon name={chosen && resolved ? iconOf(resolved) : resolved ? 'cloud' : 'auto'} size={13} color={open ? t.text : t.muted} />
        {iconOnly ? null : <Text style={{ ...F.body(600), fontSize: 11, color: open ? t.text : t.muted }} numberOfLines={1}>{label}</Text>}
        {iconOnly ? null : <Text style={{ fontSize: 8, color: t.dim }}>▾</Text>}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable onPress={() => setOpen(false)} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000040' }}>
          <View style={{ marginHorizontal: 12, marginBottom: 150, backgroundColor: t.overlay, borderWidth: 1, borderColor: t.border2, borderRadius: R.lg, padding: 7, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }}>
            <Text style={{ ...F.mono(500), fontSize: 10.5, letterSpacing: F.track, color: t.dim, paddingHorizontal: 9, paddingVertical: 6 }}>Run this session on</Text>
            <ScrollView style={{ maxHeight: Math.max(160, height * 0.5) }} bounces={false}>
            <Row on={!chosen} icon="auto" name="Auto" sub={resolved ? `resolves to ${resolved.name}` : 'NeuraMesh picks a machine that is awake'} onPress={() => { onChoose(null); setOpen(false); }} />
            {rows.map((m) => {
              const s = stateOf(m);
              const mine = m.ownerUserId === selfUserId;
              const sub = mine ? kindOf(m) : `${m.ownerName ?? 'a teammate'} · ${kindOf(m)}`;
              return (
                <Row key={m.id} on={chosen === m.id} icon={iconOf(m)} name={m.name} sub={sub} tag={!chosen && forecast.machineId === m.id ? 'auto' : undefined}
                  mark={s ? { glyph: STATE_MARK[s] ?? '○', color: markColor(s) } : undefined} onPress={() => { onChoose(m.id); setOpen(false); }} />
              );
            })}
            </ScrollView>
            <Text style={{ ...F.body(400), fontSize: 10.5, color: t.dim, lineHeight: 15, paddingHorizontal: 9, paddingTop: 7, paddingBottom: 4 }}>
              <Text style={{ ...F.body(600), color: t.muted }}>Phone sessions prefer the cloud</Text> · pick a machine for this one
            </Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function Row({ on, icon, name, sub, tag, mark, onPress }: { on: boolean; icon: IconName; name: string; sub?: string; tag?: string; mark?: { glyph: string; color: string }; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 9, paddingVertical: 8, minHeight: 40, borderRadius: R.md, backgroundColor: on ? t.panel2 : 'transparent' }}>
      <View style={{ width: 16, alignItems: 'center' }}><Icon name={icon} size={14} color={t.body} /></View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...F.body(600), fontSize: 13, color: t.text }} numberOfLines={1}>{name}</Text>
        {sub ? <Text style={{ ...F.body(400), fontSize: 10.5, color: t.dim, lineHeight: 14 }} numberOfLines={1}>{sub}</Text> : null}
      </View>
      {mark ? <Text style={{ width: 14, textAlign: 'center', fontSize: mark.glyph === '☾' ? 12 : 10, color: mark.color }}>{mark.glyph}</Text> : null}
      {tag ? <View style={{ borderWidth: 1, borderColor: t.border2, borderRadius: R.pill, paddingHorizontal: 4 }}><Text style={{ ...F.mono(600), fontSize: 9, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim }}>{tag}</Text></View> : null}
      {on ? <Icon name="check" size={13} color={t.text} /> : null}
    </Pressable>
  );
}
