// Mention + bare-name addressing — the ONE source of truth for "does this message
// address that teammate?", shared by the composer highlight (renderer) and the wake
// decisions (agent daemon). If the input lights a name up, the daemon summons it;
// if it stays plain, it won't — the two sides must never drift apart.

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Exact @mention match. Agent names are [\w-] (e.g. "echo", "echo-orch"), so a
// plain \b boundary treats the hyphen as a break — "@echo" would wrongly match
// "@echo-orch". Require the char after the name to be neither a word char nor a
// hyphen, so @echo matches @echo but not @echo-orch / @echobot.
export function mentionRe(name: string, flags = 'i'): RegExp {
  return new RegExp(`@${escapeRe(name)}(?![\\w-])`, flags);
}

// A message that STARTS with a bare agent name ("rex can we make a pdf…") is
// addressing that agent — same boundary guard as mentionRe. Leading position
// only: a mid-sentence bare name ("can rex do it?") is conversation, not a
// summons, so it must neither highlight nor wake.
export function bareAddressRe(name: string, flags = 'i'): RegExp {
  return new RegExp(`^\\s*${escapeRe(name)}(?![\\w-])`, flags);
}

// The summon test used by the daemon's wake decisions: an explicit @mention
// anywhere in the body, or the bare name in leading position.
export function addressedIn(body: string, name: string): boolean {
  return mentionRe(name).test(body) || bareAddressRe(name).test(body);
}

// ── Composer-draft tokenizer (the in-input highlight) ─────────────────────────
// Splits a draft into plain text and mention tokens against the room's roster.
// `here` = the teammate is reachable from this composer (agent registered to the
// room / the human): a bare leading name is only a token when here — the styling
// is a promise about delivery, never decoration.
export interface Mentionable {
  name: string;
  kind: 'agent' | 'human';
  here: boolean;
}

export type DraftSegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; name: string; here: boolean; who: 'agent' | 'human' }
  | { kind: 'bare'; text: string; name: string };

// ── Human mention handles ─────────────────────────────────────────────────────
// Members are addressed by HANDLE: display names carry spaces/case/accents
// ("George Alonge") that the [\w-] mention grammar (the @token scan below, the
// composer's popup query, the daemon's boundary guards) can never hold. The
// handle is the first name, lowercased + ascii-folded ("george"). A short handle
// two members share is never assigned — each collider takes their full-name slug
// ("george-alonge" / "george-smith") so a bare @george is never silently
// ambiguous; still-identical slugs get -2/-3 in input order. `reserved` (the
// active agent names) can never be shadowed: the daemon summons agents by name,
// so a member handle equal to one would highlight a human while the send wakes
// the agent. Callers must use the returned handle in BOTH the tokenizer roster
// and the inserted @text — this function is the whole convention.
export interface HumanMentionable {
  name: string; // the mention handle — always a valid [\w-] token
  label: string; // the display name it came from
}

const slugWord = (w: string) => w.normalize('NFD').replace(/[^\w-]/g, '');
const slugName = (s: string) => s.toLowerCase().split(/\s+/).map(slugWord).filter(Boolean).join('-');

export function humanHandles(labels: Array<string | null | undefined>, reserved: Iterable<string> = []): HumanMentionable[] {
  const taken = new Set([...reserved].map((n) => n.toLowerCase()));
  const named = labels.map((l) => l?.trim() ?? '');
  const firstCount = new Map<string, number>();
  for (const l of named) {
    const f = slugName(l.split(/\s+/)[0] ?? '');
    if (f) firstCount.set(f, (firstCount.get(f) ?? 0) + 1);
  }
  const out: HumanMentionable[] = [];
  for (const label of named) {
    if (!label) continue;
    const first = slugName(label.split(/\s+/)[0] ?? '');
    const base = first && firstCount.get(first) === 1 && !taken.has(first) ? first : slugName(label);
    if (!base) continue; // a name the grammar can't represent (nothing survived folding)
    let handle = base;
    for (let n = 2; taken.has(handle); n++) handle = `${base}-${n}`;
    taken.add(handle);
    out.push({ name: handle, label });
  }
  return out;
}

export function tokenizeDraft(text: string, people: Mentionable[]): DraftSegment[] {
  if (!text) return [];
  const byName = new Map(people.map((p) => [p.name.toLowerCase(), p]));
  const spans: Array<DraftSegment & { start: number; end: number }> = [];

  // bare leading agent name — longest matching name wins ("gem" never shadows "gemma")
  let bare: { name: string; start: number; end: number } | null = null;
  for (const p of people) {
    if (p.kind !== 'agent' || !p.here) continue;
    const m = bareAddressRe(p.name).exec(text);
    if (m && (!bare || p.name.length > bare.name.length)) {
      const start = m[0].length - p.name.length;
      bare = { name: p.name, start, end: m[0].length };
    }
  }
  if (bare) spans.push({ kind: 'bare', text: text.slice(bare.start, bare.end), name: bare.name, start: bare.start, end: bare.end });

  // @tokens anywhere — same end-boundary the daemon applies (mentionRe), so the
  // highlight mirrors the summon exactly, quirks included
  const at = /@([\w-]+)/g;
  for (let m = at.exec(text); m; m = at.exec(text)) {
    const p = byName.get(m[1]!.toLowerCase());
    if (!p) continue;
    spans.push({ kind: 'mention', text: m[0], name: p.name, here: p.here, who: p.kind, start: m.index, end: m.index + m[0].length });
  }

  spans.sort((a, b) => a.start - b.start);
  const out: DraftSegment[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start > pos) out.push({ kind: 'text', text: text.slice(pos, s.start) });
    const { start: _s, end: _e, ...seg } = s;
    out.push(seg);
    pos = s.end;
  }
  if (pos < text.length) out.push({ kind: 'text', text: text.slice(pos) });
  return out;
}
