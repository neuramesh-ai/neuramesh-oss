// THE APPROVED PLAN REACHES THE BUILDER (2026-08-18 audit, defect A3).
//
// Plan-first's premise is that the human-approved plan governs the build — but work_plan.approach
// was injected into no prompt at all (the daemon read it only for design-leg routing), and the
// worker got title + checklist, re-deriving the approach the human just signed off. This note
// rides the attachments note (flows.ts) so every runtime carries it, rework rounds included.
import type { PowerSyncDatabase } from '@powersync/node';
import type { LogFn } from '../agentlog';

const DESCRIPTION_CAP = 2_000;
const APPROACH_CAP = 6_000;

export async function approvedPlanNote(db: PowerSyncDatabase, taskId: string, log?: LogFn): Promise<string> {
  const [row] = await db.getAll<{ description: string | null; work_plan: string | null }>(
    'select description, work_plan from tasks where id = ?', [taskId],
  ).catch(() => [] as Array<{ description: string | null; work_plan: string | null }>);
  let note = '';
  if (row?.description?.trim()) note += `\n\nTask description (the intake record):\n${row.description.trim().slice(0, DESCRIPTION_CAP)}\n`;
  try {
    const wp = row?.work_plan ? (JSON.parse(row.work_plan) as { approach?: unknown }) : null;
    const approach = typeof wp?.approach === 'string' ? wp.approach.trim() : '';
    if (approach) {
      note += `\n\nTHE APPROVED IMPLEMENTATION PLAN — the human signed off on this; build to it, and flag any departure in your summary:\n${approach.slice(0, APPROACH_CAP)}\n`;
      log?.({ kind: 'tool', phase: 'inject', summary: `approved plan injected (${Math.min(approach.length, APPROACH_CAP)} chars)` });
    }
  } catch { /* malformed work_plan json — the checklist still governs */ }
  return note;
}
