// THE END OF A PAGED LIST, SAID OUT LOUD (the mobile fix round, 2026-09-06).
//
// A list that holds 25 of 148 sessions is bounded, not broken, and the difference is whether it
// says so. The foot names what it holds and where the rest lives. It is not usually a button:
// reaching it already asks for the next page, so the control only appears when that automatic ask
// has not answered, which is the honest place for a person to push.
import { Text, View } from 'react-native';
import { Btn } from './kit';
import { useTheme } from './theme';
import { F } from './type';

/** how many queue cards a tap reveals — four, the same four the queue opens with */
export const QUEUE_STEP = 4;

export function SessionFoot({ shown, hasMore, onMore }: { shown: number; hasMore: boolean; onMore: () => void }) {
  const t = useTheme();
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 18, alignItems: 'center', gap: 8 }}>
      {hasMore ? <Btn label="Load older sessions" onPress={onMore} /> : null}
      <Text style={{ ...F.mono(500), fontSize: 10.5, color: t.dim, textAlign: 'center' }}>
        {hasMore ? `${shown} sessions here · older ones load as you scroll` : `${shown} ${shown === 1 ? 'session' : 'sessions'} · older ones live in Threads`}
      </Text>
    </View>
  );
}
