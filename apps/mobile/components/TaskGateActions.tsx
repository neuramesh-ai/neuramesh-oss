// THE TASK GATE BUTTONS — what a human can do to this task, right now, on the phone.
//
// Split out of the task screen, where it was an 82-line switch inside a 354-line component.
// It is one question ("which moves are legal in this state?") with one answer per FSM state,
// and it reads only the task, the theme, and the handlers — so it is a component, not a
// closure that happened to be indented.
import { Link } from 'expo-router';
import { Text } from 'react-native';
import { useTheme } from '../src/theme';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { HumanCommandInput } from '@neuramesh/shared';
import { Btn } from '../src/kit';

/** the four commands this screen gates behind a feedback box — the screen's own state type */
export type FeedbackFor = null | 'task.request_changes' | 'task.revise_plan' | 'task.revise_ship_plan' | 'task.block';

export function TaskGateActions({ task, id, t, busy, run, setFeedbackFor }: {
  task: { state: string };
  id: string;
  /** INFERRED from useTheme, never restated — the palette gains tokens often */
  t: ReturnType<typeof useTheme>;
  busy: boolean;
  run: (cmd: HumanCommandInput) => Promise<unknown>;
  setFeedbackFor: Dispatch<SetStateAction<FeedbackFor>>;
}): ReactNode {
  switch (task.state) {
    case 'done':
      // ACCEPT IS THE HUMAN'S WORD (George, 2026-09-08): the button is gone. Say merge (or accept) in
      // the thread below and the orchestrator applies it, on the server's proof that you spoke.
      return (
        <>
          <Text style={{ flex: 1, alignSelf: 'center', color: t.muted, fontSize: 12.5, lineHeight: 18 }}>Review passed. Say merge here to land it.</Text>
          <Btn label="Request changes" disabled={busy} onPress={() => setFeedbackFor('task.request_changes')} style={{ flex: 1 }} />
        </>
      );
    case 'shipping':
      // the shipper is drafting: the human can still add another round of notes
      // (the revise self-loop) or accept straight past the gate — without these
      // a quiet shipper leaves the task with no legal move at all
      return (
        <>
          <Btn label="Request changes" disabled={busy} onPress={() => setFeedbackFor('task.revise_ship_plan')} style={{ flex: 1 }} />
          <Btn label="Skip the gate and accept" disabled={busy} onPress={() => run({ type: 'task.accept', taskId: id })} style={{ flex: 1 }} />
        </>
      );
    case 'ship_review':
      // the release gate (docs/23): approving the plan is the human sign-off that
      // arms the checklist — one tap from the phone; changes bounce to the shipper
      return (
        <>
          <Btn kind="primary" label="Approve release plan" disabled={busy} onPress={() => run({ type: 'task.approve_ship_plan', taskId: id })} style={{ flex: 1 }} />
          <Btn label="Request changes" disabled={busy} onPress={() => setFeedbackFor('task.revise_ship_plan')} style={{ flex: 1 }} />
        </>
      );
    case 'releasing':
      return null; // the checklist section below carries the actions (tick your items)
    case 'verifying':
      return null; // merged — the host is verifying the release; Accept (above) stays the override
    case 'design_review':
      return (
        <Link href={`/task/${id}/design`} asChild>
          <Btn kind="primary" label="Open design review" style={{ flex: 1 }} />
        </Link>
      );
    case 'plan_review':
      return (
        <Btn kind="primary" label="Request plan changes" disabled={busy} onPress={() => setFeedbackFor('task.revise_plan')} style={{ flex: 1 }} />
      );
    case 'blocked':
      return (
        <Btn kind="primary" label="Unblock" disabled={busy} onPress={() => run({ type: 'task.unblock', taskId: id })} style={{ flex: 1 }} />
      );
    case 'backlog':
      return (
        <Btn kind="primary" label="Promote to todo" disabled={busy} onPress={() => run({ type: 'task.promote', taskId: id })} style={{ flex: 1 }} />
      );
    case 'in_review':
    case 'accepted':
    case 'closed':
      return null;
    default:
      return (
        <Btn label="Block" color={t.blocked} disabled={busy} onPress={() => setFeedbackFor('task.block')} style={{ flex: 1 }} />
      );
  }
}
