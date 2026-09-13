// The machine chip's forecast LIVES IN @neuramesh/shared now (the mobile-cloud round, S1.2 — the
// phone's chip reads the same rungs). Re-exported so every importer here keeps its path.
export { choosableMachines, cloudMachineFor, forecastMachine, designationFor, machineKindLabel } from '@neuramesh/shared';
export type { ChoiceMachine, MachineForecast } from '@neuramesh/shared';
