// WHAT LANDS TODAY, on Home (George, 2026-09-07: "the home screen should also show any upcoming
// items or posts going out for the day if i want to tap and review or update or reschedule").
//
// The Calendar has always known this — it plots the same two lanes across a week. What it could not
// do is catch your eye: a post going out at five is not something you go and look for, it is
// something that should be in front of you when you open the app.
//
// So this is the SAME projection, windowed to the rest of today: `scheduleFirings` for the routines
// and `postSlot` for the posts, the two derivations every surface already shares. Nothing here
// re-derives a time, and a row that disagreed with the Calendar would be a bug in one of them.
//
// It is absent when nothing is scheduled. A band that says "nothing today" is a row of furniture
// asking to be scrolled past (CLAUDE.md #11: delete the subtext).
import { CHANNELS_WITH_PROJECT_FOR_WORKSPACE, CONTENT_ITEMS_FOR_CALENDAR, SCHEDULES_FOR_WORKSPACE } from '@neuramesh/client-core';
import { useQuery } from '@powersync/react-native';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Icon } from './icon';
import { Card, Kicker } from './kit';
import { SOON_MIN, todaySlots } from './going-out-slots';
import { type PostItem } from './post-item';
import { PostSheet } from './post-sheet';
import type { ScheduleRow } from './routine-card';
import { useTheme } from './theme';
import { F } from './type';

const hhmm = (d: Date): string => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** the tallest the band may stand on Home. Past this it scrolls inside its own card, so a busy day
 *  costs the same screen as a quiet one (George, 2026-09-07: "make the cards a continuous scolling
 *  card so the content doesn't take up the screen when it grows"). Sized to a group label plus about
 *  four rows, which is a glance. */
const BAND_MAX_H = 258;

export function GoingOutToday({ workspace }: { workspace: string | null }) {
  const t = useTheme();
  const router = useRouter();
  const { data: scheds } = useQuery<ScheduleRow>(SCHEDULES_FOR_WORKSPACE, [workspace ?? '']);
  const { data: posts } = useQuery<PostItem>(CONTENT_ITEMS_FOR_CALENDAR, [workspace ?? '']);
  const { data: rooms } = useQuery<{ id: string; slug: string }>(CHANNELS_WITH_PROJECT_FOR_WORKSPACE, [workspace ?? '']);
  const [folded, setFolded] = useState(false);
  const [post, setPost] = useState<string | null>(null);
  // a minute-fresh clock would re-render the whole of Home every minute for a label; the list is
  // rebuilt when its rows change, which is when the answer can actually differ
  const roomOf = useMemo(() => (id: string) => `#${(rooms ?? []).find((c) => c.id === id)?.slug ?? '…'}`, [rooms]);
  const slots = useMemo(() => todaySlots(scheds ?? [], posts ?? [], new Date(), roomOf), [scheds, posts, roomOf]);
  const slugOf = (id: string) => (rooms ?? []).find((c) => c.id === id)?.slug ?? 'room';
  // the sheet reads the LIVE row, the way the Calendar's does, so a reschedule lands under your thumb
  const openPost = useMemo(() => (post ? (posts ?? []).find((p) => p.id === post) ?? null : null), [post, posts]);
  // the open sheet outlives the band: "Back to draft" on the last slot of the day empties this list,
  // and unmounting the band mid-action would take the sheet away while you were using it
  if (!slots.length && !openPost) return null;

  const now = Date.now();
  // TWO LANES, SAID OUT LOUD (George, 2026-09-07: "why is routines showing under going out today?").
  // The band always carried both, which the Calendar does too, but one heading claimed both were
  // publications. A routine run does not go out anywhere, so each lane now names itself and the
  // Kicker above only says when.
  const groups = [
    { key: 'post', label: 'Going out', rows: slots.filter((s) => s.kind === 'post') },
    { key: 'run', label: 'Routines', rows: slots.filter((s) => s.kind === 'run') },
  ].filter((g) => g.rows.length);
  return (
    <>
      {slots.length ? <Kicker right={<Pressable onPress={() => setFolded((f) => !f)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Text style={{ ...F.mono(500), fontSize: 9.5, color: t.dim }}>{folded ? 'show' : 'fold'}</Text><Icon name="chevron" size={12} color={t.dim} /></Pressable>}>
        {`Today · ${slots.length}`}
      </Kicker> : null}
      {folded ? null : (
        // ONE CARD, NOT A ROW EACH (George, 2026-09-07: "going out today section should also be card
        // style background"). The day is one object, so it reads as the setup card above it does:
        // hairlines between the rows, the card's own edge around them. The card holds no padding of
        // its own — the rows go edge to edge so the `soon` wash reaches the border, and `overflow`
        // hands it the 12px radius.
        <Card style={{ marginTop: 0, paddingHorizontal: 0, paddingTop: 0, paddingBottom: 0, overflow: 'hidden' }}>
          <ScrollView style={{ maxHeight: BAND_MAX_H }} nestedScrollEnabled>
            {groups.map((g, gi) => (
              <View key={g.key}>
                <View style={{ paddingHorizontal: 13, paddingTop: gi ? 9 : 8, paddingBottom: 3, borderTopWidth: gi ? 1 : 0, borderTopColor: t.border }}>
                  <Text style={{ ...F.mono(500), fontSize: 9, letterSpacing: F.track, textTransform: 'uppercase', color: t.dim }}>{`${g.label} · ${g.rows.length}`}</Text>
                </View>
                {g.rows.map((s, i) => {
                  const mins = Math.round((s.at.getTime() - now) / 60_000);
                  const soon = s.kind === 'post' && mins >= 0 && mins <= SOON_MIN;
                  return (
                    <Pressable key={s.key} accessibilityLabel={s.title}
                      onPress={() => (s.kind === 'post' ? setPost(s.id) : router.push('/(tabs)/routines'))}
                      style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingHorizontal: 13, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: t.border, backgroundColor: soon ? `${t.warn}14` : 'transparent' }}>
                      <Text style={{ ...F.mono(500), fontSize: 11, color: soon ? t.warn : t.dim, minWidth: 36, paddingTop: 2 }}>{hhmm(s.at)}</Text>
                      <Icon name={s.kind === 'post' ? 'send' : 'routineClock'} size={14} color={soon ? t.warn : t.muted} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={{ ...F.body(500), fontSize: 13, color: t.text, lineHeight: 18 }} numberOfLines={2}>{s.title}</Text>
                        <Text style={{ ...F.mono(500), fontSize: 10.5, color: soon ? t.warn : t.dim, marginTop: 1 }} numberOfLines={1}>
                          {soon ? `in ${mins} min · ${s.sub}` : s.sub}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Card>
      )}
      {/* THE SHEET OPENS HERE, NOT ON A ROUTE (George, 2026-09-07: "the navigation away from the home
          screen and the white background when a user clicks a going out item isn't good user
          experience"). Home holds the rows AND the post rows already, so it can hold the sheet the
          way the Calendar does. Pushing a route slid Home away and put the sheet over a blank page. */}
      {openPost && workspace ? (
        <PostSheet workspace={workspace} item={openPost} roomSlug={slugOf(openPost.channel_id)}
          onClose={() => setPost(null)} onOpenThread={(id) => { setPost(null); router.push(`/thread/${id}`); }} />
      ) : null}
    </>
  );
}
