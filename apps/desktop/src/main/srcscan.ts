// Source-set readers for the source-scanning tests (tour-anchors, contracts, adoption).
//
// Those tests assert properties of the SOURCE — a registry that must not contain a tool, a
// call-site idiom that must not return — and they used to read one file each, because the
// source WAS one file. The modularization split (docs/design/modularization-2026-08) makes
// "the daemon" agents.ts + main/host/** and "the renderer" a whole tree, so the unit the
// tests scan is a FILE SET, concatenated. Anchors stay unique across the concatenation;
// a slice whose two anchors land in different files must be re-pointed at the specific
// module in the same PR that splits them (plan §Phase 0.5).
//
// Test-support only: nothing in the production graph imports this module.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function walkSources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkSources(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !e.name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

// each file opens with a banner line so a failing assertion's neighborhood names its file
const concat = (files: string[]): string =>
  files.sort().map((f) => `// ─ srcscan: ${f}\n${readFileSync(f, 'utf8')}`).join('\n');

/** the agent daemon: agents.ts + everything under main/host/ once the split lands */
export function hostSource(mainDir: string): string {
  const files = [join(mainDir, 'agents.ts')];
  try { walkSources(join(mainDir, 'host'), files); } catch { /* pre-split: no host/ yet */ }
  return concat(files);
}

/** the sync layer: sync.ts + everything under main/sync/ once the split lands */
export function syncSource(mainDir: string): string {
  const files = [join(mainDir, 'sync.ts')];
  try { walkSources(join(mainDir, 'sync'), files); } catch { /* pre-split: no sync/ yet */ }
  return concat(files);
}

/** the whole renderer tree (renderer/src — the preview harness is a consumer, not a part) */
export function rendererSource(mainDir: string): string {
  const files = walkSources(join(mainDir, '..', 'renderer', 'src'));
  if (!files.length) throw new Error('srcscan: renderer source not found — check the path');
  return concat(files);
}

/** The orchestrator's tool registry as ONE string — orchtools.ts plus every tools-*.ts group.
 *  The registry is a SET of files now, so a test that slices between two tool names cannot
 *  assume they share one. */
export function registrySource(mainDir: string): string {
  return concat(walkSources(join(mainDir, 'host')).filter((f) => /orchtools\.ts$|tools-[\w-]+\.ts$/.test(f)));
}

/** The WORKER's tools — the in-process MCP server a Claude worker gets (runtime/nmtools.ts).
 *  A different registry from the orchestrator's: these are `tool('name', …)` positional calls
 *  into the Agent SDK, not `{ name: '…' }` objects, so `toolDef` cannot see them. */
export function workerToolNames(mainDir: string): string[] {
  const src = concat([join(mainDir, 'runtime', 'nmtools.ts')]);
  const names = [...src.matchAll(/\btool\(\s*\n\s*'([a-z_]+)'/g)].map((m) => m[1] as string);
  // An inventory check that finds nothing PASSES against any other empty list — the exact trap
  // that made a one-off `grep | diff` of these tools report "identical" on two empty sets.
  if (names.length < 10) throw new Error(`workerToolNames: found ${names.length} — the pattern stopped matching, not the tools`);
  return names.sort();
}

/** ONE tool definition, by name, wherever in the registry it lives.
 *  Slicing `HOST` between two tool names broke four times in one round as tools moved between
 *  files — the anchors stopped sharing a file and the span silently became empty or enormous.
 *  Ask for the tool instead of guessing where it sits. */
export function toolDef(mainDir: string, name: string): string {
  const src = registrySource(mainDir);
  const at = src.indexOf(`name: '${name}'`);
  if (at === -1) throw new Error(`toolDef: no tool named '${name}' in the registry`);
  // back to the element's opening brace, forward to the next tool (or the array's end)
  const start = src.lastIndexOf('{', at);
  const next = src.indexOf("name: '", at + name.length + 8);
  return src.slice(start, next === -1 ? src.length : next);
}
