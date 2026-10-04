// Card fences a model bent (cardfence.ts): George's screenshot of 2026-10-02 showed rex's question as raw
// JSON, because its block opened at "question" with no brace. The repair must put every bent shape back,
// and leave everything it cannot read, or that was never bent, exactly as it was.
import { describe, expect, it } from 'vitest';
import { cardsAsWords, historyRows, parseAuthCard, parseQuestions, repairCardFences, routineBlock, stripCardFences } from '../src';

const fence = (lang: string, inner: string) => '```' + lang + '\n' + inner + '\n```';
const options = '"options": [\n  { "label": "Broaden keywords", "description": "x" },\n  { "label": "Keep keywords", "description": "y" }\n],\n"allowOther": true';

describe('a bent card goes back in its shape', () => {
  it('the screenshot: no opening brace, the prose around it kept', () => {
    const body = `Here are two ways to tune it.\n\n${fence('nmq', `"question": "How should we adjust the query?",\n${options}\n}`)}`;
    expect(parseQuestions(body)).toEqual([]); // what the clients saw: no card
    const fixed = repairCardFences(body);
    expect(fixed.startsWith('Here are two ways to tune it.\n\n```nmq\n{')).toBe(true);
    const [q] = parseQuestions(fixed);
    expect(q?.question).toBe('How should we adjust the query?');
    expect(q?.options?.map((o) => o.label)).toEqual(['Broaden keywords', 'Keep keywords']);
  });

  it('the brace on the fence line', () => {
    const body = '```nmq {\n' + `"question": "Which bar?",\n${options}\n}\n` + '```';
    expect(parseQuestions(repairCardFences(body))[0]?.question).toBe('Which bar?');
  });

  it('no braces at all, a trailing comma, and the closing fence on the last line', () => {
    expect(parseQuestions(repairCardFences(fence('nmq', '"question": "No braces?",\n"allowOther": true')))[0]?.question).toBe('No braces?');
    expect(parseQuestions(repairCardFences(fence('nmq', '{"question": "Comma?", "options": ["a", "b",],}')))[0]?.options?.length).toBe(2);
    expect(parseQuestions(repairCardFences('```nmq\n{"question": "Same line?"}```'))[0]?.question).toBe('Same line?');
  });

  it('every card kind, not only questions', () => {
    const auth = '```nmauth {\n"provider": "openai", "reason": "unavailable", "agent": "rex"}\n```';
    expect(parseAuthCard(auth)).toBeNull();
    expect(parseAuthCard(repairCardFences(auth))?.provider).toBe('openai');
  });
});

describe('what was never bent, or cannot be read, stays as it was', () => {
  it('a clean card stays byte for byte', () => {
    const body = `Pick one.\n\n${fence('nmq', '{\n  "question": "Clean?"\n}')}\n\nThanks.`;
    expect(repairCardFences(body)).toBe(body);
  });

  it('the YAML slip the nmq parser reads itself', () => {
    const body = fence('nmq', 'question: Which bar?\noptions:\n  - 5k\n  - 10k');
    expect(repairCardFences(body)).toBe(body);
    expect(parseQuestions(body)[0]?.options?.length).toBe(2);
  });

  it('a block no repair can read, an info string, a block still streaming, and other fences', () => {
    const broken = fence('nmq', '"question": "Half');
    expect(repairCardFences(broken)).toBe(broken);
    const info = '```nmq title\n{"question": "x"}\n```';
    expect(repairCardFences(info)).toBe(info);
    const streaming = 'Here it is.\n```nmq\n{"question": "St';
    expect(repairCardFences(streaming)).toBe(streaming);
    const json = '```json {\n"a": 1\n```';
    expect(repairCardFences(json)).toBe(json);
  });
});

describe('a transcript shows a card as words', () => {
  it('a question card, bent or clean, with its options', () => {
    const clean = `Two ways.\n${fence('nmq', `{"question": "Which bar?", ${options}}`)}`;
    expect(cardsAsWords(clean)).toBe('Two ways.\n[a question card: “Which bar?” · options: Broaden keywords · Keep keywords]');
    expect(cardsAsWords('```nmq {\n"question": "Bent?"}\n```')).toBe('[a question card: “Bent?”]');
  });

  it('a routine card, and words with no card', () => {
    const draft = { title: 'Daily brief', cadence: 'daily' as const, atTime: '09:00', goal: 'g', eachRun: 'e', rules: 'r', output: 'o', ifNone: 'n' };
    expect(cardsAsWords(routineBlock({ kind: 'draft', draft }))).toMatch(/^\[a routine draft card, posted with propose_routine: “Daily brief”/);
    expect(cardsAsWords('plain words')).toBe('plain words');
  });
});

describe('a one-line preview never prints a card', () => {
  it('drops every card, bent or clean, and one still streaming', () => {
    expect(stripCardFences(`Pick the list.\n\n${fence('nmq', '{"question": "x"}')}`)).toBe('Pick the list.');
    expect(stripCardFences('Two ways.\n```nmq {\n"question": "y"}\n```\nThanks.')).toBe('Two ways.\n\nThanks.');
    expect(stripCardFences('Here.\n```nmq\n{"question": "St')).toBe('Here.');
    expect(stripCardFences('```ts\nconst a = 1;\n```')).toBe('```ts\nconst a = 1;\n```');
  });

  it("a session row's snippet shows the words, not the card's JSON", () => {
    const [row] = historyRows({ threads: [{ id: 't1', title: 'Tune the query', task_id: null, updated_at: '2026-10-02T04:00:00Z', last_body: `A narrower list keeps the bar high.\n\n${fence('nmq', '{"question": "Which accounts?"}')}` } as never], tasks: [], channelId: null, channelSlug: 'marketing', query: '' });
    expect(row?.snip).toBe('A narrower list keeps the bar high.');
  });

  it("the grant's divider reads as words in a session row, never as its marker", () => {
    const [row] = historyRows({ threads: [{ id: 't1', title: 'Map the storage adapters', task_id: null, updated_at: '2026-10-04T04:00:00Z', last_body: '‹github:connected:acme/site›' } as never], tasks: [], channelId: null, channelSlug: 'build', query: '' });
    expect(row?.snip).toBe('GitHub connected · acme/site');
  });
});
