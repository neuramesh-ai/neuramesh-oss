// The command union lives in @neuramesh/shared since 2026-09-27 (src/command-union.ts), so the
// browser client and the phone type their commands against the one this server parses (the
// decoupling plan, phase 3). This path stays: every handler imports it, and the contract snapshot
// (client-contracts/snapshot.ts) reads the union from it in each tree, old tags included (docs/46).
export { ActorSchema, CommandSchema, type Command, type CommandInput } from '@neuramesh/shared/command-union';
