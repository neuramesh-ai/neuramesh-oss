// Validated metadata calls narrated in a model response.













import { RUN_NARRATED, schemaArgs, type PseudoCall } from './pseudocalls';
import type { LogFn } from '../agentlog';
import type { OrchTool } from './orchtools';






// The orchestrator's tool-loop on GEMINI (the free default brain). Mirrors the Anthropic query()
// loop — same tools, same system prompt — but via @google/genai function-calling, in-process.
// The reply (which may embed a ```nmq card — plain text) is returned exactly like the Claude path.
/** The narrated calls a turn still runs (host/pseudocalls.ts RUN_NARRATED): each once, and only with
 *  arguments the tool's own schema accepts, so a narrated call can do no more than a real one. The
 *  model never sees the result, which is why the list is short. Returns what each run answered. */
export async function runNarratedCalls(calls: readonly PseudoCall[], byName: ReadonlyMap<string, OrchTool>, log?: LogFn): Promise<string[]> {
  const answers: string[] = [];
  const done = new Set<string>();
  for (const c of calls) {
    const t = byName.get(c.name);
    if (!t || !RUN_NARRATED.has(c.name)) continue;
    const input = schemaArgs(t.schema, c.args);
    if (!input) {
      log?.({ kind: 'tool', phase: 'warn', summary: `narrated ${c.name} not run: its arguments do not fit the tool`, level: 'warn' });
      continue;
    }
    const key = `${c.name}:${JSON.stringify(input)}`;
    if (done.has(key)) continue;
    done.add(key);
    try {
      answers.push(await t.run(input));
      log?.({ kind: 'tool', phase: 'call', summary: `${c.name} (narrated) ${JSON.stringify(input).slice(0, 120)}` });
    } catch (e) {
      log?.({ kind: 'tool', phase: 'error', summary: `narrated ${c.name} failed: ${e instanceof Error ? e.message.slice(0, 120) : 'tool failed'}`, level: 'warn' });
    }
  }
  return answers;
}
