import { describe, expect, it } from 'vitest';
import { stripMarkdownInline, threadTitle } from '../src/threads';
import { plainTitle } from '../src/sessions';

describe('threadTitle', () => {
  it('strips leading mentions and capitalizes', () => {
    expect(threadTitle("@rex what's on our backlog?")).toBe("What's on our backlog?");
  });
  it('strips stacked mentions', () => {
    expect(threadTitle('@rex @patch: fix the drawer focus trap')).toBe('Fix the drawer focus trap');
  });
  it('peels greetings around mentions, in either order', () => {
    expect(threadTitle('hey @rex whats in our backlog?')).toBe('Whats in our backlog?');
    expect(threadTitle('@rex please summarize the sprint')).toBe('Summarize the sprint');
    expect(threadTitle('Hey there, ok — hello everyone')).toBe('Everyone');
  });
  it('mid-sentence handles read as names; compounds like Hi-priority survive', () => {
    expect(threadTitle('ask @gem to benchmark recall')).toBe('Ask gem to benchmark recall');
    expect(threadTitle('Hi-priority: fix the login redirect')).toBe('Hi-priority: fix the login redirect');
  });
  it('takes the first sentence of longer prose', () => {
    expect(threadTitle('Tighten the cap meter spacing. Also the button hover feels off, and the meter wraps at narrow widths.'))
      .toBe('Tighten the cap meter spacing');
  });
  it('caps long single sentences on a word boundary with an ellipsis', () => {
    const t = threadTitle('please refactor the entire projects page grid layout so the cards align with the composer column width everywhere');
    expect(t.length).toBeLessThanOrEqual(61);
    expect(t.endsWith('…')).toBe(true);
    expect(t.includes('  ')).toBe(false);
  });
  it('ignores code fences and links', () => {
    expect(threadTitle('```\nrm -rf node_modules\n```\nsee https://example.com/x — clear the corrupted install')).toBe('See — clear the corrupted install');
  });
  it('attachment-only messages get the neutral name', () => {
    expect(threadTitle('')).toBe('New thread');
    expect(threadTitle('   ')).toBe('New thread');
  });
});

describe('titles are plain text (2026-09-12)', () => {
  it('a routine body titles as its plain first line', () => {
    expect(threadTitle('Routine · do some research on AI for mental health\n\nRead the last three briefs and…')).toBe('Routine · do some research on AI for mental health');
  });
  it('a period inside a token is not a sentence stop: a version number survives the cut', () => {
    expect(threadTitle('Release drafts · v0.134.0 · alonge-dev/neuramesh\n\n**The first check** · checked 22:14')).toBe('Release drafts · v0.134.0 · alonge-dev/neuramesh');
    expect(threadTitle('Ship v2.1 today. Then rest.')).toBe('Ship v2.1 today');
  });
  it('emphasis, code ticks and a heading hash never reach a title', () => {
    expect(threadTitle('**Routine — hey rex, can we do some research**')).toBe('Routine — hey rex, can we do some research');
    expect(threadTitle('## Fix the `focus-trap` on *iPad*')).toBe('Fix the focus-trap on iPad');
  });
  it('plainTitle cleans a title cut with its closing marker gone, and leaves snake_case alone', () => {
    expect(plainTitle('**Routine — hey rex, can we do s')).toBe('Routine — hey rex, can we do s');
    expect(plainTitle('rename `nm_worker` to snake_case_name')).toBe('rename nm_worker to snake_case_name');
    expect(stripMarkdownInline('~~old~~ __bold__ _soft_')).toBe('old bold soft');
  });
});
