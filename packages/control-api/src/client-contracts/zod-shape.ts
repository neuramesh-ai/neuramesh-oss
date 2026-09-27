// the input shape of a zod v3 schema, as plain data a snapshot can hold (docs/46).
//
// it walks `_def`, the tree zod v3 builds, and never imports zod. that is the point: a snapshot of
// an OLDER tree reads that tree's own zod objects, and the shape it writes is the same shape the
// compat check later reads back. only what decides which inputs pass is kept: kinds, optional and
// nullable, literal and enum values, length and size bounds, and string formats. a refinement is a
// function, so it is invisible here, and docs/46 says so.

/** one node of an input shape. bounds mean length for a string, size for an array, value for a number. */
export interface Shape {
  kind: string;
  /** the caller may leave the field out: `.optional()`, `.default()` or `.catch()` (which takes any input) */
  optional?: true;
  nullable?: true;
  literal?: string | number | boolean | null;
  /** enum values, sorted */
  values?: Array<string | number>;
  fields?: Record<string, Shape>;
  /** the element of an array or a set, the value of a record or a map */
  item?: Shape;
  key?: Shape;
  /** the options of a union */
  options?: Shape[];
  /** the elements of a tuple */
  items?: Shape[];
  min?: number;
  max?: number;
  length?: number;
  /** a number bound that excludes its own value (`.positive()` is min 0, open) */
  minOpen?: true;
  maxOpen?: true;
  int?: true;
  /** checks that narrow a string or a number past its bounds: uuid, email, regex:…, multipleOf:… */
  formats?: string[];
}

type Def = Record<string, unknown> & { typeName?: string };
type Check = { kind: string; value?: unknown; inclusive?: boolean; regex?: RegExp; message?: unknown };

const defOf = (schema: unknown): Def => ((schema as { _def?: Def } | null)?._def ?? {});
// code-unit order, never the locale's: a snapshot written on any machine has the same bytes
const sorted = <T extends string | number>(xs: T[]): T[] => [...xs].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
// string checks that change the value rather than decide whether it passes
const TRANSFORMS = new Set(['trim', 'toLowerCase', 'toUpperCase']);
// a lazy schema can refer to itself: stop, never loop
const MAX_DEPTH = 40;

function tighterMin(s: Shape, value: number, open: boolean): void {
  if (s.min === undefined || value > s.min || (value === s.min && open)) {
    s.min = value;
    if (open) s.minOpen = true;
    else delete s.minOpen;
  }
}

function tighterMax(s: Shape, value: number, open: boolean): void {
  if (s.max === undefined || value < s.max || (value === s.max && open)) {
    s.max = value;
    if (open) s.maxOpen = true;
    else delete s.maxOpen;
  }
}

/** a check that is not a bound, written so two trees compare it as text */
function formatOf(c: Check): string {
  if (c.kind === 'regex' && c.regex) return `regex:/${c.regex.source}/${c.regex.flags}`;
  const rest = Object.fromEntries(Object.entries(c).filter(([k, v]) => k !== 'kind' && k !== 'message' && v !== undefined));
  return Object.keys(rest).length ? `${c.kind}:${JSON.stringify(rest, Object.keys(rest).sort())}` : c.kind;
}

function withChecks(kind: 'string' | 'number', checks: unknown): Shape {
  const s: Shape = { kind };
  const formats: string[] = [];
  for (const c of (checks ?? []) as Check[]) {
    const value = typeof c.value === 'number' ? c.value : undefined;
    if (c.kind === 'min' && value !== undefined) tighterMin(s, value, kind === 'number' && c.inclusive === false);
    else if (c.kind === 'max' && value !== undefined) tighterMax(s, value, kind === 'number' && c.inclusive === false);
    else if (c.kind === 'length' && value !== undefined) s.length = value;
    else if (c.kind === 'int') s.int = true;
    else if (!TRANSFORMS.has(c.kind)) formats.push(formatOf(c));
  }
  if (formats.length) s.formats = sorted(formats);
  return s;
}

function withSizes(s: Shape, min: unknown, max: unknown, exact: unknown): Shape {
  const n = (x: unknown): number | undefined => (x as { value?: number } | null)?.value;
  if (n(min) !== undefined) s.min = n(min);
  if (n(max) !== undefined) s.max = n(max);
  if (n(exact) !== undefined) s.length = n(exact);
  return s;
}

function objectOf(shape: unknown, depth: number): Shape {
  const record = (typeof shape === 'function' ? (shape as () => Record<string, unknown>)() : shape) as Record<string, unknown>;
  const fields: Record<string, Shape> = {};
  for (const name of Object.keys(record).sort()) fields[name] = shapeAt(record[name], depth + 1);
  return { kind: 'object', fields };
}

const enumValues = (values: unknown): Array<string | number> =>
  Array.isArray(values)
    ? sorted(values as string[])
    // a native TS enum maps names to values and numbers back to names: keep the values
    : sorted(Object.entries(values as Record<string, string | number>).filter(([k]) => Number.isNaN(Number(k))).map(([, v]) => v));

/** the wrappers: they add a flag or hand the walk to the schema inside */
function unwrap(d: Def, depth: number): Shape | null {
  const inner = (x: unknown): Shape => shapeAt(x, depth + 1);
  switch (d.typeName) {
    case 'ZodOptional': case 'ZodDefault': return { ...inner(d['innerType']), optional: true };
    // a caught field takes any input: a value that fails becomes the catch value
    case 'ZodCatch': return { kind: 'any', optional: true };
    case 'ZodNullable': return { ...inner(d['innerType']), nullable: true };
    case 'ZodEffects': return inner(d['schema']);
    case 'ZodBranded': return inner(d['type']);
    case 'ZodReadonly': return inner(d['innerType']);
    // a pipeline's caller sends what its first schema takes
    case 'ZodPipeline': return inner(d['in']);
    case 'ZodLazy': return inner((d['getter'] as () => unknown)());
    default: return null;
  }
}

/** the kinds that carry nothing past their name */
const LEAVES: Record<string, string> = { ZodBoolean: 'boolean', ZodAny: 'any', ZodUnknown: 'any', ZodUndefined: 'undefined', ZodVoid: 'undefined', ZodNull: 'null' };

function shapeAt(schema: unknown, depth: number): Shape {
  if (depth > MAX_DEPTH) return { kind: 'deep' };
  const d = defOf(schema);
  const wrapped = unwrap(d, depth);
  if (wrapped) return wrapped;
  const leaf = LEAVES[d.typeName ?? ''];
  if (leaf) return { kind: leaf };
  const inner = (x: unknown): Shape => shapeAt(x, depth + 1);
  switch (d.typeName) {
    case 'ZodString': return withChecks('string', d['checks']);
    case 'ZodNumber': return withChecks('number', d['checks']);
    case 'ZodLiteral': return { kind: 'literal', literal: d['value'] as Shape['literal'] };
    case 'ZodEnum': case 'ZodNativeEnum': return { kind: 'enum', values: enumValues(d['values']) };
    case 'ZodObject': return objectOf(d['shape'], depth);
    case 'ZodArray': return withSizes({ kind: 'array', item: inner(d['type']) }, d['minLength'], d['maxLength'], d['exactLength']);
    case 'ZodSet': return withSizes({ kind: 'array', item: inner(d['valueType']) }, d['minSize'], d['maxSize'], null);
    case 'ZodRecord': case 'ZodMap': return { kind: 'record', key: inner(d['keyType']), item: inner(d['valueType']) };
    case 'ZodUnion': case 'ZodDiscriminatedUnion': return { kind: 'union', options: (d['options'] as unknown[]).map(inner) };
    case 'ZodTuple': return { kind: 'tuple', items: (d['items'] as unknown[]).map(inner) };
    // an intersection, a date, a bigint and the rest are held by name: a changed name is a changed type
    default: return { kind: (d.typeName ?? 'unknown').replace(/^Zod/, '').toLowerCase() };
  }
}

/** the input shape of one zod schema */
export const shapeOf = (schema: unknown): Shape => shapeAt(schema, 0);

/**
 * the command union as type → fields. the union's own discriminator (`type`) is the key, so it is
 * left out of each command's fields. anything that is not a discriminated union of objects is an
 * error: a snapshot that silently read nothing would pass every check.
 */
export function commandsOf(union: unknown): Record<string, Record<string, Shape>> {
  const d = defOf(union);
  const key = d['discriminator'];
  if (d.typeName !== 'ZodDiscriminatedUnion' || typeof key !== 'string') {
    throw new Error(`CommandSchema is ${d.typeName ?? 'not a zod schema'}, not a discriminated union: the snapshot cannot read it`);
  }
  const out: Record<string, Record<string, Shape>> = {};
  for (const option of d['options'] as unknown[]) {
    const s = shapeOf(option);
    const tag = s.fields?.[key];
    if (s.kind !== 'object' || tag?.kind !== 'literal' || typeof tag.literal !== 'string') {
      throw new Error(`a CommandSchema member has no literal "${key}": the snapshot cannot name it`);
    }
    const { [key]: _tag, ...fields } = s.fields ?? {};
    out[tag.literal] = fields;
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]!]));
}
