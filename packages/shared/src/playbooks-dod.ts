// The two shape-contract DoD constants the playbook catalog shares (split from the registry for
// the 250-line gate; the registry re-exports them so importers keep one door).

export const REPORT_SHAPE_DOD =
  'The report is a markdown artifact named `<playbookId>-report-YYYY-MM-DD.md` (e.g. `audit-report-2026-08-20.md`) ' +
  'whose second line reads `<date> · Score: NN/100 · Basis: <what was actually accessed>`, ' +
  'carrying a `## Scorecard` table, a `## Fix these first` list with the fixes WRITTEN OUT (replacement copy, not descriptions), ' +
  'a `## What’s already working` section, and a `## What I couldn’t determine` section that names every gap honestly. ' +
  'Scores are heuristics and the report says so. Nothing invented: no fabricated statistics, testimonials or names — `[NEED: x]` and the gaps section instead.';

export const DOC_SHAPE_DOD =
  'The deliverable is a markdown artifact ending with a `## What I couldn’t determine` section that names every gap honestly. ' +
  'Nothing invented: no fabricated statistics, testimonials or names — `[NEED: x]` and the gaps section instead.';
