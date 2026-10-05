// THE CODE MODEL RULES (George, 2026-10-04, docs/design/code-model-chip-2026-10). A coding conversation runs
// the model picked FOR IT, and with no pick it runs the NeuraMesh brain: the project's developer seat no
// longer leaks in, so a seat on a model the machine cannot run never strands the first prompt. Model setup
// lives on a person's machine, not on the workspace, so the providers read off the ONE machine the session
// runs on (`machines.runtimes`, what that machine serves: its sign-ins and keys, localruntimes.ts). One caveat
// is the coding runtime's own: it has no lane for a Google sign-in (the Cline SDK carries none), so Gemini
// runs code only on an API key. One derivation for the web, the desktop and the phone, so the three name the
// same model and mark the same providers. The machine stays the authority when the session opens
// (relay/engineering-provider.ts).
import { providerForModel } from './model-packs';
import { STARTER_MODEL } from './rates';

export type CodeProvider = 'anthropic' | 'openai' | 'gemini';
export type CodeProviderState = 'ready' | 'signin' | 'connect';
/** the runtime a machine publishes when it serves the provider (machines.runtimes) */
const RUNTIME: Record<CodeProvider, string> = { anthropic: 'claude-code', openai: 'codex', gemini: 'gemini' };

/** the model a coding conversation runs: its own pick, else the NeuraMesh brain */
export const codeModelOf = (pick: string | null | undefined): string => pick || STARTER_MODEL;

export interface CodeMachineRow { id: string; owner_user_id?: string | null; kind?: string | null; runtimes?: string | null }

/** a cloud machine (a member's own or a runner): machined publishes these, a laptop is 'local' */
export const isCloudMachineRow = (m: { kind?: string | null } | null | undefined): boolean => m?.kind === 'member' || m?.kind === 'runner';

/** the machine a coding session runs on: the one it names, else the person's own cloud machine */
export function codeMachineOf<M extends CodeMachineRow>(machines: readonly M[], named: string | null | undefined, me: string | null): M | null {
  return machines.find((m) => m.id === named) ?? machines.find((m) => isCloudMachineRow(m) && m.owner_user_id === me) ?? null;
}

/** the runtimes a machine row publishes, [] when it publishes none or the JSON is bad */
export function machineRuntimeList(m: { runtimes?: string | null } | null | undefined): string[] {
  try { const r: unknown = JSON.parse(m?.runtimes ?? '[]'); return Array.isArray(r) ? r.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}

/** each provider's state for a coding session on `machine`: ready when that machine serves the provider,
 *  sign-in when the workspace set the provider up and the machine does not serve it, connect when nothing is
 *  set up. Gemini is ready on a stored Gemini API key only (`geminiKey`), because a Google sign-in cannot run code */
export function codeProviderStates(machine: { runtimes?: string | null } | null, configured: ReadonlySet<string>, geminiKey: boolean): Record<CodeProvider, CodeProviderState> {
  const runtimes = machineRuntimeList(machine);
  const state = (p: CodeProvider): CodeProviderState => (runtimes.includes(RUNTIME[p]) ? 'ready' : configured.has(p) ? 'signin' : 'connect');
  const gemini = state('gemini');
  return { anthropic: state('anthropic'), openai: state('openai'), gemini: gemini === 'ready' && geminiKey ? 'ready' : 'connect' };
}

/** the provider a model needs, or null for the NeuraMesh brain (and a model no catalog knows) */
export function codeVendorOf(model: string): CodeProvider | null {
  if (model === STARTER_MODEL) return null;
  try { return providerForModel(model); } catch { return null; }
}

/** whether a coding session can run `model` on its machine: the NeuraMesh brain always can */
export function codeRunsHere(model: string, states: Record<CodeProvider, CodeProviderState>): boolean {
  const vendor = codeVendorOf(model);
  return vendor === null || states[vendor] === 'ready';
}

const VENDOR: Record<CodeProvider, string> = { anthropic: 'Claude', openai: 'ChatGPT', gemini: 'Gemini' };

/** the Gemini group's note on a coding session */
export const CODE_GEMINI_NOTE = 'Code needs a Gemini API key. A Google sign-in cannot run code.';

/** the menu's foot: why the model cannot run code here, else what a pick does. `start`: before the session exists */
export function codeFootText(model: string, states: Record<CodeProvider, CodeProviderState>, place: 'session' | 'start'): string {
  const vendor = codeVendorOf(model);
  if (vendor && states[vendor] !== 'ready') return `${VENDOR[vendor]} cannot run code on this machine. Pick another model.`;
  return place === 'start' ? 'The session starts on this model. With no pick, it runs on the NeuraMesh brain.' : 'This session runs on this model. A pick here changes it.';
}
