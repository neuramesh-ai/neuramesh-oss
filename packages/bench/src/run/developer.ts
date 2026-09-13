// Developer (coding) runner — SWE-bench-style. Each fixture is a tiny self-contained JS project
// (private, pinned) with hidden tests. We show the model the workspace + the VERBATIM coding
// prompt — composed from defaults/agents/worker.yaml (../contracts), the same blocks the daemon
// composes — take back full-file edits, apply them into a temp copy, and run the hidden
// FAIL_TO_PASS (+ optional PASS_TO_PASS) tests. The model call is injectable so the whole
// apply→test→grade pipeline is unit-tested with a fake model (no creds).
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { benchCodingPrompt } from '../contracts';
import { CEILINGS, complete as realComplete, type CompleteResult } from '../runtime';
import { scoreDev } from '../grade/developer';

export interface DevTask {
  number: number;
  title: string;
  requirements: string[];
  definitionOfDone: string;
  /** override the role ceiling for an unusually long fixture (CEILINGS.developer otherwise) */
  maxTokens?: number;
}

export interface FileBlock {
  path: string;
  content: string;
}

/**
 * Parse fenced blocks whose info string carries a file path — accepting the formats models
 * actually use: `path=src/x.mjs`, or the path AS the info string (```src/x.mjs, ```js src/x.mjs).
 * Being format-forgiving here measures a model's coding, not its guess at our fence convention.
 */
export function parseFileBlocks(text: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  const re = /```([^\n]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const info = m[1]!.trim();
    const body = m[2]!;
    const eq = info.match(/\bpath=([^\s`]+)/);
    let path = eq ? eq[1]! : '';
    if (!path) {
      const tok = info.split(/\s+/).find((t) => /\.(mjs|js|ts|jsx|tsx|json)$/.test(t));
      if (tok) path = tok;
    }
    if (path) blocks.push({ path, content: body });
  }
  return blocks;
}

/** Every fenced code-block body, ignoring the info string — for the single-file fallback. */
export function allCodeBlocks(text: string): string[] {
  const out: string[] = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]!);
  return out;
}

/** Write blocks into dir, but ONLY within dir (reject absolute paths / traversal). Returns count applied. */
export function applyEdit(dir: string, blocks: FileBlock[]): number {
  let applied = 0;
  for (const b of blocks) {
    if (isAbsolute(b.path)) continue;
    const dest = resolve(dir, b.path);
    if (relative(dir, dest).startsWith('..')) continue; // escapes the sandbox
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, b.content);
    applied++;
  }
  return applied;
}

function listFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(full, base));
    else out.push(relative(base, full));
  }
  return out;
}

function runNode(file: string, cwd: string, timeoutMs = 15000): Promise<{ pass: boolean; output: string }> {
  return new Promise((res) => {
    const p = spawn(process.execPath, [file], { cwd, timeout: timeoutMs });
    let out = '';
    p.stdout.on('data', (d: Buffer) => (out += d.toString()));
    p.stderr.on('data', (d: Buffer) => (out += d.toString()));
    p.on('close', (code) => res({ pass: code === 0, output: out.slice(0, 2000) }));
    p.on('error', (e: Error) => res({ pass: false, output: String(e) }));
  });
}

export type CompleteFn = (model: string, system: string, user: string, maxTokens?: number) => Promise<CompleteResult>;

const DEV_SYSTEM =
  'You are a senior engineer implementing a coding task. Return the FULL updated contents of each file you change (not a diff, not a snippet) in a fenced code block with the file path on the opening fence line, like:\n```src/foo.mjs\n<entire file contents>\n```\nOnly edit files shown in the workspace. Keep changes surgical but return whole files.';

export interface DevRunResult {
  passed: boolean;
  /** the model hit the output ceiling — a failure here may be the budget, not the model */
  truncated?: boolean;
  wellFormedEdit: boolean;
  failToPass: boolean;
  passToPass: boolean;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
}

export async function runDeveloperTask(fixtureDir: string, model: string, complete: CompleteFn = realComplete): Promise<DevRunResult> {
  const task = JSON.parse(readFileSync(join(fixtureDir, 'task.json'), 'utf8')) as DevTask;
  const wsSrc = join(fixtureDir, 'workspace');
  const tmp = mkdtempSync(join(tmpdir(), 'nmbench-dev-'));
  cpSync(wsSrc, tmp, { recursive: true });

  const editable = listFiles(wsSrc);
  const shown = editable.map((rel) => `\n=== ${rel} ===\n${readFileSync(join(wsSrc, rel), 'utf8')}`).join('\n');
  const codingPrompt = benchCodingPrompt({ number: task.number, title: task.title, requirements: JSON.stringify(task.requirements) }, { repoBacked: true });
  const user = `${codingPrompt}\n\n--- WORKSPACE FILES (edit these; return each changed file complete) ---${shown}`;

  const started = Date.now();
  // The largest ceiling in the suite (CEILINGS, runtime.ts). The answer is a whole source file
  // AFTER the model has finished reasoning, so this is where a tight budget bites first: the
  // 2026-09 pre-flight had GPT-6 Astra fail outright at 6000 because reasoning consumed all of it.
  const r = await complete(model, DEV_SYSTEM, user, task.maxTokens ?? CEILINGS.developer);
  const latencyMs = Date.now() - started;

  // path-tagged blocks; fall back to the largest raw code block when the task has a single file
  // (many models just return the solution in one plain ```js block).
  let blocks = parseFileBlocks(r.text);
  if (blocks.length === 0 && editable.length === 1) {
    const raw = allCodeBlocks(r.text);
    if (raw.length) blocks = [{ path: editable[0]!, content: raw.reduce((a, b) => (b.length > a.length ? b : a)) }];
  }
  const applied = applyEdit(tmp, blocks);
  const wellFormedEdit = applied > 0;

  cpSync(join(fixtureDir, 'tests'), join(tmp, 'tests'), { recursive: true });
  const failToPass = wellFormedEdit ? (await runNode(join('tests', 'failToPass.mjs'), tmp)).pass : false;
  const hasPTP = existsSync(join(fixtureDir, 'tests', 'passToPass.mjs'));
  const passToPass = !hasPTP ? true : wellFormedEdit ? (await runNode(join('tests', 'passToPass.mjs'), tmp)).pass : false;

  return {
    passed: scoreDev({ wellFormedEdit, failToPass, passToPass }),
    truncated: r.truncated,
    wellFormedEdit,
    failToPass,
    passToPass,
    latencyMs,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
  };
}

/** Fixture task ids under a suite/developer directory (those with a task.json). */
export function listDevFixtures(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'task.json')))
    .map((e) => e.name)
    .sort();
}
