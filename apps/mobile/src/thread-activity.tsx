// WHO IS WORKING RIGHT NOW, and what a person waiting on an answer is told.
// Split out of src/thread.tsx (track D).
//
// Everything here derives from synced truth (agents.status flips through the enforced
// agent.set_status command; machines.last_seen_at heartbeats; the fleet's own intent through the
// compute store) or from the local upload queue. The strip can never invent a state the team does
// not share, and it never speaks for a machine that is not answering THIS thread.
//
// The dots-and-a-sentence version is gone. One anatomy, LiveLine: the thinking orb, then who and
// what — the same idiom the session list uses for a live row (George, 2026-09-06: "it should be
// showing live thinking orbs").
import { WAIT_RETRY, WAIT_TICK_MS } from '@neuramesh/shared';
import { stripLineFor } from './strip-rule';
import { useQuery } from '@powersync/react-native';
import { useEffect, useState } from 'react';

import { currentUserId } from './auth';
import { useTheme } from './theme';
import { useCompute } from './compute';
import { getDb } from './system';
import { LiveLine } from './thread-parts';
import { useActiveWorkspace } from './ui';

export function ActivityStrip({ channelId, threadId, awaiting, machineId }: {
  channelId: string;
  /** this conversation, so a wake that died can be told apart from one in another room */
  threadId?: string | null;
  /** THE MESSAGE NOBODY HAS ANSWERED — the newest row, when a human wrote it. The desktop's own
   *  first condition, carrying the two things the deadline needs: when it was sent, and how to
   *  send it again. Null when an agent spoke last, which is a thread waiting on nothing. */
  awaiting?: { atMs: number; retry: () => void | Promise<void> } | null;
  /** the machine this conversation was born on, when it named one (threads.machine_id) */
  machineId?: string | null;
}) {
  // EVERY AGENT IN THE ROOM, not only the busy ones. The strip needs two answers from one read:
  // who is working right now, and who WILL answer if nobody is yet.
  const t = useTheme();
  const { data: crew } = useQuery<{ id: string; name: string; emoji: string | null; role: string; status: string }>(
    `select a.id, a.name, a.emoji, a.role, a.status from agents a
     join agent_channels ac on ac.agent_id = a.id
     where ac.channel_id = ? and a.retired_at is null order by a.name`,
    [channelId],
  );
  // A WAKE THAT DIED IS SYNCED TRUTH, AND NOTHING WAS READING IT (George, 2026-09-07: "it
  // dissapears again and nothing happens"). The daemon opens a run for the message, and when the
  // turn throws it writes state='failed' with the reason in `summary` — "starter brain unavailable
  // (503)" for the very send that produced this comment. The row reaches the phone and the strip
  // kept promising an answer that was never coming. Same ruling as the dropped send and the
  // reconnect banner: the surface does not get to discard the evidence.
  const { data: lastRun } = useQuery<{ agent_id: string | null; state: string; summary: string | null; started_at: string }>(
    'select agent_id, state, summary, started_at from runs where thread_id = ? order by started_at desc limit 1',
    [threadId ?? ''],
  );

  // scoped (0113): "someone's machine is online" must mean THIS workspace's machine — another
  // workspace's live heartbeat would otherwise make an offline room look staffed
  const stripWs = useActiveWorkspace();
  const { data: machines } = useQuery<{ id: string; last_seen_at: string | null }>('select id, last_seen_at from machines where workspace_id = ?', [stripWs ?? '']);
  // the fleet's own intent, which the replica does not carry: `desired_replicas` is outside the
  // publication, so without this store a machine mid-cold-start is indistinguishable from a dead one
  const compute = useCompute(stripWs);

  // ps_crud is PowerSync-internal (not a watched user table), so useQuery would never
  // re-fire for it — poll it while the screen is mounted instead.
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const rows = await getDb().getAll<{ n: number }>('select count(*) as n from ps_crud');
        if (alive) setPending(rows[0]?.n ?? 0);
      } catch {
        /* db mid-close (sign-out) — keep the last value */
      }
    };
    void tick();
    const iv = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);
  // staleness decays with time even when no machine row changes, and the wait deadline is a clock
  // read too — one timer answers both. WAIT_TICK_MS, because minute-granularity copy needs no more.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), WAIT_TICK_MS);
    return () => clearInterval(iv);
  }, []);
  const [retrying, setRetrying] = useState(false);

  // ONE MACHINE SPEAKS HERE, AND IT IS THE ONE THAT WILL ANSWER THIS THREAD.
  //
  // This used to scan every machine in the workspace and take the first with something to say. In a
  // Team workspace that is a lie by construction: `asleep` is the RESTING state of most machines,
  // and every message runs bumpMachineWake, which lifts desired_replicas on the sender's own member
  // machine too. So George's thread announced "The cloud machine starts now." about a machine that
  // had nothing to do with it, while the runner serving the thread was up and green at the top of
  // the screen (2026-09-06).
  //
  // The thread names its machine at birth. Failing that, the pill's machine is the answer, because
  // the pill and this strip must never speak for two different boxes.
  const me = currentUserId();
  const servingId = machineId ?? compute.pillFor(me)?.intent.id ?? null;
  const servingSeen = (machines ?? []).find((m) => m.id === servingId)?.last_seen_at ?? null;
  const serving = servingId ? compute.stateOf(servingId, servingSeen) : null;

  // The decision lives in strip-rule.ts, pure and pinned (the desktop's waitghost-rule split,
  // applied here): this component's job is to render one line, not to decide which.
  const line = stripLineFor({
    crew: crew ?? [], awaitingAtMs: awaiting?.atMs ?? null, pending,
    run: (lastRun ?? [])[0] ?? null, machine: serving?.status, now,
  });
  if (!line) return null;
  return (
    <LiveLine
      {...(line.who ? { who: line.who } : {})}
      verb={line.verb}
      still={line.still}
      {...(line.warn ? { tone: t.warn } : {})}
      {...(line.retry && awaiting
        // Retry = say it again, which is what a person does anyway. It re-fires the daemon's live
        // message watch AND re-bumps the machine, so it rides the proven path rather than a
        // second one nobody exercises.
        ? { action: {
            label: WAIT_RETRY,
            busy: retrying,
            onPress: () => { setRetrying(true); void Promise.resolve(awaiting.retry()).finally(() => setRetrying(false)); },
          } }
        : {})}
    />
  );
}
