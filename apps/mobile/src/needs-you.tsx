// NEEDS YOU, AS ROWS (George, 2026-09-08: "all these accept and merge, request changes buttons are an
// antipattern"). The same session rows the Threads tab draws, filtered to the one status, no
// buttons: the snippet says WHY, a tap opens the thread where the answer is given in words, and
// the row's one act is Settle — a swipe, a long-press, or the peek that shows the swipe exists.
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Icon } from './icon';
import { Btn, Kicker } from './kit';
import { QUEUE_STEP } from './session-foot';
import { SessionRow } from './session-row';
import { cleanLine, rowKind, rowSnip, type SessionRowData } from './sessions';
import { claimPeek, wantsHint } from './settle';
import { SettleRow, settleSheet, type SettleRowHandle } from './settle-row';
import { statusChip } from './status-chip';
import { useTheme } from './theme';
import { F } from './type';

export function NeedsYou({ rows, onSettle, onOpen }: {
  rows: SessionRowData[];
  onSettle: (r: SessionRowData) => void;
  onOpen: (r: SessionRowData) => void;
}) {
  const t = useTheme();
  const [folded, setFolded] = useState(false);
  // four at a time, the way the queue has always opened (George, 2026-09-06)
  const [shown, setShown] = useState(QUEUE_STEP);
  const [hint, setHint] = useState(false);
  const first = useRef<SettleRowHandle>(null);
  const has = rows.length > 0;
  // THE SWIPE SHOWS ITSELF: the top row peeks once per launch (settle.ts owns the once)
  useEffect(() => {
    if (!has) return;
    let on = true;
    void claimPeek(rows.length).then((yes) => { if (yes && on) setTimeout(() => first.current?.peek(), 600); });
    void wantsHint().then((h) => { if (on) setHint(h); });
    return () => { on = false; };
  }, [has, rows.length]);
  return (
    <>
      <Kicker right={<Pressable onPress={() => setFolded((f) => !f)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Text style={{ ...F.mono(500), fontSize: 9.5, color: t.dim }}>{folded ? 'show' : 'fold'}</Text><Icon name="chevron" size={12} color={t.dim} /></Pressable>}>
        {`Needs you · ${rows.length}`}
      </Kicker>
      {hint && !folded ? <Text style={{ ...F.body(400), fontSize: 12, color: t.muted, paddingHorizontal: 16, paddingBottom: 6 }}>Swipe a row to the left to settle it.</Text> : null}
      {folded ? null : rows.slice(0, shown).map((r, i) => {
        const title = cleanLine(r.title);
        const snip = rowSnip(r);
        const can = !!r.threadId;
        return (
          <SettleRow key={r.key} ref={i === 0 ? first : undefined} enabled={can} onSettle={() => onSettle(r)}>
            <SessionRow kind={rowKind(r)} state={r.state} title={title} snip={r.why ?? snip.text} snipMono={!r.why && snip.mono}
              when={`#${r.channelSlug}`} live={!!r.live} ask={r.ask} chip={statusChip(t, r.status)} flush={can}
              onPress={() => onOpen(r)} onLongPress={can ? () => settleSheet(title, () => onSettle(r), () => onOpen(r)) : undefined} />
          </SettleRow>
        );
      })}
      {!folded && rows.length > shown ? (
        <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 6 }}>
          <Btn label={`Show ${Math.min(QUEUE_STEP, rows.length - shown)} more`} onPress={() => setShown((n) => n + QUEUE_STEP)} />
        </View>
      ) : null}
    </>
  );
}
