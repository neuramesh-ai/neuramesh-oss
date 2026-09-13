// Pure activity-log grouping — turns the flat per-event agent telemetry into readable
// items for the AgentActivity view. Extracted from App.tsx so it can be unit-tested
// without booting React. The renderer's LogRow is a structural superset of ActRow.

// Minimal row shape the grouping reads (App.tsx's LogRow satisfies this structurally).
export interface ActRow {
  id: number;
  kind: string;
  phase: string | null;
  tool_use_id: string | null;
  level: string;
}

export type ActItem<R extends ActRow = ActRow> =
  | { t: 'narration'; row: R }
  | { t: 'tool'; call: R; result: R | null }
  | { t: 'event'; row: R };

// A 'turn' is the agent narrating; a tool 'call' + its 'result' collapse into ONE item
// (paired by tool_use_id, so parallel calls never cross-wire their outputs); wakes / exec /
// lifecycle / injects / turn-results stay slim status markers. id-less runtimes (Gemini/Codex)
// fall back to attaching a result to the most recent still-open call.
export function groupActivity<R extends ActRow>(rows: R[]): ActItem<R>[] {
  const items: ActItem<R>[] = [];
  const byId = new Map<string, Extract<ActItem<R>, { t: 'tool' }>>();
  const lastOpenTool = (): Extract<ActItem<R>, { t: 'tool' }> | undefined => {
    for (let i = items.length - 1; i >= 0; i--) { const it = items[i]; if (it && it.t === 'tool' && !it.result) return it; }
    return undefined;
  };
  for (const r of rows) {
    if (r.kind === 'turn') items.push({ t: 'narration', row: r });
    else if (r.kind === 'tool' && r.phase === 'call') {
      const it: Extract<ActItem<R>, { t: 'tool' }> = { t: 'tool', call: r, result: null };
      items.push(it);
      if (r.tool_use_id) byId.set(r.tool_use_id, it);
    } else if (r.kind === 'tool' && r.phase === 'result') {
      const paired = r.tool_use_id ? byId.get(r.tool_use_id) : lastOpenTool();
      if (r.tool_use_id) byId.delete(r.tool_use_id);
      if (paired) paired.result = r; else items.push({ t: 'event', row: r });
    } else items.push({ t: 'event', row: r });
  }
  return items;
}

// Friendly verb-led headline for a tool 'call', derived from its summary (toolSummary in
// agents.ts prefixes the tool name). Unknown tools fall back to the raw summary, unchanged.
export const TOOL_VERB: Record<string, string> = {
  Bash: 'Ran', Read: 'Read', Write: 'Wrote', Edit: 'Edited', MultiEdit: 'Edited',
  Glob: 'Searched', Grep: 'Searched', WebFetch: 'Fetched', WebSearch: 'Searched the web',
  Task: 'Delegated', load_skill: 'Loaded skill', propose_skill: 'Proposed skill', screenshot: 'Screenshot',
};
export function toolHeadline(summary: string): { verb: string; arg: string } {
  const m = summary.match(/^([A-Za-z_]+):?\s+([\s\S]+)$/);
  const name = m?.[1];
  const verb = name ? TOOL_VERB[name] : undefined;
  return verb ? { verb, arg: m?.[2] ?? summary } : { verb: '', arg: summary };
}
export function toolOutcome(result: { level: string } | null): { glyph: string; cls: string } | null {
  if (!result) return null;
  if (result.level === 'error') return { glyph: '✕', cls: 'o-error' };
  if (result.level === 'warn') return { glyph: '⚠', cls: 'o-warn' };
  return { glyph: '✓', cls: 'o-ok' };
}
