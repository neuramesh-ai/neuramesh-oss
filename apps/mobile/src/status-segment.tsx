// STATUS IS A FILTER (George, 2026-09-08): one segment, the three words and All, a count on each.
// The counts read the loaded page, so they never disagree with the list under them.
import { THREAD_STATUSES, type ThreadStatus } from '@neuramesh/shared';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from './theme';
import { F, R } from './type';

const LABEL: Record<ThreadStatus, string> = { needs_you: 'Needs you', in_progress: 'In progress', settled: 'Settled' };

export function StatusSegment({ value, counts, total, onPick }: {
  value: ThreadStatus | null;
  counts: Record<ThreadStatus, number>;
  total: number;
  onPick: (s: ThreadStatus | null) => void;
}) {
  const t = useTheme();
  const opt = (s: ThreadStatus | null, label: string, n: number) => {
    const on = value === s;
    return (
      <Pressable key={s ?? 'all'} onPress={() => onPick(s)} accessibilityLabel={`${label} · ${n}`} accessibilityState={{ selected: on }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: on ? t.panel3 : 'transparent' }}>
        <Text style={{ ...F.body(500), fontSize: 12, color: on ? t.text : t.muted }}>{label}</Text>
        <Text style={{ ...F.mono(500), fontSize: 10, color: on ? t.body : t.dim }}>{n}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ marginHorizontal: 16, marginTop: 10, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: t.panel2, borderWidth: 1, borderColor: t.border2, borderRadius: R.pill, padding: 2 }}>
      {opt(null, 'All', total)}
      {THREAD_STATUSES.map((s) => opt(s, LABEL[s], counts[s]))}
    </View>
  );
}
