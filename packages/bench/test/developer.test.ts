import { describe, it, expect } from 'vitest';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { parseFileBlocks, applyEdit, runDeveloperTask, listDevFixtures, type CompleteFn } from '../src/run/developer';

const HERE = dirname(fileURLToPath(import.meta.url));
const suite = resolve(HERE, '../suite/developer');
// The task set is private (docs/decisions.md D4): a public checkout has no suite/, and the three
// fixture-backed groups below skip there. The parser and the edit tests still run.
const hasSuite = existsSync(suite);

const fake = (text: string): CompleteFn => async () => ({ text, tokensIn: 10, tokensOut: 10 });
const block = (path: string, body: string): string => `Here is the fix:\n\`\`\`js path=${path}\n${body}\n\`\`\``;

describe('parseFileBlocks', () => {
  it('extracts path + content, with or without a language tag', () => {
    const b = parseFileBlocks('intro\n```js path=src/a.mjs\nexport const a = 1;\n```\ntail\n```path=src/b.mjs\nexport const b = 2;\n```');
    expect(b).toHaveLength(2);
    expect(b[0]!.path).toBe('src/a.mjs');
    expect(b[0]!.content).toContain('export const a = 1;');
    expect(b[1]!.path).toBe('src/b.mjs');
  });
  it('recognizes the path AS the fence info string (```src/a.mjs and ```js src/a.mjs)', () => {
    expect(parseFileBlocks('```src/a.mjs\nexport const a = 1;\n```')[0]!.path).toBe('src/a.mjs');
    expect(parseFileBlocks('```js src/b.mjs\nexport const b = 2;\n```')[0]!.path).toBe('src/b.mjs');
  });
  it('ignores plain fenced blocks with no path', () => {
    expect(parseFileBlocks('```\njust code\n```')).toHaveLength(0);
  });
});

describe('applyEdit', () => {
  it('writes files under the dir and rejects traversal / absolute paths', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nmbench-apply-'));
    const n = applyEdit(tmp, [
      { path: 'src/ok.mjs', content: 'ok' },
      { path: '../escape.mjs', content: 'no' },
      { path: '/abs.mjs', content: 'no' },
    ]);
    expect(n).toBe(1);
    expect(readFileSync(join(tmp, 'src/ok.mjs'), 'utf8')).toBe('ok');
  });
});

describe.skipIf(!hasSuite)('listDevFixtures', () => {
  it('finds all five coding fixtures', () => {
    expect(listDevFixtures(suite).sort()).toEqual(['expr-eval', 'lru-cache', 'merge-intervals', 'semver-compare', 'topo-sort']);
  });
});

// A correct reference solution per fixture. Running each through the real apply→test pipeline
// proves the fixture is solvable AND its hidden tests are right (so a benchmark pass is a real pass).
const REFERENCES: Record<string, string> = {
  'lru-cache': block(
    'src/lru.mjs',
    `export class LRUCache {
  constructor(capacity) { this.capacity = capacity; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return -1;
    const v = this.map.get(key);
    this.map.delete(key); this.map.set(key, v);
    return v;
  }
  put(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value);
  }
}`,
  ),
  'merge-intervals': block(
    'src/merge.mjs',
    `export function mergeIntervals(intervals) {
  const arr = [...intervals].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of arr) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}`,
  ),
  'expr-eval': block(
    'src/expr.mjs',
    `export function evaluate(expr) {
  let i = 0; const s = expr;
  const ws = () => { while (i < s.length && s[i] === ' ') i++; };
  function factor() {
    ws();
    if (s[i] === '(') { i++; const v = expr2(); ws(); i++; return v; }
    let n = ''; if (s[i] === '-') { n = '-'; i++; }
    while (i < s.length && s[i] >= '0' && s[i] <= '9') n += s[i++];
    return parseInt(n, 10);
  }
  function term() {
    let v = factor(); ws();
    while (s[i] === '*' || s[i] === '/') { const op = s[i++]; const f = factor(); v = op === '*' ? v * f : Math.trunc(v / f); ws(); }
    return v;
  }
  function expr2() {
    let v = term(); ws();
    while (s[i] === '+' || s[i] === '-') { const op = s[i++]; const t = term(); v = op === '+' ? v + t : v - t; ws(); }
    return v;
  }
  return expr2();
}`,
  ),
  'topo-sort': block(
    'src/topo.mjs',
    `export function topoSort(graph) {
  const order = []; const state = new Map();
  function visit(n) {
    const st = state.get(n) || 0;
    if (st === 2) return;
    if (st === 1) throw new Error('cycle at ' + n);
    state.set(n, 1);
    for (const d of (graph[n] || [])) visit(d);
    state.set(n, 2);
    order.push(n);
  }
  for (const n of Object.keys(graph)) visit(n);
  return order;
}`,
  ),
  'semver-compare': block(
    'src/semver.mjs',
    `export function compare(a, b) {
  const parse = (v) => { const [core, pre] = v.split('-'); return { nums: core.split('.').map(Number), pre: pre ? pre.split('.') : null }; };
  const pa = parse(a), pb = parse(b);
  for (let i = 0; i < 3; i++) if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] < pb.nums[i] ? -1 : 1;
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i], y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\\d+$/.test(x), yn = /^\\d+$/.test(y);
    if (xn && yn) { const d = Number(x) - Number(y); if (d !== 0) return d < 0 ? -1 : 1; }
    else if (xn) return -1;
    else if (yn) return 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}`,
  ),
};

describe.skipIf(!hasSuite)('coding fixtures are solvable and correctly graded', () => {
  for (const id of Object.keys(REFERENCES)) {
    it(`${id}: reference solution passes FAIL_TO_PASS`, async () => {
      const r = await runDeveloperTask(join(suite, id), 'fake', fake(REFERENCES[id]!));
      expect(r.wellFormedEdit).toBe(true);
      expect(r.failToPass).toBe(true);
      expect(r.passed).toBe(true);
    });
  }
});

describe.skipIf(!hasSuite)('runDeveloperTask grades failures honestly', () => {
  it('a wrong edit is well-formed but fails the hidden tests', async () => {
    // an LRU that never evicts — compiles and applies, but fails the eviction assertions
    const wrong = block('src/lru.mjs', 'export class LRUCache { constructor(c){this.m=new Map();} get(k){return this.m.has(k)?this.m.get(k):-1;} put(k,v){this.m.set(k,v);} }');
    const r = await runDeveloperTask(join(suite, 'lru-cache'), 'fake', fake(wrong));
    expect(r.wellFormedEdit).toBe(true);
    expect(r.failToPass).toBe(false);
    expect(r.passed).toBe(false);
  });
  it('prose with no file block is not a well-formed edit', async () => {
    const r = await runDeveloperTask(join(suite, 'lru-cache'), 'fake', fake('I would fix it but here is only prose.'));
    expect(r.wellFormedEdit).toBe(false);
    expect(r.passed).toBe(false);
  });
  it('a single plain code block (no path) is applied via the single-file fallback', async () => {
    const plain = `\`\`\`js
export class LRUCache {
  constructor(c) { this.capacity = c; this.map = new Map(); }
  get(k) { if (!this.map.has(k)) return -1; const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v; }
  put(k, v) { if (this.map.has(k)) this.map.delete(k); this.map.set(k, v); if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value); }
}
\`\`\``;
    const r = await runDeveloperTask(join(suite, 'lru-cache'), 'fake', fake(plain));
    expect(r.wellFormedEdit).toBe(true);
    expect(r.passed).toBe(true);
  });
});
