import { describe, expect, it } from 'vitest';
import { authCardBlock, authDecisionQuestion, cardNotification, cardTitle, formatCardAnswer, isLowRiskPermissionCard, MAX_SUGGESTIONS, parseAuthCard, parseCard, parseQuestions, parseSuggestions, preview, readAnswers, stripSuggestions } from '../src/cards';

const NMQ = 'Which deploy target for the marketing site?\n\n```nmq\n{"options":["Vercel","Netlify"]}\n```';
const NMAUTH = 'Your NeuraMesh session needs a reconnect.\n\n```nmauth\n{"nonce":"abc"}\n```';

describe('parseCard', () => {
  it('detects an nmq question card', () => {
    expect(parseCard(NMQ)).toEqual({ kind: 'nmq' });
  });

  it('detects an nmauth reconnect card', () => {
    expect(parseCard(NMAUTH)).toEqual({ kind: 'nmauth' });
  });

  it('nmauth wins when a body carries both markers (the reconnect is blocking)', () => {
    expect(parseCard('```nmq\n{}\n```\n```nmauth\n{}\n```')).toEqual({ kind: 'nmauth' });
  });

  it('is null for an ordinary message', () => {
    expect(parseCard('just a normal update, pushed the branch')).toBeNull();
    expect(parseCard('here is a ```ts\ncode block\n``` but no card')).toBeNull();
  });
});

describe('preview', () => {
  it('drops the fenced card block and returns the first prose line', () => {
    expect(preview(NMQ)).toBe('Which deploy target for the marketing site?');
  });

  it('strips markdown emphasis characters', () => {
    expect(preview('**Heads up** — the _build_ is `green`')).toBe('Heads up — the build is green');
  });

  it('skips leading blank lines', () => {
    expect(preview('\n\n   \nfirst real line\nsecond')).toBe('first real line');
  });

  it('caps the length', () => {
    expect(preview('x'.repeat(300)).length).toBe(140);
    expect(preview('x'.repeat(300), 10).length).toBe(10);
  });

  it('is empty when there is nothing but a fenced block', () => {
    expect(preview('```nmauth\n{"nonce":"abc"}\n```')).toBe('');
  });
});

describe('cardTitle', () => {
  it('phrases nmq as a question and nmauth as an action', () => {
    expect(cardTitle('nmq', '#growth')).toBe('A question for you · #growth');
    expect(cardTitle('nmauth', '#1204')).toBe('Action needed · #1204');
  });
});

describe('cardNotification', () => {
  it('builds title + readable body for a card message', () => {
    expect(cardNotification(NMQ, '#growth')).toEqual({
      kind: 'nmq',
      title: 'A question for you · #growth',
      body: 'Which deploy target for the marketing site?',
    });
  });

  it('falls back when the card has no prose line', () => {
    expect(cardNotification('```nmauth\n{"nonce":"abc"}\n```', '#1204')).toEqual({
      kind: 'nmauth',
      title: 'Action needed · #1204',
      body: 'Open NeuraMesh to respond',
    });
  });

  it('is null for a non-card message', () => {
    expect(cardNotification('shipped it', '#growth')).toBeNull();
  });
});

describe('question cards', () => {
  const twoQ =
    'Two things before I build:\n\n```nmq\n{"question":"Deploy target?","options":[{"label":"Vercel","description":"same org"},{"label":"Netlify"}],"allowOther":true}\n```\n```nmq\n{"question":"Ship copy now?","options":[{"label":"Yes"},{"label":"Hold"}]}\n```';

  it('parses every nmq block into a question', () => {
    const qs = parseQuestions(twoQ);
    expect(qs).toHaveLength(2);
    expect(qs[0]?.question).toBe('Deploy target?');
    expect(qs[0]?.options?.[0]).toEqual({ label: 'Vercel', description: 'same org' });
    expect(qs[1]?.question).toBe('Ship copy now?');
  });

  it('skips a malformed block, keeps the valid ones', () => {
    expect(parseQuestions('```nmq\n{not json}\n```\n```nmq\n{"question":"ok"}\n```')).toEqual([{ question: 'ok' }]);
  });

  it('formats the answer reply as **question** → answer lines', () => {
    expect(formatCardAnswer([{ question: 'Deploy target?', answer: 'Vercel' }, { question: 'Ship copy now?', answer: '' }])).toBe(
      '**Deploy target?** → Vercel\n**Ship copy now?** → (skipped)',
    );
  });

  it('reads answers back out of reply bodies (round-trips)', () => {
    const reply = formatCardAnswer([{ question: 'Deploy target?', answer: 'Vercel' }]);
    const answers = readAnswers([reply]);
    expect(answers.get('Deploy target?')).toBe('Vercel');
  });
});

describe('permission-request variant (agent policy engine)', () => {
  const card = (q: object) => '```nmq\n' + JSON.stringify(q) + '\n```';

  it('parseQuestions surfaces kind + risk when present, leaving ordinary cards untouched', () => {
    const perm = parseQuestions(card({ question: 'Run rm -rf?', kind: 'permission', risk: 'high', options: [{ label: 'Approve' }, { label: 'Deny' }], allowOther: false }))[0]!;
    expect(perm.kind).toBe('permission');
    expect(perm.risk).toBe('high');
    const plain = parseQuestions(card({ question: 'Ship it?' }))[0]!;
    expect(plain.kind).toBeUndefined();
    expect(plain.risk).toBeUndefined();
  });

  it('parseQuestions carries the schedule payload through (marketing schedule-confirm cards)', () => {
    const sched = { action: 'schedule' as const, items: [{ item: 'ci-1', letter: 'a', platform: 'x', slot: '2026-08-01T09:00:00Z', preview: 'a post' }] };
    const q = parseQuestions(card({ question: 'Schedule 1 post for #7?', schedule: sched, options: [{ label: 'Schedule all' }], allowOther: false }))[0]!;
    expect(q.schedule).toEqual(sched); // spread preserves it exactly, like `failover`
    expect(parseQuestions(card({ question: 'Ship it?' }))[0]!.schedule).toBeUndefined();
  });

  it('isLowRiskPermissionCard flags only low-risk permission cards (fewer, better pushes)', () => {
    expect(isLowRiskPermissionCard(card({ question: 'reach api.x.com?', kind: 'permission', risk: 'low' }))).toBe(true);
    expect(isLowRiskPermissionCard(card({ question: 'rm -rf?', kind: 'permission', risk: 'high' }))).toBe(false);
    expect(isLowRiskPermissionCard(card({ question: 'Ship the release?' }))).toBe(false);
    expect(isLowRiskPermissionCard('no card here')).toBe(false);
  });
});

describe('suggestion pills (```nms blocks)', () => {
  const NMS = 'Still unassigned — #1052 needs repro hardware context.\n\n```nms\n["Offer it to patch anyway", "Park it in the backlog", "Who else could take it?"]\n```';

  it('parses a well-formed block into trimmed strings', () => {
    expect(parseSuggestions(NMS)).toEqual(['Offer it to patch anyway', 'Park it in the backlog', 'Who else could take it?']);
    expect(parseSuggestions('```nms\n["  padded  "]\n```')).toEqual(['padded']);
  });

  it('is empty for no block, malformed JSON, or a non-array payload', () => {
    expect(parseSuggestions('plain reply, no block')).toEqual([]);
    expect(parseSuggestions('```nms\n[not json\n```')).toEqual([]);
    expect(parseSuggestions('```nms\n{"question":"nope"}\n```')).toEqual([]);
  });

  it('drops non-strings, empties, and over-long entries', () => {
    expect(parseSuggestions('```nms\n["ok", 7, null, "", "   ", "' + 'x'.repeat(49) + '"]\n```')).toEqual(['ok']);
  });

  it('dedupes case-insensitively and caps at MAX_SUGGESTIONS across blocks', () => {
    expect(parseSuggestions('```nms\n["Ship it", "ship it", "a", "b", "c", "d"]\n```')).toEqual(['Ship it', 'a', 'b', 'c']);
    expect(parseSuggestions('```nms\n["a", "b"]\n```\n```nms\n["b", "c", "d", "e"]\n```')).toHaveLength(MAX_SUGGESTIONS);
  });

  it('never collides with the nmq family', () => {
    expect(parseQuestions(NMS)).toEqual([]);
    expect(parseSuggestions('```nmq\n{"question":"Deploy?"}\n```')).toEqual([]);
    expect(parseCard(NMS)).toBeNull();
  });

  it('stripSuggestions removes the block + trailing whitespace, leaving prose and other fences', () => {
    expect(stripSuggestions(NMS)).toBe('Still unassigned — #1052 needs repro hardware context.');
    const withCode = 'look:\n```ts\nconst x = 1\n```\n\n```nms\n["Run it"]\n```';
    expect(stripSuggestions(withCode)).toBe('look:\n```ts\nconst x = 1\n```');
  });

  it('stripSuggestions clears a trailing unterminated fence (mid-stream render)', () => {
    expect(stripSuggestions('almost done…\n\n```nms\n["Park it')).toBe('almost done…');
    expect(stripSuggestions('almost done…\n\n```nms\n')).toBe('almost done…');
  });

  it('stripSuggestions leaves an unrelated body untouched', () => {
    expect(stripSuggestions('nothing to strip here')).toBe('nothing to strip here');
  });

  it('preview already drops nms blocks from notification copy (and `#` with the other md chars)', () => {
    expect(preview(NMS)).toBe('Still unassigned — 1052 needs repro hardware context.');
  });
});

// The live #1026 card: rex authored plain-string options and every pill rendered BLANK —
// a decision the human could see but not answer.
it('parseQuestions: string options become labels instead of blank pills', () => {
  const body = '```nmq\n' + JSON.stringify({
    question: 'How should plume proceed?',
    options: ['Schedule both as drafted', 'Revise the Jul 25 copy', 'Hold until I review'],
  }) + '\n```';
  const [q] = parseQuestions(body);
  expect(q?.options).toEqual([
    { label: 'Schedule both as drafted' },
    { label: 'Revise the Jul 25 copy' },
    { label: 'Hold until I review' },
  ]);
});

it('parseQuestions: text/value/title stand in for label, and unreadable options are dropped', () => {
  const body = '```nmq\n' + JSON.stringify({
    question: 'pick',
    options: [{ text: 'by text' }, { value: 'by value' }, { title: 'by title' }, { label: '   ' }, {}, 42, null, { label: 'ok', description: 'why' }],
  }) + '\n```';
  const [q] = parseQuestions(body);
  expect(q?.options).toEqual([
    { label: 'by text' }, { label: 'by value' }, { label: 'by title' }, { label: 'ok', description: 'why' },
  ]);
});

it('parseQuestions: a card with no usable options carries none at all', () => {
  const body = '```nmq\n' + JSON.stringify({ question: 'free text?', options: ['', '  ', {}] }) + '\n```';
  expect(parseQuestions(body)[0]?.options).toBeUndefined();
});

// George's live thread (2026-07-30): rex asked a real question in the YAML-shaped near-miss and
// the block leaked into the room as raw transport, with no decision row written anywhere.
it('parseQuestions: the YAML-shaped near-miss still becomes a card', () => {
  const body = [
    'Likely blocker: the clone fails from the worker host.',
    '```nmq',
    "question: #1009 copy sweep can't clone acme/marketing-site. How should we proceed?",
    'options:',
    '  - Grant repo access, then I re-offer the sweep',
    '  - Point to a different repo/URL, and I rebind #1009 to it',
    '  - Cancel the sweep',
    '```',
  ].join('\n');
  const [q] = parseQuestions(body);
  expect(q?.question).toBe("#1009 copy sweep can't clone acme/marketing-site. How should we proceed?");
  expect(q?.options).toEqual([
    { label: 'Grant repo access, then I re-offer the sweep' },
    { label: 'Point to a different repo/URL, and I rebind #1009 to it' },
    { label: 'Cancel the sweep' },
  ]);
});

it('parseQuestions: a near-miss question with no options is still a card', () => {
  const body = '```nmq\nquestion: ship it?\nallow_other: true\n```';
  const [q] = parseQuestions(body);
  expect(q?.question).toBe('ship it?');
  expect(q?.options).toBeUndefined();
  expect(q?.allowOther).toBe(true);
});

it('parseQuestions: a block with no question at all is still skipped, not invented', () => {
  expect(parseQuestions('```nmq\njust some prose the model emitted\n```')).toEqual([]);
  expect(parseQuestions('```nmq\nquestion:   \n```')).toEqual([]);
});

it('parseQuestions: a following top-level key ends the option list', () => {
  const body = '```nmq\nquestion: pick\noptions:\n  - one\n  - two\nkind: permission\n```';
  const [q] = parseQuestions(body);
  expect(q?.options).toEqual([{ label: 'one' }, { label: 'two' }]);
});

// ── the nmauth payload (the phone's credential card, 2026-09-08) ──────────────────────────────
// The phone had no parser, so `stripCards` dropped the block and the reader saw prose ending in
// "choose how to proceed:" with nothing to choose. One parser now serves both clients.
describe('parseAuthCard', () => {
  const body = (json: string) => `⚠️ @rex can't reply.\n\n\`\`\`nmauth\n${json}\n\`\`\``;

  it('reads the payload an agent posts', () => {
    const a = parseAuthCard(body('{"provider":"gemini","reason":"unavailable","agent":"rex"}'));
    expect(a).toEqual({ provider: 'gemini', reason: 'unavailable', agent: 'rex' });
  });

  it('carries the task number when the block is about a task', () => {
    expect(parseAuthCard(body('{"provider":"anthropic","reason":"expired","agent":"patch","taskNumber":1046}'))?.taskNumber).toBe(1046);
  });

  it('carries the fallback door\'s fields, and round-trips through the one serializer (2026-09-17)', () => {
    const card = { provider: 'openai', reason: 'unavailable' as const, agent: 'rex', why: 'This machine has no OpenAI / Codex login.', starter: true, scope: { threadId: 't-1', role: 'orchestrator' }, switched: true };
    expect(parseAuthCard(authCardBlock(card))).toEqual(card);
    // a malformed scope is dropped rather than trusted, and `switched` is only ever literally true
    expect(parseAuthCard(body('{"provider":"openai","scope":{"threadId":"t"},"switched":"yes"}'))).toEqual({ provider: 'openai' });
  });

  it('mints the needs-you row\'s question from the card, naming who, why and the way out', () => {
    expect(authDecisionQuestion({ provider: 'openai', agent: 'rex', why: 'This machine has no OpenAI / Codex login.' }))
      .toBe('@rex cannot run here. This machine has no OpenAI / Codex login. Sign in again, or switch this conversation to the NeuraMesh brain, on credits.');
    expect(authDecisionQuestion({ provider: 'anthropic', reason: 'expired' })).toMatch(/^An agent cannot run here\. The Claude login on this machine expired\./);
  });

  it('is null without a block, so ordinary prose is never a card', () => {
    expect(parseAuthCard('no block here')).toBeNull();
  });

  it('is null on unparseable JSON — the prose still has to read on its own', () => {
    expect(parseAuthCard(body('{not json'))).toBeNull();
  });

  it('drops a reason it does not know rather than passing it through', () => {
    const a = parseAuthCard(body('{"provider":"gemini","reason":"weird"}'));
    expect(a).toEqual({ provider: 'gemini' });
  });

  it('needs a provider — that is the one field the card cannot render without', () => {
    expect(parseAuthCard(body('{"reason":"expired"}'))).toBeNull();
  });
});

describe('fence openers do not backtrack on blank lines (js/polynomial-redos)', () => {
  // an opener followed by thousands of blank lines and NO closing fence: `\s*\n` made every parser
  // re-scan the body from each whitespace position; `[ \t]*\n` scans it once
  const flood = '\n '.repeat(20_000);
  it('parseAuthCard returns fast on an unterminated fence', () => {
    const t0 = performance.now();
    expect(parseAuthCard('```nmauth\n' + flood)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });
  it('the question and suggestion parsers too', () => {
    const t0 = performance.now();
    expect(parseQuestions('```nmq\n' + flood)).toEqual([]);
    expect(parseSuggestions('```nms\n' + flood)).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(400);
  });
  it('a fence with trailing blanks after the word, or a blank line before the JSON, still parses', () => {
    const card = parseAuthCard('```nmauth  \n\n{"provider":"anthropic","reason":"expired"}\n```');
    expect(card?.provider).toBe('anthropic');
  });
});
