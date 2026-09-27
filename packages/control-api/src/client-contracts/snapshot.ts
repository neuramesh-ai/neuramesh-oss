// the desktop contract of one tree (docs/46): the command union, the HTTP routes, the client
// schema, the sync rules, the relay's frames and lanes, and the agent contracts.
//
// `root` is any checkout of this repository with its dependencies in place, so the same code reads
// this tree (the compat test, the version bump) and an old tag (scripts/contract-snapshot.mjs
// --ref). each file is imported or read from `root`, never from this module's own tree. tooling
// only: the app never imports this module, so its devDependencies stay out of the bundle.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { ContractSnapshot } from './compat';
import { commandsOf } from './zod-shape';

/**
 * THE ONE LINE to change when the client schema moves: the module that holds it, relative to the
 * root. it may export `TABLE_COLUMNS` (table → column → type, the client-core form) or `AppSchema`
 * (a PowerSync Schema, the desktop form). `clientSchema()` reads either.
 */
export const CLIENT_SCHEMA_FILE = 'packages/client-core/src/schema.ts';
export const SYNC_RULES_FILE = 'dev/stack/powersync/sync-config.yaml';
export const RELAY_PROTOCOL_FILE = 'packages/relay/src/protocol.ts';
/** the items a tree says no desktop uses from its next snapshot on (docs/46, rule 3) */
export const RETIRED_FILE = 'packages/control-api/src/client-contracts/retired.ts';
/** route prefixes a desktop never calls: the cron, the fleet, the relay's validation and Stripe */
export const SERVER_ONLY_ROUTES = ['/internal/', '/webhooks/'];

const importTree = (root: string, rel: string): Promise<Record<string, unknown>> => import(pathToFileURL(join(root, rel)).href);
// code-unit order, never the locale's: a snapshot written on any machine has the same bytes
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** the client schema, as table → column names: the one adapter every reader goes through */
export async function clientSchema(root: string): Promise<Record<string, string[]>> {
  const m = await importTree(root, CLIENT_SCHEMA_FILE);
  const plain = m['TABLE_COLUMNS'] as Record<string, Record<string, string>> | undefined;
  const schema = m['AppSchema'] as { tables?: Array<{ name: string; columns: Array<{ name: string }> }> } | undefined;
  const tables: Array<[string, string[]]> = plain
    ? Object.entries(plain).map(([name, cols]) => [name, Object.keys(cols)])
    : (schema?.tables ?? []).map((t) => [t.name, t.columns.map((c) => c.name)]);
  if (!tables.length) throw new Error(`${CLIENT_SCHEMA_FILE} exports neither TABLE_COLUMNS nor AppSchema: change CLIENT_SCHEMA_FILE (docs/46)`);
  return Object.fromEntries(tables.sort(([a], [b]) => byName(a, b)).map(([name, cols]) => [name, [...cols].sort(byName)]));
}

/** the method and path of every route a client can call, sorted. middleware (method ALL) is not a route. */
export async function routesOf(root: string): Promise<string[]> {
  const { createApp } = (await importTree(root, 'packages/control-api/src/app.ts')) as { createApp: (store: unknown) => { routes: Array<{ method: string; path: string }> } };
  const { MemoryStore } = (await importTree(root, 'packages/control-api/src/store.ts')) as { MemoryStore: new () => unknown };
  const routes = createApp(new MemoryStore()).routes
    .filter((r) => r.method !== 'ALL' && !SERVER_ONLY_ROUTES.some((p) => r.path.startsWith(p)))
    .map((r) => `${r.method} ${r.path}`);
  return [...new Set(routes)].sort(byName);
}

/** split a select list at its top-level commas, and name each item as the client sees it */
function selected(list: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { items.push(cur); cur = ''; } else cur += ch;
  }
  items.push(cur);
  return items.map((item) => {
    const alias = /\s+as\s+("?)(\w+)\1\s*$/i.exec(item);
    return alias ? alias[2]! : item.trim().replace(/^\w+\./, '');
  });
}

/** the tables the sync rules serve, as table → columns (`*` for every column) */
export function syncRulesOf(root: string): Record<string, string[]> {
  // js-yaml is a devDependency of @neuramesh/shared: borrowed, so the control-api's lockfile stays as it is
  const yaml = createRequire(new URL('../../../shared/package.json', import.meta.url))('js-yaml') as { load(text: string): unknown };
  type Stream = { query?: unknown; queries?: unknown[]; data?: unknown[] };
  const doc = yaml.load(readFileSync(join(root, SYNC_RULES_FILE), 'utf8')) as { streams?: Record<string, Stream>; bucket_definitions?: Record<string, Stream> };
  const queries = [...Object.values(doc.streams ?? {}), ...Object.values(doc.bucket_definitions ?? {})]
    .flatMap((s) => [...(s.query === undefined ? [] : [s.query]), ...(s.queries ?? []), ...(s.data ?? [])]);
  const tables: Record<string, Set<string>> = {};
  for (const q of queries) {
    const m = typeof q === 'string' ? /^\s*select\s+([\s\S]+?)\s+from\s+"?([a-z_][a-z0-9_]*)"?/i.exec(q) : null;
    if (!m) throw new Error(`${SYNC_RULES_FILE}: a query the snapshot cannot read: ${String(q)}`);
    const cols = (tables[m[2]!] ??= new Set());
    for (const c of selected(m[1]!)) cols.add(c);
  }
  if (!Object.keys(tables).length) throw new Error(`${SYNC_RULES_FILE} serves no table the snapshot can read`);
  return Object.fromEntries(Object.keys(tables).sort(byName).map((t) => {
    const cols = [...tables[t]!];
    return [t, cols.includes('*') ? ['*'] : cols.sort(byName)];
  }));
}

/** the relay's frame types (channel frames and edge messages) and lanes, read from the protocol's types */
export function relayOf(root: string): { frames: string[]; lanes: string[] } {
  const file = join(root, RELAY_PROTOCOL_FILE);
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const fail = (what: string): never => { throw new Error(`${RELAY_PROTOCOL_FILE}: ${what}, so the snapshot cannot read the relay contract`); };
  const alias = (name: string): ts.TypeNode =>
    sf.statements.find((s): s is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(s) && s.name.text === name)?.type ?? fail(`no type ${name}`);
  const members = (t: ts.TypeNode): ts.TypeNode[] => (ts.isUnionTypeNode(t) ? [...t.types] : [t]);
  const text = (t: ts.TypeNode | undefined, name: string): string =>
    t && ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? t.literal.text : fail(`${name} is not a union of string literals`);
  const tag = (m: ts.TypeNode): string => {
    const t = ts.isTypeLiteralNode(m) ? m.members.find((p): p is ts.PropertySignature => ts.isPropertySignature(p) && p.name.getText(sf) === 't') : undefined;
    return text(t?.type, 'an EdgeMessage member without a literal t');
  };
  const frames = [...members(alias('FrameType')).map((t) => text(t, 'FrameType')), ...members(alias('EdgeMessage')).map(tag)];
  return { frames: frames.sort(byName), lanes: members(alias('ChannelLane')).map((t) => text(t, 'ChannelLane')).sort(byName) };
}

/**
 * the contract of the desktop that `root` builds. `retired` leaves out what that tree's RETIRED list
 * names: the snapshot a version bump writes. the compat test reads the tree whole, because the
 * server must keep a retired item until no supported snapshot has it.
 */
export async function snapshotTree(root: string, opts: { retired?: boolean } = {}): Promise<ContractSnapshot> {
  const { version } = JSON.parse(readFileSync(join(root, 'apps/desktop/package.json'), 'utf8')) as { version: string };
  const { CommandSchema } = await importTree(root, 'packages/control-api/src/commands.ts');
  const snap: ContractSnapshot = {
    format: 1,
    version,
    commands: commandsOf(CommandSchema),
    routes: await routesOf(root),
    clientSchema: await clientSchema(root),
    syncRules: syncRulesOf(root),
    relay: relayOf(root),
    agents: readdirSync(join(root, 'defaults/agents')).filter((f) => f.endsWith('.yaml')).sort(byName),
  };
  if (!opts.retired || !existsSync(join(root, RETIRED_FILE))) return snap;
  type Retire = { RETIRED: readonly string[]; withoutRetired: (s: ContractSnapshot, items: readonly string[]) => ContractSnapshot };
  const { RETIRED, withoutRetired } = (await importTree(root, RETIRED_FILE)) as Retire;
  return withoutRetired(snap, RETIRED);
}

/** JSON for a snapshot file: two-space indent, and any node whose line fits in 100 characters on one line */
export function stringifySnapshot(value: unknown, indent = '', lead = 0): string {
  const flat = JSON.stringify(value);
  if (value === null || typeof value !== 'object' || indent.length + lead + flat.length <= 100) return flat;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map((v) => inner + stringifySnapshot(v, inner)).join(',\n')}\n${indent}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
  const line = ([k, v]: [string, unknown]): string => `${inner}${JSON.stringify(k)}: ${stringifySnapshot(v, inner, JSON.stringify(k).length + 2)}`;
  return `{\n${entries.map(line).join(',\n')}\n${indent}}`;
}
