// Message markers — the '‹wb:id›' / decision / suggestion tokens a message body carries,
// and how they are stripped for display. Split out of thread/convo.tsx.


/**
 * The machine markers a message may carry, stripped before it is read.
 *
 * `‹revised:…›` re-anchors a card, `‹cards:…›` re-shows one, `‹gen-image:…›` is what the card's
 * Generate button actually sends — none of them are language. Named here because it used to be an
 * inline regex in the task thread only, so the very same message read clean on a task and leaked
 * `‹gen-image:ci-c3›` into a conversation: exactly the two-surfaces-one-behaviour drift that
 * having two thread components keeps producing.
 */
export const MARKER_RE = /‹(?:revised|cards|gen-image|gen-video|release):[^›]+›/g;

export const stripMarkers = (body: string): string => body.replace(MARKER_RE, '').trim();
