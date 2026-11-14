// The scenario registry: features.mjs runs these in order. Each scenario is
//   { id, title, needs?: ['browser' | 'personB' | 'model'], run(t, ctx) }
// and lives in the module of its area. Order matters:
//   - stall-arm first, so the feedback it leaves is old enough when stall-watchdog reads it last;
//   - the Free-plan caps (projects, the seat) before invite-join flips the plan to cloud;
//   - the live agent turns and the stall watchdog before invite-join, whose Team reshape moves the
//     crew's machine and mints a runner (it runs last and keeps the run at one awake machine).
import { agentsLive, stallArm } from './agents-live.mjs';
import { collab } from './collab.mjs';
import { content } from './content.mjs';
import { extras } from './extras.mjs';
import { machines } from './machines.mjs';
import { probe } from './probe.mjs';
import { r7 } from './r7.mjs';
import { r8Memory } from './r8-memory.mjs';
import { r8Ops } from './r8-ops.mjs';
import { r8Wake } from './r8-wake.mjs';
import { r9Intake } from './r9-intake.mjs';
import { tasks } from './tasks.mjs';
import { tenancy } from './tenancy.mjs';
import { workspace } from './workspace.mjs';

const byId = (list, id) => list.find((s) => s.id === id);

export const SCENARIOS = [
  ...probe,
  stallArm,
  ...tasks,
  ...workspace,
  ...content,
  ...extras,
  ...tenancy,
  // the r7 upstream features: after projects-rooms (project-work uses its room), before the live
  // agent turns (coding-progress parks the runner, and the agent turns wake it again)
  ...r7,
  // r8: project memory (D15) on the starter brain
  ...r8Memory,
  // r8: the speculative wake parks and wakes the runner, so it runs after the r7 features
  ...r8Wake,
  // the r8 ops decisions (D2 idle window and Always on, D14 solo vault). solo-vault is opt-in: it
  // invites, which collab's invite-join owns in a full run
  ...r8Ops,
  // r9: intake (the starter brain's decision on a first message), the scratch workspace and the narration
  ...r9Intake,
  ...agentsLive.filter((s) => s.id !== 'stall-watchdog'),
  byId(agentsLive, 'stall-watchdog'),
  // last: the cloud plan and the Team reshape mint machines, and the sandbox's machine budget is one
  ...collab,
  // opt-in (run only when FEATURES names them): they change the workspace for the rest of a run
  ...machines,
];
