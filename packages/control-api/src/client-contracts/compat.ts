// does the current tree still serve a desktop it must serve? (docs/46, rules 2 and 4)
//
// `breaks(prev, next)` holds a newer contract snapshot to an older one and lists every way the
// newer one refuses what the older desktop sends or reads: a command, a field or a value that is
// gone, a field that became required, a type that narrowed, a route, a table, a column, a synced
// table, a lane, a frame or an agent contract that is gone. additions pass. pure data in, data out,
// so the test can plant a removal and prove the check catches it.
import type { Shape } from './zod-shape';

/** what `scripts/contract-snapshot.mjs` writes to contracts/desktop/<version>.json */
export interface ContractSnapshot {
  format: 1;
  version: string;
  commands: Record<string, Record<string, Shape>>;
  routes: string[];
  clientSchema: Record<string, string[]>;
  syncRules: Record<string, string[]>;
  relay: { frames: string[]; lanes: string[] };
  agents: string[];
}

/** one break: the desktop version it breaks, the contract item, and what changed */
export interface Break {
  version: string;
  item: string;
  problem: string;
}

/** the rule every break breaks, said once per failure (docs/46) */
export const RULE =
  'A desktop that this server must serve uses what this change removes or narrows: a supported desktop, or the candidate of a version bump. ' +
  'Rule 2 (docs/46): a contract change adds. It never removes or renames something that a supported desktop uses. ' +
  'Rule 3: a removal waits for the floor. Put the item back, or retire it and remove it two published desktops later (docs/46, "Remove something")';

export const formatBreak = (b: Break): string => `v${b.version} · ${b.item}: ${b.problem} (rule 2)`;

const quote = (v: unknown): string => JSON.stringify(v);
const describe = (s: Shape): string =>
  s.kind === 'literal' ? `the value ${quote(s.literal)}`
  : s.kind === 'enum' ? `one of ${(s.values ?? []).map(quote).join(', ')}`
  : s.kind === 'any' ? 'any value'
  : `${/^[aeiou]/.test(s.kind) ? 'an' : 'a'} ${s.kind}`;
const at = (path: string): string => (path ? `the field ${path} ` : '');

/** a shape that takes null: nullable, the null kind, any, or a union with one of those */
const takesNull = (n: Shape): boolean => !!n.nullable || n.kind === 'null' || n.kind === 'any' || (n.kind === 'union' && (n.options ?? []).some(takesNull));

/** the ways `n` refuses what `p` took, each one phrased with its field path */
export function shapeProblems(p: Shape, n: Shape, path = ''): string[] {
  const out: string[] = [];
  if (p.optional && !n.optional) out.push(`${at(path)}was optional and is now required`);
  return out.concat(optionProblems(p, n, path));
}

/** a shape without its field flag: whether it takes null, then its type */
const optionProblems = (p: Shape, n: Shape, path: string): string[] =>
  (p.nullable && !takesNull(n) ? [`${at(path)}took null and no longer does`] : []).concat(typeProblems(p, n, path));

const takes = (p: Shape, n: Shape): boolean => optionProblems(p, n, '').length === 0;
const ANY: Shape = { kind: 'any' };
const or = (s: Shape | undefined): Shape => s ?? ANY;

/** the kinds that compare across kinds (any, null, unions, values), or null when both kinds must match */
function crossProblems(p: Shape, n: Shape, path: string): string[] | null {
  if (n.kind === 'any' || p.kind === 'deep') return [];
  if (p.kind === 'null') return takesNull(n) ? [] : [`${at(path)}took null and no longer does`];
  if (p.kind === 'undefined') return n.optional || n.kind === 'undefined' ? [] : [`${at(path)}took undefined and no longer does`];
  if (p.kind === 'union') return (p.options ?? []).flatMap((o) => optionProblems(o, n, path));
  if (n.kind === 'union') return unionProblems(p, n.options ?? [], path);
  if (p.kind === 'literal') return literalTaken(p.literal, n) ? [] : [`${at(path)}no longer takes the value ${quote(p.literal)}`];
  if (p.kind === 'enum') return enumProblems(p, n, path);
  if (p.kind !== n.kind) return [`${at(path)}changed from ${describe(p)} to ${describe(n)}`];
  return null;
}

function typeProblems(p: Shape, n: Shape, path: string): string[] {
  const cross = crossProblems(p, n, path);
  if (cross) return cross;
  switch (p.kind) {
    case 'string': case 'number': return boundProblems(p, n, path);
    case 'array': return boundProblems(p, n, path).concat(shapeProblems(or(p.item), or(n.item), `${path}[]`));
    case 'object': return fieldProblems(p.fields ?? {}, n.fields ?? {}, path);
    case 'record': return typeProblems(or(p.key), or(n.key), `${path} key`).concat(shapeProblems(or(p.item), or(n.item), `${path}[key]`));
    case 'tuple': return tupleProblems(p.items ?? [], n.items ?? [], path);
    default: return [];
  }
}

/** the newer side is a union: some option must take the older shape whole */
function unionProblems(p: Shape, options: Shape[], path: string): string[] {
  if (options.some((o) => takes(p, o))) return [];
  const same = options.filter((o) => o.kind === p.kind);
  // one option of the same kind: its own problems are the precise answer
  if (same.length === 1) return optionProblems(p, same[0]!, path);
  return [`${at(path)}changed from ${describe(p)} to a union that does not take it`];
}

function literalTaken(v: Shape['literal'], n: Shape): boolean {
  if (n.kind === 'literal') return n.literal === v;
  if (n.kind === 'enum') return (n.values ?? []).includes(v as string | number);
  if (v === null) return takesNull(n);
  if (n.kind !== typeof v) return false;
  // a string or a number: the value must still pass the bounds, and a format cannot be read here
  return typeof v === 'string' ? !n.formats && withinBounds(v.length, n) : typeof v !== 'number' || (!n.formats && !(n.int && !Number.isInteger(v)) && withinBounds(v, n));
}

function withinBounds(x: number, n: Shape): boolean {
  if (n.length !== undefined && x !== n.length) return false;
  if (n.min !== undefined && (n.minOpen ? x <= n.min : x < n.min)) return false;
  return n.max === undefined || (n.maxOpen ? x < n.max : x <= n.max);
}

function enumProblems(p: Shape, n: Shape, path: string): string[] {
  const values = p.values ?? [];
  const gone = values.filter((v) => !literalTaken(v, n));
  if (!gone.length) return [];
  if (n.kind !== 'enum' && n.kind !== 'string' && n.kind !== 'number') return [`${at(path)}changed from ${describe(p)} to ${describe(n)}`];
  return [`${at(path)}no longer takes ${gone.map(quote).join(', ')}`];
}

/** a bound as the message says it: its value, and whether it excludes that value */
const bound = (v: number | undefined, open: true | undefined): string => (v === undefined ? 'none' : `${v}${open ? ' (open)' : ''}`);
/** the lower bound moved up: a value the older side took may now fail */
const rose = (p: Shape, n: Shape): boolean =>
  n.min !== undefined && (p.min === undefined || n.min > p.min || (n.min === p.min && !!n.minOpen && !p.minOpen));
const fell = (p: Shape, n: Shape): boolean =>
  n.max !== undefined && (p.max === undefined || n.max < p.max || (n.max === p.max && !!n.maxOpen && !p.maxOpen));
const UNIT: Record<string, string> = { string: 'length ', array: 'size ' };

function boundProblems(p: Shape, n: Shape, path: string): string[] {
  const out: string[] = [];
  const unit = UNIT[p.kind] ?? '';
  if (rose(p, n)) out.push(`${at(path)}minimum ${unit}rose from ${bound(p.min, p.minOpen)} to ${bound(n.min, n.minOpen)}`);
  if (fell(p, n)) out.push(`${at(path)}maximum ${unit}fell from ${bound(p.max, p.maxOpen)} to ${bound(n.max, n.maxOpen)}`);
  if (n.length !== undefined && n.length !== p.length) out.push(`${at(path)}${unit}is now fixed at ${n.length}`);
  if (n.int && !p.int) out.push(`${at(path)}now takes whole numbers only`);
  const had = new Set(p.formats ?? []);
  return out.concat((n.formats ?? []).filter((f) => !had.has(f)).map((f) => `${at(path)}now demands ${f}`));
}

function fieldProblems(prev: Record<string, Shape>, next: Record<string, Shape>, path: string): string[] {
  const out: string[] = [];
  const dot = (name: string): string => (path ? `${path}.${name}` : name);
  for (const [name, p] of Object.entries(prev)) {
    const n = next[name];
    out.push(...(n ? shapeProblems(p, n, dot(name)) : [`the field ${dot(name)} is gone`]));
  }
  for (const [name, n] of Object.entries(next)) {
    if (!(name in prev) && !n.optional) out.push(`the field ${dot(name)} is new and required, and a supported desktop does not send it`);
  }
  return out;
}

function tupleProblems(prev: Shape[], next: Shape[], path: string): string[] {
  if (prev.length !== next.length) return [`${at(path)}changed from ${prev.length} elements to ${next.length}`];
  return prev.flatMap((p, i) => shapeProblems(p, next[i]!, `${path}[${i}]`));
}

/** names in `prev` that `next` lacks */
const missing = (prev: string[], next: string[]): string[] => {
  const have = new Set(next);
  return prev.filter((x) => !have.has(x));
};

function tableBreaks(prev: ContractSnapshot, next: ContractSnapshot, add: (item: string, problem: string) => void): void {
  for (const [table, cols] of Object.entries(prev.clientSchema)) {
    const now = next.clientSchema[table];
    if (!now) add(`client schema table ${table}`, 'the table is gone');
    else for (const c of missing(cols, now)) add(`client schema column ${table}.${c}`, 'the column is gone');
  }
  for (const [table, cols] of Object.entries(prev.syncRules)) {
    const now = next.syncRules[table];
    if (!now) add(`sync rule for ${table}`, 'the sync rules no longer serve the table');
    else if (now.includes('*')) continue;
    else if (cols.includes('*')) add(`sync rule for ${table}`, 'the rule served every column (select *) and now lists some');
    else for (const c of missing(cols, now)) add(`sync rule column ${table}.${c}`, 'the rule no longer lists the column');
  }
}

/** every way `next` breaks the desktop that `prev` describes. empty means that desktop still works. */
export function breaks(prev: ContractSnapshot, next: ContractSnapshot): Break[] {
  const out: Break[] = [];
  const add = (item: string, problem: string): void => void out.push({ version: prev.version, item, problem });
  for (const [type, fields] of Object.entries(prev.commands)) {
    const now = next.commands[type];
    if (!now) add(`command ${type}`, 'the command type is gone');
    else for (const problem of fieldProblems(fields, now, '')) add(`command ${type}`, problem);
  }
  for (const r of missing(prev.routes, next.routes)) add(`route ${r}`, 'the route is gone');
  tableBreaks(prev, next, add);
  for (const l of missing(prev.relay.lanes, next.relay.lanes)) add(`relay lane ${l}`, 'the lane is gone');
  for (const f of missing(prev.relay.frames, next.relay.frames)) add(`relay frame ${f}`, 'the frame type is gone');
  for (const a of missing(prev.agents, next.agents)) add(`agent contract ${a}`, 'the contract file is gone');
  return out;
}
