import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const exec = promisify(execFile);
export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
export async function save(path, data) { await mkdir(dirname(path), {recursive:true}); await writeFile(path, JSON.stringify(data,null,2)+'\n'); }
export const suite = await readJson(resolve(root,'evals/coding/cases.json'));
export function localUrl(raw, protocols = ['http:']) {
  const url = new URL(raw);
  if (!protocols.includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('Coding evals require an explicit loopback development URL.');
  return url;
}
export function allowedCommand(command, cwd) {
  let candidate = command.trim();
  // Only the exact eval worktree is permitted; never parse general shell composition.
  if (typeof cwd === 'string' && /^\/[\w/-]+$/.test(cwd)) {
    for (const path of [cwd, `'${cwd}'`, `"${cwd}"`]) {
      const prefix = `cd ${path} && `;
      if (candidate.startsWith(prefix)) { candidate = candidate.slice(prefix.length); break; }
    }
  }
  return /^(?:npm test|node --test(?: test\/\*\.test\.mjs)?)$/.test(candidate);
}
export function approvalCommands(text) {
  try { const input=JSON.parse(text); return Array.isArray(input.commands)&&input.commands.length>0&&input.commands.every(c=>typeof c==='string')?input.commands:[]; }
  catch { return typeof text==='string'?[text]:[]; }
}
export function allowedPath(path) { return /^(?:README\.md|(?:src|public|test)\/[\w./-]+)$/.test(path) && !path.split('/').includes('..') && !path.includes('//'); }
export function statusOf(checks, error) { return !error && checks.length > 0 && checks.every(c=>c.passed) ? 'passed' : 'failed'; }
export function safeEnv() { return Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]])); }
