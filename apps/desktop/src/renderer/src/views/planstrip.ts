// THE PLAN STRIP's one rule (the source-release round, U3b: the foot's face and the top dock's
// account menu draw the same strip). The words are Free and Pro (shared entitlements, unit U5).
// A LOCAL connection has no plan: Free is the whole product on this Mac, and the face already
// carries the Get Pro door in its connections block, so the strip is ABSENT there, never a
// disabled row. On a hosted connection the strip names the plan and, on Free, opens the
// Upgrade sheet. No project count: Free has no project cap (the Upgrade sheet says so).
export const PLAN_STRIP_COPY = {
  pro: { name: 'Pro', sub: 'The hosted cloud' },
  free: { name: 'Free', sub: 'Reads stay. Pro turns writes back on.', door: 'Get Pro' },
} as const;

export interface PlanStrip { name: string; sub: string; door: string | null; pro: boolean }

export function planStripFor(input: { local: boolean; isCloud: boolean }): PlanStrip | null {
  if (input.local) return null;
  if (input.isCloud) return { ...PLAN_STRIP_COPY.pro, door: null, pro: true };
  return { name: PLAN_STRIP_COPY.free.name, sub: PLAN_STRIP_COPY.free.sub, door: PLAN_STRIP_COPY.free.door, pro: false };
}
