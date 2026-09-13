// ONE ROW FOR EVERYTHING ON THE CALENDAR (the mobile fix round, 2026-09-06): a routine's firing and
// a post are the same anatomy — a time, a lane glyph, a title and one line under it — so they are
// one object rather than two blocks that drift apart. The band of drafts with no time uses it too,
// with an em rule where the clock would be.
//
// Every row is a target. Nothing on this surface used to be, which is why a calendar full of
// firings could not be acted on.
import { Pressable, Text, View } from 'react-native';
import { Icon } from './icon';
import { useTheme } from './theme';
import { F } from './type';

export const NO_TIME = '—';

export function AgendaRow({ time, kind, title, sub, dim, done, onPress }: {
  /** the 24-hour clock, or NO_TIME for an item nobody has scheduled */
  time: string;
  kind: 'run' | 'post';
  title: string;
  sub: string;
  dim?: boolean;
  /** it already happened. A published post is history, so it recedes and wears a different mark
   *  (George, 2026-09-07: "published items should we visually differentiated on the calendar").
   *  Reading the sub line was the only way to tell a post that had gone from one still to come. */
  done?: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const faded = dim || done;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 9, alignItems: 'flex-start',
      minHeight: 48, opacity: faded ? 0.55 : pressed ? 0.7 : 1, backgroundColor: pressed ? t.panel2 : 'transparent',
    })}>
      <Text style={{ ...F.mono(500), fontSize: 11, color: t.dim, width: 40, paddingTop: 3 }}>{time}</Text>
      <View style={{ width: 22, height: 22, borderRadius: kind === 'post' ? 11 : 7, backgroundColor: t.panel2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={done ? 'checkCircle' : kind === 'post' ? 'send' : 'routineClock'} size={13} color={done ? t.green : t.muted} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ ...F.body(500), fontSize: 13, color: t.text }} numberOfLines={1}>{title}</Text>
        <Text style={{ ...F.body(400), fontSize: 11, color: t.muted }} numberOfLines={1}>{sub}</Text>
      </View>
      <Icon name="chevron" size={13} color={t.dim} />
    </Pressable>
  );
}
