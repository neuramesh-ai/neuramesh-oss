// The prompt meter — measures the STATIC instruction payload a turn kind carries, from the same
// modules the daemon composes it from (never a copy of their text).
//
// Why this exists (2026-08-18 audit): the one doctrine budget with no gauge was "agent overhead
// < 10%". The assembler budgets only the dynamic user-message blocks; the system prompt and the
// tool registry ride outside it and grew with every feature — to ~16k tokens per orchestrator
// wake — with nothing measuring them. This module is the gauge: promptbudget.test.ts prints the
// table on every test run and (P3) asserts shrink-only budgets from prompts-ratchet.json, the
// lint-ratchet idiom pointed at the instruction surface.
//
// Token estimates are chars/4 — the same convention as harness/assemble.ts. The meter measures
// what is HANDED to a runtime (names, descriptions, schema field names + their .describe()
// strings), not the runtime's own serialization overhead, so the numbers are comparable across
// commits rather than absolute.
import type { ZodTypeAny } from 'zod';
import { composePrompt } from '@neuramesh/shared';
import type { TurnKind } from '@neuramesh/shared';
import { shippedContract } from './contracts';
import { makeOrchTools, type OrchTool } from './host/orchtools';
import { DEFS } from './harness/tooldefs';
import { WHITEBOARD_DEFS } from './harness/tooldefs-whiteboard';

/** chars of one zod field: its key + its .describe() string (the model-visible parts). */
function schemaChars(schema: Record<string, ZodTypeAny>): number {
  let n = 0;
  for (const [key, t] of Object.entries(schema)) {
    n += key.length;
    const d = (t as { description?: unknown }).description ?? (t as { _def?: { description?: unknown } })._def?.description;
    if (typeof d === 'string') n += d.length;
  }
  return n;
}

export interface ToolWeight { name: string; chars: number }
export interface RegistryWeight { tools: ToolWeight[]; total: number }

export function weighTools(tools: Array<{ name: string; description: string; schema?: Record<string, ZodTypeAny> }>): RegistryWeight {
  const weights = tools.map((t) => ({ name: t.name, chars: t.name.length + t.description.length + (t.schema ? schemaChars(t.schema) : 0) }));
  return { tools: weights, total: weights.reduce((a, b) => a + b.chars, 0) };
}

/**
 * Build the REAL orchestrator registry with inert services.
 *
 * Every service is a stub that answers emptily (or throws if a build-time call would actually
 * mutate something) — building the registry runs no tool, so the stubs exist only to satisfy the
 * closures. `spawn` presence mirrors the real call sites: triage/own turns fund a fan-out, sweep
 * turns have no run to parent legs onto.
 *
 * This is the seam the manifest test (host/orchregistry.test.ts) asserts through: it sees what
 * a turn is actually HANDED, where a source-text grep saw only what the file mentions — the
 * difference that let the #272 split drop the whiteboard spread while every test stayed green.
 */
export async function buildStubOrchestratorRegistry(kind: TurnKind & ('triage' | 'own' | 'sweep'), sweepScope?: 'digest' | 'watchdog' | 'monitor'): Promise<OrchTool[]> {
  const never = async (): Promise<never> => { throw new Error('promptmeter stub — tools are weighed, never run'); };
  const host = makeOrchTools({
    db: { getAll: async () => [] } as never,
    post: never,
    agents: new Map(),
    apiGet: never,
    brain: {} as never,
    buildScheduleCard: () => '',
    draftsForAnchor: async () => null,
    ensureChatWorkspace: () => '/tmp/promptmeter',
    executeHire: never,
    generateDraftImage: never,
    libraryDocs: async () => [],
    startDeepWork: async () => null,
    subjectFor: () => null,
    whiteboardClosures: () => ({ list: never, read: never, create: never, update: never }) as never,
    workspaceListing: () => [],
    workspaceRead: () => ({ ok: false as const, error: 'promptmeter stub' }),
  } as never);
  return host.buildOrchestratorTools({
    ch: { id: 'meter-ch', slug: 'meter', workspace_id: 'meter-ws' },
    agent: { id: 'meter-agent', name: 'rex', role: 'orchestrator', runtime: 'claude-code' } as never,
    actor: { kind: 'agent', id: 'meter-agent', role: 'orchestrator' },
    skills: [],
    thread: undefined,
    convoThreadId: kind === 'triage' ? 'meter-thread' : null,
    token: '',
    kind,
    ...(sweepScope ? { sweepScope } : {}),
    ...(kind === 'sweep' ? {} : { spawn: async () => ({ ok: false, error: 'promptmeter stub' }) }),
  });
}

export async function weighOrchestratorRegistry(kind: TurnKind & ('triage' | 'own' | 'sweep'), sweepScope?: 'digest' | 'watchdog' | 'monitor'): Promise<RegistryWeight> {
  return weighTools(await buildStubOrchestratorRegistry(kind, sweepScope));
}

/** Compose a contract's blocks with representative vars and measure each block. */
export function weighContract(role: string, blocks: string[], vars: Record<string, string> = {}): { blocks: Array<{ block: string; chars: number }>; total: number } {
  const prompt = shippedContract(role)?.prompt ?? {};
  const out = blocks.map((block) => ({ block, chars: composePrompt(prompt[block] ?? '', vars).length }));
  return { blocks: out, total: out.reduce((a, b) => a + b.chars, 0) };
}

/** The CLI worker tool bus (codex/gemini) — pure data, weighed as handed to the loopback MCP. */
export function weighBusDefs(): RegistryWeight {
  const all = [...DEFS, ...WHITEBOARD_DEFS].map((d) => ({ name: d.name, description: d.description, schema: d.params as Record<string, ZodTypeAny> }));
  return weighTools(all);
}

const tok = (chars: number) => Math.round(chars / 4);

/** One stable, greppable report line per surface — printed by promptbudget.test.ts. */
export async function staticPayloadReport(): Promise<{ lines: string[]; totals: Record<string, number> }> {
  const lines: string[] = [];
  const totals: Record<string, number> = {};
  const contract = weighContract('orchestrator', ['channel', 'powers', 'style']);
  lines.push(`contract orchestrator: ${contract.blocks.map((b) => `${b.block} ${b.chars}`).join(' · ')} = ${contract.total} chars (~${tok(contract.total)} tok)`);
  totals['contract.orchestrator'] = contract.total;
  // the extracted TS-literal blocks (2026-08-18 P4) — measured as their own surfaces so their
  // arrival reads as coverage gained, not as the channel contract growing
  const threadC = weighContract('orchestrator', ['thread']);
  lines.push(`contract orchestrator.thread: ${threadC.total} chars (~${tok(threadC.total)} tok)`);
  totals['contract.orchestrator.thread'] = threadC.total;
  const sweeps = weighContract('orchestrator', ['sweep.digest', 'sweep.watchdog', 'sweep.monitor', 'sweep.note']);
  lines.push(`contract orchestrator.sweeps: ${sweeps.blocks.map((b) => `${b.block} ${b.chars}`).join(' · ')} = ${sweeps.total} chars (~${tok(sweeps.total)} tok)`);
  totals['contract.orchestrator.sweeps'] = sweeps.total;
  for (const kind of ['triage', 'own'] as const) {
    const w = await weighOrchestratorRegistry(kind);
    lines.push(`registry orchestrator/${kind}: ${w.tools.length} tools, ${w.total} chars (~${tok(w.total)} tok)`);
    totals[`registry.${kind}`] = w.total;
    totals[`registry.${kind}.tools`] = w.tools.length;
  }
  for (const scope of ['digest', 'watchdog', 'monitor'] as const) {
    const w = await weighOrchestratorRegistry('sweep', scope);
    lines.push(`registry orchestrator/sweep.${scope}: ${w.tools.length} tools, ${w.total} chars (~${tok(w.total)} tok)`);
    totals[`registry.sweep.${scope}`] = w.total;
    totals[`registry.sweep.${scope}.tools`] = w.tools.length;
  }
  const bus = weighBusDefs();
  lines.push(`registry worker/bus: ${bus.tools.length} tools, ${bus.total} chars (~${tok(bus.total)} tok)`);
  totals['registry.bus'] = bus.total;
  const worker = weighContract('worker', ['system', 'turn', 'where.repo', 'nm_tools']);
  lines.push(`contract worker: ${worker.blocks.map((b) => `${b.block} ${b.chars}`).join(' · ')} = ${worker.total} chars (~${tok(worker.total)} tok)`);
  totals['contract.worker'] = worker.total;
  return { lines, totals };
}
