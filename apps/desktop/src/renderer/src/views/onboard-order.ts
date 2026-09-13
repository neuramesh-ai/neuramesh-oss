// THE WIZARD'S STEPS, PER CLIENT AND PER RESUME (the source-release round, unit U3a). The browser
// mints its workspace at its FIRST step so the fleet has an id to provision against. The desktop
// mints at Launch. Since the first hosted sign-in creates the person's first workspace on the
// server (control-api first-workspace.ts), a desktop that boots into that unfinished workspace
// RESUMES it (wsident.ts), and the Workspace step has no job left: its name and address exist.
// Keeping the step would ask for a name the Launch step cannot apply, and the old Launch
// handler would have minted a second workspace beside the first. So the step is absent.
export const DESKTOP_ORDER = ['machine', 'keys', 'workspace', 'team', 'launch'] as const;
export const WEB_ORDER = ['workspace', 'machine', 'keys', 'team', 'launch'] as const;
export type StepId = (typeof DESKTOP_ORDER)[number];

/** the browser keeps its order on a resume (it starts at step 2, Onboarding.tsx); the desktop drops the Workspace step */
export function onboardOrderFor(input: { web: boolean; resume: boolean }): readonly StepId[] {
  if (input.web) return WEB_ORDER;
  return input.resume ? DESKTOP_ORDER.filter((s) => s !== 'workspace') : DESKTOP_ORDER;
}
