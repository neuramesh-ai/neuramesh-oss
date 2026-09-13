# Code header destination guard — 2026-09-03

## Symptom

Opening a regular task from shared history while Code was the previously selected destination left
Code-only workspace chrome visible above the task: Code history/new controls plus Changes, Files,
Work Plan, Checkpoints, and Terminal.

## Root cause

`App.tsx` mounted `EngineeringWorkspaceHeader` whenever the remembered `view` was `engineering` and
the conversation tab was active. Shared-history task/chat navigation changes `openTaskId` or
`openThreadId` without changing that remembered destination. The regular session therefore owned the
body while the stale Code destination still owned the workspace-strip context.

## Fix

The Code context now also requires that no regular task or conversation is open:

`view === 'engineering' && convOn && !openTaskId && !openThreadId`

This preserves the user's underlying Code destination so closing the regular session returns to Code,
while ensuring only the surface that currently owns the conversation supplies the strip chrome.

## Verification

- A regression test was added to `engineering/layout.test.ts`; it failed before the guard and passes
  after it.
- The complete desktop suite passes: 1,152 tests, 0 failures.
- Desktop TypeScript typecheck passes.
- Live web reproduction passed: Code → Search threads → `#1005 · Set up your marketing HQ` hides all
  Code-specific chrome; closing that marketing task restores the Code header and workspace tools.
- Screenshot: `docs/design/engineering-os-2026-08/validation/2026-09-03-code-header-scope/marketing-task-no-code-chrome.png`.

## Status

DONE
