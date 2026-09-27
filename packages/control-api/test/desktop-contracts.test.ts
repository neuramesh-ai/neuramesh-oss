// the desktops this tree must serve still work against it (docs/46, rule 4).
//
// contracts/desktop/<version>.json is the contract of each desktop, written in its version-bump PR
// by scripts/contract-snapshot.mjs. this suite snapshots the CURRENT tree the same way and holds it
// to each supported desktop (SUPPORTED_DESKTOP_VERSIONS: the two newest published ones) and to each
// snapshot newer than the newest supported one: the candidate of a bump that is not published yet.
// a command, a field, a value, a route, a client table or column, a synced table, a relay lane or
// frame, or an agent contract that such a desktop uses may not go, and a field may not narrow or
// become required. additions pass. an older snapshot is not held: that desktop is below the floor.
//
// the planted cases come first: a check that cannot fail passes every tree.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareVersions, SUPPORTED_DESKTOP_VERSIONS } from '@neuramesh/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { breaks, formatBreak, RULE, type ContractSnapshot } from '../src/client-contracts/compat';
import { RETIRED, withoutRetired } from '../src/client-contracts/retired';
import { snapshotTree, stringifySnapshot } from '../src/client-contracts/snapshot';
import { shapeOf, type Shape } from '../src/client-contracts/zod-shape';

const repo = join(import.meta.dirname, '../../..');
const dir = join(repo, 'contracts/desktop');
const snapshots = readdirSync(dir)
  .filter((f) => /^\d+\.\d+\.\d+\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as ContractSnapshot)
  .sort((a, b) => compareVersions(b.version, a.version));
const desktopVersion = (JSON.parse(readFileSync(join(repo, 'apps/desktop/package.json'), 'utf8')) as { version: string }).version;
/** newest first: each snapshot newer than the newest supported desktop (a candidate), then each supported one */
const held = snapshots.flatMap((snap): Array<{ snap: ContractSnapshot; why: string }> =>
  compareVersions(snap.version, SUPPORTED_DESKTOP_VERSIONS[0]) > 0 ? [{ snap, why: 'the candidate of a bump, not published yet' }]
  : (SUPPORTED_DESKTOP_VERSIONS as readonly string[]).includes(snap.version) ? [{ snap, why: 'supported' }]
  : []);

let current: ContractSnapshot;
beforeAll(async () => {
  current = await snapshotTree(repo);
}, 120_000);

/** the current contract, as if it were a published desktop's */
const asPublished = (): ContractSnapshot => ({ ...structuredClone(current), version: '9.9.9' });
const said = (prev: ContractSnapshot, next: ContractSnapshot): string[] => breaks(prev, next).map(formatBreak);

/** the first command field the predicate picks (task.claim is the command the cases remove or grow) */
function pick(pred: (s: Shape) => boolean): { type: string; name: string; shape: Shape } {
  for (const [type, fields] of Object.entries(current.commands)) {
    if (type === 'task.claim') continue;
    for (const [name, shape] of Object.entries(fields)) if (pred(shape)) return { type, name, shape };
  }
  throw new Error('no command field fits the planted case');
}

/** the planted cases find their targets in the current tree, so a later legal removal never breaks them */
const first = <T>(xs: T[], what: string): T => xs[0] ?? (() => { throw new Error(`the current tree has no ${what}`); })();

describe('the check fails on a planted removal', () => {
  it('a command type, a field and a nested field that are gone', () => {
    const prev = asPublished();
    const next = asPublished();
    const nested = pick((s) => s.kind === 'object' && Object.keys(s.fields ?? {}).length > 0);
    const inner = Object.keys(nested.shape.fields!)[0]!;
    const field = pick((s) => s.kind === 'string' && !s.optional);
    delete next.commands['task.claim'];
    delete next.commands[field.type]![field.name];
    delete next.commands[nested.type]![nested.name]!.fields![inner];
    expect(new Set(said(prev, next))).toEqual(new Set([
      `v9.9.9 · command ${field.type}: the field ${field.name} is gone (rule 2)`,
      `v9.9.9 · command ${nested.type}: the field ${nested.name}.${inner} is gone (rule 2)`,
      'v9.9.9 · command task.claim: the command type is gone (rule 2)',
    ]));
  });

  it('an optional field made required, a new required field, a value removed, a bound narrowed, a type changed', () => {
    const prev = asPublished();
    const next = asPublished();
    const optional = pick((s) => !!s.optional && s.kind === 'string');
    const enumField = pick((s) => s.kind === 'enum' && (s.values ?? []).length > 1);
    const capped = pick((s) => s.kind === 'string' && s.max !== undefined && !s.optional);
    const numeric = pick((s) => s.kind === 'number');
    const gone = enumField.shape.values![0]!;
    delete next.commands[optional.type]![optional.name]!.optional;
    next.commands['task.claim']!['reason'] = { kind: 'string' };
    next.commands[enumField.type]![enumField.name]!.values = enumField.shape.values!.slice(1);
    next.commands[capped.type]![capped.name]!.max = capped.shape.max! - 1;
    next.commands[numeric.type]![numeric.name] = { kind: 'string' };
    expect(new Set(said(prev, next))).toEqual(new Set([
      `v9.9.9 · command ${optional.type}: the field ${optional.name} was optional and is now required (rule 2)`,
      'v9.9.9 · command task.claim: the field reason is new and required, and a supported desktop does not send it (rule 2)',
      `v9.9.9 · command ${enumField.type}: the field ${enumField.name} no longer takes ${JSON.stringify(gone)} (rule 2)`,
      `v9.9.9 · command ${capped.type}: the field ${capped.name} maximum length fell from ${capped.shape.max} to ${capped.shape.max! - 1} (rule 2)`,
      `v9.9.9 · command ${numeric.type}: the field ${numeric.name} changed from a number to a string (rule 2)`,
    ]));
  });

  it('a route, a client table and column, a synced table and column, a lane, a frame and an agent contract', () => {
    const prev = asPublished();
    const next = asPublished();
    const route = first(current.routes, 'route');
    const [dropped, trimmed] = Object.keys(current.clientSchema).slice(0, 2) as [string, string];
    const col = first(current.clientSchema[trimmed]!, 'client column');
    const stars = Object.keys(current.syncRules).filter((t) => current.syncRules[t]!.includes('*'));
    const [unserved, narrowed] = [first(stars, 'select * rule'), stars[1]!];
    const listed = first(Object.keys(current.syncRules).filter((t) => !current.syncRules[t]!.includes('*')), 'rule that lists columns');
    const listedCol = first(current.syncRules[listed]!, 'listed column');
    const [lane, frame, agent] = [first(current.relay.lanes, 'lane'), first(current.relay.frames, 'frame'), first(current.agents, 'agent contract')];
    next.routes = next.routes.filter((r) => r !== route);
    delete next.clientSchema[dropped];
    next.clientSchema[trimmed] = next.clientSchema[trimmed]!.filter((c) => c !== col);
    delete next.syncRules[unserved];
    next.syncRules[narrowed] = ['id'];
    next.syncRules[listed] = next.syncRules[listed]!.filter((c) => c !== listedCol);
    next.relay.lanes = next.relay.lanes.filter((l) => l !== lane);
    next.relay.frames = next.relay.frames.filter((f) => f !== frame);
    next.agents = next.agents.filter((a) => a !== agent);
    expect(new Set(said(prev, next))).toEqual(new Set([
      `v9.9.9 · route ${route}: the route is gone (rule 2)`,
      `v9.9.9 · client schema table ${dropped}: the table is gone (rule 2)`,
      `v9.9.9 · client schema column ${trimmed}.${col}: the column is gone (rule 2)`,
      `v9.9.9 · sync rule for ${unserved}: the sync rules no longer serve the table (rule 2)`,
      `v9.9.9 · sync rule for ${narrowed}: the rule served every column (select *) and now lists some (rule 2)`,
      `v9.9.9 · sync rule column ${listed}.${listedCol}: the rule no longer lists the column (rule 2)`,
      `v9.9.9 · relay lane ${lane}: the lane is gone (rule 2)`,
      `v9.9.9 · relay frame ${frame}: the frame type is gone (rule 2)`,
      `v9.9.9 · agent contract ${agent}: the contract file is gone (rule 2)`,
    ]));
  });

  it('additions pass: a command, an optional field, a value, a wider bound, a route, a table, a column, a lane', () => {
    const prev = asPublished();
    const next = asPublished();
    const enumField = pick((s) => s.kind === 'enum');
    const capped = pick((s) => s.kind === 'string' && s.max !== undefined);
    const required = pick((s) => s.kind === 'string' && !s.optional);
    next.commands['contract.planted'] = { note: { kind: 'string' } };
    next.commands['task.claim']!['note'] = { kind: 'string', optional: true };
    next.commands[enumField.type]![enumField.name]!.values = [...enumField.shape.values!, 'planted'];
    next.commands[capped.type]![capped.name]!.max = capped.shape.max! + 1;
    next.commands[required.type]![required.name]!.optional = true;
    next.routes = [...next.routes, 'GET /v1/planted'];
    next.clientSchema['planted'] = ['id'];
    next.clientSchema['tasks'] = [...next.clientSchema['tasks']!, 'planted'];
    next.syncRules['messages'] = [...next.syncRules['messages']!, 'planted'];
    next.relay.lanes = [...next.relay.lanes, 'planted'];
    next.agents = [...next.agents, 'planted.yaml'];
    expect(said(prev, next)).toEqual([]);
  });
});

describe('the input shape a zod schema records', () => {
  it('keeps what decides which inputs pass', () => {
    const schema = z.object({
      id: z.string().uuid(),
      note: z.string().trim().min(1).max(200).optional(),
      count: z.number().int().positive(),
      mode: z.enum(['tasks', 'chat']).default('tasks'),
      tags: z.array(z.string()).max(8).nullable(),
      meta: z.record(z.string(), z.string()).optional(),
      kind: z.literal('x'),
      either: z.union([z.string(), z.number()]),
      checked: z.string().refine((v) => v.length > 0),
      caught: z.string().catch('untitled'),
    });
    expect(shapeOf(schema).fields).toEqual({
      caught: { kind: 'any', optional: true },
      checked: { kind: 'string' },
      count: { kind: 'number', int: true, min: 0, minOpen: true },
      either: { kind: 'union', options: [{ kind: 'string' }, { kind: 'number' }] },
      id: { kind: 'string', formats: ['uuid'] },
      kind: { kind: 'literal', literal: 'x' },
      meta: { kind: 'record', key: { kind: 'string' }, item: { kind: 'string' }, optional: true },
      mode: { kind: 'enum', values: ['chat', 'tasks'], optional: true },
      note: { kind: 'string', min: 1, max: 200, optional: true },
      tags: { kind: 'array', item: { kind: 'string' }, max: 8, nullable: true },
    });
  });

  it('a union that drops an option, and nullable that is dropped, break. A union that widens does not.', () => {
    const was = (s: z.ZodTypeAny): ContractSnapshot => ({ ...asPublished(), commands: { 'x.y': { v: shapeOf(s) } } });
    const wide = was(z.union([z.string(), z.number()]).nullable());
    expect(said(wide, was(z.string().nullable()))).toEqual(['v9.9.9 · command x.y: the field v changed from a number to a string (rule 2)']);
    expect(said(wide, was(z.union([z.string(), z.number()])))).toEqual(['v9.9.9 · command x.y: the field v took null and no longer does (rule 2)']);
    expect(said(was(z.string()), was(z.union([z.string(), z.number(), z.null()])))).toEqual([]);
    expect(said(was(z.literal('a')), was(z.enum(['a', 'b'])))).toEqual([]);
    expect(said(was(z.enum(['a', 'b'])), was(z.string()))).toEqual([]);
  });
});

describe('rule 3: a retired item leaves the new snapshots, then the server may drop it', () => {
  it('the older desktop that uses the item still breaks, and two retired snapshots let it go', () => {
    const route = first(current.routes, 'route');
    const field = pick((s) => !!s.optional);
    const items = [`route ${route}`, `command ${field.type} field ${field.name}`];
    const older = asPublished();
    const retired = ['9.9.10', '9.9.11'].map((version) => withoutRetired({ ...asPublished(), version }, items));
    const dropped = asPublished();
    dropped.routes = dropped.routes.filter((r) => r !== route);
    delete dropped.commands[field.type]![field.name];
    expect(new Set(said(older, dropped))).toEqual(new Set([
      `v9.9.9 · route ${route}: the route is gone (rule 2)`,
      `v9.9.9 · command ${field.type}: the field ${field.name} is gone (rule 2)`,
    ]));
    for (const snap of retired) expect(said(snap, dropped)).toEqual([]);
  });

  it('every form of an item reads, and a line that names nothing is an error', () => {
    const table = first(Object.keys(current.clientSchema), 'client table');
    const listed = Object.keys(current.syncRules).find((t) => !current.syncRules[t]!.includes('*'))!;
    const snap = withoutRetired(asPublished(), [
      'command task.claim', `client schema table ${table}`, `client schema column tasks.${current.clientSchema['tasks']![0]}`,
      `sync rule for ${table}`, `sync rule column ${listed}.${current.syncRules[listed]![0]}`,
      `relay lane ${current.relay.lanes[0]}`, `relay frame ${current.relay.frames[0]}`, `agent contract ${current.agents[0]}`,
    ]);
    expect(snap.commands['task.claim']).toBeUndefined();
    expect(snap.clientSchema[table]).toBeUndefined();
    expect(snap.clientSchema['tasks']).not.toContain(current.clientSchema['tasks']![0]);
    expect(snap.syncRules[table]).toBeUndefined();
    expect(snap.syncRules[listed]).not.toContain(current.syncRules[listed]![0]);
    expect([snap.relay.lanes, snap.relay.frames, snap.agents].map((xs) => xs.length)).toEqual([current.relay.lanes.length - 1, current.relay.frames.length - 1, current.agents.length - 1]);
    expect(() => withoutRetired(asPublished(), ['the route GET /v1/me'])).toThrow(/names no contract item/);
  });

  it('the RETIRED list reads, and a snapshot the bump writes leaves it out', async () => {
    expect(await snapshotTree(repo, { retired: true })).toEqual(withoutRetired(current, RETIRED));
  });
});

describe('the current tree serves the desktops it must serve', () => {
  it('each supported desktop has a snapshot, and so does the version this tree builds', () => {
    const have = snapshots.map((s) => s.version);
    for (const v of SUPPORTED_DESKTOP_VERSIONS) {
      expect(have, `SUPPORTED_DESKTOP_VERSIONS names ${v}, and contracts/desktop/${v}.json does not exist. A supported desktop is a published one, and its version-bump PR wrote the snapshot (docs/46).`).toContain(v);
    }
    expect(have, `apps/desktop/package.json says ${desktopVersion}, and contracts/desktop/${desktopVersion}.json does not exist. Run node scripts/contract-snapshot.mjs in the version-bump PR (docs/11 §2).`).toContain(desktopVersion);
  });

  it('reads a whole contract from this tree', () => {
    // the positive controls: a reader that read nothing would pass every check below
    expect(Object.keys(current.commands).length).toBeGreaterThan(100);
    expect(current.routes).toContain('POST /v1/commands');
    expect(Object.keys(current.clientSchema)).toContain('messages');
    expect(current.syncRules['messages']).toContain('body');
    expect(current.relay.lanes).toContain('terminal');
    expect(current.agents).toContain('orchestrator.yaml');
  });

  it('every snapshot file is in the form the writer writes', () => {
    for (const snap of snapshots) {
      const file = readFileSync(join(dir, `${snap.version}.json`), 'utf8');
      expect(file, `contracts/desktop/${snap.version}.json`).toBe(`${stringifySnapshot(JSON.parse(file))}\n`);
    }
  });

  // the message names the desktop, so each failure prints its own breaks rather than one for all
  it.each(held.map(({ snap, why }) => [snap.version, why, snap] as const))('desktop v%s (%s)', (version, why, snap) => {
    expect(breaks(snap, current).map(formatBreak), `v${version} (${why}). ${RULE}`).toEqual([]);
  });
});
