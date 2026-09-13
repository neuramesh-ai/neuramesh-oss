// NM_LOCAL=1: the stack a person runs on their own machine (docs/local-mode.md). ONE predicate,
// read at every plan gate, so Free on the local stack carries every entitlement while the stored
// plan stays 'free' and the UI keeps saying Free. Enforced where the cap is decided, never in a
// prompt: seats (handler/workspace.ts), projects (handler/project.ts), schedules
// (handler/schedule.ts), cloud machines (handler/machine.ts), one machine per member
// (pgstore.registerMachine), attachments (app.ts). The starter brain is the one door that stays
// shut here — its key lives on the cloud and never reaches a machine (credits.ts).
export const localMode = (): boolean => process.env['NM_LOCAL'] === '1';
