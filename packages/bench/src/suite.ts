import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The task set lives beside this package, not in the caller's cwd. It is held out and private
// (docs/decisions.md D4): the public snapshot ships without it, so every loader asks first.
export const SUITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../suite');

/** True, with one line on stdout, when packages/bench/suite is not in this checkout. */
export function suiteMissing(role: string): boolean {
  if (existsSync(SUITE_DIR)) return false;
  console.log(`${role}: skipped, packages/bench/suite is not in this checkout (the task set is private, docs/decisions.md D4)`);
  return true;
}
