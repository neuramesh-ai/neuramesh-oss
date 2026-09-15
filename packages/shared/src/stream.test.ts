import { describe, expect, it } from 'vitest';
import { carryCards } from './stream';

describe('carryCards keeps the words when the final block is only a fence', () => {
  const pills = '```nms\n["What are we building?", "Show me the library docs"]\n```';
  it('a prose block, then the pills as their own final block: the prose leads and the pills follow', () => {
    const out = carryCards(pills, ['Hey, I am rex, your orchestrator. Mention me with a goal and I break it into tasks.']);
    expect(out.startsWith('Hey, I am rex')).toBe(true);
    expect(out.endsWith(pills)).toBe(true);
    expect(out.match(/```nms/g)).toHaveLength(1);
  });
  it('a question card as the final block keeps the words that introduced it', () => {
    const card = '```nmq\n{"question": "What are we building here?", "options": []}\n```';
    const out = carryCards(card, ['Before I plan, one thing.']);
    expect(out).toBe(`Before I plan, one thing.\n\n${card}`);
  });
  it('a final block with prose is untouched: the narration before a tool call still goes', () => {
    expect(carryCards('Done. The plan is up.', ['Let me check the board…'])).toBe('Done. The plan is up.');
  });
  it('the last earlier block with prose wins, and its own fence is not doubled', () => {
    const out = carryCards(pills, ['First thoughts.', `Second thoughts.\n\n${pills}`]);
    expect(out).toBe(`Second thoughts.\n\n${pills}`);
  });
});

describe('carryCards keeps the words the model said in a message of its own', () => {
  const intro = 'Hey. I am rex, your orchestrator. This is #general, the team home base. Mention me with a goal and I break it into board tasks and hand them to the team.';
  it('an introduction, then a tool check, then a one-line confirmation: the introduction leads', () => {
    const out = carryCards('Confirmed: no open tasks on the board right now.', [intro, 'Let me check the board.'], [intro]);
    expect(out).toBe(`${intro}\n\nConfirmed: no open tasks on the board right now.`);
  });
  it('a short standalone line is narration and stays out', () => {
    expect(carryCards('Done.', ['Let me check the board.'], ['Let me check the board.'])).toBe('Done.');
  });
  it('words the final block already holds are not said twice', () => {
    expect(carryCards(`${intro}\n\nDone.`, [intro], [intro])).toBe(`${intro}\n\nDone.`);
  });
});

describe('carryCards drops a narrated tool call from the words it carries', () => {
  const intro = 'I am rex, the point of contact for #general. A few things I do here: answer directly, produce deliverables, route real work to the board.';
  it('a set_thread_title({...}) line before the words stays out, the words stay in', () => {
    const block = `set_thread_title({"title": "Rex introduction", "description": "Intro and capabilities overview"})\n${intro}`;
    expect(carryCards('Confirmed: nothing on the board yet.', [block], [block])).toBe(`${intro}\n\nConfirmed: nothing on the board yet.`);
  });
});
