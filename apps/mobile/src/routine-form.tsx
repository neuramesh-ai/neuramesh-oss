// THE ROUTINE SHEET (the mobile-cloud round D9; the desktop's ScheduleFormModal at phone scale):
// arm a new routine or edit one in place. Title · what each run asks · the room · the cadence as
// pills · the weekday (weekly) · the time (recurring) or the date + time (once). Arming sends
// `schedule.create` with `routine: true` (a routine, not a marketing drafting schedule); editing
// sends `schedule.update` — next_run_at recomputes server-side from the ONE cadence brain.
import { CHANNELS_WITH_PROJECT_FOR_WORKSPACE } from '@neuramesh/client-core';
import { SCHED_WEEKDAYS } from '@neuramesh/shared';
import { useQuery } from '@powersync/react-native';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { api } from './auth';
import { Btn, inputStyle } from './kit';
import { useTheme } from './theme';
import { GhostPill } from './thread-parts';
import { F, R } from './type';

export interface RoutineDraft {
  id?: string;
  title: string;
  prompt: string;
  channel_id: string;
  cadence: 'once' | 'daily' | 'weekdays' | 'weekly';
  at_time: string;
  weekday: number;
  /** YYYY-MM-DD, once only */
  runDate: string;
}

const CADENCES: Array<[RoutineDraft['cadence'], string]> = [['once', 'Once'], ['daily', 'Daily'], ['weekdays', 'Weekdays'], ['weekly', 'Weekly']];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function RoutineSheet({ workspace, initial, onClose, onSaved }: { workspace: string; initial: RoutineDraft; onClose: () => void; onSaved: () => void }) {
  const t = useTheme();
  const editing = !!initial.id;
  const [d, setD] = useState<RoutineDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const { data: channels } = useQuery<{ id: string; slug: string }>(CHANNELS_WITH_PROJECT_FOR_WORKSPACE, [workspace]);
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
  const set = <K extends keyof RoutineDraft>(k: K, v: RoutineDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    if (!d.title.trim() || !d.prompt.trim()) { setErr('Add a title and the question for each run.'); return; }
    if (!TIME_RE.test(d.at_time)) { setErr('Use the 24-hour format HH:MM.'); return; }
    const runAt = d.cadence === 'once' ? new Date(`${d.runDate}T${d.at_time}:00`) : null;
    if (runAt && (Number.isNaN(runAt.getTime()) || runAt.getTime() <= Date.now())) { setErr('Pick a date and time in the future.'); return; }
    setBusy(true);
    setErr('');
    const args = { title: d.title.trim(), prompt: d.prompt.trim(), cadence: d.cadence, tz, ...(runAt ? { runAt: runAt.toISOString() } : { atTime: d.at_time }), ...(d.cadence === 'weekly' ? { weekday: d.weekday } : {}) };
    try {
      if (editing) await api.command({ type: 'schedule.update', schedule: initial.id!, ...args });
      else await api.command({ type: 'schedule.create', channel: d.channel_id, routine: true, ...args });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not save. Try again.');
      setBusy(false);
    }
  }

  const field = (label: string, node: React.ReactNode) => (
    <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
      <Text style={{ ...F.mono(500), fontSize: 9.5, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim, marginBottom: 6 }}>{label}</Text>
      {node}
    </View>
  );
  const input = (value: string, onChange: (v: string) => void, placeholder: string, multiline = false) => (
    <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={t.dim} multiline={multiline} autoCapitalize={multiline ? 'sentences' : 'none'}
      style={{ ...inputStyle(t), fontSize: 14, minHeight: multiline ? 84 : 40 }} />
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ backgroundColor: t.bg, borderTopLeftRadius: R.lg, borderTopRightRadius: R.lg, maxHeight: '88%', paddingBottom: 24 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14 }}>
            <Text style={{ ...F.display(), fontSize: 20, letterSpacing: F.tight(20), color: t.text, flex: 1 }}>{editing ? 'Edit routine' : 'New routine'}</Text>
            <Btn label="Close" sm onPress={onClose} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {field('Title', input(d.title, (v) => set('title', v), 'Daily brief'))}
            {field('What each run asks', input(d.prompt, (v) => set('prompt', v), 'Summarize what moved in this room and what needs me.', true))}
            {!editing ? field('Room', (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {(channels ?? []).map((c) => <GhostPill key={c.id} label={`#${c.slug}`} on={d.channel_id === c.id} onPress={() => set('channel_id', c.id)} />)}
              </View>
            )) : null}
            {field('Cadence', (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {CADENCES.map(([k, l]) => <GhostPill key={k} label={l} on={d.cadence === k} onPress={() => set('cadence', k)} />)}
              </View>
            ))}
            {d.cadence === 'weekly' ? field('Day', (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {SCHED_WEEKDAYS.map((w, i) => <GhostPill key={w} label={w} on={d.weekday === i} onPress={() => set('weekday', i)} />)}
              </View>
            )) : null}
            {field(d.cadence === 'once' ? 'When' : 'Time of day', (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                {d.cadence === 'once' ? <View style={{ flex: 1 }}>{input(d.runDate, (v) => set('runDate', v), 'YYYY-MM-DD')}</View> : null}
                <View style={{ width: 96 }}>{input(d.at_time, (v) => set('at_time', v), '09:00')}</View>
                <Text style={{ ...F.mono(500), fontSize: 11, color: t.dim, flexShrink: 1 }}>{tz}</Text>
              </View>
            ))}
            {err ? <Text style={{ ...F.body(400), color: t.blocked, fontSize: 12.5, paddingHorizontal: 16, paddingTop: 10 }}>{err}</Text> : null}
            <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 16 }}>
              <Btn label={busy ? 'Please wait…' : editing ? 'Save changes' : 'Arm routine'} kind="primary" disabled={busy} onPress={() => void save()} />
            </View>
            <Text style={{ ...F.body(400), fontSize: 12, color: t.dim, paddingHorizontal: 16, paddingTop: 12, lineHeight: 17 }}>{editing ? 'This changes the cadence only. The run count stays.' : 'Each run opens its own conversation in the room. The crew there answers it.'}</Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
