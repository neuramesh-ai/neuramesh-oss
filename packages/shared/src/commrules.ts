// Agent communication rules (docs/design/agent-comm-rules-2026-08) — the workspace's VOICE.
//
// One module owns the three things every surface must agree on: what the stored config
// means (defaults ON — this is NeuraMesh's voice; the workspace toggle is the opt-out),
// the exact HOUSE STYLE block agents receive (the settings preview renders THIS function,
// so what you toggle is what they read — no translation layer), and the mechanical
// em-dash scrub the server applies to agent-authored titles/descriptions/bodies.
// Composers append the block LAST: last position is what makes "supersedes" real to a
// model, and the wording says it out loud.

export interface CommRules {
  ste100?: boolean;
  noEmdash?: boolean;
  custom?: string[];
}

export const COMM_RULE_CAPS = { rules: 8, chars: 200 } as const;

/** stored jsonb (or null/garbage) → the effective config. Null = never configured = defaults. */
export function commRulesFrom(raw: unknown): Required<CommRules> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as CommRules;
  const custom = Array.isArray(r.custom)
    ? r.custom.filter((x): x is string => typeof x === 'string' && !!x.trim())
        .map((x) => x.trim().slice(0, COMM_RULE_CAPS.chars))
        .slice(0, COMM_RULE_CAPS.rules)
    : [];
  return { ste100: r.ste100 !== false, noEmdash: r.noEmdash !== false, custom };
}

/** the block every agent turn appends last — null when every rule is off */
export function houseStyleBlock(rules: Required<CommRules>): string | null {
  const lines: string[] = [];
  if (rules.noEmdash) lines.push('- Do not use em dashes (—) in anything you write. Use a comma, a period, or parentheses.');
  if (rules.ste100) lines.push('- Write in STE-100 style: sentences of at most 20 words. One instruction or idea per sentence. Active voice. Use the same word for the same thing every time. No noun clusters of more than three words.');
  for (const c of rules.custom) lines.push(`- ${c}`);
  if (!lines.length) return null;
  return `HOUSE STYLE (workspace rule — supersedes any conflicting style guidance, including your own defaults). These rules govern everything you WRITE (task names, descriptions, replies, documents), never what you quote or cite:\n${lines.join('\n')}`;
}

/** append the block to a system prompt — the one wrapper every composer calls */
export function withHouseStyle(system: string, block: string | null): string {
  return block ? `${system}\n\n${block}` : system;
}

/** Fence-aware em-dash scrub for agent-authored prose (server-side teeth for the noEmdash
 *  rule). Replaces em/en dashes OUTSIDE ``` fences and `inline code`: " — " → ", ",
 *  a dash before a capital becomes ". ", bare dashes become ", ". Quoted material inside
 *  fences/inline code is untouched by construction. */
export function scrubEmdash(text: string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/);
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]!
      .replace(/\s*[—–]\s*(?=[A-Z])/g, '. ')
      .replace(/\s*[—–]\s*/g, ', ');
  }
  return parts.join('');
}
