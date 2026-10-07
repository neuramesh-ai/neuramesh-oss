// the person's word on a done unit (George, 2026-09-08: "a user should explicitly tell the model in chat
// e.g. merge for those actions to happen, not a button click"). two pure readers the accept path shares:
// which messages a client posted for the person (control-api store/thread-settle.ts leaves them out of
// the server's floor), and whether a typed message tells the agent to merge or accept (the daemon's
// accept_task gate, host/acceptgate.ts). since 2026-10-05 every reply on a done unit wakes the
// orchestrator, so a question there must not be able to merge anything.

/** a card's answer as the person's client posts it: "**question** → answer" */
const CARD_ANSWER = /^\s*\*\*[^\n]*\*\*\s*(?:→|->)/;

/** a message the person's client posted for them: a card's answer, or a marker line (‹github:connected:…›,
 *  ‹gen-image:…›, ‹wb:…›). a click or a record, never the words the person typed */
export function isCardOrMarker(body: string): boolean {
  return body.trimStart().startsWith('‹') || CARD_ANSWER.test(body);
}

const VERB = '(?:merge|accept|land|ship)';
const VERB_FIRST = new RegExp(`^${VERB}\\b`);
// one word before the verb: the agent's name ("rex merge it"), or a verb it joins ("approve and merge")
const ONE_WORD_FIRST = new RegExp(`^(\\S+) (?:and )?${VERB}\\b`);
// the courtesy and the assent a person puts before the word ("yes, please merge it", "go ahead and ship it")
const LEAD = /^(?:(?:please|pls|ok|okay|yes|yeah|yep|sure|great|cool|perfect|thanks|lgtm|then|now|so|and|just|i|we|go ahead and|you can|you may|feel free to|let's|lets|can you|could you|would you|will you)\s+)+/;
// a word that makes the verb a noun, a name or a plan of the person's own ("a merge conflict", "the
// merge failed", "git merge", "I will merge it")
const NOT_A_NAME = /^(?:a|an|the|this|that|any|no|one|some|each|every|my|our|your|its|their|git|to|will|would|should|could|can|might|may|must|shall|do|does|did|is|was|[a-z]+'(?:ll|d|ve|re|m))$/;
// a "not yet", a condition or the person's own hand, in any words: they did not say to merge now
const HOLD = /\b(?:not|never|dont|do not|wait|hold|stop|cancel|yet|before|until|unless|later|tomorrow|tonight|after|once|if|myself|ourselves|manually)\b|n't\b/;
const POLITE_ASK = /^(?:please |pls )?(?:can|could|would|will) you\b/;

/** the verb opens the clause, after the courtesy, or after one word that names the agent ("rex merge it") */
function opensWithVerb(clause: string): boolean {
  const c = clause.replace(LEAD, '');
  if (VERB_FIRST.test(c)) return true;
  const m = ONE_WORD_FIRST.exec(c);
  return !!m && !NOT_A_NAME.test(m[1]!);
}

/**
 * Does a person's message tell the agent to merge or accept the unit? An instruction: the verb (merge,
 * accept, land, ship) opens a clause: "merge it", "rex, merge it", "Looks good. Ship it.", "please accept".
 * A polite ask may end in a question mark ("can you merge it?"). A question, a "not yet" in any words and
 * a card's click are no instruction. The reading is strict on purpose: a word it misses costs the person
 * one more message, and a word it invents costs a merge that nobody can undo.
 */
export function isAcceptWord(body: string): boolean {
  if (isCardOrMarker(body)) return false;
  const text = body.toLowerCase().replace(/[’`]/g, "'").replace(/(^|\s)@[\w.-]+/g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (!new RegExp(`\\b${VERB}\\b`).test(text) || HOLD.test(text)) return false;
  const clauses = text.split(/[.!?;,:\n—–]+|\s-\s/).map((c) => c.trim()).filter(Boolean);
  const said = clauses.find(opensWithVerb);
  if (!said) return false;
  return !text.includes('?') || POLITE_ASK.test(said);
}
