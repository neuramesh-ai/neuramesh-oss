// The undo pill (the thread-status round): a moment to take a settle back, in place of a confirm.
// Sits above the tab bar, clear of the FAB, and leaves by itself (UNDO_MS in settle-rules.ts).
import { Pressable, Text, View } from 'react-native';
import { useTheme } from './theme';
import { F, R } from './type';

export function UndoPill({ title, onUndo, bottom = 99 }: { title: string; onUndo: () => void; bottom?: number }) {
  const t = useTheme();
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom, alignItems: 'center' }}>
      {/* the whole pill is the undo: its one act, and a thumb-sized target */}
      <Pressable onPress={onUndo} accessibilityLabel="Undo settle" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 16, paddingRight: 14, minHeight: 44, borderWidth: 1, borderColor: t.border2, borderRadius: R.pill, backgroundColor: t.panel2, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } }}>
        <Text style={{ ...F.body(400), fontSize: 12.5, color: t.body, maxWidth: 230 }} numberOfLines={1}>{`${title} settled`}</Text>
        <Text style={{ ...F.body(600), fontSize: 12.5, color: t.text }}>Undo</Text>
      </Pressable>
    </View>
  );
}
