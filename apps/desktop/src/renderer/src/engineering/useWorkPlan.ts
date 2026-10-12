import { useCallback, useEffect, useRef, useState } from 'react';
import { engineeringWorkPlanMessages } from '@neuramesh/shared';
import type { EngineeringSession } from './domain';

/** An unseen proposal fronts Work Plan once. Restored pending plans count as arrivals, but
 * historical plans in Act and plans behind a file approval never steal the review pane. */
export function workPlanArrival(seen: Set<string>, session: EngineeringSession | null): boolean {
  if (!session?.workPlan?.trim()) return false;
  const proposal = engineeringWorkPlanMessages(session).findLast((item) => item.kind === 'work_plan' && item.body === session.workPlan);
  if (!proposal) return false;
  const key = JSON.stringify([session.id, proposal?.id, session.workPlan]);
  if (seen.has(key)) return false;
  seen.add(key);
  return session.mode === 'plan' && session.pendingModeHandoff?.actionable === true && !session.pendingApproval;
}

export function useWorkPlan(session: EngineeringSession | null, show: () => void) {
  const seen = useRef(new Set<string>());
  const showRef = useRef(show);
  showRef.current = show;
  const [selection, setSelection] = useState<{ session: string; text: string } | null>(null);
  const id = session?.id ?? '';
  const open = useCallback((text?: string) => { setSelection(text ? { session: id, text } : null); showRef.current(); }, [id]);
  useEffect(() => { if (workPlanArrival(seen.current, session)) open(); }, [session, open]);
  return { open, text: selection?.session === id ? selection.text : null };
}
