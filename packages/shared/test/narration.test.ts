import { describe, expect, it } from 'vitest';
import { MAX_PROGRESS_CHARS, MAX_PROGRESS_LINES, NARRATION_RULE, addProgressLine, sameProgress } from '../src/narration';

describe('the narration rule', () => {
  it('asks for a line before each tool batch, a line after a finding, and a plan for a self-contained ask', () => {
    expect(NARRATION_RULE).toMatch(/Before each group of tool calls/);
    expect(NARRATION_RULE).toMatch(/what you found and what you will do next/);
    expect(NARRATION_RULE).toMatch(/one-line plan/);
    expect(NARRATION_RULE).not.toMatch(/—|;/);
  });
});

describe('addProgressLine', () => {
  it('skips empty and repeated blocks, so a caller can skip the update', () => {
    const one = addProgressLine([], '  I will check the library.  ');
    expect(one).toEqual(['I will check the library.']);
    expect(addProgressLine(one, 'I will check the library.')).toBe(one);
    expect(addProgressLine(one, '   ')).toBe(one);
  });
  it('keeps the newest lines and clips a long block', () => {
    let lines: readonly string[] = [];
    for (let i = 0; i < MAX_PROGRESS_LINES + 3; i++) lines = addProgressLine(lines, `line ${i}`);
    expect(lines.length).toBe(MAX_PROGRESS_LINES);
    expect(lines[0]).toBe('line 3');
    const long = addProgressLine([], 'x'.repeat(MAX_PROGRESS_CHARS * 2));
    expect(long[0]!.length).toBe(MAX_PROGRESS_CHARS);
    expect(long[0]!.endsWith('…')).toBe(true);
  });
  it('sameProgress compares in order', () => {
    expect(sameProgress(undefined, [])).toBe(true);
    expect(sameProgress(['a'], ['a'])).toBe(true);
    expect(sameProgress(['a', 'b'], ['b', 'a'])).toBe(false);
  });
});
