// THE CARDS AS WORDS, for an agent's transcript (the routine writer's third live run, and George's
// screenshot of 2026-10-02). A transcript puts each message on one line, so a raw card reached the model
// as "```nmq { "question": … }", and a small model copied that bent shape into its next card. The
// transcript now names each card in words and leaves the model no block to copy: the contract keeps the
// one true shape. A card no parser reads stays as it was.
import { parseQuestionBlock } from './cards';
import { repairCardFences } from './cardfence';
import { routineCardText } from './routine-draft';

const NMQ = /```nmq[ \t]*\n([\s\S]*?)```/g;

/** a message as an agent's transcript shows it: question and routine cards in words */
export function cardsAsWords(body: string): string {
  if (!body.includes('```nm')) return body;
  return routineCardText(repairCardFences(body)).replace(NMQ, (whole, inner: string) => {
    const q = parseQuestionBlock(inner);
    if (!q) return whole;
    const options = q.options?.length ? ` · options: ${q.options.map((o) => o.label).join(' · ')}` : '';
    return `[a question card: “${q.question}”${options}]`;
  });
}
