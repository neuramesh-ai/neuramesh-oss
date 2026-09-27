// the way out for a contract item (docs/46, rule 3: a removal waits for the floor).
//
// a snapshot records what the server OFFERS at a version, because that is what the tree can show.
// so an item that a desktop stopped using still sits in every new snapshot, and it could never
// leave. a line here says "no desktop from the next version on uses this item". the next version
// bump leaves it out of its snapshot. once two desktops without it are published and
// SUPPORTED_DESKTOP_VERSIONS names them, no snapshot the compat test holds has it: the server may
// drop it, and the line goes with it.
//
// each item is named the way a break names it. a line needs the PR that stopped the use, and the
// review checks the claim: a desktop that still uses a retired item breaks in silence two
// releases later.
import type { ContractSnapshot } from './compat';

/** items no desktop uses from the next snapshot on: `command task.offer field checklist`, `route GET /v1/x`, … */
export const RETIRED: readonly string[] = [];

type Apply = (s: ContractSnapshot, m: RegExpExecArray) => void;

const drop = <T>(xs: T[], x: T): T[] => xs.filter((y) => y !== x);

// the item grammar: the words a break uses for the same item
const GRAMMAR: Array<[RegExp, Apply]> = [
  [/^command (\S+)$/, (s, m) => { delete s.commands[m[1]!]; }],
  [/^command (\S+) field (\S+)$/, (s, m) => { delete s.commands[m[1]!]?.[m[2]!]; }],
  [/^route (\S+ \S+)$/, (s, m) => { s.routes = drop(s.routes, m[1]!); }],
  [/^client schema table (\w+)$/, (s, m) => { delete s.clientSchema[m[1]!]; }],
  [/^client schema column (\w+)\.(\w+)$/, (s, m) => { if (s.clientSchema[m[1]!]) s.clientSchema[m[1]!] = drop(s.clientSchema[m[1]!]!, m[2]!); }],
  [/^sync rule for (\w+)$/, (s, m) => { delete s.syncRules[m[1]!]; }],
  [/^sync rule column (\w+)\.(\w+)$/, (s, m) => { if (s.syncRules[m[1]!]) s.syncRules[m[1]!] = drop(s.syncRules[m[1]!]!, m[2]!); }],
  [/^relay lane (\S+)$/, (s, m) => { s.relay.lanes = drop(s.relay.lanes, m[1]!); }],
  [/^relay frame (\S+)$/, (s, m) => { s.relay.frames = drop(s.relay.frames, m[1]!); }],
  [/^agent contract (\S+)$/, (s, m) => { s.agents = drop(s.agents, m[1]!); }],
];

/** the snapshot without the retired items. an item the grammar cannot read is an error, never skipped. */
export function withoutRetired(snap: ContractSnapshot, items: readonly string[]): ContractSnapshot {
  const out = structuredClone(snap);
  for (const item of items) {
    const rule = GRAMMAR.map(([re, apply]) => [re.exec(item), apply] as const).find(([m]) => m);
    if (!rule) throw new Error(`RETIRED: "${item}" names no contract item (docs/46 lists the forms)`);
    rule[1](out, rule[0]!);
  }
  return out;
}
