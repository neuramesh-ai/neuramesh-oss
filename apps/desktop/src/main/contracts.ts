// Reading agent contracts off disk — the fs half of @neuramesh/shared's agentcontract.
//
// Three layers, precedence local › baseline › shipped (docs/design/agent-instructions-and-task-
// policy-2026-08 §B.1). This module owns two of them:
//
//   · SHIPPED  — defaults/agents/*.yaml, bundled with the app. The authoritative contract, and
//                the thing "Reset to default" restores from. Read-only at runtime.
//   · LOCAL    — <userData>/agent-instructions/<name>.yaml. Written by the agent overlay, and by
//                the human's own editor. Its `instructions` ALWAYS wins: local-first means the
//                agent running on this machine behaves how this machine says, and a configured
//                machine is not a conflict to reconcile. `instructions` is the ONLY key read from
//                it — prompt blocks are the product's behaviour and stay in defaults/agents/.
//
// The third (the synced `agents.brief`) lives in the database and is passed in by the caller.
//
// Everything is cached per boot and re-read on write, because a prompt is composed on every turn
// and hitting the disk each time would put fs latency in the agent's critical path.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as parseYaml, dump as dumpYaml } from 'js-yaml';
import type { AgentContract } from '@neuramesh/shared';

/** where the bundled contracts live — repo layout in dev, app resources when packaged */
function shippedDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [
    join(here, '../../../../defaults/agents'),      // dev: apps/desktop/out/main → repo root
    join(here, '../../defaults/agents'),
    join(process.resourcesPath ?? '', 'defaults/agents'), // packaged (extraResources)
  ]) {
    if (p && existsSync(p)) return p;
  }
  return join(here, '../../../../defaults/agents'); // report the expected path in the error
}

let localRoot = '';
/** called once at boot with app.getPath('userData') */
export function initContracts(userData: string): void {
  localRoot = join(userData, 'agent-instructions');
  try { mkdirSync(localRoot, { recursive: true }); } catch { /* read-only home: local layer just stays empty */ }
}
export const localContractPath = (name: string): string => join(localRoot, `${name.toLowerCase()}.yaml`);

const shippedCache = new Map<string, AgentContract | null>();
const localCache = new Map<string, string | null>();

function readContract(file: string): AgentContract | null {
  try {
    const doc = parseYaml(readFileSync(file, 'utf8'));
    return doc && typeof doc === 'object' ? (doc as AgentContract) : null;
  } catch (e) {
    // a malformed contract must NOT take the agent down — it falls back to the layer beneath and
    // says so loudly, because a silently-ignored contract is an agent quietly missing its rules
    console.error(`agent_contract parse failed: ${file} — ${e instanceof Error ? e.message : 'unreadable'}`);
    return null;
  }
}

/** The shipped contract for a role (or a named agent), or null when there is no file for it. */
export function shippedContract(key: string): AgentContract | null {
  const k = key.toLowerCase();
  if (!shippedCache.has(k)) {
    const dir = shippedDir();
    const named = join(dir, 'named', `${k}.yaml`);
    const byRole = join(dir, `${k}.yaml`);
    shippedCache.set(k, existsSync(named) ? readContract(named) : existsSync(byRole) ? readContract(byRole) : null);
  }
  return shippedCache.get(k) ?? null;
}

/** Resolve name-first, then role — the same order descriptionFor already uses. */
export function contractFor(name: string, role: string): AgentContract | null {
  return shippedContract(name) ?? shippedContract(role);
}

/** This machine's instructions for an agent, or null when it has never been configured here. */
export function localInstructions(name: string): string | null {
  const k = name.toLowerCase();
  if (!localCache.has(k)) {
    const f = localContractPath(k);
    if (!existsSync(f)) localCache.set(k, null);
    else {
      const doc = readContract(f);
      const v = typeof doc?.instructions === 'string' ? doc.instructions.trim() : '';
      localCache.set(k, v || null);
    }
  }
  return localCache.get(k) ?? null;
}

/**
 * Write this machine's instructions for an agent. `null`/'' REMOVES the override rather than
 * storing a blank — clearing the field asks for the layer beneath, not for an agent with no rules.
 *
 * ANYTHING ELSE IN THE FILE SURVIVES. The first version rewrote the whole file as
 * `header + instructions:`, so a key somebody had hand-added was destroyed by the next Save in
 * the overlay — silently, with no backup. A file we invite people to edit by hand cannot be a
 * file we truncate on write. Unknown keys are re-emitted (via a YAML dump, which costs their
 * comments — stated in the header rather than pretended away); the common case, a file holding
 * only instructions, keeps the hand-written literal-block format.
 */
export function writeLocalInstructions(name: string, instructions: string | null): void {
  if (!localRoot) throw new Error('contracts not initialised');
  const k = name.toLowerCase();
  const text = (instructions ?? '').trim();
  const f = localContractPath(k);

  const existing = existsSync(f) ? (readContract(f) as Record<string, unknown> | null) : null;
  // An UNPARSEABLE file is the other way to lose someone's words: readContract returns null for
  // it (by design — a broken contract must not take the agent down), which would send us straight
  // down the "no extras" path and overwrite whatever they were mid-edit. Keep a copy first. The
  // save still succeeds, because a machine's instructions must stay editable from the overlay
  // even when its file is briefly broken.
  if (existsSync(f) && !existing) {
    try { copyFileSync(f, `${f}.bak`); console.error(`agent_contract unparseable, kept a copy at ${f}.bak`); } catch { /* best effort */ }
  }
  const extras = Object.entries(existing ?? {}).filter(([key]) => key !== 'instructions');

  if (extras.length) {
    const doc: Record<string, unknown> = Object.fromEntries(extras);
    if (text) doc['instructions'] = text;
    writeFileSync(f, header(k) + dumpYaml(doc, { lineWidth: 0, noRefs: true }));
  } else if (!text) {
    try { if (existsSync(f)) writeFileSync(f, header(k) + 'instructions: ""\n'); } catch { /* ignore */ }
  } else {
    // A literal block keeps the text exactly as typed — no escaping to get wrong, and the file
    // stays hand-editable, which is the point of it being YAML rather than JSON.
    const body = text.split('\n').map((l) => (l.trim() ? `  ${l}` : '')).join('\n');
    writeFileSync(f, `${header(k)}instructions: |-\n${body}\n`);
  }
  localCache.set(k, text || null);
}

// Accurate about its own scope. The first version claimed this file wins "over the shipped
// contract", which is true of `instructions` and of nothing else: prompt blocks are read from
// defaults/agents/ only, deliberately (they are the product's behaviour, versioned and reviewed).
// A header that overstates what a file does is how someone spends an afternoon editing a block
// that was never going to be read.
const header = (name: string): string =>
  `# @${name} — THIS MACHINE's INSTRUCTIONS.\n` +
  `#\n` +
  `# \`instructions\` below governs how @${name} behaves on this machine. It wins over the synced\n` +
  `# baseline (agents.brief) and is never synced anywhere. Edit it here or in the agent overlay;\n` +
  `# "Reset" there deletes the override and the baseline governs again.\n` +
  `#\n` +
  `# It is the ONLY key read from this file. Prompt blocks (channel/powers/style) come from the\n` +
  `# shipped contract in defaults/agents/ and cannot be overridden per machine — adding one here\n` +
  `# has no effect. Other keys are preserved on save, but their comments are not.\n`;

/** every role/name the shipped set covers — the CI tripwire reads this */
export function shippedContractKeys(): string[] {
  const dir = shippedDir();
  if (!existsSync(dir)) return [];
  const flat = readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, ''));
  const namedDir = join(dir, 'named');
  const named = existsSync(namedDir) ? readdirSync(namedDir).filter((f) => f.endsWith('.yaml')).map((f) => f.replace(/\.yaml$/, '')) : [];
  return [...flat, ...named];
}
