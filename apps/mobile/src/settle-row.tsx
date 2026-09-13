// THE SETTLE ROW (the thread-status round, 2026-09-08): a session row that settles on a swipe.
//
// Three doors to the same act, because a swipe is invisible until you know it is there:
//   · swipe left, the iOS trailing action, the word "Settle" on the warn hue;
//   · long-press, a sheet with Settle and Open;
//   · the peek — `peek()` opens the action and closes it again, once per launch, until the person
//     has settled a thread once (settle.ts decides; Home asks).
// The peek uses the swipeable's own open, so `onSwipeableOpen` is guarded while it plays: a
// demonstration must never settle anything.
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, Text } from 'react-native';
import { isDarkTheme } from './kit';
import { useTheme } from './theme';
import { F, R } from './type';

export interface SettleRowHandle { peek: () => void }

const ACTION_W = 84;

export function settleSheet(title: string, onSettle: () => void, onOpen: () => void): void {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions({ title, options: ['Settle', 'Open', 'Cancel'], cancelButtonIndex: 2 }, (i) => {
      if (i === 0) onSettle();
      else if (i === 1) onOpen();
    });
    return;
  }
  Alert.alert(title, undefined, [{ text: 'Settle', onPress: onSettle }, { text: 'Open', onPress: onOpen }, { text: 'Cancel', style: 'cancel' }]);
}

export const SettleRow = forwardRef<SettleRowHandle, { enabled: boolean; onSettle: () => void; children: ReactNode }>(
  function SettleRow({ enabled, onSettle, children }, ref) {
    const t = useTheme();
    const sw = useRef<SwipeableMethods>(null);
    const peeking = useRef(false);
    useImperativeHandle(ref, () => ({
      peek: () => {
        if (!enabled || !sw.current) return;
        peeking.current = true;
        sw.current.openRight();
        setTimeout(() => {
          sw.current?.close();
          setTimeout(() => { peeking.current = false; }, 400);
        }, 900);
      },
    }), [enabled]);
    const fired = useRef(false);
    // the ONLY actions are on the right, so any open is a settle. The callback's `direction` is not
    // checked on purpose: RNGH 2.24 reports the direction of the SWIPE (left reveals the right
    // actions), older docs the side that opened — a check on either word is a coin toss.
    const settleOnce = () => {
      if (peeking.current || fired.current) return;
      fired.current = true;
      onSettle();
      // the row normally unmounts; if the settle was refused and it stays, let it fire again
      setTimeout(() => { fired.current = false; }, 1500);
    };
    if (!enabled) return <>{children}</>;
    // dark ink on the light amber of the dark theme; cream ink on the deep amber of the light one
    const ink = isDarkTheme(t.bg) ? t.bg : t.brandInk;
    return (
      <ReanimatedSwipeable
        ref={sw}
        friction={1.6}
        rightThreshold={ACTION_W * 0.7}
        overshootRight={false}
        containerStyle={{ marginHorizontal: 6, borderRadius: R.md, overflow: 'hidden' }}
        childrenContainerStyle={{ marginHorizontal: -6, backgroundColor: t.bg }}
        // both open events, once: a release that lands open settles whichever event the runtime fires first
        onSwipeableWillOpen={settleOnce}
        onSwipeableOpen={settleOnce}
        renderRightActions={() => (
          // the revealed word is a button too: a swipe that stops short still has a way to finish
          <Pressable onPress={onSettle} accessibilityLabel="Settle" style={{ width: ACTION_W, backgroundColor: t.warn, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ ...F.body(600), fontSize: 12.5, color: ink }}>Settle</Text>
          </Pressable>
        )}
      >
        {children}
      </ReanimatedSwipeable>
    );
  },
);
