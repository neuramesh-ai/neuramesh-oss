// TWO SECTIONS OF THE TASK SCREEN — the subtask roll-up and the release checklist.
//
// Split out of the phone's task screen, where each was an inline IIFE inside a 180-line JSX
// tree. Both are the same shape: a block that renders only when the task is in a particular
// shape, and reads four or five things to do it. That is a component.
import { Feather } from '@expo/vector-icons';
import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../src/theme';
import type { ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import type { HumanCommandInput, ShipPlan } from '@neuramesh/shared';
import type { ThreadAgent } from '../src/thread';
import { F, R } from '../src/type';

type Common = {
  /** INFERRED from useTheme, never restated */
  t: ReturnType<typeof useTheme>;
  label: StyleProp<TextStyle>;
  busy: boolean;
};

/** subtasks (docs/24): rows with the boss check-off — no subtask can block */
export function TaskSubtasks({ task, subtaskRows, agents, run, t, label, busy }: Common & {
  task: { parent_task_id: string | null };
  subtaskRows: Array<{ id: string; number: number; title: string; state: string; assignee_id: string | null }> | undefined;
  agents: ThreadAgent[] | undefined;
  run: (cmd: HumanCommandInput) => Promise<unknown>;
}): ReactNode {
  // subtasks (docs/24): rows with the boss check-off — no subtask can block
  const subsList = subtaskRows ?? [];
  if (!subsList.length || task.parent_task_id) return null;
  const doneN = subsList.filter((x) => x.state === 'done' || x.state === 'closed').length;
  return (
    <>
      <Text style={label}>Subtasks · {doneN}/{subsList.length}</Text>
      <View style={{ marginHorizontal: 16, borderWidth: 1, borderColor: t.border, borderRadius: R.lg, overflow: 'hidden' }}>
        {subsList.map((x, n) => {
          const isDone = x.state === 'done' || x.state === 'closed';
          const who = (agents ?? []).find((a) => a.id === x.assignee_id)?.name;
          return (
            <Pressable key={x.id} disabled={isDone || busy}
              onPress={() => run({ type: 'task.finish_subtask', taskId: x.id })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: t.panel, borderTopWidth: n === 0 ? 0 : 1, borderTopColor: t.border, opacity: busy ? 0.7 : 1 }}>
              <Feather name={isDone ? 'check-circle' : 'circle'} size={16} color={isDone ? t.done : t.text} />
              <Text style={{ color: t.dim, fontSize: 10, ...F.mono(500) }}>#{x.number}</Text>
              <Text style={{ color: isDone ? t.muted : t.text, fontSize: 13, flex: 1 }} numberOfLines={2}>{x.title}</Text>
              {who ? <Text style={{ ...F.mono(500), color: t.dim, fontSize: 9.5, letterSpacing: F.tight(9.5) }}>{who}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      {doneN < subsList.length ? (
        <Text style={{ color: t.dim, fontSize: 11, paddingHorizontal: 16, paddingTop: 6, lineHeight: 16 }}>
          accept & ship stay locked while a subtask is open — tap a row to check it off
        </Text>
      ) : null}
    </>
  );
}

/** Ship gate (docs/23): the release checklist, tickable in place from the phone. */
export function TaskShipPlan({ task, id, run, t, label, busy }: Common & {
  task: { ship_plan: string | null; state: string };
  id: string;
  run: (cmd: HumanCommandInput) => Promise<unknown>;
}): ReactNode {
  // Ship gate (docs/23): the release checklist, tickable in place while the
  // task is releasing. Human items are yours to tick from the phone; the
  // server refuses everything else (an agent can never tick a human item).
  if (!task.ship_plan || (task.state !== 'ship_review' && task.state !== 'releasing')) return null;
  let plan: ShipPlan | null = null;
  try { plan = JSON.parse(task.ship_plan) as ShipPlan; } catch { return null; }
  if (!plan) return null;
  const liveTicks = task.state === 'releasing';
  const done = plan.items.filter((i) => i.state !== 'pending').length;
  return (
    <>
      <Text style={label}>Release plan · v{plan.round} · risk {plan.risk} · {done}/{plan.items.length}</Text>
      <View style={{ marginHorizontal: 16, borderWidth: 1, borderColor: t.border, borderRadius: R.lg, overflow: 'hidden' }}>
        {plan.items.map((i, n) => {
          const isDone = i.state !== 'pending';
          const who = i.owner === 'human' ? 'you' : i.owner === 'agent' ? 'agent' : 'shipper';
          return (
            <Pressable
              key={i.id}
              disabled={!liveTicks || busy}
              onPress={() => run({ type: 'task.check_ship_item', taskId: id, itemId: i.id, state: isDone ? 'pending' : 'done' })}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: t.panel, borderTopWidth: n === 0 ? 0 : 1, borderTopColor: t.border, opacity: busy ? 0.7 : 1 }}
            >
              <Feather name={isDone ? 'check-circle' : 'circle'} size={16} color={isDone ? t.done : i.owner === 'human' && liveTicks ? t.text : t.dim} />
              <Text style={{ color: isDone ? t.muted : t.text, fontSize: 13, flex: 1 }} numberOfLines={2}>{i.title}</Text>
              <Text style={{ color: i.owner === 'human' && !isDone ? t.text : t.dim, ...F.mono(500), fontSize: 9.5, letterSpacing: F.tight(9.5), textTransform: 'lowercase' }}>{who}</Text>
            </Pressable>
          );
        })}
      </View>
      {liveTicks ? (
        <Text style={{ color: t.dim, fontSize: 11, paddingHorizontal: 16, paddingTop: 6, lineHeight: 16 }}>
          the shipper merges the moment every box clears — nothing ships early
        </Text>
      ) : null}
    </>
  );
}
