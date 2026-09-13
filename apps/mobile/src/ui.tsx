import { type Theme } from '@neuramesh/client-core';
import { Text, View } from 'react-native';
import { useTheme } from './theme';
import { F, R } from './type';

// FSM state → the theme's state-color token.
export function stateColor(t: Theme, state: string): string {
  const key: Record<string, keyof Theme> = {
    backlog: 'backlog', todo: 'todo', planning: 'plan', plan_review: 'planrev',
    designing: 'design', design_review: 'designrev', in_progress: 'prog', in_review: 'review',
    done: 'done', shipping: 'ship', ship_review: 'shiprev', releasing: 'rel', verifying: 'verif',
    accepted: 'acc', blocked: 'blocked', closed: 'closed',
  };
  return t[key[state] ?? 'muted'];
}

const STATE_LABEL: Record<string, string> = {
  plan_review: 'plan review',
  design_review: 'design review',
  ship_review: 'ship review',
  in_progress: 'in progress',
  in_review: 'in review',
};
export function stateLabel(state: string): string {
  return STATE_LABEL[state] ?? state;
}

// UPPERCASE mono state pill on a 16%-opacity same-color tint (the desktop's .chip.c-*).
export function StateChip({ state }: { state: string }) {
  const t = useTheme();
  const c = stateColor(t, state);
  return (
    <View style={{ alignSelf: 'flex-start', borderRadius: R.pill, paddingHorizontal: 7, paddingVertical: 3, backgroundColor: `${c}29` }}>
      <Text style={{ ...F.mono(500), color: c, fontSize: 10, letterSpacing: F.track, textTransform: 'uppercase' }}>{stateLabel(state)}</Text>
    </View>
  );
}

// Agent emoji tile or human initials circle.
export function Avatar({ emoji, label, size = 30 }: { emoji?: string | null; label?: string; size?: number }) {
  const t = useTheme();
  const initials = (label ?? '?').slice(0, 2).toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: emoji ? size * 0.3 : size / 2,
        backgroundColor: emoji ? t.panel3 : `${t.accent}2e`,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: emoji ? size * 0.5 : size * 0.38, color: t.accent, ...F.mono(600) }}>{emoji ?? initials}</Text>
    </View>
  );
}

// Compact relative time (now / 5m / 3h / 2d).
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// The active workspace now lives in WorkspaceProvider (0113) — re-exported here so the screens
// that already import it from `ui` keep working. It used to be
// `select workspace_id from workspace_members limit 1`, which with two memberships returned an
// arbitrary (and not even stable) one of them.
export { useActiveWorkspace } from './workspace';
