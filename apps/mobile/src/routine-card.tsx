// THE ROUTINE CARD (the mobile-cloud round D9 — the desktop's Automations row at card scale): title ·
// the state chip · the cadence line (cadence · time · tz · #room · who) · next run / last run · the
// runs door ("n runs so far" IS the door — no count, no door; docs/33 §8) opening the run history in
// place, each run a session · Pause/Resume · Edit · Remove (a two-step, the second press confirms).
import { SCHEDULE_RUN_THREADS } from '@neuramesh/client-core';
import { cadenceLine, nextRunLabel } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { cleanLine } from './sessions';
import { Btn, Card, Chip, Facts } from './kit';
import { Icon } from './icon';
import { useTheme } from './theme';
import { F } from './type';
import { timeAgo } from './ui';

export interface ScheduleRow {
  id: string;
  title: string;
  cadence: string;
  at_time: string;
  tz: string;
  weekday: number | null;
  next_run_at: string | null;
  run_count: number | null;
  agent_id: string | null;
  status: string;
  last_run_at: string | null;
  last_error: string | null;
  payload: string | null;
  channel_id: string;
  channel_slug: string | null;
  created_at: string;
}
interface RunRow { id: string; title: string | null; created_at: string; updated_at: string; channel_id: string; last_body: string | null; msg_count: number }

export const promptOf = (s: ScheduleRow): string => { try { return String((JSON.parse(s.payload ?? '{}') as { prompt?: string }).prompt ?? ''); } catch { return ''; } };

const fmtWhen = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
};

export function RoutineCard({ s, agentName, where, onToggle, onEdit, onRemove, busy }: {
  s: ScheduleRow; agentName: string | null;
  /** where this runs, in the screen's own words: the room, and the project too while nothing is
   *  picked. A room slug repeats across projects, so `#build` alone names three rooms. */
  where: string;
  onToggle: () => void; onEdit: () => void; onRemove: () => void; busy: boolean;
}) {
  const t = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const h = setTimeout(() => setArmed(false), 2600); return () => clearTimeout(h); }, [armed]);
  const { data: runs } = useQuery<RunRow>(SCHEDULE_RUN_THREADS, [open ? s.id : '']);
  const paused = s.status === 'paused';
  const n = s.run_count ?? 0;
  const chip = paused ? { label: 'paused', color: t.dim, quiet: true } : s.cadence === 'once' ? { label: 'once', color: t.prog } : { label: 'armed', color: t.done };
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="routineClock" size={15} color={t.body} />
        <Text style={{ ...F.body(500), fontSize: 13.5, color: t.text, flex: 1 }} numberOfLines={1}>{s.title}</Text>
        <Chip label={chip.label} color={chip.color} quiet={chip.quiet} />
      </View>
      <Text style={{ ...F.body(400), fontSize: 12.5, color: t.muted, marginTop: 4 }} numberOfLines={1}>
        {cadenceLine(s)} {s.tz} · {where}{agentName ? ` · ${agentName}` : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 18, marginTop: 8 }}>
        <View><Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim }}>Next run</Text><Text style={{ ...F.body(500), fontSize: 12.5, color: paused ? t.dim : t.body }}>{paused ? 'paused' : s.next_run_at ? `${fmtWhen(s.next_run_at)} · ${nextRunLabel(s.next_run_at)}` : 'not scheduled'}</Text></View>
        <View><Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim }}>Last run</Text><Text style={{ ...F.body(500), fontSize: 12.5, color: t.body }}>{s.last_run_at ? `${fmtWhen(s.last_run_at)} · ${timeAgo(s.last_run_at)} ago` : 'never ran'}</Text></View>
      </View>
      {s.last_error ? <Facts style={{ color: t.warn }}>{`last run failed · ${s.last_error}`}</Facts> : null}
      {n > 0 ? (
        <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <View style={{ transform: [{ rotate: open ? '0deg' : '-90deg' }] }}><Icon name="chevron" size={13} color={t.muted} /></View>
          <Text style={{ ...F.body(600), fontSize: 12, color: t.link }}>{`${n} run${n === 1 ? '' : 's'} so far`}</Text>
        </Pressable>
      ) : null}
      {open ? (
        <View style={{ marginTop: 4 }}>
          {runs === undefined ? null : runs.length === 0 ? (
            <Text style={{ ...F.body(400), fontSize: 12, color: t.dim, paddingVertical: 4 }}>No run conversations yet. Older runs are not listed.</Text>
          ) : runs.map((r) => (
            <Pressable key={r.id} onPress={() => router.push(`/thread/${r.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 }}>
              <Text style={{ ...F.body(600), fontSize: 12, color: t.text, width: 78 }}>{fmtWhen(r.created_at)}</Text>
              <Text style={{ ...F.body(400), fontSize: 12, color: t.muted, flex: 1 }} numberOfLines={1}>{cleanLine((r.last_body ?? r.title ?? 'Untitled run').split('\n')[0] ?? '')}</Text>
              <Text style={{ ...F.mono(500), fontSize: 10, color: r.msg_count <= 1 ? t.dim : t.muted }}>{r.msg_count <= 1 ? 'no reply' : `${r.msg_count - 1} repl${r.msg_count - 1 === 1 ? 'y' : 'ies'}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {s.cadence !== 'once' || paused ? <Btn label={paused ? 'Resume' : 'Pause'} sm disabled={busy} onPress={onToggle} /> : null}
        <Btn label="Edit" sm disabled={busy} onPress={onEdit} />
        <Btn label={armed ? 'Remove? Tap again.' : 'Remove'} sm disabled={busy} onPress={() => { if (armed) { setArmed(false); onRemove(); } else setArmed(true); }} style={armed ? { borderColor: t.blocked } : undefined} />
      </View>
    </Card>
  );
}
