// THE PHASE DIAL (docs/35 §3.2): a ring filled to where the journey stands, in the state's hue. The
// fractions lived in the phone's session row; the desktop's ⌘Y overlay draws the same ring now
// (the thread-status round, 2026-09-08), so the table lives here and neither surface can drift.
const DIAL_AT: Record<string, number> = {
  backlog: 5, todo: 10, designing: 22, design_review: 32, planning: 40, plan_review: 50,
  in_progress: 62, in_review: 78, done: 86, accepted: 100, closed: 100, blocked: 50,
  shipping: 90, ship_review: 92, releasing: 95, verifying: 97,
};

/** 0..1, where the dial stands for a state — an unknown state sits at the middle */
export function dialFraction(state: string): number {
  return (DIAL_AT[state] ?? 50) / 100;
}
