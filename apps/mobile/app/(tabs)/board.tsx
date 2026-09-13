import { TASKS_FOR_WORKSPACE } from '@neuramesh/client-core';
import { useQuery } from '@powersync/react-native';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Dimensions, Pressable, ScrollView, Text, View } from 'react-native';
import { Icon } from '../../src/icon';
import { useTheme } from '../../src/theme';
import { F, R } from '../../src/type';
import { StateChip, useActiveWorkspace } from '../../src/ui';

interface TaskRow {
  id: string;
  number: number;
  title: string;
  state: string;
  branch: string;
}

const ORDER = ['backlog', 'todo', 'planning', 'plan_review', 'designing', 'design_review', 'in_progress', 'in_review', 'done', 'accepted', 'blocked'];

// One FSM column at a time (paged), the next peeking via the pager dots — the phone
// analog of the desktop board. Tapping a card opens the task.
export default function Board() {
  const t = useTheme();
  const ws = useActiveWorkspace();
  const { data: tasks } = useQuery<TaskRow>(TASKS_FOR_WORKSPACE, [ws ?? '']);
  const router = useRouter();
  const width = Dimensions.get('window').width;
  const [page, setPage] = useState(0);

  const byState = new Map<string, TaskRow[]>();
  for (const task of tasks ?? []) {
    const arr = byState.get(task.state) ?? [];
    arr.push(task);
    byState.set(task.state, arr);
  }
  const filled = ORDER.filter((s) => (byState.get(s)?.length ?? 0) > 0);
  const cols = filled.length > 0 ? filled : ['todo'];

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 }}>
        <Text style={{ ...F.body(600), color: t.text, fontSize: 18 }}>Tasks</Text>
        {/* park an idea — the backlog's one creation path from a phone (docs/15); it lives with the board now, Home's FAB starts a chat */}
        <Pressable onPress={() => router.push('/capture')} hitSlop={8} accessibilityLabel="Park an idea" style={{ marginLeft: 8, width: 26, height: 26, borderRadius: R.pill, borderWidth: 1, borderColor: t.border2, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="pen" size={13} color={t.muted} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 4, marginLeft: 'auto' }}>
          {cols.map((c, i) => (
            <View key={c} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i === page ? t.accent : t.border2 }} />
          ))}
        </View>
      </View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={{ flex: 1 }}
      >
        {cols.map((state) => {
          const items = byState.get(state) ?? [];
          return (
            <View key={state} style={{ width, padding: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <StateChip state={state} />
                <Text style={{ color: t.dim, fontSize: 12, ...F.mono(500) }}>{items.length}</Text>
              </View>
              <ScrollView showsVerticalScrollIndicator={false}>
                {items.map((task) => (
                  <Link key={task.id} href={`/task/${task.id}`} asChild>
                    <Pressable style={{ borderWidth: 1, borderColor: t.border2, backgroundColor: t.panel2, borderRadius: R.lg, padding: 11, marginBottom: 8 }}>
                      <Text style={{ color: t.dim, fontSize: 10.5, ...F.mono(500) }}>NM-{task.number}</Text>
                      <Text style={{ color: t.text, fontSize: 12.5, ...F.body(600), marginTop: 4 }} numberOfLines={2}>
                        {task.title}
                      </Text>
                      {task.branch ? (
                        <Text style={{ color: t.dim, fontSize: 10, ...F.mono(400), marginTop: 5 }} numberOfLines={1}>
                          {task.branch}
                        </Text>
                      ) : null}
                    </Pressable>
                  </Link>
                ))}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}
