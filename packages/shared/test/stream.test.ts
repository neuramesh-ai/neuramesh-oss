// Live #1048: the ```revise fence typed itself out under "plume is typing" — a JSON array of
// post bodies shown to a human as if the agent were talking to them. The final message stripped
// it; the stream never did, and the renderer's guard matched `nm*` fences only.
import { describe, expect, it } from 'vitest';
import { visibleStream, isStandDown, carryCards } from '../src/stream';

const PROSE = 'All three X drafts, below. I added image briefs to b and c.';

describe('machine fences never reach the bubble', () => {
  it('the #1048 case: a revise fence still streaming in shows nothing but the prose', () => {
    const partial = `${PROSE}\n\n\`\`\`revise\n[\n  {"letter":"b","body":"you left the same review comm`;
    expect(visibleStream(partial)).toEqual({ text: PROSE, forming: 'drafts' });
  });

  it('a closed fence leaves nothing behind — not even a gap', () => {
    const done = `${PROSE}\n\n\`\`\`revise\n[{"letter":"b","body":"x"}]\n\`\`\`\n`;
    expect(visibleStream(done)).toEqual({ text: PROSE, forming: null });
  });

  it('the bare opening line, before a single byte of payload, already hides', () => {
    expect(visibleStream(`${PROSE}\n\n\`\`\`revise`)).toEqual({ text: PROSE, forming: 'drafts' });
  });

  it('covers the cards verb and the nm transport fences', () => {
    expect(visibleStream(`${PROSE}\n\`\`\`cards\na, b\n`).forming).toBe('drafts');
    expect(visibleStream(`Which one?\n\`\`\`nmq\n{"question":"…`).forming).toBe('card');
    expect(visibleStream(`Done.\n\`\`\`nms\n["ship it"`).forming).toBe('card');
  });

  it('several fences in one turn all go', () => {
    const t = `one\n\`\`\`revise\n[]\n\`\`\`\ntwo\n\`\`\`nms\n["a"]\n\`\`\`\nthree`;
    expect(visibleStream(t).text).toBe('one\ntwo\nthree');
  });
});

describe('prose the human wrote for the human survives', () => {
  it('a plain code block is untouched — it is the answer, not the wire', () => {
    const t = 'Use this:\n\n```ts\nconst x = 1;\n```\n\nThat is all.';
    expect(visibleStream(t)).toEqual({ text: t, forming: null });
  });

  it('an unfenced word that happens to be a tag is untouched', () => {
    const t = 'I will revise the cards and repost the posts.';
    expect(visibleStream(t)).toEqual({ text: t, forming: null });
  });

  it('a fenced json block is left alone — only the named machine tags hide', () => {
    const t = 'The shape is:\n\n```json\n{"a":1}\n```';
    expect(visibleStream(t)).toEqual({ text: t, forming: null });
  });

  it('an empty turn stays empty rather than becoming a stray newline', () => {
    expect(visibleStream('')).toEqual({ text: '', forming: null });
    expect(visibleStream('```revise\n[')).toEqual({ text: '', forming: 'drafts' });
  });
});

// The stand-down sentinel is addressed to the daemon, not the human. It leaked twice: as a bare
// "NO_REPLY" narration line in the activity feed, and into the live bubble before the turn ended.
describe('the stand-down sentinel never renders', () => {
  it('a turn that is only NO_REPLY shows nothing', () => {
    expect(visibleStream('NO_REPLY')).toEqual({ text: '', forming: null });
    expect(visibleStream('  NO_REPLY\n')).toEqual({ text: '', forming: null });
  });

  // the 2026-07-02 loop: a model wrapped the sentinel in narrative, the exact-equality check
  // missed it, the chatter posted, counted as fresh activity, and re-armed the next sweep
  it('stands down when the sentinel is its own first or last line, however dressed', () => {
    expect(isStandDown('NO_REPLY')).toBe(true);
    expect(isStandDown(' NO_REPLY ')).toBe(true);
    expect(isStandDown('**NO_REPLY**')).toBe(true);
    expect(isStandDown('Board is empty, nothing needs me.\n\nNO_REPLY')).toBe(true);
    expect(isStandDown('')).toBe(true); // an empty turn IS a stand-down (ORCH_EMPTY_TURN)
  });

  it('a NO_REPLY mid-sentence is a real reply and must still post', () => {
    expect(isStandDown('I answered NO_REPLY last time because nothing was open, but now #12 is stuck.')).toBe(false);
    expect(isStandDown('NO_REPLY_NEEDED is not the sentinel.')).toBe(false);
  });

  it('prose that merely contains the token still renders in full', () => {
    const t = 'The sweep answers NO_REPLY when the board is quiet.';
    expect(visibleStream(t)).toEqual({ text: t, forming: null });
  });
});

describe('carryCards — cards written before the final block survive it', () => {
  const card = (q: string) => '```nmq\n' + JSON.stringify({ question: q, options: [{ label: 'A' }, { label: 'B' }] }) + '\n```';

  it('rescues cards the final block dropped — the "Waiting on those two" incident', () => {
    const earlier = [`Two quick questions before I scope this:\n\n${card('Which repo?')}\n\n${card('Full page or a section?')}`];
    const out = carryCards('Waiting on those two before scoping the task.', earlier);
    expect(out).toContain('Which repo?');
    expect(out).toContain('Full page or a section?');
    // the prose that refers to "those two" sits UNDER the two it means
    expect(out.indexOf('Which repo?')).toBeLessThan(out.indexOf('Waiting on those two'));
  });

  it('never duplicates a card the final block already carries', () => {
    const final = `Here you go:\n\n${card('Which repo?')}`;
    expect(carryCards(final, [`Draft:\n${card('Which repo?')}`])).toBe(final);
  });

  it('a REVISED card asking the same question supersedes the draft', () => {
    const draft = '```nmq\n' + JSON.stringify({ question: 'Which repo?', options: [{ label: 'old' }] }) + '\n```';
    const final = `Settled:\n\n${card('Which repo?')}`;
    const out = carryCards(final, [draft]);
    expect(out).toBe(final);
    expect(out).not.toContain('"old"');
  });

  it('plain narration blocks add nothing', () => {
    expect(carryCards('The answer is 4.', ['Let me check the board…', 'Reading the repo now.'])).toBe('The answer is 4.');
  });

  it('nms suggestion fences ride along too', () => {
    const nms = '```nms\n["Offer it to a developer", "Show me the diff"]\n```';
    const out = carryCards('Pick one.', [`Options:\n${nms}`]);
    expect(out.startsWith(nms)).toBe(true);
  });
});
