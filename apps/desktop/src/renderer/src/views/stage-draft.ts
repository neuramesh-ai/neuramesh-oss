// What the Home composer holds when a door hands it a draft (NewChatStage's composeSignal).
//
// Two kinds of draft reach it. A DOOR draft is what a person just asked for: a playbook pill, New
// routine, a suggestion card. It replaces the box, because the person chose it. A SEED draft is the
// app's own offer: the first-send intro ("@rex introduce yourself..."). It must never replace what the
// person typed. The intro is seeded when `welcomed` resolves, which is a network read that can land
// seconds after Home paints, so a person who starts to type at once (the static shell even invites it)
// lost the text to the intro and sent the intro instead (live build f4f9c91a, 2026-11-06).

/** the box's next text: `current` is what it holds now, `incoming` the handed draft (null: none) */
export function adoptDraft(current: string, incoming: string | null | undefined, seed: boolean): string {
  if (incoming == null) return current;
  if (seed && current.trim()) return current;
  return incoming;
}
