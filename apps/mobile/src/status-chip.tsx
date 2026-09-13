// A thread's status, as a chip (docs/33 §4, the thread-status round): needs you wears `warn`, the
// attention hue the desktop bell already uses; in progress wears `prog`, the build leg's hue;
// settled is the quiet chip. The dial keeps the phase — the chip says whose turn it is.
import type { Theme } from '@neuramesh/client-core';
import { THREAD_STATUS_LABEL, type ThreadStatus } from '@neuramesh/shared';
import { Pressable, Text } from 'react-native';
import { Chip } from './kit';
import { useTheme } from './theme';
import { F, R } from './type';

export function statusHue(t: Theme, s: ThreadStatus): string | undefined {
  return s === 'needs_you' ? t.warn : s === 'in_progress' ? t.prog : undefined;
}

/** the row's chip prop for a status: a hue, or quiet */
export function statusChip(t: Theme, s: ThreadStatus): { label: string; color?: string } {
  const color = statusHue(t, s);
  return color ? { label: THREAD_STATUS_LABEL[s], color } : { label: THREAD_STATUS_LABEL[s] };
}

export function StatusChip({ status }: { status: ThreadStatus }) {
  const t = useTheme();
  const color = statusHue(t, status);
  return <Chip label={THREAD_STATUS_LABEL[status]} color={color ?? t.muted} quiet={!color} />;
}

/** the head's one act — a ghost pill, never a filled block; 30 tall to sit among the toks */
export function SettlePill({ label = 'Settle', onPress }: { label?: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={6} accessibilityLabel={label} style={{ marginLeft: 'auto', borderWidth: 1, borderColor: t.border2, borderRadius: R.pill, paddingHorizontal: 12, minHeight: 30, justifyContent: 'center' }}>
      <Text style={{ ...F.body(500), fontSize: 12, color: t.text }}>{label}</Text>
    </Pressable>
  );
}
