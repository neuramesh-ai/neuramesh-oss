#!/usr/bin/env node
// THE SHARED CONFIG, WITHOUT THE PRIVATE APPS (George, 2026-09-27: a private app stays out of the
// public repository, its name too). The publish removes every private path (scripts/public-tree.sh), but five files serve
// both trees whole and name the private apps: the lockfile (their importers), eslint.config.mjs
// (their lint globs), lint-ratchet.json (their size caps), .claude/launch.json (their dev servers)
// and package.json (their scripts). public-snapshot.sh runs this on its clean clone BEFORE it
// removes the private paths, so the private package names can still be read from them.
//
//   node scripts/public-config.mjs <private path>...   strip the five files in the current tree
//   node scripts/public-config.mjs --self-test         prove every rule strips, and that the check fails
//
// Every private path comes from PUBLIC_EXCLUDE (the ONE list), so no app is named here. An entry
// this script cannot strip (a private glob alone in its eslint list, say) fails the publish, loud,
// rather than ship a name: the check after the strip is the gate, and the self-test proves it can fail.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** what names a private path or package: a path as a path segment, a package as a whole name. A
 *  one-word path (memory, infra) counts only with a slash after it, as a path INTO it: bare, it is
 *  a common word ("in-memory", `"private": true`), and prose is not a path */
export function matcher(paths, names) {
  const res = [
    ...paths.map((p) => new RegExp(p.includes('/')
      ? `(?:^|[^A-Za-z0-9_.-])${esc(p)}(?:/|$|[^A-Za-z0-9_.-])`
      : `(?:^|[^A-Za-z0-9_.-])${esc(p)}/`)),
    ...names.map((n) => new RegExp(`${esc(n)}(?![A-Za-z0-9_-])`)),
  ];
  return (s) => res.some((re) => re.test(s));
}

/** lint-ratchet.json: the size caps of files under a private path */
export function stripRatchet(json, paths) {
  const out = JSON.parse(json);
  const gone = [];
  for (const map of ['files', 'standing']) {
    for (const k of Object.keys(out[map] ?? {})) {
      if (paths.some((p) => k === p || k.startsWith(`${p}/`))) { delete out[map][k]; gone.push(k); }
    }
  }
  return { text: `${JSON.stringify(out, null, 2)}\n`, gone };
}

/** .claude/launch.json: a dev server that runs a private path or package */
export function stripLaunch(json, names) {
  const out = JSON.parse(json);
  const gone = [];
  out.configurations = (out.configurations ?? []).filter((c) => {
    if (!names(JSON.stringify(c))) return true;
    gone.push(c.name);
    return false;
  });
  return { text: `${JSON.stringify(out, null, 2)}\n`, gone };
}

/** package.json: a script whose command names a private path or package */
export function stripScripts(json, names) {
  const out = JSON.parse(json);
  const gone = [];
  for (const [k, v] of Object.entries(out.scripts ?? {})) {
    if (names(String(v))) { delete out.scripts[k]; gone.push(k); }
  }
  return { text: `${JSON.stringify(out, null, 2)}\n`, gone };
}

/** eslint.config.mjs: a quoted glob under a private path, out of the list it sits in */
export function stripEslint(text, paths) {
  const gone = [];
  let out = text;
  for (const p of paths) {
    const lit = `(['"])(${esc(p)}(?:/[^'"]*)?)\\1`;
    // an element with a comma after it, then the last element with a comma before it
    out = out.replace(new RegExp(`${lit}\\s*,\\s*`, 'g'), (_m, _q, g) => { gone.push(g); return ''; });
    out = out.replace(new RegExp(`\\s*,\\s*${lit}`, 'g'), (_m, _q, g) => { gone.push(g); return ''; });
  }
  return { text: out, gone };
}

/** pnpm-lock.yaml: the importer block of a private path. Packages only it used stay as orphans:
 *  they name no app, and pnpm installs the public tree from the lockfile as it stands */
export function stripLock(text, paths) {
  const lines = text.split('\n');
  const out = [];
  const gone = [];
  let section = '';
  let skipping = false;
  for (const line of lines) {
    if (/^\S/.test(line)) { section = line; skipping = false; }
    else if (section === 'importers:' && /^ {2}\S/.test(line)) {
      const key = line.trim().replace(/:$/, '');
      skipping = paths.some((p) => key === p || key.startsWith(`${p}/`));
      if (skipping) gone.push(key);
    }
    if (!skipping) out.push(line);
  }
  return { text: out.join('\n'), gone };
}

/** what still names a private path after the strip: the check that stops a publish */
export function leftovers(files, paths, names) {
  const names_ = matcher(paths, names);
  const left = [];
  for (const [file, text] of Object.entries(files)) {
    // the size caps carry their reasons in prose: only a KEY is a path there
    if (file === 'lint-ratchet.json') {
      const j = JSON.parse(text);
      for (const k of [...Object.keys(j.files ?? {}), ...Object.keys(j.standing ?? {})]) {
        if (paths.some((p) => k === p || k.startsWith(`${p}/`))) left.push(`${file}: ${k}`);
      }
      continue;
    }
    let body = text;
    if (file === 'pnpm-lock.yaml') body = (/^importers:\n([\s\S]*?)^\S/m.exec(text)?.[1] ?? '');
    for (const line of body.split('\n')) {
      const code = file.endsWith('.mjs') ? line.replace(/\/\/.*$/, '') : line;
      if (!/^\s*\*/.test(code) && names_(code)) left.push(`${file}: ${line.trim().slice(0, 100)}`);
    }
  }
  return left;
}

const FILES = ['pnpm-lock.yaml', 'eslint.config.mjs', 'lint-ratchet.json', '.claude/launch.json', 'package.json'];

function strip(root, paths) {
  const names = paths
    .map((p) => join(root, p, 'package.json'))
    .filter((f) => existsSync(f))
    .map((f) => JSON.parse(readFileSync(f, 'utf8')).name)
    .filter(Boolean);
  const names_ = matcher(paths, names);
  const after = {};
  for (const file of FILES) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    const { text: out, gone } = file === 'lint-ratchet.json' ? stripRatchet(text, paths)
      : file === '.claude/launch.json' ? stripLaunch(text, names_)
      : file === 'package.json' ? stripScripts(text, names_)
      : file === 'eslint.config.mjs' ? stripEslint(text, paths)
      : stripLock(text, paths);
    if (out !== text) writeFileSync(path, out);
    after[file] = out;
    console.log(`  ${file.padEnd(22)} ${gone.length ? `stripped ${gone.length}: ${gone.join(', ')}` : 'names no private path'}`);
  }
  return leftovers(after, paths, names);
}

function selfTest() {
  const paths = ['apps/alpha', 'apps/beta'];
  const names = matcher(paths, ['@neuramesh/alpha', '@neuramesh/beta']);
  const fail = (why) => { console.error(`public-config self-test FAIL: ${why}`); process.exit(1); };
  const r = stripRatchet(JSON.stringify({ files: { 'apps/alpha/a.ts': 1, 'apps/desktop/b.ts': 2 }, standing: { 'apps/beta/c.ts': { max: 3 } } }), paths);
  if (r.gone.join() !== 'apps/alpha/a.ts,apps/beta/c.ts' || r.text.includes('apps/alpha')) fail('the ratchet kept a private cap');
  const l = stripLaunch(JSON.stringify({ configurations: [{ name: 'alpha', cwd: 'apps/alpha' }, { name: 'beta-dev', runtimeArgs: ['--filter', '@neuramesh/beta'] }, { name: 'desktop', cwd: 'apps/desktop' }, { name: 'webkit', runtimeArgs: ['@neuramesh/betamax'] }] }), names);
  if (l.gone.join() !== 'alpha,beta-dev') fail(`the launch list kept or lost the wrong servers: ${l.gone.join()}`);
  const s = stripScripts(JSON.stringify({ scripts: { 'beta:dev': 'pnpm --filter @neuramesh/beta dev', build: 'pnpm -r build' } }), names);
  if (s.gone.join() !== 'beta:dev') fail('the scripts kept a private one');
  const e = stripEslint("files: ['apps/desktop/src/**/*.tsx', 'apps/alpha/**/*.{ts,tsx}', 'apps/beta/src/**/*.tsx'],", paths);
  if (e.text !== "files: ['apps/desktop/src/**/*.tsx'],") fail(`the lint globs came out as ${e.text}`);
  const k = stripLock('lockfileVersion: 9.0\nimporters:\n  apps/desktop:\n    dependencies: {}\n  apps/alpha:\n    dependencies:\n      react: 19\npackages:\n  react@19: {}\n', paths);
  if (k.gone.join() !== 'apps/alpha' || k.text.includes('apps/alpha') || !k.text.includes('apps/desktop:')) fail('the lockfile kept a private importer');
  // the check must be able to fail: a private glob alone in its list cannot be stripped by the
  // element rules, so the check has to see it
  const alone = stripEslint("ignores: ['apps/alpha/**'],", paths).text;
  if (!leftovers({ 'eslint.config.mjs': alone }, paths, []).length) fail('the check passed a private glob left alone in its list');
  if (leftovers({ 'eslint.config.mjs': '// apps/alpha keeps its own lint\n' }, paths, []).length) fail('the check failed on a comment');
  // a one-word private path is a path only with a slash: prose and `"private": true` are not
  const words = matcher(['notes', 'private'], []);
  if (words('the in-memory notes store') || words('"private": true') || !words('cat notes/a.md')) fail('a one-word path matched prose, or missed a path into it');
  const prose = JSON.stringify({ files: {}, standing: { 'apps/desktop/x.ts': { max: 1, reason: 'mirrors notes/ and apps/alpha/ by design' } } });
  if (leftovers({ 'lint-ratchet.json': prose }, ['notes', ...paths], []).length) fail('the check read a reason as a path');
  if (!leftovers({ 'lint-ratchet.json': JSON.stringify({ files: { 'notes/a.ts': 1 }, standing: {} }) }, ['notes'], []).length) fail('the check missed a private size cap');
  console.log('public-config self-test OK: every rule strips its file, and the check fails on what it cannot strip');
}

if (process.argv[2] === '--self-test') selfTest();
else if (import.meta.url === `file://${process.argv[1]}`) {
  const paths = process.argv.slice(2).filter((p) => existsSync(p));
  if (!paths.length) { console.error('usage: node scripts/public-config.mjs <private path>... | --self-test'); process.exit(2); }
  console.log('· the shared config, without the private apps');
  const left = strip(process.cwd(), paths);
  if (left.length) {
    console.error(`public-config: private names remain in the shared config. Strip them by hand:\n  ${left.join('\n  ')}`);
    process.exit(1);
  }
}
