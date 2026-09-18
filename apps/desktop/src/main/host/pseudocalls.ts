// A PSEUDO TOOL CALL is a tool invocation the model WROTE as text instead of calling — a fenced
// `set_thread_title(title="…")` above the answer. Seen live on the Starter lane (2026-09-17, the
// house model on a routine's first reply): the function declarations were sent, the model still
// narrated the call, and the narration reached the room as the reply's first paragraph. The call
// never ran, so it is noise twice over. Enforced here rather than prompted: the text a human reads
// is filtered against the names of the tools that WERE offered, and the drop is logged.
//
// Pure. Drops a fenced block whose non-empty lines are all calls to known tools, and a bare line
// that is exactly such a call. Prose that merely mentions a tool name stays.

const FENCE = /```[^\n]*\n([\s\S]*?)```/g;

function callLine(line: string, names: ReadonlySet<string>): boolean {
  const m = /^\s*(?:nm\.|mcp__nm__)?([A-Za-z_][A-Za-z0-9_]*)\s*\((?:[\s\S]*)\)\s*;?\s*$/.exec(line);
  return !!m && names.has(m[1]!);
}

/** the reply with narrated tool calls removed, and how many were removed */
export function stripPseudoToolCalls(text: string, toolNames: Iterable<string>): { text: string; stripped: number } {
  const names = new Set(toolNames);
  if (!names.size || !text) return { text, stripped: 0 };
  let stripped = 0;
  let out = text.replace(FENCE, (whole, body: string) => {
    const lines = body.split('\n').filter((l) => l.trim().length);
    if (lines.length && lines.every((l) => callLine(l, names))) { stripped += lines.length; return ''; }
    return whole;
  });
  out = out.split('\n').filter((l) => { const hit = callLine(l, names); if (hit) stripped++; return !hit; }).join('\n');
  return { text: stripped ? out.replace(/\n{3,}/g, '\n\n').trim() : text, stripped };
}
