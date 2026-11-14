// WHAT THE SLEEP-TIME REFRESH MAY STORE AS A FACT (host/block.ts). A fact is something worth
// remembering in a month: a decision, a convention, an owner, a deadline. Only a model reading the
// room can find one. Without a model (the echo mode: no vendor token, which is every workspace on
// the starter brain on Cloud Run) the refresh used to store "#general channel status: N messages and
// M open tasks" as a fact on every pass, and recall and the Memory view filled with counts (the
// Cloud Run feature suite, 2026-10-30). A count is the summary block's business, never a fact.

/** the facts to upsert: the model's lines that fit, or none at all when no model read the room */
export function factCandidates(raw: string | null): string[] {
  if (raw === null) return [];
  return raw.split('\n').map((l) => l.trim()).filter((l) => l.length >= 12 && l.length <= 300).slice(0, 5);
}
